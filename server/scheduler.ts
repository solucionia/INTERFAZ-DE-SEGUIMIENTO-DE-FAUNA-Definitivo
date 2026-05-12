import cron from "node-cron";
import { storage } from "./storage";
import { fetchMovebankEvents, MovebankError } from "./movebank";
import { detectEvents } from "./eventDetection";
import { sendEventAlert, sendEmissionSummaryEmail, sendImmobilityAlertEmail, sendCriticalImmobilityEmail, type CriticalImmobilityEmailRow } from "./emailService";
import { DEFAULT_THRESHOLDS, normalizeThresholds, type EventThresholds } from "@shared/schema";
import { decrypt } from "./encryption";
import { log } from "./index";
import { movebankRateLimiter, movebankDelay } from "./movebankRateLimit";
import { ornitelaSync } from "./ornitelaSync";
import { parseOrnitelaCsv } from "./ornitelaCsvParser";

const CRON_INTERVAL = process.env.CRON_INTERVAL || "0 */6 * * *";

const SCHEDULER_MAX_BACKFILL_DAYS = 30;
const MIN_GAP_MS = 60 * 1000;

async function computeBackfillRange(
  studyId: string,
  individualLocalId: string,
  sensorType: "gps" | "acc",
  now: number,
  maxBackfillDays: number,
): Promise<{ fromTs: number; toTs: number } | null> {
  const cap = now - maxBackfillDays * 24 * 60 * 60 * 1000;
  const range = await storage.getCachedTimestampRange(studyId, individualLocalId, sensorType);
  let fromTs: number;
  if (range && Number.isFinite(range.max) && range.max > 0) {
    fromTs = Math.max(range.max + 1, cap);
  } else {
    fromTs = cap;
  }
  if (fromTs >= now - MIN_GAP_MS) return null;
  return { fromTs, toTs: now };
}

