import { storage } from "./storage";
import type { CachedGpsEvent, CachedAccEvent } from "@shared/schema";
import { HDOP_QUALITY_THRESHOLD } from "@shared/schema";
import { log } from "./index";
import * as turf from "@turf/turf";

function filterHighQualityGps<T extends { hdop?: number | null }>(events: T[]): T[] {
  return events.filter((e) => e.hdop == null || e.hdop <= HDOP_QUALITY_THRESHOLD);
}

export interface ImmobilityConfig {
  hoursToAnalyze: number;
  immobilityThresholdHours: number;
  noTransmissionThresholdHours: number;
  speedThreshold: number;
  positionChangeThreshold: number;
  // Criterio PRINCIPAL (acelerómetro): un animal está muerto cuando la varianza
  // combinada del ACC (x+y+z) se mantiene por debajo de este umbral durante
  // `immobilityThresholdHours` horas. Un animal vivo (incluso incubando) genera
  // varianza ACC por encima de este umbral, evitando falsos positivos.
  accVarianceThreshold: number;
  // Mínimo de muestras ACC en la ventana para considerar el criterio ACC fiable.
  accMinSamples: number;
  // Criterio SECUNDARIO/respaldo (GPS, solo cuando no hay datos ACC): el animal
  // se considera inmóvil si el 90% de los puntos del período caen dentro de este
  // radio (metros) respecto al centro mediano, ignorando outliers puntuales.
  immobilityRadiusMeters: number;
  // Criterios activables/desactivables individualmente (ambos true por defecto):
  // - enableImmobility: si es false, NO se evalúa inmovilidad/mortalidad ni se
  //   generan/persisten alertas `mortality`.
  // - enableNoTransmission: si es false, NO se evalúa "sin transmisión" ni se
  //   generan/persisten alertas `no_transmission` (evita falsos positivos de
  //   emisores inactivos cuando solo se quiere analizar inmovilidad).
  enableImmobility: boolean;
  enableNoTransmission: boolean;
  // Criterios ADICIONALES de acelerómetro (opt-in, desactivados por defecto):
  // - enableAccConsecutive: marca inmovilidad si hay `ACC_CONSECUTIVE_RUN` muestras
  //   ACC consecutivas en las que la variación de CADA eje (X, Y, Z) respecto a la
  //   muestra anterior es < `ACC_CONSECUTIVE_DELTA`.
  // - enableZNegative: marca mortalidad si hay `Z_NEGATIVE_RUN` muestras ACC
  //   consecutivas con zAcceleration por debajo de `Z_NEGATIVE_VALUE`.
  enableAccConsecutive: boolean;
  enableZNegative: boolean;
}

export const DEFAULT_IMMOBILITY_CONFIG: ImmobilityConfig = {
  hoursToAnalyze: 96,
  immobilityThresholdHours: 24,
  noTransmissionThresholdHours: 7 * 24,
  speedThreshold: 0.5,
  positionChangeThreshold: 0.0001,
  accVarianceThreshold: 5,
  accMinSamples: 10,
  immobilityRadiusMeters: 50,
  enableImmobility: true,
  enableNoTransmission: true,
  enableAccConsecutive: false,
  enableZNegative: false,
};

// Parámetros de los criterios ACC adicionales.
const ACC_CONSECUTIVE_RUN = 3; // nº de muestras consecutivas a evaluar
const ACC_CONSECUTIVE_DELTA = 20; // variación máxima por eje entre muestras consecutivas
const Z_NEGATIVE_VALUE = -200; // umbral de caída del eje Z
const Z_NEGATIVE_RUN = 2; // nº de muestras consecutivas por debajo del umbral

export const NO_TRANSMISSION_THRESHOLD_DAYS_KEY = "no_transmission_threshold_days";
export const DEFAULT_NO_TRANSMISSION_THRESHOLD_DAYS = 7;
export const NO_TRANSMISSION_THRESHOLD_DAYS_OPTIONS = [5, 10, 15, 20] as const;

