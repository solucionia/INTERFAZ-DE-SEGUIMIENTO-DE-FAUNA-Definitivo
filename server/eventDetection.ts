import type { EventThresholds, EventType, InsertDetectedEvent } from "@shared/schema";
import { EVENT_SEVERITY, DEFAULT_THRESHOLDS } from "@shared/schema";

interface AccSample {
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

interface GpsPoint {
  timestamp: number;
  lat: number;
  lng: number;
}

function findNearestGps(gpsPoints: GpsPoint[], timestamp: number): GpsPoint | null {
  if (gpsPoints.length === 0) return null;
  let closest = gpsPoints[0];
  let minDiff = Math.abs(closest.timestamp - timestamp);
  for (const p of gpsPoints) {
    const diff = Math.abs(p.timestamp - timestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return closest;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function detectMortality(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["mortality"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  if (samples.length < 10) return events;

  const durationMs = thresholds.durationHours * 3600 * 1000;
  const maxVar = thresholds.stationaryVariance;

  let windowStart = 0;
  for (let windowEnd = 0; windowEnd < samples.length; windowEnd++) {
    while (samples[windowEnd].timestamp - samples[windowStart].timestamp > durationMs) {
      windowStart++;
    }

    const windowDuration = samples[windowEnd].timestamp - samples[windowStart].timestamp;
    if (windowDuration < durationMs * 0.9) continue;

    const windowSamples = samples.slice(windowStart, windowEnd + 1);
    if (windowSamples.length < 5) continue;

    const xVar = variance(windowSamples.map((s) => s.x));
    const yVar = variance(windowSamples.map((s) => s.y));
    const zVar = variance(windowSamples.map((s) => s.z));

    if (xVar < maxVar && yVar < maxVar && zVar < maxVar) {
      const gp = findNearestGps(gpsPoints, samples[windowEnd].timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "mortality" as EventType,
        severity: EVENT_SEVERITY.mortality,
        timestampStart: samples[windowStart].timestamp,
        timestampEnd: samples[windowEnd].timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: windowSamples.slice(0, 10).map((s) => ({ x: s.x, y: s.y, z: s.z })),
        description: `Acelerómetro estacionario durante ${thresholds.durationHours}h (varianza X:${xVar.toFixed(1)}, Y:${yVar.toFixed(1)}, Z:${zVar.toFixed(1)})`,
      });
      windowStart = windowEnd + 1;
    }
  }
  return events;
}

function detectDetachment(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["detachment"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const { xThresholdHigh, xThresholdLow, minPositions, windowSize } = thresholds;

  for (let i = 0; i <= samples.length - windowSize; i++) {
    const window = samples.slice(i, i + windowSize);
    let exceeds = 0;
    for (const s of window) {
      if (s.x > xThresholdHigh || s.x < xThresholdLow) {
        exceeds++;
      }
    }
    if (exceeds >= minPositions) {
      const gp = findNearestGps(gpsPoints, window[0].timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "detachment" as EventType,
        severity: EVENT_SEVERITY.detachment,
        timestampStart: window[0].timestamp,
        timestampEnd: window[window.length - 1].timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: window.map((s) => ({ x: s.x, y: s.y, z: s.z })),
        description: `Eje X fuera de rango (${exceeds}/${windowSize} posiciones exceden ±${xThresholdHigh})`,
      });
      i += windowSize - 1;
    }
  }
  return events;
}

function detectFight(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["fight"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const { zThreshold, minOccurrences, windowMinutes } = thresholds;
  const windowMs = windowMinutes * 60 * 1000;

  for (let i = 0; i < samples.length; i++) {
    const windowEnd = samples[i].timestamp + windowMs;
    const windowSamples: AccSample[] = [];
    for (let j = i; j < samples.length && samples[j].timestamp <= windowEnd; j++) {
      windowSamples.push(samples[j]);
    }

    let negativeCount = 0;
    let hasPositive = false;
    let alternating = false;
    let lastWasNegative = false;

    for (const s of windowSamples) {
      if (s.z < zThreshold) {
        negativeCount++;
        if (hasPositive && !lastWasNegative) alternating = true;
        lastWasNegative = true;
      } else if (s.z > 0) {
        hasPositive = true;
        lastWasNegative = false;
      }
    }

    if (negativeCount >= minOccurrences && alternating) {
      const gp = findNearestGps(gpsPoints, windowSamples[0].timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "fight" as EventType,
        severity: EVENT_SEVERITY.fight,
        timestampStart: windowSamples[0].timestamp,
        timestampEnd: windowSamples[windowSamples.length - 1].timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: windowSamples.slice(0, 10).map((s) => ({ x: s.x, y: s.y, z: s.z })),
        description: `Eje Z alternando: ${negativeCount} valores < ${zThreshold} en ${windowMinutes} min`,
      });
      const lastTs = windowSamples[windowSamples.length - 1].timestamp;
      while (i < samples.length - 1 && samples[i + 1].timestamp <= lastTs) i++;
    }
  }
  return events;
}

function detectFeeding(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["feeding"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const { yThreshold, minOccurrences, windowMinutes } = thresholds;
  const windowMs = windowMinutes * 60 * 1000;

  for (let i = 0; i < samples.length; i++) {
    const windowEnd = samples[i].timestamp + windowMs;
    const windowSamples: AccSample[] = [];
    for (let j = i; j < samples.length && samples[j].timestamp <= windowEnd; j++) {
      windowSamples.push(samples[j]);
    }

    let highYCount = 0;
    for (const s of windowSamples) {
      if (s.y > yThreshold) highYCount++;
    }

    if (highYCount >= minOccurrences) {
      const gp = findNearestGps(gpsPoints, windowSamples[0].timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "feeding" as EventType,
        severity: EVENT_SEVERITY.feeding,
        timestampStart: windowSamples[0].timestamp,
        timestampEnd: windowSamples[windowSamples.length - 1].timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: windowSamples.slice(0, 10).map((s) => ({ x: s.x, y: s.y, z: s.z })),
        description: `Eje Y > ${yThreshold}: ${highYCount} valores positivos en ${windowMinutes} min`,
      });
      const lastTs = windowSamples[windowSamples.length - 1].timestamp;
      while (i < samples.length - 1 && samples[i + 1].timestamp <= lastTs) i++;
    }
  }
  return events;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function countSignChanges(values: number[]): number {
  let changes = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] >= 0 && values[i - 1] < 0) || (values[i] < 0 && values[i - 1] >= 0)) {
      changes++;
    }
  }
  return changes;
}

function detectIncubation(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["incubation"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const { yRangeLow, yRangeHigh, minStdDev, windowMinutes, minSignChanges } = thresholds;
  const windowMs = windowMinutes * 60 * 1000;

  for (let i = 0; i < samples.length; i++) {
    const windowEnd = samples[i].timestamp + windowMs;
    const windowSamples: AccSample[] = [];
    for (let j = i; j < samples.length && samples[j].timestamp <= windowEnd; j++) {
      windowSamples.push(samples[j]);
    }
    if (windowSamples.length < 5) continue;

    const allInRange = windowSamples.every((s) => s.y >= yRangeLow && s.y <= yRangeHigh);
    if (!allInRange) continue;

    const yValues = windowSamples.map((s) => s.y);
    const sd = stdDev(yValues);
    if (sd < minStdDev) continue;

    const signChanges = countSignChanges(yValues);
    if (signChanges < minSignChanges) continue;

    const gp = findNearestGps(gpsPoints, windowSamples[0].timestamp);
    events.push({
      studyId,
      individualLocalId: animalId,
      eventType: "incubation" as EventType,
      severity: EVENT_SEVERITY.incubation,
      timestampStart: windowSamples[0].timestamp,
      timestampEnd: windowSamples[windowSamples.length - 1].timestamp,
      lat: gp?.lat ?? null,
      lng: gp?.lng ?? null,
      accValues: windowSamples.slice(0, 10).map((s) => ({ x: s.x, y: s.y, z: s.z })),
      description: `Eje Y contenido (${yRangeLow} a ${yRangeHigh}) con desv.est. ${sd.toFixed(1)}, ${signChanges} cambios de signo en ${windowMinutes} min`,
    });
    const lastTs = windowSamples[windowSamples.length - 1].timestamp;
    while (i < samples.length - 1 && samples[i + 1].timestamp <= lastTs) i++;
  }
  return events;
}

function detectLowActivity(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["lowActivity"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const minSamples = Math.max(2, thresholds.minSamples ?? 10);
  if (samples.length < minSamples) return events;

  // Mínimo 2 horas sostenidas (forzado por el schema: durationHours.min(2))
  const durationHours = Math.max(2, thresholds.durationHours);
  const durationMs = durationHours * 3600 * 1000;
  const critical = thresholds.criticalCombinedVariance;
  const warning = thresholds.warningCombinedVariance;

  let windowStart = 0;
  for (let windowEnd = 0; windowEnd < samples.length; windowEnd++) {
    while (samples[windowEnd].timestamp - samples[windowStart].timestamp > durationMs) {
      windowStart++;
    }
    const windowDuration = samples[windowEnd].timestamp - samples[windowStart].timestamp;
    if (windowDuration < durationMs * 0.9) continue;

    const windowSamples = samples.slice(windowStart, windowEnd + 1);
    if (windowSamples.length < minSamples) continue;

    const xVar = variance(windowSamples.map((s) => s.x));
    const yVar = variance(windowSamples.map((s) => s.y));
    const zVar = variance(windowSamples.map((s) => s.z));
    const combined = xVar + yVar + zVar;

    let severity: string | null = null;
    let descLabel = "";
    if (combined < critical) {
      severity = "critical";
      descLabel = "actividad prácticamente nula (posible mortalidad)";
    } else if (combined < warning) {
      severity = "warning";
      descLabel = "actividad muy reducida (posible animal herido)";
    }

    if (severity) {
      const gp = findNearestGps(gpsPoints, samples[windowEnd].timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "low_activity" as EventType,
        severity,
        timestampStart: samples[windowStart].timestamp,
        timestampEnd: samples[windowEnd].timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: windowSamples.slice(0, 10).map((s) => ({ x: s.x, y: s.y, z: s.z })),
        description: `Baja actividad ACC sostenida ${durationHours}h: ${descLabel}. Varianza combinada=${combined.toFixed(1)} (X:${xVar.toFixed(1)}, Y:${yVar.toFixed(1)}, Z:${zVar.toFixed(1)})`,
        metadata: {
          combined_variance: combined,
          x_variance: xVar,
          y_variance: yVar,
          z_variance: zVar,
          duration_hours: durationHours,
          samples: windowSamples.length,
        } as any,
      });
      windowStart = windowEnd + 1;
    }
  }
  return events;
}

function detectElectrocution(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["electrocution"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const minSamples = Math.max(3, thresholds.minSamples ?? 5);
  if (samples.length < minSamples + 1) return events;

  // Mínimo 30 minutos sin variación tras un salto abrupto (forzado por schema)
  const durationMinutes = Math.max(30, thresholds.durationMinutes);
  const durationMs = durationMinutes * 60 * 1000;
  const stepThreshold = thresholds.zStepThreshold;
  const sustainedVar = thresholds.sustainedVariance;

  // Para verificar que el cambio es "permanente", comparamos la media del eje Z
  // antes y después del salto. Exigimos también estabilidad en X/Y para descartar
  // golpes, aterrizajes o vuelo estacionario que también podrían sostener Z.
  const preWindowSamples = Math.max(3, minSamples);

  for (let i = 1; i < samples.length; i++) {
    const dz = samples[i].z - samples[i - 1].z;
    if (Math.abs(dz) < stepThreshold) continue;

    // Necesitamos contexto previo para validar el "salto de nivel"
    if (i < preWindowSamples) continue;
    const preSlice = samples.slice(Math.max(0, i - preWindowSamples), i);
    const preMeanZ = preSlice.reduce((s, v) => s + v.z, 0) / preSlice.length;

    // A partir de i, recoger ventana >= durationMs
    const windowStartTs = samples[i].timestamp;
    const windowEndTarget = windowStartTs + durationMs;
    let j = i;
    while (j < samples.length && samples[j].timestamp <= windowEndTarget) j++;
    const window = samples.slice(i, j);
    const windowSpan = window.length > 0 ? window[window.length - 1].timestamp - window[0].timestamp : 0;
    if (window.length < minSamples || windowSpan < durationMs * 0.9) continue;

    const zVals = window.map((s) => s.z);
    const zVar = variance(zVals);
    if (zVar >= sustainedVar) continue;

    // Confirmar nivel permanente: la media post tiene que estar a >= stepThreshold del nivel previo
    const postMeanZ = zVals.reduce((s, v) => s + v, 0) / zVals.length;
    if (Math.abs(postMeanZ - preMeanZ) < stepThreshold) continue;

    // Estabilidad multieje: X e Y también deben permanecer prácticamente sin variación.
    // Usamos un umbral relajado (2x sustainedVar) ya que pueden tener offset distinto.
    const xVar = variance(window.map((s) => s.x));
    const yVar = variance(window.map((s) => s.y));
    if (xVar >= sustainedVar * 2 || yVar >= sustainedVar * 2) continue;

    const gp = findNearestGps(gpsPoints, windowStartTs);
    events.push({
      studyId,
      individualLocalId: animalId,
      eventType: "electrocution" as EventType,
      severity: EVENT_SEVERITY.electrocution,
      timestampStart: windowStartTs,
      timestampEnd: window[window.length - 1].timestamp,
      lat: gp?.lat ?? null,
      lng: gp?.lng ?? null,
      accValues: window.slice(0, 10).map((s) => ({ x: s.x, y: s.y, z: s.z })),
      description: `Posible electrocución: cambio permanente en eje Z (Δ=${dz.toFixed(1)}, media previa ${preMeanZ.toFixed(1)} → ${postMeanZ.toFixed(1)}) y ${durationMinutes} min sin variación (varZ=${zVar.toFixed(2)}, varX=${xVar.toFixed(2)}, varY=${yVar.toFixed(2)})`,
      metadata: {
        z_step: dz,
        z_pre_mean: preMeanZ,
        z_post_mean: postMeanZ,
        z_variance_after: zVar,
        x_variance_after: xVar,
        y_variance_after: yVar,
        duration_minutes: durationMinutes,
        samples: window.length,
      } as any,
    });
    // Saltar al final de la ventana detectada para no reportar duplicados solapados
    i = i + window.length - 1;
  }
  return events;
}

/**
 * Depredación / Pelea (eje Z ±200): busca una ventana de `consecutiveSamples`
 * muestras ACC consecutivas en la que el eje Z presenta a la vez al menos un
 * valor por encima de `zHighThreshold` (+200) y al menos uno por debajo de
 * `zLowThreshold` (-200), es decir, oscila entre extremos positivo y negativo.
 */
function detectPredationFight(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["predationFight"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const run = Math.max(2, thresholds.consecutiveSamples);
  const high = thresholds.zHighThreshold;
  const low = thresholds.zLowThreshold;
  if (samples.length < run) return events;

  for (let i = 0; i + run - 1 < samples.length; i++) {
    const window = samples.slice(i, i + run);
    const hasHigh = window.some((s) => s.z > high);
    const hasLow = window.some((s) => s.z < low);
    if (hasHigh && hasLow) {
      const gp = findNearestGps(gpsPoints, window[0].timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "predation_fight" as EventType,
        severity: EVENT_SEVERITY.predation_fight,
        timestampStart: window[0].timestamp,
        timestampEnd: window[window.length - 1].timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: window.map((s) => ({ x: s.x, y: s.y, z: s.z })),
        description: `Depredación/Pelea: eje Z oscila entre > ${high} y < ${low} en ${run} muestras ACC consecutivas`,
        metadata: {
          z_high_threshold: high,
          z_low_threshold: low,
          consecutive_samples: run,
        } as any,
      });
      // Saltar al final de la ventana detectada para no reportar solapamientos
      i = i + run - 1;
    }
  }
  return events;
}

/**
 * Riesgo de caída del emisor o problema con el ejemplar: cualquier muestra ACC
 * cuyo eje X supere `xHighThreshold` (+300) o baje de `xLowThreshold` (-300).
 * Reporta una única alerta por pasada (la dedup 24h evita reincidencias).
 */
function detectTransmitterFallRisk(
  samples: AccSample[],
  gpsPoints: GpsPoint[],
  thresholds: EventThresholds["transmitterFallRisk"],
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const events: InsertDetectedEvent[] = [];
  const high = thresholds.xHighThreshold;
  const low = thresholds.xLowThreshold;

  for (const s of samples) {
    if (s.x > high || s.x < low) {
      const gp = findNearestGps(gpsPoints, s.timestamp);
      events.push({
        studyId,
        individualLocalId: animalId,
        eventType: "transmitter_fall_risk" as EventType,
        severity: EVENT_SEVERITY.transmitter_fall_risk,
        timestampStart: s.timestamp,
        timestampEnd: s.timestamp,
        lat: gp?.lat ?? null,
        lng: gp?.lng ?? null,
        accValues: [{ x: s.x, y: s.y, z: s.z }],
        description: `Riesgo caída emisor / problema con el ejemplar: eje X = ${s.x.toFixed(1)} (umbral > ${high} o < ${low})`,
        metadata: {
          x_value: s.x,
          x_high_threshold: high,
          x_low_threshold: low,
        } as any,
      });
      break;
    }
  }
  return events;
}

export function detectEvents(
  accSamples: AccSample[],
  gpsSamples: GpsPoint[],
  thresholds: EventThresholds,
  studyId: string,
  animalId: string,
  options: { ornitelaOnly?: boolean } = {}
): InsertDetectedEvent[] {
  // Dispositivos sin ACC: salida silenciosa sin alertas falsas
  if (!accSamples || accSamples.length === 0) return [];

  const sorted = [...accSamples].sort((a, b) => a.timestamp - b.timestamp);
  const gpsSorted = [...gpsSamples].sort((a, b) => a.timestamp - b.timestamp);
  const ornitelaOnly = options.ornitelaOnly === true;

  const allEvents: InsertDetectedEvent[] = [
    ...(thresholds.mortality.enabled !== false ? detectMortality(sorted, gpsSorted, thresholds.mortality, studyId, animalId) : []),
    ...(thresholds.detachment.enabled !== false ? detectDetachment(sorted, gpsSorted, thresholds.detachment, studyId, animalId) : []),
    ...(thresholds.fight.enabled !== false ? detectFight(sorted, gpsSorted, thresholds.fight, studyId, animalId) : []),
    ...(thresholds.feeding.enabled !== false ? detectFeeding(sorted, gpsSorted, thresholds.feeding, studyId, animalId) : []),
    ...(thresholds.incubation.enabled !== false ? detectIncubation(sorted, gpsSorted, thresholds.incubation, studyId, animalId) : []),
    ...(thresholds.predationFight?.enabled !== false ? detectPredationFight(sorted, gpsSorted, thresholds.predationFight ?? DEFAULT_THRESHOLDS.predationFight, studyId, animalId) : []),
    ...(thresholds.transmitterFallRisk?.enabled !== false ? detectTransmitterFallRisk(sorted, gpsSorted, thresholds.transmitterFallRisk ?? DEFAULT_THRESHOLDS.transmitterFallRisk, studyId, animalId) : []),
    // Alertas exclusivas de Ornitela
    ...(ornitelaOnly && thresholds.lowActivity?.enabled !== false ? detectLowActivity(sorted, gpsSorted, thresholds.lowActivity, studyId, animalId) : []),
    ...(ornitelaOnly && thresholds.electrocution?.enabled !== false ? detectElectrocution(sorted, gpsSorted, thresholds.electrocution, studyId, animalId) : []),
  ];

  return allEvents.sort((a, b) => a.timestampStart - b.timestampStart);
}