async function runEventDetection() {
  const startTime = Date.now();
  log("Cron: Iniciando deteccion automatica de eventos...", "cron");

  let syncStudies = 0;
  let syncAnimals = 0;
  let syncGpsRows = 0;
  let syncAccRows = 0;
  let syncStoppedByRateLimit = false;
  let syncErrors = 0;
  let syncGpsAttempts = 0;
  let syncGpsZeroAnimals = 0;

  try {
    const blockCheck = movebankRateLimiter.isBlocked();
    if (blockCheck.blocked) {
      log(`Cron: Movebank bloqueado — ${blockCheck.reason}. Saltando detección de eventos.`, "cron");
      await storage.createCronLog("event_detection", "skipped", blockCheck.reason);
      await storage.createCronLog("movebank_sync", "skipped", blockCheck.reason);
      return;
    }

    const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();
    let totalEvents = 0;
    let totalEmails = 0;

    studyLoop: for (const { study, activeIndividuals } of studiesWithAnimals) {
      const studyBlockCheck = movebankRateLimiter.isBlocked();
      if (studyBlockCheck.blocked) {
        log(`Cron: Movebank bloqueado durante ejecución — saltando estudios restantes`, "cron");
        syncStoppedByRateLimit = true;
        break;
      }

      const studyStartTime = Date.now();
      log(`Cron: Iniciando detección de eventos para estudio: ${study.name}`, "cron");

      let thresholds: EventThresholds = DEFAULT_THRESHOLDS;
      if (study.speciesProfileId) {
        const profile = await storage.getSpeciesProfile(study.speciesProfileId);
        if (profile) thresholds = normalizeThresholds(profile.thresholds);
      }

      const now = Date.now();
      let studyEvents = 0;

      if (!study.movebankStudyId || !study.movebankUsername || !study.movebankPassword) {
        log(`Cron: Estudio "${study.name}" no tiene credenciales de Movebank, omitiendo`, "cron");
        continue;
      }

      let decryptedUsername: string;
      let decryptedPassword: string;
      try {
        decryptedUsername = decrypt(study.movebankUsername);
        decryptedPassword = decrypt(study.movebankPassword);
      } catch (e: any) {
        log(`Cron: Error descifrando credenciales para estudio "${study.name}": ${e.message}`, "cron");
        continue;
      }

      syncStudies++;

      for (const animal of activeIndividuals) {
        const gpsBlock = movebankRateLimiter.isBlocked();
        if (gpsBlock.blocked) {
          log(`Cron: Rate limit alcanzado durante "${study.name}" — parando sync`, "cron");
          syncStoppedByRateLimit = true;
          break studyLoop;
        }

        const gpsBackfill = await computeBackfillRange(study.id, animal.localIdentifier, "gps", now, SCHEDULER_MAX_BACKFILL_DAYS);
        const accBackfill = await computeBackfillRange(study.id, animal.localIdentifier, "acc", now, SCHEDULER_MAX_BACKFILL_DAYS);

        if (!gpsBackfill && !accBackfill) {
          continue;
        }

        syncAnimals++;

        try {
          let gpsRows: Record<string, string>[] = [];
          if (gpsBackfill) {
            gpsRows = await fetchMovebankEvents(study.movebankStudyId, decryptedUsername, decryptedPassword, animal.localIdentifier, 653, gpsBackfill.fromTs, gpsBackfill.toTs);
            await movebankDelay();
          }

          const accBlock = movebankRateLimiter.isBlocked();
          if (accBlock.blocked) {
            syncStoppedByRateLimit = true;
          }

          let accRows: Record<string, string>[] = [];
          if (accBackfill && !syncStoppedByRateLimit) {
            accRows = await fetchMovebankEvents(study.movebankStudyId, decryptedUsername, decryptedPassword, animal.localIdentifier, 2365683, accBackfill.fromTs, accBackfill.toTs);
            await movebankDelay();
          }

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
            syncGpsRows += gpsToCache.length;
          }
          if (gpsBackfill) {
            syncGpsAttempts++;
            if (gpsToCache.length === 0) syncGpsZeroAnimals++;
            await storage.recordFetchedRange(study.id, animal.localIdentifier, "gps", gpsBackfill.fromTs, gpsBackfill.toTs);
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
            syncAccRows += accToCache.length;
          }
          if (accBackfill && !syncStoppedByRateLimit) {
            await storage.recordFetchedRange(study.id, animal.localIdentifier, "acc", accBackfill.fromTs, accBackfill.toTs);
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
          syncErrors++;
          const isRateLimit = (e instanceof MovebankError && e.statusCode === 429) || (e?.statusCode === 429);
          if (isRateLimit) {
            syncStoppedByRateLimit = true;
            log(`Cron: 429 detectado en "${study.name}/${animal.localIdentifier}" — parando sync`, "cron");
            break studyLoop;
          }
          log(`Cron: Error en Movebank para estudio "${study.name}", animal "${animal.localIdentifier}": ${e.message}`, "cron");
        }
      }

      const studyDuration = ((Date.now() - studyStartTime) / 1000).toFixed(1);
      log(`Cron: Detección completada para ${study.name}: ${studyEvents} eventos encontrados (${studyDuration}s)`, "cron");
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("event_detection", "success", `${totalEvents} eventos, ${totalEmails} emails, duración: ${totalDuration}s`);
    const syncStatus = syncStoppedByRateLimit ? "partial" : "success";
    const syncDetails = `${syncStudies} estudios, ${syncAnimals} animales, ${syncGpsRows} GPS, ${syncAccRows} ACC, errores: ${syncErrors}, cortado: ${syncStoppedByRateLimit}, duración: ${totalDuration}s`;
    await storage.createCronLog("movebank_sync", syncStatus, syncDetails);
    log(`Cron: Deteccion completada - ${totalEvents} eventos, ${totalEmails} emails (${totalDuration}s)`, "cron");
    log(`Cron: Sync Movebank - ${syncDetails}`, "cron");

    if (syncGpsAttempts >= 5) {
      const zeroPct = (syncGpsZeroAnimals / syncGpsAttempts) * 100;
      if (zeroPct > 80) {
        log(`Cron: WARN: Posible problema con parámetros Movebank: ${zeroPct.toFixed(1)}% de animales (${syncGpsZeroAnimals}/${syncGpsAttempts}) devolvieron 0 GPS`, "cron");
        await storage.createCronLog("movebank_sync_anomaly", "warn", `${zeroPct.toFixed(1)}% animales con 0 GPS (${syncGpsZeroAnimals}/${syncGpsAttempts})`);
      }
    }
  } catch (e: any) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("event_detection", "error", `${e.message} (duración: ${totalDuration}s)`);
    await storage.createCronLog("movebank_sync", "error", `${e.message} | parcial: ${syncStudies}e/${syncAnimals}a/${syncGpsRows}g/${syncAccRows}a | duración: ${totalDuration}s`);
    log(`Cron: Error en deteccion: ${e.message} (${totalDuration}s)`, "cron");
  }
}