export async function getNoTransmissionThresholdDays(): Promise<number> {
  try {
    const raw = await storage.getSetting(NO_TRANSMISSION_THRESHOLD_DAYS_KEY);
    if (raw) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch (e: any) {
    log(`Immobility: error leyendo setting ${NO_TRANSMISSION_THRESHOLD_DAYS_KEY}: ${e.message}`, "analysis");
  }
  return DEFAULT_NO_TRANSMISSION_THRESHOLD_DAYS;
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
  method: "acc" | "gps" | "acc_consecutive" | "z_negative";
  accVariance: number | null;
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
  type: "immobility" | "no_transmission" | "zone_deviation";
  studyName: string;
  hoursSinceLast: number | null;
  hoursImmobile: number | null;
  lastTransmission: number | null;
  lat: number | null;
  lon: number | null;
  kmOutside: number | null;
}

export interface ZoneDeviationAlert {
  individual: string;
  species: string;
  kmOutside: number;
  dynamicRadiusKm: number;
  centroidLat: number;
  centroidLon: number;
  lastLat: number;
  lastLon: number;
  lastTimestamp: number;
  accActivity: number | null;
  accSamples: number;
  severity: "critical" | "warning";
  googleMapsUrl: string;
  status: string;
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
    zoneDeviation: number;
  };
  immobilityAlerts: ImmobilityAlert[];
  noTransmissionAlerts: NoTransmissionAlert[];
  zoneDeviationAlerts: ZoneDeviationAlert[];
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

function variance(nums: number[]): number {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nums.length;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Mayor hueco temporal entre muestras consecutivas (ms). Sirve para rechazar
// datos dispersos/bimodales (p.ej. muestras solo al inicio y al final de la
// ventana) que pasarían un chequeo de cobertura basado solo en first→last.
function maxGap(timestampsSorted: number[]): number {
  let max = 0;
  for (let i = 1; i < timestampsSorted.length; i++) {
    const g = timestampsSorted[i] - timestampsSorted[i - 1];
    if (g > max) max = g;
  }
  return max;
}

// Fracción máxima de la ventana que puede ocupar un único hueco sin muestras.
const MAX_GAP_FRACTION = 0.5;

/**
 * Criterio PRINCIPAL de mortalidad: acelerómetro.
 * Toma la ventana de las últimas `immobilityThresholdHours` horas (hasta `now`).
 * Si la varianza combinada (x+y+z) se mantiene por debajo de `accVarianceThreshold`
 * durante toda la ventana → el animal está inmóvil (muerto). Si supera el umbral
 * → el animal está vivo (incluida la incubación, que genera actividad ACC clara).
 * Devuelve `null` cuando no hay datos ACC suficientes para decidir (→ se usa el
 * respaldo GPS).
 */
function detectAccMortality(
  acc: CachedAccEvent[],
  cfg: ImmobilityConfig,
  now: number,
): { status: "dead" | "alive"; durationHours: number; combinedVariance: number; samples: number; startTs: number; endTs: number } | null {
  if (acc.length < cfg.accMinSamples) return null;
  const durationMs = cfg.immobilityThresholdHours * 60 * 60 * 1000;
  const windowStart = now - durationMs;
  const w = acc.filter((e) => e.timestamp >= windowStart).sort((a, b) => a.timestamp - b.timestamp);
  if (w.length < cfg.accMinSamples) return null;
  const span = w[w.length - 1].timestamp - w[0].timestamp;
  // Cobertura: el rango debe abarcar ~90% de la ventana Y sin huecos grandes
  // (evita concluir sobre datos dispersos/bimodales concentrados en los extremos).
  if (span < durationMs * 0.9) return null;
  if (maxGap(w.map((e) => e.timestamp)) > durationMs * MAX_GAP_FRACTION) return null;

  const combined =
    variance(w.map((e) => e.xAcceleration)) +
    variance(w.map((e) => e.yAcceleration)) +
    variance(w.map((e) => e.zAcceleration));

  return {
    status: combined < cfg.accVarianceThreshold ? "dead" : "alive",
    durationHours: Math.round((span / (60 * 60 * 1000)) * 10) / 10,
    combinedVariance: Math.round(combined * 10) / 10,
    samples: w.length,
    startTs: w[0].timestamp,
    endTs: w[w.length - 1].timestamp,
  };
}

/**
 * Criterio ADICIONAL 1 — "Inmovilidad ACC consecutiva".
 * Recorre las muestras ACC ordenadas por tiempo y busca una racha de
 * `ACC_CONSECUTIVE_RUN` muestras consecutivas en la que, entre cada par de
 * muestras seguidas, la variación de CADA eje (|dX|, |dY|, |dZ|) sea menor que
 * `ACC_CONSECUTIVE_DELTA`. Devuelve la primera racha encontrada o null.
 */
function detectAccConsecutiveImmobility(
  acc: CachedAccEvent[],
): { startTs: number; endTs: number; samples: number } | null {
  if (acc.length < ACC_CONSECUTIVE_RUN) return null;
  const w = [...acc].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i + ACC_CONSECUTIVE_RUN - 1 < w.length; i++) {
    let ok = true;
    for (let j = i + 1; j < i + ACC_CONSECUTIVE_RUN; j++) {
      const dx = Math.abs(w[j].xAcceleration - w[j - 1].xAcceleration);
      const dy = Math.abs(w[j].yAcceleration - w[j - 1].yAcceleration);
      const dz = Math.abs(w[j].zAcceleration - w[j - 1].zAcceleration);
      if (dx >= ACC_CONSECUTIVE_DELTA || dy >= ACC_CONSECUTIVE_DELTA || dz >= ACC_CONSECUTIVE_DELTA) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { startTs: w[i].timestamp, endTs: w[i + ACC_CONSECUTIVE_RUN - 1].timestamp, samples: ACC_CONSECUTIVE_RUN };
    }
  }
  return null;
}

/**
 * Criterio ADICIONAL 2 — "Caída Z negativa".
 * Busca `Z_NEGATIVE_RUN` muestras ACC consecutivas (orden temporal) cuyo eje Z
 * esté por debajo de `Z_NEGATIVE_VALUE`. Devuelve la primera racha o null.
 */
function detectZNegativeFall(
  acc: CachedAccEvent[],
): { startTs: number; endTs: number; samples: number } | null {
  if (acc.length < Z_NEGATIVE_RUN) return null;
  const w = [...acc].sort((a, b) => a.timestamp - b.timestamp);
  let run = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i].zAcceleration < Z_NEGATIVE_VALUE) {
      run++;
      if (run >= Z_NEGATIVE_RUN) {
        return { startTs: w[i - Z_NEGATIVE_RUN + 1].timestamp, endTs: w[i].timestamp, samples: Z_NEGATIVE_RUN };
      }
    } else {
      run = 0;
    }
  }
  return null;
}

