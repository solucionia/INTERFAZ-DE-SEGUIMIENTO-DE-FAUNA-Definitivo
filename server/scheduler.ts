import cron from "node-cron";
import { storage } from "./storage";
import { fetchMovebankEvents } from "./movebank";
import { detectEvents } from "./eventDetection";
import { sendEventAlert, sendEmissionSummaryEmail, sendImmobilityAlertEmail } from "./emailService";
import { DEFAULT_THRESHOLDS, type EventThresholds } from "@shared/schema";
import { decrypt } from "./encryption";
import { log } from "./index";

const CRON_INTERVAL = process.env.CRON_INTERVAL || "0 */6 * * *";

async function runEventDetection() {
  const startTime = Date.now();
  log("Cron: Iniciando deteccion automatica de eventos...", "cron");

  try {
    const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();
    let totalEvents = 0;
    let totalEmails = 0;

    for (const { study, activeIndividuals } of studiesWithAnimals) {
      const studyStartTime = Date.now();
      log(`Cron: Iniciando detección de eventos para estudio: ${study.name}`, "cron");

      let thresholds: EventThresholds = DEFAULT_THRESHOLDS;
      if (study.speciesProfileId) {
        const profile = await storage.getSpeciesProfile(study.speciesProfileId);
        if (profile) thresholds = profile.thresholds as EventThresholds;
      }

      const now = Date.now();
      const sixHoursAgo = now - 6 * 60 * 60 * 1000;
      let studyEvents = 0;

      let decryptedUsername: string;
      let decryptedPassword: string;
      try {
        decryptedUsername = decrypt(study.movebankUsername);
        decryptedPassword = decrypt(study.movebankPassword);
      } catch (e: any) {
        log(`Cron: Error descifrando credenciales para estudio "${study.name}": ${e.message}`, "cron");
        continue;
      }

      for (const animal of activeIndividuals) {
        try {
          const [gpsRows, accRows] = await Promise.all([
            fetchMovebankEvents(study.movebankStudyId, decryptedUsername, decryptedPassword, animal.localIdentifier, 653, sixHoursAgo, now),
            fetchMovebankEvents(study.movebankStudyId, decryptedUsername, decryptedPassword, animal.localIdentifier, 2365683, sixHoursAgo, now),
          ]);

          const gpsSamples = gpsRows
            .filter((r) => r.location_lat && r.location_long)
            .map((r) => ({
              timestamp: new Date(r.timestamp).getTime(),
              lat: parseFloat(r.location_lat),
              lng: parseFloat(r.location_long),
            }))
            .filter((p) => !isNaN(p.lat) && !isNaN(p.lng) && !isNaN(p.timestamp));

          const gpsToCache = gpsRows
            .filter((r) => r.location_lat && r.location_long)
            .map((r) => ({
              studyId: study.id,
              individualLocalIdentifier: animal.localIdentifier,
              timestamp: new Date(r.timestamp).getTime(),
              latitude: parseFloat(r.location_lat),
              longitude: parseFloat(r.location_long),
              groundSpeed: r.ground_speed ? parseFloat(r.ground_speed) : null,
              heading: r.heading ? parseFloat(r.heading) : null,
              heightAboveEllipsoid: r.height_above_ellipsoid ? parseFloat(r.height_above_ellipsoid) : null,
            }))
            .filter((p) => !isNaN(p.timestamp) && !isNaN(p.latitude) && !isNaN(p.longitude));
          if (gpsToCache.length > 0) {
            await storage.insertCachedGpsEvents(gpsToCache);
            await storage.recordFetchedRange(study.id, animal.localIdentifier, "gps", sixHoursAgo, now);
          }

          const accSamples: { timestamp: number; x: number; y: number; z: number }[] = [];
          const accToCache: { studyId: string; individualLocalIdentifier: string; timestamp: number; xAcceleration: number; yAcceleration: number; zAcceleration: number; rawData: string | null }[] = [];
          for (const r of accRows) {
            const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
            const ts = new Date(r.timestamp).getTime();
            if (isNaN(ts)) continue;
            if (rawAxes) {
              const vals = rawAxes.split(/\s+/).map(Number);
              for (let i = 0; i + 2 < vals.length; i += 3) {
                if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
                  accSamples.push({ timestamp: ts + i * 10, x: vals[i], y: vals[i + 1], z: vals[i + 2] });
                  accToCache.push({
                    studyId: study.id,
                    individualLocalIdentifier: animal.localIdentifier,
                    timestamp: ts + i * 10,
                    xAcceleration: vals[i],
                    yAcceleration: vals[i + 1],
                    zAcceleration: vals[i + 2],
                    rawData: i === 0 ? rawAxes : null,
                  });
                }
              }
            } else {
              accSamples.push({
                timestamp: ts,
                x: parseFloat(r.acceleration_x || "0"),
                y: parseFloat(r.acceleration_y || "0"),
                z: parseFloat(r.acceleration_z || "0"),
              });
              accToCache.push({
                studyId: study.id,
                individualLocalIdentifier: animal.localIdentifier,
                timestamp: ts,
                xAcceleration: parseFloat(r.acceleration_x || "0"),
                yAcceleration: parseFloat(r.acceleration_y || "0"),
                zAcceleration: parseFloat(r.acceleration_z || "0"),
                rawData: null,
              });
            }
          }
          if (accToCache.length > 0) {
            await storage.insertCachedAccEvents(accToCache);
            await storage.recordFetchedRange(study.id, animal.localIdentifier, "acc", sixHoursAgo, now);
          }

          if (accSamples.length > 0) {
            const detected = detectEvents(accSamples, gpsSamples, thresholds, study.id, animal.localIdentifier);

            for (const event of detected) {
              const saved = await storage.createDetectedEvent(event);
              totalEvents++;
              studyEvents++;

              if (study.alertEmail && (event.severity === "critical" || event.severity === "high")) {
                const alreadySent = await storage.getAlertLog(saved.id, study.alertEmail);
                if (!alreadySent) {
                  const sent = await sendEventAlert(saved, study.alertEmail, study.name);
                  if (sent) {
                    await storage.createAlertLog(saved.id, study.alertEmail);
                    totalEmails++;
                  }
                }
              }
            }
          }
        } catch (e: any) {
          log(`Cron: Error en Movebank para estudio "${study.name}", animal "${animal.localIdentifier}": ${e.message}`, "cron");
        }
      }

      const studyDuration = ((Date.now() - studyStartTime) / 1000).toFixed(1);
      log(`Cron: Detección completada para ${study.name}: ${studyEvents} eventos encontrados (${studyDuration}s)`, "cron");
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("event_detection", "success", `${totalEvents} eventos, ${totalEmails} emails, duración: ${totalDuration}s`);
    log(`Cron: Deteccion completada - ${totalEvents} eventos, ${totalEmails} emails (${totalDuration}s)`, "cron");
  } catch (e: any) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("event_detection", "error", `${e.message} (duración: ${totalDuration}s)`);
    log(`Cron: Error en deteccion: ${e.message} (${totalDuration}s)`, "cron");
  }
}

