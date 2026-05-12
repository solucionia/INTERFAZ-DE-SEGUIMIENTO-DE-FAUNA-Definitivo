import { storage } from "./storage";
import type { CachedGpsEvent } from "@shared/schema";
import { log } from "./index";

export interface ImmobilityConfig {
  hoursToAnalyze: number;
  immobilityThresholdHours: number;
  noTransmissionThresholdHours: number;
  speedThreshold: number;
  positionChangeThreshold: number;
}

export const DEFAULT_IMMOBILITY_CONFIG: ImmobilityConfig = {
  hoursToAnalyze: 96,
  immobilityThresholdHours: 24,
  noTransmissionThresholdHours: 48,
  speedThreshold: 0.5,
  positionChangeThreshold: 0.0001,
};

interface PreparedPoint {
  individual: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  groundSpeed: number | null;
  timeDiffHours: number | null;
  distance: number | null;
  speedCalculated: number | null;
}

interface AnalyzedPoint extends PreparedPoint {
  isImmobile: boolean;
  immobilityGroupId: number | null;
}

export interface ImmobilityAlert {
  individual: string;
  species: string;
  alertStart: number;
  alertEnd: number;
  hoursImmobile: number;
  daysImmobile: number;
  numRecords: number;
  lastLat: number;
  lastLon: number;
  avgSpeed: number;
  maxSpeed: number;
  googleMapsUrl: string;
  status: string;
  severity: string;
}

export interface NoTransmissionAlert {
  individual: string;
  species: string;
  lastTransmission: number | null;
  hoursSinceLast: number | null;
  daysSinceLast: number | null;
  lastLat: number | null;
  lastLon: number | null;
  googleMapsUrl: string | null;
  status: string;
  severity: string;
}

export interface NewCriticalAlert {
  individual: string;
  species: string;
  type: "immobility" | "no_transmission";
  studyName: string;
  hoursSinceLast: number | null;
  hoursImmobile: number | null;
  lastTransmission: number | null;
  lat: number | null;
  lon: number | null;
}

export interface ImmobilityAnalysisResult {
  summary: {
    totalAnimals: number;
    transmitting: number;
    noTransmission: number;
    immobile: number;
    criticalAlerts: number;
    analyzedAt: number;
    config: ImmobilityConfig;
    excludedNoHistory: number;
  };
  immobilityAlerts: ImmobilityAlert[];
  noTransmissionAlerts: NoTransmissionAlert[];
  activeAnimals: {
    individual: string;
    species: string;
    lastTransmission: number;
    lastSpeed: number | null;
    lastLat: number;
    lastLon: number;
    status: string;
  }[];
  stats: {
    totalGpsPoints: number;
    immobilePoints: number;
    immobilityGroups: number;
  };
  newCriticalAlerts: NewCriticalAlert[];
  resolvedCount: number;
}

const METERS_PER_DEGREE = 111320;

function prepareData(gpsEvents: CachedGpsEvent[], config: ImmobilityConfig): PreparedPoint[] {
  const byAnimal = new Map<string, CachedGpsEvent[]>();
  for (const evt of gpsEvents) {
    const key = evt.individualLocalIdentifier;
    if (!byAnimal.has(key)) byAnimal.set(key, []);
    byAnimal.get(key)!.push(evt);
  }

  const prepared: PreparedPoint[] = [];
  byAnimal.forEach((events, individual) => {
    const sorted = events.sort((a: CachedGpsEvent, b: CachedGpsEvent) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      let timeDiffHours: number | null = null;
      let distance: number | null = null;
      let speedCalculated: number | null = null;

      if (i > 0) {
        const prev = sorted[i - 1];
        timeDiffHours = (curr.timestamp - prev.timestamp) / (1000 * 60 * 60);
        const dLat = curr.latitude - prev.latitude;
        const dLon = curr.longitude - prev.longitude;
        distance = Math.sqrt(dLat * dLat + dLon * dLon);

        if ((!curr.groundSpeed || curr.groundSpeed === 0) && timeDiffHours > 0) {
          speedCalculated = (distance * METERS_PER_DEGREE) / (timeDiffHours * 3600);
        }
      }

      prepared.push({
        individual,
        timestamp: curr.timestamp,
        latitude: curr.latitude,
        longitude: curr.longitude,
        groundSpeed: curr.groundSpeed,
        timeDiffHours,
        distance,
        speedCalculated,
      });
    }
  });

  return prepared;
}

