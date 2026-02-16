import * as turf from "@turf/turf";

interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: number;
  individual_id?: string;
}

interface McpResult {
  analysisType: "mcp";
  areas: { individual: string; area_km2: number }[];
  geojson: GeoJSON.FeatureCollection;
}

interface KernelResult {
  analysisType: "kernel";
  areas: { individual: string; area_95_km2: number; area_50_km2: number }[];
  geojson: GeoJSON.FeatureCollection;
}

interface DistanceResult {
  analysisType: "distance";
  individuals: {
    individual: string;
    total_km: number;
    average_daily_km: number;
    daily: { date: string; distance_km: number }[];
  }[];
}

interface SpeedResult {
  analysisType: "speed";
  individuals: {
    individual: string;
    average_kmh: number;
    max_kmh: number;
    speeds: { timestamp: number; speed_kmh: number }[];
  }[];
}

interface IndividualComprehensiveMetrics {
  individual: string;
  locations: number;
  analysisDays: number;
  firstDate: string;
  lastDate: string;
  totalDistanceKm: number;
  minConsecutiveDistKm: number;
  maxConsecutiveDistKm: number;
  minDailyDistKm: number;
  maxDailyDistKm: number;
  avgDailyDistKm: number;
  eccentricity: number;
  linearity: number;
  hHref: number;
  hLscv: number | null;
  lscvConverged: boolean;
  kernelHrefAreas: Record<string, number>;
  kernelLscvAreas: Record<string, number> | null;
  mcpAreas: Record<string, number>;
}

interface ComprehensiveResult {
  analysisType: "comprehensive";
  bandwidthMethod: string;
  sampled: boolean;
  sampleSize: number;
  totalPoints: number;
  perIndividual: IndividualComprehensiveMetrics[];
  geojson: GeoJSON.FeatureCollection;
}

export type AnalysisResult = McpResult | KernelResult | DistanceResult | SpeedResult | ComprehensiveResult;

const KERNEL_PERCENTAGES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
const MCP_PERCENTAGES = [50, 75, 90, 95, 100];
const MAX_SAMPLE_SIZE = 10000;

function groupByIndividual(points: GpsPoint[]): Record<string, GpsPoint[]> {
  const groups: Record<string, GpsPoint[]> = {};
  for (const p of points) {
    const id = p.individual_id || "unknown";
    if (!groups[id]) groups[id] = [];
    groups[id].push(p);
  }
  for (const id of Object.keys(groups)) {
    groups[id].sort((a: GpsPoint, b: GpsPoint) => a.timestamp - b.timestamp);
  }
  return groups;
}

function samplePoints(pts: GpsPoint[], maxSize: number): { sampled: GpsPoint[]; wasSampled: boolean; originalSize: number } {
  if (pts.length <= maxSize) {
    return { sampled: pts, wasSampled: false, originalSize: pts.length };
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const middle = pts.slice(1, pts.length - 1);
  const needed = maxSize - 2;
  const shuffled = [...middle];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = shuffled.slice(0, needed);
  selected.push(first, last);
  selected.sort((a, b) => a.timestamp - b.timestamp);
  return { sampled: selected, wasSampled: true, originalSize: pts.length };
}

export function computeMCP(points: GpsPoint[], params?: { percent?: number }): McpResult {
  const groups = groupByIndividual(points);
  const features: GeoJSON.Feature[] = [];
  const areas: { individual: string; area_km2: number }[] = [];

  for (const id of Object.keys(groups)) {
    const pts = groups[id];
    if (pts.length < 3) continue;

    let usePts = pts;
    const percent = params?.percent ?? 95;
    if (percent < 100 && pts.length > 5) {
      const centroid = turf.centroid(
        turf.featureCollection(pts.map((p: GpsPoint) => turf.point([p.lng, p.lat])))
      );
      const withDist = pts.map((p: GpsPoint) => ({
        ...p,
        dist: turf.distance(centroid, turf.point([p.lng, p.lat]), { units: "kilometers" }),
      }));
      withDist.sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist);
      const keepCount = Math.max(3, Math.ceil((percent / 100) * withDist.length));
      usePts = withDist.slice(0, keepCount);
    }

    const turfPoints = turf.featureCollection(
      usePts.map((p: GpsPoint) => turf.point([p.lng, p.lat]))
    );

    const hull = turf.convex(turfPoints);
    if (!hull) continue;

    const areaM2 = turf.area(hull);
    const areaKm2 = areaM2 / 1e6;

    hull.properties = {
      id,
      area_km2: Math.round(areaKm2 * 1000) / 1000,
      percent,
      type: "mcp",
    };

    features.push(hull);
    areas.push({ individual: id, area_km2: Math.round(areaKm2 * 1000) / 1000 });
  }

  return {
    analysisType: "mcp",
    areas,
    geojson: turf.featureCollection(features),
  };
}