async function runEmissionCheck() {
  const startTime = Date.now();
  log("Cron: Verificando alertas de emision...", "cron");

  try {
    const alerts = await storage.getAllActiveEmissionAlerts();
    if (alerts.length === 0) {
      log("Cron: No hay alertas de emisión activas", "cron");
      return;
    }

    const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();
    const now = Date.now();
    let totalAlertsSent = 0;

    for (const alert of alerts) {
      if (alert.lastSentAt) {
        const hoursSinceLast = (now - new Date(alert.lastSentAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLast < 24) continue;
      }

      const cutoffMs = alert.daysThreshold * 24 * 60 * 60 * 1000;
      const silentAnimals: {
        animalId: string;
        studyName: string;
        lastEmission: number | null;
        daysSilent: number | null;
        lat: number | null;
        lng: number | null;
      }[] = [];

      const userStudies = await storage.getStudiesForUser(alert.userId);
      const user = await storage.getUser(alert.userId);
      const isSuperuser = user?.role === "superuser";

      const accessibleStudies = isSuperuser
        ? studiesWithAnimals
        : studiesWithAnimals.filter((s) => userStudies.some((us) => us.id === s.study.id));

      for (const { study, activeIndividuals } of accessibleStudies) {
        let emDecryptedUsername: string;
        let emDecryptedPassword: string;
        try {
          emDecryptedUsername = decrypt(study.movebankUsername);
          emDecryptedPassword = decrypt(study.movebankPassword);
        } catch (e: any) {
          log(`Cron: Error descifrando credenciales para estudio "${study.name}" en emisión: ${e.message}`, "cron");
          continue;
        }

        for (const animal of activeIndividuals) {
          try {
            const recentWindow = now - cutoffMs * 2;
            const gpsEvents = await fetchMovebankEvents(
              study.movebankStudyId,
              emDecryptedUsername,
              emDecryptedPassword,
              animal.localIdentifier,
              653,
              recentWindow,
              now
            );

            let lastTs: number | null = null;
            let lastLat: number | null = null;
            let lastLng: number | null = null;

            for (const ev of gpsEvents) {
              const ts = new Date(ev.timestamp).getTime();
              if (!isNaN(ts) && (lastTs === null || ts > lastTs)) {
                lastTs = ts;
                if (ev.location_lat && ev.location_long) {
                  const lat = parseFloat(ev.location_lat);
                  const lng = parseFloat(ev.location_long);
                  if (!isNaN(lat) && !isNaN(lng)) {
                    lastLat = lat;
                    lastLng = lng;
                  }
                }
              }
            }

            const daysSilent = lastTs ? Math.floor((now - lastTs) / (24 * 60 * 60 * 1000)) : null;

            if (daysSilent === null || daysSilent >= alert.daysThreshold) {
              silentAnimals.push({
                animalId: animal.localIdentifier,
                studyName: study.name,
                lastEmission: lastTs,
                daysSilent,
                lat: lastLat,
                lng: lastLng,
              });
            }
          } catch (e: any) {
            log(`Cron: Error comprobando emisión de "${animal.localIdentifier}" en estudio "${study.name}": ${e.message}`, "cron");
          }
        }
      }

      if (silentAnimals.length > 0) {
        const sent = await sendEmissionSummaryEmail(alert.email, silentAnimals, alert.daysThreshold);
        if (sent) {
          await storage.updateEmissionAlertLastSent(alert.id);
          totalAlertsSent++;
        }
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("emission_check", "success", `${totalAlertsSent} alertas enviadas (${totalDuration}s)`);
    log(`Cron: Verificacion de emision completada - ${totalAlertsSent} alertas (${totalDuration}s)`, "cron");
  } catch (e: any) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("emission_check", "error", `${e.message} (duración: ${totalDuration}s)`);
    log(`Cron: Error en verificacion de emision: ${e.message} (${totalDuration}s)`, "cron");
  }
}

async function runImmobilityCheck() {
  const startTime = Date.now();
  log("Cron: Iniciando chequeo de inmovilidad/mortalidad...", "cron");

  try {
    const { analyzeImmobility } = await import("./immobilityDetector");
    const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();
    let totalAlerts = 0;
    let totalEmails = 0;

    for (const { study } of studiesWithAnimals) {
      try {
        const result = await analyzeImmobility(study.id);
        const alertCount = result.immobilityAlerts.length + result.noTransmissionAlerts.length;
        totalAlerts += alertCount;

        if (study.alertEmail && result.immobilityAlerts.length > 0) {
          const sent = await sendImmobilityAlertEmail(
            study.alertEmail,
            study.name,
            result.immobilityAlerts
          );
          if (sent) totalEmails++;
        }

        if (alertCount > 0) {
          log(`Cron: Inmovilidad ${study.name}: ${result.immobilityAlerts.length} inmoviles, ${result.noTransmissionAlerts.length} sin transmision`, "cron");
        }
      } catch (e: any) {
        log(`Cron: Error en inmovilidad para "${study.name}": ${e.message}`, "cron");
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("immobility_check", "success", `${totalAlerts} alertas, ${totalEmails} emails (${totalDuration}s)`);
    log(`Cron: Chequeo de inmovilidad completado - ${totalAlerts} alertas, ${totalEmails} emails (${totalDuration}s)`, "cron");
  } catch (e: any) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("immobility_check", "error", `${e.message} (${totalDuration}s)`);
    log(`Cron: Error en chequeo de inmovilidad: ${e.message} (${totalDuration}s)`, "cron");
  }
}

export function startScheduler() {
  log(`Cron: Programando tareas con intervalo "${CRON_INTERVAL}"`, "cron");

  cron.schedule(CRON_INTERVAL, async () => {
    log("Cron: Ejecutando tareas programadas...", "cron");
    await runEventDetection();
    await runEmissionCheck();
    await runImmobilityCheck();
  });

  log("Cron: Scheduler iniciado correctamente", "cron");
}
