import type { EventThresholds, EventType, InsertDetectedEvent } from "@shared/schema";
import { EVENT_SEVERITY } from "@shared/schema";

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

export function detectEvents(
  accSamples: AccSample[],
  gpsSamples: GpsPoint[],
  thresholds: EventThresholds,
  studyId: string,
  animalId: string
): InsertDetectedEvent[] {
  const sorted = [...accSamples].sort((a, b) => a.timestamp - b.timestamp);
  const gpsSorted = [...gpsSamples].sort((a, b) => a.timestamp - b.timestamp);

  const allEvents: InsertDetectedEvent[] = [
    ...(thresholds.mortality.enabled !== false ? detectMortality(sorted, gpsSorted, thresholds.mortality, studyId, animalId) : []),
    ...(thresholds.detachment.enabled !== false ? detectDetachment(sorted, gpsSorted, thresholds.detachment, studyId, animalId) : []),
    ...(thresholds.fight.enabled !== false ? detectFight(sorted, gpsSorted, thresholds.fight, studyId, animalId) : []),
    ...(thresholds.feeding.enabled !== false ? detectFeeding(sorted, gpsSorted, thresholds.feeding, studyId, animalId) : []),
    ...(thresholds.incubation.enabled !== false ? detectIncubation(sorted, gpsSorted, thresholds.incubation, studyId, animalId) : []),
  ];

  return allEvents.sort((a, b) => a.timestampStart - b.timestampStart);
}