function detectImmobility(preparedData: PreparedPoint[], config: ImmobilityConfig): AnalyzedPoint[] {
  let groupCounter = 0;
  let currentGroup: number | null = null;
  let prevIndividual: string | null = null;

  return preparedData.map((point) => {
    const speed = point.groundSpeed ?? point.speedCalculated ?? 0;
    const dist = point.distance ?? 0;
    const isImmobile = speed < config.speedThreshold && dist < config.positionChangeThreshold;

    if (point.individual !== prevIndividual) {
      currentGroup = null;
      prevIndividual = point.individual;
    }

    if (isImmobile) {
      if (currentGroup === null) {
        groupCounter++;
        currentGroup = groupCounter;
      }
    } else {
      currentGroup = null;
    }

    return {
      ...point,
      isImmobile,
      immobilityGroupId: isImmobile ? currentGroup : null,
    };
  });
}

function identifyMortalityEvents(
  analyzedData: AnalyzedPoint[],
  config: ImmobilityConfig,
  speciesMap: Map<string, string>
): ImmobilityAlert[] {
  const groups = new Map<number, AnalyzedPoint[]>();
  for (const point of analyzedData) {
    if (point.immobilityGroupId != null) {
      if (!groups.has(point.immobilityGroupId)) groups.set(point.immobilityGroupId, []);
      groups.get(point.immobilityGroupId)!.push(point);
    }
  }

  const alerts: ImmobilityAlert[] = [];
  groups.forEach((points) => {
    if (points.length < 2) return;
    const first = points[0];
    const last = points[points.length - 1];
    const durationHours = (last.timestamp - first.timestamp) / (1000 * 60 * 60);

    if (durationHours >= config.immobilityThresholdHours) {
      const speeds = points.map((p: AnalyzedPoint) => p.groundSpeed ?? p.speedCalculated ?? 0);
      const avgSpeed = speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length;
      const maxSpeed = Math.max(...speeds);

      alerts.push({
        individual: first.individual,
        species: speciesMap.get(first.individual) || "Desconocida",
        alertStart: first.timestamp,
        alertEnd: last.timestamp,
        hoursImmobile: Math.round(durationHours * 10) / 10,
        daysImmobile: Math.round((durationHours / 24) * 10) / 10,
        numRecords: points.length,
        lastLat: last.latitude,
        lastLon: last.longitude,
        avgSpeed: Math.round(avgSpeed * 1000) / 1000,
        maxSpeed: Math.round(maxSpeed * 1000) / 1000,
        googleMapsUrl: `https://www.google.com/maps?q=${last.latitude},${last.longitude}`,
        status: "INMÓVIL",
        severity: durationHours > 48 ? "critical" : "warning",
      });
    }
  });

  return alerts;
}