async function runEmissionCheck() {
  const startTime = Date.now();
  log("Cron: Verificando alertas de emision...", "cron");

  try {
    const blockCheck = movebankRateLimiter.isBlocked();
    if (blockCheck.blocked) {
      log(`Cron: Movebank bloqueado — ${blockCheck.reason}. Saltando verificación de emisión.`, "cron");
      return;
    }

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
        if (!study.movebankStudyId || !study.movebankUsername || !study.movebankPassword) {
          continue;
        }

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
            await movebankDelay();

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

const CRITICAL_ALERT_RECIPIENT = process.env.IMMOBILITY_ALERT_EMAIL || "jjiglesias@grefa.org";

let immobilityCheckRunning = false;

async function runImmobilityCheck() {
  if (immobilityCheckRunning) {
    log("Cron: Chequeo de inmovilidad ya en ejecución — omitiendo disparo concurrente", "cron");
    return;
  }
  immobilityCheckRunning = true;
  const startTime = Date.now();
  log("Cron: Iniciando chequeo de inmovilidad/mortalidad...", "cron");

  try {
    const { analyzeImmobility } = await import("./immobilityDetector");
    const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();
    let totalAlerts = 0;
    let totalEmails = 0;
    let totalNewCritical = 0;
    let totalResolved = 0;
    const aggregatedCritical: CriticalImmobilityEmailRow[] = [];

    for (const { study } of studiesWithAnimals) {
      try {
        const result = await analyzeImmobility(study.id);
        const alertCount = result.immobilityAlerts.length + result.noTransmissionAlerts.length;
        totalAlerts += alertCount;
        totalNewCritical += result.newCriticalAlerts.length;
        totalResolved += result.resolvedCount;

        if (study.alertEmail && result.immobilityAlerts.length > 0) {
          const sent = await sendImmobilityAlertEmail(
            study.alertEmail,
            study.name,
            result.immobilityAlerts
          );
          if (sent) totalEmails++;
        }

        for (const c of result.newCriticalAlerts) {
          aggregatedCritical.push({
            individual: c.individual,
            species: c.species,
            type: c.type,
            studyName: c.studyName,
            hoursSinceLast: c.hoursSinceLast,
            hoursImmobile: c.hoursImmobile,
            lastTransmission: c.lastTransmission,
            lat: c.lat,
            lon: c.lon,
            kmOutside: c.kmOutside,
          });
        }

        const zoneCount = result.zoneDeviationAlerts.length;
        const totalForLog = alertCount + zoneCount;
        if (totalForLog > 0 || result.resolvedCount > 0) {
          log(`Cron: Inmovilidad ${study.name}: ${result.immobilityAlerts.length} inmoviles, ${result.noTransmissionAlerts.length} sin transmision, ${zoneCount} fuera de zona, ${result.newCriticalAlerts.length} nuevas criticas, ${result.resolvedCount} resueltas`, "cron");
        }
      } catch (e: any) {
        log(`Cron: Error en inmovilidad para "${study.name}": ${e.message}`, "cron");
      }
    }

    if (aggregatedCritical.length > 0) {
      const sent = await sendCriticalImmobilityEmail(CRITICAL_ALERT_RECIPIENT, aggregatedCritical);
      if (sent) totalEmails++;
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `${totalAlerts} alertas, ${totalNewCritical} nuevas criticas, ${totalResolved} resueltas, ${totalEmails} emails (${totalDuration}s)`;
    await storage.createCronLog("immobility_check", "success", summary);
    log(`Cron: Chequeo de inmovilidad completado - ${summary}`, "cron");
  } catch (e: any) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("immobility_check", "error", `${e.message} (${totalDuration}s)`);
    log(`Cron: Error en chequeo de inmovilidad: ${e.message} (${totalDuration}s)`, "cron");
  } finally {
    immobilityCheckRunning = false;
  }
}

async function runOrnitelaSync() {
  const startTime = Date.now();
  log("Cron: Iniciando sincronización Ornitela...", "cron");

  try {
    const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();
    const ornitelaStudies = studiesWithAnimals.filter(
      ({ study }) => study.ornitelaEnabled === true
    );

    if (ornitelaStudies.length === 0) {
      log("Cron: No hay estudios con Ornitela habilitado", "cron");
      return;
    }

    let totalDevices = 0;
    let totalGps = 0;
    let totalAcc = 0;
    let studiesSynced = 0;

    for (const { study } of ornitelaStudies) {
      try {
        const syncIntervalHours = study.ornitelaSyncIntervalHours || 6;
        if (study.ornitelaLastSync) {
          const lastSyncTime = new Date(study.ornitelaLastSync).getTime();
          const hoursSinceLastSync = (Date.now() - lastSyncTime) / (1000 * 60 * 60);
          if (hoursSinceLastSync < syncIntervalHours) {
            log(`Cron: Ornitela estudio "${study.name}" sincronizado hace ${hoursSinceLastSync.toFixed(1)}h, intervalo ${syncIntervalHours}h — omitiendo`, "cron");
            continue;
          }
        }

        const decryptedStudy = await storage.getStudyDecrypted(study.id);
        if (!decryptedStudy || !decryptedStudy.ornitelaPanelUrl || !decryptedStudy.ornitelaUsername || !decryptedStudy.ornitelaPassword) {
          log(`Cron: Ornitela estudio "${study.name}" no tiene credenciales completas, omitiendo`, "cron");
          continue;
        }

        const panelUrl = decryptedStudy.ornitelaPanelUrl;
        const username = decryptedStudy.ornitelaUsername;
        const password = decryptedStudy.ornitelaPassword;

        const session = await ornitelaSync.login(panelUrl, username, password);
        const devices = await ornitelaSync.getDeviceList(panelUrl, session);

        if (devices.length === 0) {
          log(`Cron: Ornitela estudio "${study.name}" — no se encontraron dispositivos`, "cron");
          continue;
        }

        const hoursBack = Math.max(syncIntervalHours * 2, 6);
        const now = new Date();
        const fromDate = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

        const formatDate = (d: Date): string => {
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(d.getUTCDate()).padStart(2, "0");
          const hh = String(d.getUTCHours()).padStart(2, "0");
          const min = String(d.getUTCMinutes()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
        };

        const fromStr = formatDate(fromDate);
        const toStr = formatDate(now);

        log(`Cron: Ornitela estudio "${study.name}" — descargando ${devices.length} dispositivos, rango ${fromStr} - ${toStr}`, "cron");

        const csvResults = await ornitelaSync.downloadAllDevicesCSV(panelUrl, session, devices, fromStr, toStr);

        let studyGps = 0;
        let studyAcc = 0;

        for (const result of csvResults) {
          if (result.error || !result.csv || result.csv.trim().length === 0) {
            if (result.error) {
              log(`Cron: Ornitela dispositivo ${result.name} (${result.imei}) error: ${result.error}`, "cron");
            }
            continue;
          }

          try {
            const parseResult = await parseOrnitelaCsv(result.csv, study.id, storage);
            studyGps += parseResult.gpsImported;
            studyAcc += parseResult.accImported;
          } catch (parseErr: any) {
            log(`Cron: Ornitela error parseando CSV de ${result.name} (${result.imei}): ${parseErr.message}`, "cron");
          }
        }

        await storage.updateStudy(study.id, { ornitelaLastSync: new Date() } as any);

        totalDevices += devices.length;
        totalGps += studyGps;
        totalAcc += studyAcc;
        studiesSynced++;

        log(`Cron: Ornitela estudio "${study.name}" completado — ${devices.length} dispositivos, ${studyGps} GPS, ${studyAcc} ACC`, "cron");
      } catch (studyErr: any) {
        log(`Cron: Error en Ornitela para estudio "${study.name}": ${studyErr.message}`, "cron");
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("ornitela_sync", "success", `${studiesSynced} estudios, ${totalDevices} dispositivos, ${totalGps} GPS, ${totalAcc} ACC (${totalDuration}s)`);
    log(`Cron: Sincronización Ornitela completada — ${studiesSynced} estudios, ${totalDevices} dispositivos, ${totalGps} GPS, ${totalAcc} ACC (${totalDuration}s)`, "cron");
  } catch (e: any) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    await storage.createCronLog("ornitela_sync", "error", `${e.message} (duración: ${totalDuration}s)`);
    log(`Cron: Error en sincronización Ornitela: ${e.message} (${totalDuration}s)`, "cron");
  }
}

export {
  runEventDetection,
  runEmissionCheck,
  runImmobilityCheck,
  runOrnitelaSync,
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const CATCHUP_DELAY_MS = 5000;

let catchupChecked = false;
let catchupRunning = false;

async function runAllScheduledTasks(label: string) {
  log(`Cron: ${label} — ejecutando event detection`, "cron");
  await runEventDetection();
  log(`Cron: ${label} — ejecutando emission check`, "cron");
  await runEmissionCheck();
  // Inmovilidad ya tiene su propio cron de 2h con mutex; no la incluimos aquí
  // para evitar overlap en horas alineadas (0/6/12/18h).
  log(`Cron: ${label} — ejecutando Ornitela sync`, "cron");
  await runOrnitelaSync();
}

async function maybeRunStartupCatchup() {
  if (catchupChecked) return;
  catchupChecked = true;

  try {
    const [lastDetection, lastCatchup] = await Promise.all([
      storage.getLastCronRunAt("event_detection"),
      storage.getLastCronRunAt("startup_catchup"),
    ]);

    const now = Date.now();
    const lastTs = Math.max(
      lastDetection ? lastDetection.getTime() : 0,
      lastCatchup ? lastCatchup.getTime() : 0,
    );

    if (lastTs > 0 && now - lastTs < SIX_HOURS_MS) {
      const hoursAgo = ((now - lastTs) / (60 * 60 * 1000)).toFixed(1);
      log(`Cron: Última ejecución hace ${hoursAgo}h — no se requiere catch-up al arranque`, "cron");
      return;
    }

    if (catchupRunning) return;
    catchupRunning = true;

    const reason = lastTs > 0
      ? `${((now - lastTs) / (60 * 60 * 1000)).toFixed(1)}h desde última ejecución`
      : "sin ejecuciones previas registradas";

    log(`Cron: Catch-up al arranque (${reason}) — disparando tareas...`, "cron");
    // Marca temprana para que otros procesos / instancias autoscale que arranquen
    // simultáneamente vean un registro reciente y omitan el catch-up duplicado.
    await storage.createCronLog("startup_catchup", "running", reason);

    const startTime = Date.now();
    try {
      await runAllScheduledTasks("startup-catchup");
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      await storage.createCronLog("startup_catchup", "success", `${reason} (duración: ${totalDuration}s)`);
      log(`Cron: Catch-up al arranque completado (${totalDuration}s)`, "cron");
    } catch (e: any) {
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      await storage.createCronLog("startup_catchup", "error", `${e?.message || e} (duración: ${totalDuration}s)`);
      log(`Cron: Error en catch-up al arranque: ${e?.message || e}`, "cron");
    } finally {
      catchupRunning = false;
    }
  } catch (e: any) {
    log(`Cron: Error comprobando catch-up al arranque: ${e?.message || e}`, "cron");
  }
}

const IMMOBILITY_CRON_INTERVAL = process.env.IMMOBILITY_CRON_INTERVAL || "*/30 * * * *";

export function startScheduler() {
  log(`Cron: Programando tareas con intervalo "${CRON_INTERVAL}"`, "cron");

  cron.schedule(CRON_INTERVAL, async () => {
    log("Cron: Ejecutando tareas programadas...", "cron");
    await runAllScheduledTasks("scheduled");
  });

  log(`Cron: Programando chequeo de inmovilidad cada "${IMMOBILITY_CRON_INTERVAL}"`, "cron");
  cron.schedule(IMMOBILITY_CRON_INTERVAL, async () => {
    log("Cron: Ejecutando chequeo de inmovilidad (2h)...", "cron");
    await runImmobilityCheck();
  });

  // Catch-up al arranque para entornos Autoscale: si han pasado más de 6h
  // desde la última ejecución (o no hay registros), ejecutar inmediatamente
  // tras un pequeño retraso para no bloquear el arranque del servidor.
  setTimeout(() => {
    void maybeRunStartupCatchup();
  }, CATCHUP_DELAY_MS);

  log("Cron: Scheduler iniciado correctamente", "cron");
}