function computeMCPMultiPercent(pts: GpsPoint[], id: string): { areas: Record<string, number>; features: GeoJSON.Feature[] } {
  const areas: Record<string, number> = {};
  const features: GeoJSON.Feature[] = [];

  if (pts.length < 3) return { areas, features };

  const centroid = turf.centroid(
    turf.featureCollection(pts.map((p) => turf.point([p.lng, p.lat])))
  );
  const withDist = pts.map((p) => ({
    ...p,
    dist: turf.distance(centroid, turf.point([p.lng, p.lat]), { units: "kilometers" }),
  }));
  withDist.sort((a, b) => a.dist - b.dist);

  for (const pct of MCP_PERCENTAGES) {
    let usePts: GpsPoint[];
    if (pct >= 100) {
      usePts = pts;
    } else {
      const keepCount = Math.max(3, Math.ceil((pct / 100) * withDist.length));
      usePts = withDist.slice(0, keepCount);
    }

    const turfPts = turf.featureCollection(usePts.map((p) => turf.point([p.lng, p.lat])));
    const hull = turf.convex(turfPts);
    if (!hull) continue;

    const areaKm2 = turf.area(hull) / 1e6;
    areas[`${pct}`] = Math.round(areaKm2 * 1000) / 1000;

    hull.properties = {
      id,
      area_km2: Math.round(areaKm2 * 1000) / 1000,
      percent: pct,
      type: "mcp",
      method: "mcp",
    };
    features.push(hull);
  }

  return { areas, features };
}

function gaussianKernel(distance: number, bandwidth: number): number {
  const u = distance / bandwidth;
  return Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
}

function silvermanBandwidth(points: GpsPoint[]): number {
  if (points.length < 2) return 1;
  const lats = points.map((p: GpsPoint) => p.lat);
  const lngs = points.map((p: GpsPoint) => p.lng);
  const stdLat = stdDev(lats);
  const stdLng = stdDev(lngs);
  const sigma = Math.max((stdLat + stdLng) / 2, 0.001);
  const n = points.length;
  const h = sigma * Math.pow((4 / (3 * n)), 0.2);
  const approxKm = h * 111;
  return Math.max(approxKm, 0.1);
}

function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s: number, v: number) => s + v, 0) / n;
  const variance = values.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function computeLSCVBandwidth(points: GpsPoint[], href: number): { h: number; converged: boolean } {
  const n = points.length;
  if (n < 10) return { h: href, converged: false };

  const samplePts = n > 500 ? samplePoints(points, 500).sampled : points;
  const sn = samplePts.length;

  const distances: number[][] = [];
  for (let i = 0; i < sn; i++) {
    distances[i] = [];
    for (let j = 0; j < sn; j++) {
      if (i === j) {
        distances[i][j] = 0;
      } else if (j < i) {
        distances[i][j] = distances[j][i];
      } else {
        distances[i][j] = turf.distance(
          turf.point([samplePts[i].lng, samplePts[i].lat]),
          turf.point([samplePts[j].lng, samplePts[j].lat]),
          { units: "kilometers" }
        );
      }
    }
  }

  const hMin = 0.1 * href;
  const hMax = 2.0 * href;
  const nSteps = 50;

  let bestH = href;
  let bestScore = Infinity;

  for (let step = 0; step < nSteps; step++) {
    const h = hMin + (hMax - hMin) * (step / (nSteps - 1));

    let score = 0;

    let integralTerm = 0;
    for (let i = 0; i < sn; i++) {
      for (let j = i + 1; j < sn; j++) {
        const d = distances[i][j];
        const hSqrt2 = h * Math.sqrt(2);
        integralTerm += 2 * gaussianKernel(d, hSqrt2);
      }
    }
    integralTerm = integralTerm / (sn * sn) + sn * gaussianKernel(0, h * Math.sqrt(2)) / (sn * sn);

    let looTerm = 0;
    for (let i = 0; i < sn; i++) {
      let densityWithout = 0;
      for (let j = 0; j < sn; j++) {
        if (i === j) continue;
        densityWithout += gaussianKernel(distances[i][j], h);
      }
      densityWithout /= (sn - 1);
      looTerm += densityWithout;
    }
    looTerm = (2.0 / sn) * looTerm;

    score = integralTerm - looTerm;

    if (score < bestScore) {
      bestScore = score;
      bestH = h;
    }
  }

  const converged = Math.abs(bestH - hMin) > 0.01 * href && Math.abs(bestH - hMax) > 0.01 * href;

  return { h: Math.round(bestH * 1000) / 1000, converged };
}