function checkTransmissionStatus(
  activeAnimals: { localIdentifier: string; movebankId: number }[],
  gpsEvents: CachedGpsEvent[],
  config: ImmobilityConfig,
  speciesMap: Map<string, string>,
  now: number
): { noTransmission: NoTransmissionAlert[]; active: ImmobilityAnalysisResult["activeAnimals"] } {
  const lastByAnimal = new Map<string, CachedGpsEvent>();
  for (const evt of gpsEvents) {
    const current = lastByAnimal.get(evt.individualLocalIdentifier);
    if (!current || evt.timestamp > current.timestamp) {
      lastByAnimal.set(evt.individualLocalIdentifier, evt);
    }
  }

  const noTransmission: NoTransmissionAlert[] = [];
  const active: ImmobilityAnalysisResult["activeAnimals"] = [];

  for (const animal of activeAnimals) {
    const lastEvt = lastByAnimal.get(animal.localIdentifier);

    if (!lastEvt) {
      noTransmission.push({
        individual: animal.localIdentifier,
        species: speciesMap.get(animal.localIdentifier) || "Desconocida",
        lastTransmission: null,
        hoursSinceLast: null,
        daysSinceLast: null,
        lastLat: null,
        lastLon: null,
        googleMapsUrl: null,
        status: "SIN TRANSMISIÓN",
        severity: "critical",
      });
      continue;
    }

    const hoursSince = (now - lastEvt.timestamp) / (1000 * 60 * 60);

    if (hoursSince >= config.noTransmissionThresholdHours) {
      noTransmission.push({
        individual: animal.localIdentifier,
        species: speciesMap.get(animal.localIdentifier) || "Desconocida",
        lastTransmission: lastEvt.timestamp,
        hoursSinceLast: Math.round(hoursSince * 10) / 10,
        daysSinceLast: Math.round((hoursSince / 24) * 10) / 10,
        lastLat: lastEvt.latitude,
        lastLon: lastEvt.longitude,
        googleMapsUrl: `https://www.google.com/maps?q=${lastEvt.latitude},${lastEvt.longitude}`,
        status: "SIN TRANSMISIÓN",
        severity: hoursSince > 96 ? "critical" : "warning",
      });
    } else {
      active.push({
        individual: animal.localIdentifier,
        species: speciesMap.get(animal.localIdentifier) || "Desconocida",
        lastTransmission: lastEvt.timestamp,
        lastSpeed: lastEvt.groundSpeed,
        lastLat: lastEvt.latitude,
        lastLon: lastEvt.longitude,
        status: "ACTIVO",
      });
    }
  }

  return { noTransmission, active };
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function analyzeImmobility(
  studyId: string,
  config: Partial<ImmobilityConfig> = {},
  options: { persist?: boolean } = {}
): Promise<ImmobilityAnalysisResult> {
  const cfg: ImmobilityConfig = { ...DEFAULT_IMMOBILITY_CONFIG, ...config };
  const persist = options.persist !== false;
  const now = Date.now();
  const startTime = now - cfg.hoursToAnalyze * 60 * 60 * 1000;

  log(`Immobility: Analizando estudio ${studyId} (${cfg.hoursToAnalyze}h, umbral ${cfg.immobilityThresholdHours}h, persist=${persist})`, "analysis");

  const studyData = await storage.getActiveStudiesWithDeployments();
  const studyInfo = studyData.find(s => s.study.id === studyId);
  if (!studyInfo) {
    return {
      summary: { totalAnimals: 0, transmitting: 0, noTransmission: 0, immobile: 0, criticalAlerts: 0, analyzedAt: now, config: cfg, excludedNoHistory: 0 },
      immobilityAlerts: [],
      noTransmissionAlerts: [],
      activeAnimals: [],
      stats: { totalGpsPoints: 0, immobilePoints: 0, immobilityGroups: 0 },
      newCriticalAlerts: [],
      resolvedCount: 0,
    };
  }

  const { study, activeIndividuals } = studyInfo;

  // Filtrar animales sin historial: si nunca han transmitido (no hay rango GPS en BD), excluir.
  const filteredIndividuals: { localIdentifier: string; movebankId: number }[] = [];
  let excludedNoHistory = 0;
  for (const animal of activeIndividuals) {
    const range = await storage.getCachedTimestampRange(studyId, animal.localIdentifier, "gps");
    if (!range || !Number.isFinite(range.max) || range.max <= 0) {
      excludedNoHistory++;
      continue;
    }
    filteredIndividuals.push(animal);
  }

  if (excludedNoHistory > 0) {
    log(`Immobility: Excluidos ${excludedNoHistory} animales sin historial GPS (lastTransmission=NULL)`, "analysis");
  }

  const allInds = await storage.getIndividuals(studyId);
  const speciesMap = new Map<string, string>();
  for (const ind of allInds) {
    if (ind.localIdentifier && ind.taxonCanonicalName) {
      speciesMap.set(ind.localIdentifier, ind.taxonCanonicalName);
    }
  }

  const allGpsEvents: CachedGpsEvent[] = [];
  for (const animal of filteredIndividuals) {
    const events = await storage.getCachedGpsEvents(studyId, animal.localIdentifier, startTime, now);
    allGpsEvents.push(...events);
  }

  log(`Immobility: ${allGpsEvents.length} GPS events para ${filteredIndividuals.length} animales`, "analysis");

  const prepared = prepareData(allGpsEvents, cfg);
  prepared.sort((a, b) => a.individual.localeCompare(b.individual) || a.timestamp - b.timestamp);
  const analyzed = detectImmobility(prepared, cfg);
  const immobilityAlerts = identifyMortalityEvents(analyzed, cfg, speciesMap);

  // Estado de transmisión basado en histórico COMPLETO, no solo en la ventana analizada.
  // Así detectamos animales que llevan mucho tiempo silenciados (>>96h) cuya última GPS
  // ya no aparece en `allGpsEvents`.
  const noTransmission: NoTransmissionAlert[] = [];
  const active: ImmobilityAnalysisResult["activeAnimals"] = [];

  for (const animal of filteredIndividuals) {
    const lastEvt = await storage.getLatestCachedGpsEvent(studyId, animal.localIdentifier);
    if (!lastEvt) {
      // Defensivo (no debería ocurrir tras filtro previo): saltar.
      continue;
    }
    const hoursSince = (now - lastEvt.timestamp) / (1000 * 60 * 60);
    const species = speciesMap.get(animal.localIdentifier) || "Desconocida";

    if (hoursSince >= cfg.noTransmissionThresholdHours) {
      noTransmission.push({
        individual: animal.localIdentifier,
        species,
        lastTransmission: lastEvt.timestamp,
        hoursSinceLast: Math.round(hoursSince * 10) / 10,
        daysSinceLast: Math.round((hoursSince / 24) * 10) / 10,
        lastLat: lastEvt.latitude,
        lastLon: lastEvt.longitude,
        googleMapsUrl: `https://www.google.com/maps?q=${lastEvt.latitude},${lastEvt.longitude}`,
        status: "SIN TRANSMISIÓN",
        severity: hoursSince > 96 ? "critical" : "warning",
      });
    } else {
      // Buscar groundSpeed real en la ventana si existe
      let lastSpeed: number | null = null;
      const windowEvts = allGpsEvents.filter(e => e.individualLocalIdentifier === animal.localIdentifier);
      if (windowEvts.length > 0) {
        const latestInWindow = windowEvts.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
        lastSpeed = latestInWindow.groundSpeed;
      }
      active.push({
        individual: animal.localIdentifier,
        species,
        lastTransmission: lastEvt.timestamp,
        lastSpeed,
        lastLat: lastEvt.latitude,
        lastLon: lastEvt.longitude,
        status: "ACTIVO",
      });
    }
  }

  const immobilePoints = analyzed.filter(p => p.isImmobile).length;
  const groupIds = new Set(analyzed.filter(p => p.immobilityGroupId != null).map(p => p.immobilityGroupId));

  const newCriticalAlerts: NewCriticalAlert[] = [];
  let resolvedCount = 0;

  if (persist) {
    // 1) Inmovilidad: dedupe 24h por (study, individual, type, resolvedStatus=false)
    for (const alert of immobilityAlerts) {
      try {
        const existing = await storage.findRecentUnresolvedDetectedEvent(
          studyId, alert.individual, "mortality", now - DEDUP_WINDOW_MS,
        );
        if (existing) continue;

        // Insert directo (bypass dedup duro por timestampStart en createDetectedEvent),
        // ya que el dedup auténtico es la ventana de 24h verificada arriba.
        await storage.insertDetectedEventNoDedupe({
          studyId,
          individualLocalId: alert.individual,
          eventType: "mortality",
          severity: alert.severity,
          timestampStart: alert.alertStart,
          timestampEnd: alert.alertEnd,
          lat: alert.lastLat,
          lng: alert.lastLon,
          description: `Inmovilidad detectada: ${alert.hoursImmobile}h (${alert.daysImmobile} días), ${alert.numRecords} registros. Vel. prom: ${alert.avgSpeed} m/s, máx: ${alert.maxSpeed} m/s`,
          readStatus: false,
          resolvedStatus: false,
          accValues: null,
        });

        if (alert.severity === "critical") {
          newCriticalAlerts.push({
            individual: alert.individual,
            species: alert.species,
            type: "immobility",
            studyName: study.name,
            hoursSinceLast: null,
            hoursImmobile: alert.hoursImmobile,
            lastTransmission: alert.alertEnd,
            lat: alert.lastLat,
            lon: alert.lastLon,
          });
        }
      } catch (e: any) {
        log(`Immobility: Error guardando evento para ${alert.individual}: ${e.message}`, "analysis");
      }
    }

    // 2) Sin transmisión: dedupe 24h por (study, individual, type, resolvedStatus=false).
    // timestampStart=now (timestamp de detección) para evitar colisión con dedup duro
    // de createDetectedEvent y permitir nuevas filas tras 24h.
    for (const alert of noTransmission) {
      try {
        const existing = await storage.findRecentUnresolvedDetectedEvent(
          studyId, alert.individual, "no_transmission", now - DEDUP_WINDOW_MS,
        );
        if (existing) continue;

        await storage.insertDetectedEventNoDedupe({
          studyId,
          individualLocalId: alert.individual,
          eventType: "no_transmission",
          severity: alert.severity,
          timestampStart: now,
          timestampEnd: now,
          lat: alert.lastLat,
          lng: alert.lastLon,
          description: `Sin transmisión: ${alert.hoursSinceLast ?? "?"}h (${alert.daysSinceLast ?? "?"} días). Última posición conocida: ${alert.lastTransmission ? new Date(alert.lastTransmission).toISOString() : "—"}`,
          readStatus: false,
          resolvedStatus: false,
          accValues: null,
        });

        if (alert.severity === "critical") {
          newCriticalAlerts.push({
            individual: alert.individual,
            species: alert.species,
            type: "no_transmission",
            studyName: study.name,
            hoursSinceLast: alert.hoursSinceLast,
            hoursImmobile: null,
            lastTransmission: alert.lastTransmission,
            lat: alert.lastLat,
            lon: alert.lastLon,
          });
        }
      } catch (e: any) {
        log(`Immobility: Error guardando no_transmission para ${alert.individual}: ${e.message}`, "analysis");
      }
    }

    // 3) Resolución: animales que vuelven a transmitir → marcar abiertas como resueltas
    for (const a of active) {
      try {
        const n = await storage.markDetectedEventsResolved(studyId, a.individual, ["mortality", "no_transmission"]);
        resolvedCount += n;
      } catch (e: any) {
        log(`Immobility: Error resolviendo eventos para ${a.individual}: ${e.message}`, "analysis");
      }
    }
  }

  const criticalAlerts = immobilityAlerts.filter(a => a.severity === "critical").length +
    noTransmission.filter(a => a.severity === "critical").length;

  const result: ImmobilityAnalysisResult = {
    summary: {
      totalAnimals: filteredIndividuals.length,
      transmitting: active.length,
      noTransmission: noTransmission.length,
      immobile: immobilityAlerts.length,
      criticalAlerts,
      analyzedAt: now,
      config: cfg,
      excludedNoHistory,
    },
    immobilityAlerts,
    noTransmissionAlerts: noTransmission,
    activeAnimals: active,
    stats: {
      totalGpsPoints: allGpsEvents.length,
      immobilePoints,
      immobilityGroups: groupIds.size,
    },
    newCriticalAlerts,
    resolvedCount,
  };

  log(`Immobility: Análisis completado - ${immobilityAlerts.length} inmóviles, ${noTransmission.length} sin transmisión, ${active.length} activos, ${newCriticalAlerts.length} nuevas críticas, ${resolvedCount} resueltas`, "analysis");

  return result;
}