/**
 * Construye una alerta de inmovilidad/mortalidad para los criterios ACC
 * adicionales (consecutiva / Z negativa). Reutiliza la última GPS para situar
 * el marcador en el mapa.
 */
function buildAccCriteriaAlert(
  id: string,
  species: string,
  gps: CachedGpsEvent[],
  method: "acc_consecutive" | "z_negative",
  run: { startTs: number; endTs: number; samples: number },
): ImmobilityAlert {
  const lastGps = gps.length ? gps.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
  const lat = lastGps?.latitude ?? 0;
  const lon = lastGps?.longitude ?? 0;
  const hours = Math.round(((run.endTs - run.startTs) / (60 * 60 * 1000)) * 10) / 10;
  return {
    individual: id,
    species,
    alertStart: run.startTs,
    alertEnd: run.endTs,
    hoursImmobile: hours,
    daysImmobile: Math.round((hours / 24) * 10) / 10,
    numRecords: run.samples,
    lastLat: lat,
    lastLon: lon,
    avgSpeed: 0,
    maxSpeed: 0,
    googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`,
    status: method === "acc_consecutive" ? "INMÓVIL (ACC consecutiva)" : "MORTALIDAD (Z negativa)",
    severity: "critical",
    method,
    accVariance: null,
  };
}

/**
 * Criterio SECUNDARIO/respaldo de inmovilidad: GPS por radio.
 * Solo se usa cuando no hay ACC concluyente. Toma la ventana de las últimas
 * `immobilityThresholdHours` horas y calcula un centro mediano (robusto frente a
 * outliers). Si el percentil 90 de las distancias al centro cae dentro de
 * `immobilityRadiusMeters`, el animal se considera inmóvil — ignorando hasta un
 * 10% de puntos atípicos que se alejen de la nube principal.
 */
function detectGpsRadiusMortality(
  gps: CachedGpsEvent[],
  cfg: ImmobilityConfig,
  now: number,
): { durationHours: number; samples: number; startTs: number; endTs: number; lastLat: number; lastLon: number; avgSpeed: number; maxSpeed: number; radiusM: number } | null {
  if (gps.length < 3) return null;
  const durationMs = cfg.immobilityThresholdHours * 60 * 60 * 1000;
  const windowStart = now - durationMs;
  const w = gps.filter((e) => e.timestamp >= windowStart).sort((a, b) => a.timestamp - b.timestamp);
  if (w.length < 3) return null;
  const span = w[w.length - 1].timestamp - w[0].timestamp;
  if (span < durationMs * 0.9) return null;
  if (maxGap(w.map((e) => e.timestamp)) > durationMs * MAX_GAP_FRACTION) return null;

  const medLat = median(w.map((p) => p.latitude));
  const medLon = median(w.map((p) => p.longitude));
  const center = turf.point([medLon, medLat]);
  const dists = w
    .map((p) => turf.distance(center, turf.point([p.longitude, p.latitude]), { units: "kilometers" }) * 1000)
    .sort((a, b) => a - b);
  const p90 = dists[Math.floor(0.9 * (dists.length - 1))];
  if (p90 > cfg.immobilityRadiusMeters) return null;

  const last = w[w.length - 1];
  const speeds = w.map((p) => p.groundSpeed ?? 0);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  return {
    durationHours: Math.round((span / (60 * 60 * 1000)) * 10) / 10,
    samples: w.length,
    startTs: w[0].timestamp,
    endTs: last.timestamp,
    lastLat: last.latitude,
    lastLon: last.longitude,
    avgSpeed: Math.round(avgSpeed * 1000) / 1000,
    maxSpeed: Math.round(Math.max(...speeds) * 1000) / 1000,
    radiusM: Math.round(p90 * 10) / 10,
  };
}

/**
 * Construye la alerta de mortalidad/inmovilidad para un animal.
 * 1) ACC primero: si concluye "vivo" → no se genera alerta (ni se usa GPS),
 *    lo que evita falsos positivos de animales quietos pero con actividad ACC
 *    (incubación). Si concluye "muerto" → alerta crítica por ACC.
 * 2) Si el ACC no es concluyente (sin datos suficientes) → respaldo GPS por radio.
 */
function buildMortalityAlert(
  id: string,
  species: string,
  acc: CachedAccEvent[],
  gps: CachedGpsEvent[],
  cfg: ImmobilityConfig,
  now: number,
): ImmobilityAlert | null {
  const accRes = detectAccMortality(acc, cfg, now);
  if (accRes) {
    if (accRes.status === "alive") return null;
    const lastGps = gps.length ? gps.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
    const lat = lastGps?.latitude ?? 0;
    const lon = lastGps?.longitude ?? 0;
    return {
      individual: id,
      species,
      alertStart: accRes.startTs,
      alertEnd: accRes.endTs,
      hoursImmobile: accRes.durationHours,
      daysImmobile: Math.round((accRes.durationHours / 24) * 10) / 10,
      numRecords: accRes.samples,
      lastLat: lat,
      lastLon: lon,
      avgSpeed: 0,
      maxSpeed: 0,
      googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`,
      status: "INMÓVIL (ACC)",
      severity: "critical",
      method: "acc",
      accVariance: accRes.combinedVariance,
    };
  }

  // Sin ACC concluyente → respaldo GPS por radio (50 m por defecto).
  const gpsRes = detectGpsRadiusMortality(gps, cfg, now);
  if (gpsRes) {
    return {
      individual: id,
      species,
      alertStart: gpsRes.startTs,
      alertEnd: gpsRes.endTs,
      hoursImmobile: gpsRes.durationHours,
      daysImmobile: Math.round((gpsRes.durationHours / 24) * 10) / 10,
      numRecords: gpsRes.samples,
      lastLat: gpsRes.lastLat,
      lastLon: gpsRes.lastLon,
      avgSpeed: gpsRes.avgSpeed,
      maxSpeed: gpsRes.maxSpeed,
      googleMapsUrl: `https://www.google.com/maps?q=${gpsRes.lastLat},${gpsRes.lastLon}`,
      status: "INMÓVIL (GPS)",
      severity: gpsRes.durationHours > 48 ? "critical" : "warning",
      method: "gps",
      accVariance: null,
    };
  }

  return null;
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