function computeKernelMultiPercent(
  pts: GpsPoint[],
  id: string,
  bandwidth: number,
  method: string
): { areas: Record<string, number>; features: GeoJSON.Feature[] } {
  const areas: Record<string, number> = {};
  const features: GeoJSON.Feature[] = [];

  if (pts.length < 5) return { areas, features };

  const turfPoints = pts.map((p) => turf.point([p.lng, p.lat]));
  const fc = turf.featureCollection(turfPoints);
  const bboxArr = turf.bbox(fc);

  const padDeg = (bandwidth / 111) * 2;
  const paddedBbox: [number, number, number, number] = [
    bboxArr[0] - padDeg,
    bboxArr[1] - padDeg,
    bboxArr[2] + padDeg,
    bboxArr[3] + padDeg,
  ];

  const cellSizeKm = Math.max(bandwidth / 3, 0.05);
  const grid = turf.pointGrid(paddedBbox, cellSizeKm, { units: "kilometers" });

  const densities: number[] = [];
  for (const gridPt of grid.features) {
    let density = 0;
    for (const p of pts) {
      const dist = turf.distance(gridPt, turf.point([p.lng, p.lat]), { units: "kilometers" });
      density += gaussianKernel(dist, bandwidth);
    }
    density /= pts.length;
    densities.push(density);
    gridPt.properties = gridPt.properties || {};
    gridPt.properties.density = density;
  }

  if (densities.length === 0) return { areas, features };

  const sortedDensities = densities.filter((d) => d > 0).sort((a, b) => b - a);
  if (sortedDensities.length === 0) return { areas, features };

  const totalDensity = sortedDensities.reduce((s, v) => s + v, 0);

  const thresholds: Record<number, number> = {};
  let cumSum = 0;
  for (const d of sortedDensities) {
    cumSum += d;
    const cumPct = cumSum / totalDensity;
    for (const pct of KERNEL_PERCENTAGES) {
      if (thresholds[pct] === undefined && cumPct > pct / 100) {
        thresholds[pct] = d;
      }
    }
  }
  for (const pct of KERNEL_PERCENTAGES) {
    if (thresholds[pct] === undefined) {
      thresholds[pct] = 0;
    }
  }

  for (const pct of KERNEL_PERCENTAGES) {
    const threshold = thresholds[pct];
    const ptsAbove = grid.features.filter((f: any) => (f.properties?.density ?? 0) >= threshold);

    if (ptsAbove.length >= 3) {
      const hull = turf.convex(turf.featureCollection(ptsAbove));
      if (hull) {
        const areaKm2 = turf.area(hull) / 1e6;
        areas[`${pct}`] = Math.round(areaKm2 * 1000) / 1000;

        hull.properties = {
          id,
          level: `${pct}%`,
          percent: pct,
          area_km2: Math.round(areaKm2 * 1000) / 1000,
          type: "kernel",
          method,
        };
        features.push(hull);
      }
    }
  }

  return { areas, features };
}

export function computeKernel(points: GpsPoint[], params?: { bandwidth?: number }): KernelResult {
  const groups = groupByIndividual(points);
  const features: GeoJSON.Feature[] = [];
  const areas: { individual: string; area_95_km2: number; area_50_km2: number }[] = [];

  for (const id of Object.keys(groups)) {
    const pts = groups[id];
    if (pts.length < 5) continue;

    const bandwidth = params?.bandwidth ?? silvermanBandwidth(pts);
    const result = computeKernelMultiPercent(pts, id, bandwidth, "href");

    areas.push({
      individual: id,
      area_95_km2: result.areas["95"] || 0,
      area_50_km2: result.areas["50"] || 0,
    });

    const f95 = result.features.find((f: any) => f.properties?.percent === 95);
    const f50 = result.features.find((f: any) => f.properties?.percent === 50);
    if (f95) features.push(f95);
    if (f50) features.push(f50);
  }

  return {
    analysisType: "kernel",
    areas,
    geojson: turf.featureCollection(features),
  };
}

