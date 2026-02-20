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

export interface ImmobilityAnalysisResult {
  summary: {
    totalAnimals: number;
    transmitting: number;
    noTransmission: number;
    immobile: number;
    criticalAlerts: number;
    analyzedAt: number;
    config: ImmobilityConfig;
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

export async function analyzeImmobility(
  studyId: string,
  config: Partial<ImmobilityConfig> = {}
): Promise<ImmobilityAnalysisResult> {
  const cfg: ImmobilityConfig = { ...DEFAULT_IMMOBILITY_CONFIG, ...config };
  const now = Date.now();
  const startTime = now - cfg.hoursToAnalyze * 60 * 60 * 1000;

  log(`Immobility: Analizando estudio ${studyId} (${cfg.hoursToAnalyze}h, umbral ${cfg.immobilityThresholdHours}h)`, "analysis");

  const studyData = await storage.getActiveStudiesWithDeployments();
  const studyInfo = studyData.find(s => s.study.id === studyId);
  if (!studyInfo) {
    return {
      summary: { totalAnimals: 0, transmitting: 0, noTransmission: 0, immobile: 0, criticalAlerts: 0, analyzedAt: now, config: cfg },
      immobilityAlerts: [],
      noTransmissionAlerts: [],
      activeAnimals: [],
      stats: { totalGpsPoints: 0, immobilePoints: 0, immobilityGroups: 0 },
    };
  }

  const { activeIndividuals } = studyInfo;

  const allInds = await storage.getIndividuals(studyId);
  const speciesMap = new Map<string, string>();
  for (const ind of allInds) {
    if (ind.localIdentifier && ind.taxonCanonicalName) {
      speciesMap.set(ind.localIdentifier, ind.taxonCanonicalName);
    }
  }

  const allGpsEvents: CachedGpsEvent[] = [];
  for (const animal of activeIndividuals) {
    const events = await storage.getCachedGpsEvents(studyId, animal.localIdentifier, startTime, now);
    allGpsEvents.push(...events);
  }

  log(`Immobility: ${allGpsEvents.length} GPS events para ${activeIndividuals.length} animales`, "analysis");

  const prepared = prepareData(allGpsEvents, cfg);
  prepared.sort((a, b) => a.individual.localeCompare(b.individual) || a.timestamp - b.timestamp);
  const analyzed = detectImmobility(prepared, cfg);
  const immobilityAlerts = identifyMortalityEvents(analyzed, cfg, speciesMap);
  const { noTransmission, active } = checkTransmissionStatus(activeIndividuals, allGpsEvents, cfg, speciesMap, now);

  const immobilePoints = analyzed.filter(p => p.isImmobile).length;
  const groupIds = new Set(analyzed.filter(p => p.immobilityGroupId != null).map(p => p.immobilityGroupId));

  for (const alert of immobilityAlerts) {
    try {
      await storage.createDetectedEvent({
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
    } catch (e: any) {
      log(`Immobility: Error guardando evento para ${alert.individual}: ${e.message}`, "analysis");
    }
  }

  const criticalAlerts = immobilityAlerts.filter(a => a.severity === "critical").length +
    noTransmission.filter(a => a.severity === "critical").length;

  const result: ImmobilityAnalysisResult = {
    summary: {
      totalAnimals: activeIndividuals.length,
      transmitting: active.length,
      noTransmission: noTransmission.length,
      immobile: immobilityAlerts.length,
      criticalAlerts,
      analyzedAt: now,
      config: cfg,
    },
    immobilityAlerts,
    noTransmissionAlerts: noTransmission,
    activeAnimals: active,
    stats: {
      totalGpsPoints: allGpsEvents.length,
      immobilePoints,
      immobilityGroups: groupIds.size,
    },
  };

  log(`Immobility: Análisis completado - ${immobilityAlerts.length} inmóviles, ${noTransmission.length} sin transmisión, ${active.length} activos`, "analysis");

  return result;
}