const inFlightAnalyses = new Set<string>();

export function triggerImmobilityAnalysisInBackground(studyId: string, source: string): void {
  if (inFlightAnalyses.has(studyId)) {
    log(`Immobility[bg/${source}]: estudio ${studyId} ya en análisis — saltando trigger`, "analysis");
    return;
  }
  inFlightAnalyses.add(studyId);
  setImmediate(() => {
    analyzeImmobility(studyId)
      .then(result => {
        const newCrit = result.newCriticalAlerts?.length ?? 0;
        log(`Immobility[bg/${source}]: estudio ${studyId} OK — ${result.immobilityAlerts.length} inmov, ${result.noTransmissionAlerts.length} sin tx, ${result.zoneDeviationAlerts?.length ?? 0} zona, ${newCrit} críticos nuevos`, "analysis");
      })
      .catch(err => {
        log(`Immobility[bg/${source}]: estudio ${studyId} ERROR — ${err?.message ?? err}`, "analysis");
      })
      .finally(() => {
        inFlightAnalyses.delete(studyId);
      });
  });
}

export async function analyzeImmobility(
  studyId: string,
  config: Partial<ImmobilityConfig> = {},
  options: { persist?: boolean } = {}
): Promise<ImmobilityAnalysisResult> {
  const cfg: ImmobilityConfig = { ...DEFAULT_IMMOBILITY_CONFIG, ...config };
  // Si el caller no pasa explícitamente noTransmissionThresholdHours, usar el valor global persistido
  if (config.noTransmissionThresholdHours === undefined) {
    const days = await getNoTransmissionThresholdDays();
    cfg.noTransmissionThresholdHours = days * 24;
  }
  const persist = options.persist !== false;
  const now = Date.now();
  // Cargar al menos la ventana de inmovilidad para que el criterio ACC/GPS pueda
  // evaluarse aunque el caller pida un hoursToAnalyze menor que immobilityThresholdHours.
  const loadWindowHours = Math.max(cfg.hoursToAnalyze, cfg.immobilityThresholdHours);
  const startTime = now - loadWindowHours * 60 * 60 * 1000;

  log(`Immobility: Analizando estudio ${studyId} (${cfg.hoursToAnalyze}h, umbral ${cfg.immobilityThresholdHours}h, persist=${persist})`, "analysis");

  const studyData = await storage.getActiveStudiesWithDeployments();
  const studyInfo = studyData.find(s => s.study.id === studyId);
  if (!studyInfo) {
    return {
      summary: { totalAnimals: 0, transmitting: 0, noTransmission: 0, immobile: 0, criticalAlerts: 0, analyzedAt: now, config: cfg, excludedNoHistory: 0, zoneDeviation: 0 },
      immobilityAlerts: [],
      noTransmissionAlerts: [],
      zoneDeviationAlerts: [],
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
  const gpsByAnimal = new Map<string, CachedGpsEvent[]>();
  const accByAnimal = new Map<string, CachedAccEvent[]>();
  for (const animal of filteredIndividuals) {
    const rawEvents = await storage.getCachedGpsEvents(studyId, animal.localIdentifier, startTime, now);
    // Excluir GPS de baja calidad (HDOP > 5) del análisis de inmovilidad/mortalidad.
    const events = filterHighQualityGps(rawEvents);
    allGpsEvents.push(...events);
    gpsByAnimal.set(animal.localIdentifier, events);
    const accEvents = await storage.getCachedAccEvents(studyId, animal.localIdentifier, startTime, now);
    accByAnimal.set(animal.localIdentifier, accEvents);
  }

  const totalAcc = Array.from(accByAnimal.values()).reduce((s, a) => s + a.length, 0);
  log(`Immobility: ${allGpsEvents.length} GPS / ${totalAcc} ACC events para ${filteredIndividuals.length} animales`, "analysis");

  // Detección de mortalidad/inmovilidad: ACC primario, GPS por radio (50 m) de respaldo.
  // Solo se evalúa si el criterio de inmovilidad está activo.
  const immobilityAlerts: ImmobilityAlert[] = [];
  if (cfg.enableImmobility) {
    for (const animal of filteredIndividuals) {
      const id = animal.localIdentifier;
      const species = speciesMap.get(id) || "Desconocida";
      const alert = buildMortalityAlert(id, species, accByAnimal.get(id) ?? [], gpsByAnimal.get(id) ?? [], cfg, now);
      if (alert) immobilityAlerts.push(alert);
    }
  }

  // Criterios ACC ADICIONALES (opt-in). Independientes de `enableImmobility`:
  // cada uno añade su propia fila a la tabla de inmovilidad con su `method`.
  // Evitamos duplicar el mismo (animal, método) que ya pudo generar el criterio
  // principal por varianza ACC.
  if (cfg.enableAccConsecutive || cfg.enableZNegative) {
    for (const animal of filteredIndividuals) {
      const id = animal.localIdentifier;
      const species = speciesMap.get(id) || "Desconocida";
      const acc = accByAnimal.get(id) ?? [];
      if (acc.length === 0) continue;
      const gps = gpsByAnimal.get(id) ?? [];
      if (cfg.enableAccConsecutive) {
        const run = detectAccConsecutiveImmobility(acc);
        if (run) immobilityAlerts.push(buildAccCriteriaAlert(id, species, gps, "acc_consecutive", run));
      }
      if (cfg.enableZNegative) {
        const run = detectZNegativeFall(acc);
        if (run) immobilityAlerts.push(buildAccCriteriaAlert(id, species, gps, "z_negative", run));
      }
    }
  }

  // Estado de transmisión basado en histórico COMPLETO, no solo en la ventana analizada.
  // Así detectamos animales que llevan mucho tiempo silenciados (>>96h) cuya última GPS
  // ya no aparece en `allGpsEvents`.
  const noTransmission: NoTransmissionAlert[] = [];
  const active: ImmobilityAnalysisResult["activeAnimals"] = [];

  // Las alertas de no-transmisión SOLO aplican a estudios Ornitela.
  // Movebank tiene ciclos de transmisión muy variables (días/semanas) que generan falsos positivos.
  const ornitelaOnly = study.ornitelaEnabled === true;

  for (const animal of filteredIndividuals) {
    const lastEvt = await storage.getLatestCachedGpsEvent(studyId, animal.localIdentifier);
    if (!lastEvt) {
      // Defensivo (no debería ocurrir tras filtro previo): saltar.
      continue;
    }
    const hoursSince = (now - lastEvt.timestamp) / (1000 * 60 * 60);
    const species = speciesMap.get(animal.localIdentifier) || "Desconocida";

    // Si el criterio "sin transmisión" está desactivado, se ignora por completo:
    // el umbral NO clasifica animales (no se generan alertas y NO se excluyen de
    // `active`), de modo que el análisis se centra solo en inmovilidad.
    if (cfg.enableNoTransmission && hoursSince >= cfg.noTransmissionThresholdHours) {
      // Animal sin transmisión reciente:
      // - Solo generamos alerta no_transmission para estudios Ornitela.
      // - En cualquier caso, NO entra en `active` → no auto-resuelve mortality/no_transmission
      //   sin evidencia real de nueva transmisión.
      if (ornitelaOnly) {
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
      }
      // Continúa al siguiente animal sin tocar `active`.
      continue;
    }
    {
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

  const immobilePoints = immobilityAlerts.reduce((s, a) => s + a.numRecords, 0);
  const immobilityGroups = immobilityAlerts.length;

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
          description:
            alert.method === "acc"
              ? `Mortalidad detectada por acelerómetro: ${alert.hoursImmobile}h (${alert.daysImmobile} días) sin variación significativa, ${alert.numRecords} muestras ACC. Varianza combinada=${alert.accVariance} (umbral=${cfg.accVarianceThreshold})`
              : alert.method === "acc_consecutive"
                ? `Inmovilidad detectada por ACC consecutiva: ${alert.numRecords} muestras consecutivas con variación por eje < ${ACC_CONSECUTIVE_DELTA} (${alert.hoursImmobile}h)`
                : alert.method === "z_negative"
                  ? `Mortalidad detectada por caída Z negativa: ${alert.numRecords} muestras consecutivas con zAcceleration < ${Z_NEGATIVE_VALUE} (${alert.hoursImmobile}h)`
                  : `Inmovilidad detectada por GPS (radio ${cfg.immobilityRadiusMeters}m): ${alert.hoursImmobile}h (${alert.daysImmobile} días), ${alert.numRecords} posiciones. Vel. prom: ${alert.avgSpeed} m/s, máx: ${alert.maxSpeed} m/s`,
          metadata: {
            method: alert.method,
            acc_combined_variance: alert.accVariance,
            duration_hours: alert.hoursImmobile,
            samples: alert.numRecords,
          } as any,
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
            kmOutside: null,
          });
        }
      } catch (e: any) {
        log(`Immobility: Error guardando evento para ${alert.individual}: ${e.message}`, "analysis");
      }
    }

    // 2) Sin transmisión: una sola alerta abierta por animal. Si ya existe una
    // sin resolver, se refresca su descripción/timestamp con el estado actual
    // en vez de crear una nueva (evita acumular ruido en animales con
    // transmisores perdidos por días/semanas).
    for (const alert of noTransmission) {
      try {
        const description = `Sin transmisión: ${alert.hoursSinceLast ?? "?"}h (${alert.daysSinceLast ?? "?"} días). Última posición conocida: ${alert.lastTransmission ? new Date(alert.lastTransmission).toISOString() : "—"}`;
        const existing = await storage.findRecentUnresolvedDetectedEvent(
          studyId, alert.individual, "no_transmission", 0,
        );
        if (existing) {
          await storage.updateDetectedEvent(existing.id, {
            description,
            timestampStart: now,
            timestampEnd: now,
            severity: alert.severity,
            lat: alert.lastLat,
            lng: alert.lastLon,
          });
          continue;
        }

        await storage.insertDetectedEventNoDedupe({
          studyId,
          individualLocalId: alert.individual,
          eventType: "no_transmission",
          severity: alert.severity,
          timestampStart: now,
          timestampEnd: now,
          lat: alert.lastLat,
          lng: alert.lastLon,
          description,
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
            kmOutside: null,
          });
        }
      } catch (e: any) {
        log(`Immobility: Error guardando no_transmission para ${alert.individual}: ${e.message}`, "analysis");
      }
    }

    // 3) Resolución: animales que vuelven a transmitir → marcar abiertas como resueltas.
    //    Solo se resuelven los tipos cuyo criterio esté activo (un criterio
    //    desactivado se ignora por completo, no toca sus eventos existentes).
    const typesToResolve: ("mortality" | "no_transmission")[] = [];
    if (cfg.enableImmobility || cfg.enableAccConsecutive || cfg.enableZNegative) typesToResolve.push("mortality");
    if (cfg.enableNoTransmission) typesToResolve.push("no_transmission");
    if (typesToResolve.length > 0) {
      for (const a of active) {
        try {
          const n = await storage.markDetectedEventsResolved(studyId, a.individual, typesToResolve);
          resolvedCount += n;
        } catch (e: any) {
          log(`Immobility: Error resolviendo eventos para ${a.individual}: ${e.message}`, "analysis");
        }
      }
    }
  }

  // ===== Análisis de desviación de zona (solo Ornitela) =====
  const zoneDeviationAlerts: ZoneDeviationAlert[] = [];
  if (study.ornitelaEnabled === true) {
    const ZONE_HISTORY_DAYS = 30;
    const ZONE_MIN_HISTORY_DAYS = 7;
    const ZONE_MIN_RADIUS_KM = 5;
    const ZONE_PERCENTILE = 0.95;
    const ACC_WINDOW_HOURS = 2;
    const ACC_HIGH_ACTIVITY = 150;
    const ACC_LOW_ACTIVITY = 30;
    const zoneStart = now - ZONE_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const accStart = now - ACC_WINDOW_HOURS * 60 * 60 * 1000;

    for (const animal of filteredIndividuals) {
      try {
        const histPtsRaw = await storage.getCachedGpsEvents(studyId, animal.localIdentifier, zoneStart, now);
        // Excluir GPS de baja calidad (HDOP > 5) del cálculo del radio dinámico y "última posición".
        const histPts = filterHighQualityGps(histPtsRaw);
        if (histPts.length < 2) continue;

        const minTs = histPts.reduce((m, p) => Math.min(m, p.timestamp), Infinity);
        const historyDays = (now - minTs) / (1000 * 60 * 60 * 24);
        if (historyDays < ZONE_MIN_HISTORY_DAYS) continue;

        const lastPt = histPts.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));

        const fc = turf.featureCollection(
          histPts.map(p => turf.point([p.longitude, p.latitude]))
        );
        const centroid = turf.centroid(fc);
        const [centroidLon, centroidLat] = centroid.geometry.coordinates;

        const distances = histPts.map(p =>
          turf.distance(centroid, turf.point([p.longitude, p.latitude]), { units: "kilometers" })
        ).sort((a, b) => a - b);
        const idx = Math.floor(ZONE_PERCENTILE * (distances.length - 1));
        const p95 = distances[Math.max(0, idx)];
        const dynamicRadiusKm = Math.max(p95, ZONE_MIN_RADIUS_KM);

        const lastDistKm = turf.distance(centroid, turf.point([lastPt.longitude, lastPt.latitude]), { units: "kilometers" });
        if (lastDistKm <= dynamicRadiusKm) continue;

        const kmOutside = Math.round((lastDistKm - dynamicRadiusKm) * 100) / 100;

        const accEvts = await storage.getCachedAccEvents(studyId, animal.localIdentifier, accStart, now);
        let accActivity: number | null = null;
        if (accEvts.length > 0) {
          const sum = accEvts.reduce((s, e) => s + Math.abs(e.yAcceleration), 0);
          accActivity = Math.round((sum / accEvts.length) * 10) / 10;
        }

        let severity: "critical" | "warning";
        if (accActivity == null) {
          severity = "warning";
        } else if (accActivity > ACC_HIGH_ACTIVITY) {
          severity = "warning";
        } else if (accActivity < ACC_LOW_ACTIVITY) {
          severity = "critical";
        } else {
          severity = "warning";
        }

        const species = speciesMap.get(animal.localIdentifier) || "Desconocida";
        zoneDeviationAlerts.push({
          individual: animal.localIdentifier,
          species,
          kmOutside,
          dynamicRadiusKm: Math.round(dynamicRadiusKm * 100) / 100,
          centroidLat,
          centroidLon,
          lastLat: lastPt.latitude,
          lastLon: lastPt.longitude,
          lastTimestamp: lastPt.timestamp,
          accActivity,
          accSamples: accEvts.length,
          severity,
          googleMapsUrl: `https://www.google.com/maps?q=${lastPt.latitude},${lastPt.longitude}`,
          status: "FUERA DE ZONA",
        });
      } catch (e: any) {
        log(`Zone: Error analizando ${animal.localIdentifier}: ${e.message}`, "analysis");
      }
    }

    if (persist) {
      // Persistencia + dedup 24h + email crítico para zone_deviation
      for (const z of zoneDeviationAlerts) {
        try {
          const existing = await storage.findRecentUnresolvedDetectedEvent(
            studyId, z.individual, "zone_deviation", now - DEDUP_WINDOW_MS,
          );
          if (existing) continue;

          await storage.insertDetectedEventNoDedupe({
            studyId,
            individualLocalId: z.individual,
            eventType: "zone_deviation",
            severity: z.severity,
            timestampStart: z.lastTimestamp,
            timestampEnd: z.lastTimestamp,
            lat: z.lastLat,
            lng: z.lastLon,
            description: `Desviación de zona: ${z.kmOutside} km fuera del radio habitual (${z.dynamicRadiusKm} km). Actividad ACC (eje Y, ${ACC_WINDOW_HOURS}h): ${z.accActivity ?? "n/d"} (${z.accSamples} muestras)`,
            metadata: {
              km_outside: z.kmOutside,
              dynamic_radius_km: z.dynamicRadiusKm,
              centroid_lat: z.centroidLat,
              centroid_lng: z.centroidLon,
              acc_activity_y: z.accActivity,
              acc_samples: z.accSamples,
            } as any,
            readStatus: false,
            resolvedStatus: false,
            accValues: null,
          });

          if (z.severity === "critical") {
            newCriticalAlerts.push({
              individual: z.individual,
              species: z.species,
              type: "zone_deviation",
              studyName: study.name,
              hoursSinceLast: null,
              hoursImmobile: null,
              lastTransmission: z.lastTimestamp,
              lat: z.lastLat,
              lon: z.lastLon,
              kmOutside: z.kmOutside,
            });
          }
        } catch (e: any) {
          log(`Zone: Error guardando evento para ${z.individual}: ${e.message}`, "analysis");
        }
      }

      // Auto-resolución: si el animal ya está dentro del radio (no aparece en alertas)
      // marcamos sus zone_deviation abiertas como resueltas.
      const flagged = new Set(zoneDeviationAlerts.map(z => z.individual));
      for (const animal of filteredIndividuals) {
        if (flagged.has(animal.localIdentifier)) continue;
        try {
          const n = await storage.markDetectedEventsResolved(studyId, animal.localIdentifier, ["zone_deviation"]);
          resolvedCount += n;
        } catch {}
      }
    }
  }

  const criticalAlerts = immobilityAlerts.filter(a => a.severity === "critical").length +
    noTransmission.filter(a => a.severity === "critical").length +
    zoneDeviationAlerts.filter(a => a.severity === "critical").length;

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
      zoneDeviation: zoneDeviationAlerts.length,
    },
    immobilityAlerts,
    noTransmissionAlerts: noTransmission,
    zoneDeviationAlerts,
    activeAnimals: active,
    stats: {
      totalGpsPoints: allGpsEvents.length,
      immobilePoints,
      immobilityGroups,
    },
    newCriticalAlerts,
    resolvedCount,
  };

  log(`Immobility: Análisis completado - ${immobilityAlerts.length} inmóviles, ${noTransmission.length} sin transmisión, ${zoneDeviationAlerts.length} fuera de zona, ${active.length} activos, ${newCriticalAlerts.length} nuevas críticas, ${resolvedCount} resueltas`, "analysis");

  return result;
}