export function computeDistance(points: GpsPoint[]): DistanceResult {
  const groups = groupByIndividual(points);
  const individuals: DistanceResult["individuals"] = [];

  for (const id of Object.keys(groups)) {
    const pts = groups[id];
    if (pts.length < 2) {
      individuals.push({ individual: id, total_km: 0, average_daily_km: 0, daily: [] });
      continue;
    }

    const dailyMap: Record<string, number> = {};
    let totalKm = 0;

    for (let i = 1; i < pts.length; i++) {
      const dist = turf.distance(
        turf.point([pts[i - 1].lng, pts[i - 1].lat]),
        turf.point([pts[i].lng, pts[i].lat]),
        { units: "kilometers" }
      );
      totalKm += dist;

      const dateStr = new Date(pts[i].timestamp).toISOString().split("T")[0];
      dailyMap[dateStr] = (dailyMap[dateStr] || 0) + dist;
    }

    const daily = Object.entries(dailyMap)
      .map(([date, distance_km]) => ({
        date,
        distance_km: Math.round(distance_km * 1000) / 1000,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const avgDaily = daily.length > 0 ? totalKm / daily.length : 0;

    individuals.push({
      individual: id,
      total_km: Math.round(totalKm * 1000) / 1000,
      average_daily_km: Math.round(avgDaily * 1000) / 1000,
      daily,
    });
  }

  return { analysisType: "distance", individuals };
}

export function computeSpeed(points: GpsPoint[]): SpeedResult {
  const groups = groupByIndividual(points);
  const individuals: SpeedResult["individuals"] = [];

  for (const id of Object.keys(groups)) {
    const pts = groups[id];
    if (pts.length < 2) {
      individuals.push({ individual: id, average_kmh: 0, max_kmh: 0, speeds: [] });
      continue;
    }

    const speeds: { timestamp: number; speed_kmh: number }[] = [];

    for (let i = 1; i < pts.length; i++) {
      const dist = turf.distance(
        turf.point([pts[i - 1].lng, pts[i - 1].lat]),
        turf.point([pts[i].lng, pts[i].lat]),
        { units: "kilometers" }
      );
      const timeDiffH = (pts[i].timestamp - pts[i - 1].timestamp) / (1000 * 3600);
      if (timeDiffH <= 0) continue;

      const speedKmh = dist / timeDiffH;
      if (speedKmh > 500) continue;

      speeds.push({
        timestamp: pts[i].timestamp,
        speed_kmh: Math.round(speedKmh * 100) / 100,
      });
    }

    const avgKmh = speeds.length > 0 ? speeds.reduce((s: number, v) => s + v.speed_kmh, 0) / speeds.length : 0;
    const maxKmh = speeds.length > 0 ? Math.max(...speeds.map((s) => s.speed_kmh)) : 0;

    individuals.push({
      individual: id,
      average_kmh: Math.round(avgKmh * 100) / 100,
      max_kmh: Math.round(maxKmh * 100) / 100,
      speeds,
    });
  }

  return { analysisType: "speed", individuals };
}

function computeEccentricity(pts: GpsPoint[]): number {
  if (pts.length < 3) return 0;

  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const meanLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;

  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const xCoords = pts.map((p) => (p.lng - meanLng) * cosLat * 111.32);
  const yCoords = pts.map((p) => (p.lat - meanLat) * 111.32);

  const meanX = xCoords.reduce((s, v) => s + v, 0) / xCoords.length;
  const meanY = yCoords.reduce((s, v) => s + v, 0) / yCoords.length;

  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx = xCoords[i] - meanX;
    const dy = yCoords[i] - meanY;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= pts.length;
  cyy /= pts.length;
  cxy /= pts.length;

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const discriminant = Math.max(0, trace * trace - 4 * det);
  const sqrtDisc = Math.sqrt(discriminant);

  const lambda1 = (trace + sqrtDisc) / 2;
  const lambda2 = (trace - sqrtDisc) / 2;

  const a = Math.sqrt(Math.max(lambda1, 0));
  const b = Math.sqrt(Math.max(lambda2, 0));

  if (a === 0) return 0;
  return Math.round(Math.sqrt(1 - (b * b) / (a * a)) * 1000) / 1000;
}

function computeLinearity(pts: GpsPoint[]): number {
  if (pts.length < 2) return 0;

  const netDisplacement = turf.distance(
    turf.point([pts[0].lng, pts[0].lat]),
    turf.point([pts[pts.length - 1].lng, pts[pts.length - 1].lat]),
    { units: "kilometers" }
  );

  let totalDist = 0;
  for (let i = 1; i < pts.length; i++) {
    totalDist += turf.distance(
      turf.point([pts[i - 1].lng, pts[i - 1].lat]),
      turf.point([pts[i].lng, pts[i].lat]),
      { units: "kilometers" }
    );
  }

  if (totalDist === 0) return 0;
  return Math.round((netDisplacement / totalDist) * 1000) / 1000;
}

function computeDistanceMetrics(pts: GpsPoint[]): {
  totalKm: number;
  minConsecutiveKm: number;
  maxConsecutiveKm: number;
  minDailyKm: number;
  maxDailyKm: number;
  avgDailyKm: number;
  daily: { date: string; distance_km: number }[];
} {
  if (pts.length < 2) {
    return { totalKm: 0, minConsecutiveKm: 0, maxConsecutiveKm: 0, minDailyKm: 0, maxDailyKm: 0, avgDailyKm: 0, daily: [] };
  }

  const consecutiveDists: number[] = [];
  const dailyMap: Record<string, number> = {};
  let totalKm = 0;

  for (let i = 1; i < pts.length; i++) {
    const dist = turf.distance(
      turf.point([pts[i - 1].lng, pts[i - 1].lat]),
      turf.point([pts[i].lng, pts[i].lat]),
      { units: "kilometers" }
    );
    totalKm += dist;
    consecutiveDists.push(dist);

    const dateStr = new Date(pts[i].timestamp).toISOString().split("T")[0];
    dailyMap[dateStr] = (dailyMap[dateStr] || 0) + dist;
  }

  const daily = Object.entries(dailyMap)
    .map(([date, distance_km]) => ({ date, distance_km: Math.round(distance_km * 1000) / 1000 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const dailyValues = daily.map((d) => d.distance_km);

  return {
    totalKm: Math.round(totalKm * 1000) / 1000,
    minConsecutiveKm: consecutiveDists.length > 0 ? Math.round(Math.min(...consecutiveDists) * 1000) / 1000 : 0,
    maxConsecutiveKm: consecutiveDists.length > 0 ? Math.round(Math.max(...consecutiveDists) * 1000) / 1000 : 0,
    minDailyKm: dailyValues.length > 0 ? Math.min(...dailyValues) : 0,
    maxDailyKm: dailyValues.length > 0 ? Math.max(...dailyValues) : 0,
    avgDailyKm: dailyValues.length > 0 ? Math.round((dailyValues.reduce((s, v) => s + v, 0) / dailyValues.length) * 1000) / 1000 : 0,
    daily,
  };
}

export function computeComprehensive(
  points: GpsPoint[],
  params?: { bandwidthMethod?: string }
): ComprehensiveResult {
  const bandwidthMethod = params?.bandwidthMethod || "href";
  const groups = groupByIndividual(points);
  const allFeatures: GeoJSON.Feature[] = [];
  const perIndividual: IndividualComprehensiveMetrics[] = [];

  let totalPointsAll = 0;
  let totalSampledAll = 0;
  let anySampled = false;

  for (const id of Object.keys(groups)) {
    const rawPts = groups[id];
    totalPointsAll += rawPts.length;

    const { sampled: pts, wasSampled, originalSize } = samplePoints(rawPts, MAX_SAMPLE_SIZE);
    totalSampledAll += pts.length;
    if (wasSampled) anySampled = true;

    if (pts.length < 3) continue;

    const dates = new Set(pts.map((p) => new Date(p.timestamp).toISOString().split("T")[0]));

    const distMetrics = computeDistanceMetrics(pts);
    const eccentricity = computeEccentricity(pts);
    const linearity = computeLinearity(pts);

    const hHref = silvermanBandwidth(pts);

    let hLscv: number | null = null;
    let lscvConverged = false;
    let kernelLscvAreas: Record<string, number> | null = null;

    if (bandwidthMethod === "href" || bandwidthMethod === "both") {
      const kernelHref = computeKernelMultiPercent(pts, id, hHref, "href");
      for (const f of kernelHref.features) allFeatures.push(f);

      if (bandwidthMethod === "both") {
        const lscvResult = computeLSCVBandwidth(pts, hHref);
        hLscv = lscvResult.h;
        lscvConverged = lscvResult.converged;

        const effectiveH = lscvResult.converged ? lscvResult.h : hHref;
        const kernelLscv = computeKernelMultiPercent(pts, id, effectiveH, "lscv");
        kernelLscvAreas = kernelLscv.areas;
        for (const f of kernelLscv.features) allFeatures.push(f);
      }

      const mcpResult = computeMCPMultiPercent(pts, id);
      for (const f of mcpResult.features) allFeatures.push(f);

      perIndividual.push({
        individual: id,
        locations: originalSize,
        analysisDays: dates.size,
        firstDate: new Date(pts[0].timestamp).toISOString(),
        lastDate: new Date(pts[pts.length - 1].timestamp).toISOString(),
        totalDistanceKm: distMetrics.totalKm,
        minConsecutiveDistKm: distMetrics.minConsecutiveKm,
        maxConsecutiveDistKm: distMetrics.maxConsecutiveKm,
        minDailyDistKm: distMetrics.minDailyKm,
        maxDailyDistKm: distMetrics.maxDailyKm,
        avgDailyDistKm: distMetrics.avgDailyKm,
        eccentricity,
        linearity,
        hHref: Math.round(hHref * 1000) / 1000,
        hLscv,
        lscvConverged,
        kernelHrefAreas: kernelHref.areas,
        kernelLscvAreas,
        mcpAreas: mcpResult.areas,
      });
    } else if (bandwidthMethod === "lscv") {
      const lscvResult = computeLSCVBandwidth(pts, hHref);
      hLscv = lscvResult.h;
      lscvConverged = lscvResult.converged;

      const effectiveH = lscvResult.converged ? lscvResult.h : hHref;
      const kernelResult = computeKernelMultiPercent(pts, id, effectiveH, "lscv");
      for (const f of kernelResult.features) allFeatures.push(f);

      const mcpResult = computeMCPMultiPercent(pts, id);
      for (const f of mcpResult.features) allFeatures.push(f);

      perIndividual.push({
        individual: id,
        locations: originalSize,
        analysisDays: dates.size,
        firstDate: new Date(pts[0].timestamp).toISOString(),
        lastDate: new Date(pts[pts.length - 1].timestamp).toISOString(),
        totalDistanceKm: distMetrics.totalKm,
        minConsecutiveDistKm: distMetrics.minConsecutiveKm,
        maxConsecutiveDistKm: distMetrics.maxConsecutiveKm,
        minDailyDistKm: distMetrics.minDailyKm,
        maxDailyDistKm: distMetrics.maxDailyKm,
        avgDailyDistKm: distMetrics.avgDailyKm,
        eccentricity,
        linearity,
        hHref: Math.round(hHref * 1000) / 1000,
        hLscv,
        lscvConverged,
        kernelHrefAreas: kernelResult.areas,
        kernelLscvAreas: null,
        mcpAreas: mcpResult.areas,
      });
    }
  }

  return {
    analysisType: "comprehensive",
    bandwidthMethod,
    sampled: anySampled,
    sampleSize: totalSampledAll,
    totalPoints: totalPointsAll,
    perIndividual,
    geojson: turf.featureCollection(allFeatures),
  };
}

export function runAnalysis(
  analysisType: string,
  gpsRows: { individual_id: string; timestamp: number; latitude: number; longitude: number }[],
  params?: Record<string, any>
): AnalysisResult {
  const points: GpsPoint[] = gpsRows.map((r) => ({
    lat: r.latitude,
    lng: r.longitude,
    timestamp: r.timestamp,
    individual_id: r.individual_id,
  }));

  switch (analysisType) {
    case "mcp":
      return computeMCP(points, params);
    case "kernel":
      return computeKernel(points, params);
    case "distance":
      return computeDistance(points);
    case "speed":
      return computeSpeed(points);
    case "comprehensive":
      return computeComprehensive(points, params);
    default:
      throw new Error(`Tipo de análisis no soportado: ${analysisType}`);
  }
}
