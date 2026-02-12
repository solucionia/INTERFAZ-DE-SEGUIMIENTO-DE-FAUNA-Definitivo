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

export type AnalysisResult = McpResult | KernelResult | DistanceResult | SpeedResult;

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

export function computeKernel(points: GpsPoint[], params?: { bandwidth?: number }): KernelResult {
  const groups = groupByIndividual(points);
  const features: GeoJSON.Feature[] = [];
  const areas: { individual: string; area_95_km2: number; area_50_km2: number }[] = [];

  for (const id of Object.keys(groups)) {
    const pts = groups[id];
    if (pts.length < 5) continue;

    const bandwidth = params?.bandwidth ?? silvermanBandwidth(pts);
    const turfPoints = pts.map((p: GpsPoint) => turf.point([p.lng, p.lat]));
    const fc = turf.featureCollection(turfPoints);
    const bboxArr = turf.bbox(fc);

    const padDeg = bandwidth / 111 * 2;
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

    if (densities.length === 0) continue;

    const sortedDensities = densities.filter((d: number) => d > 0).sort((a: number, b: number) => b - a);
    if (sortedDensities.length === 0) continue;

    let cumSum = 0;
    const totalDensity = sortedDensities.reduce((s: number, v: number) => s + v, 0);
    let threshold95 = 0;
    let threshold50 = 0;

    for (const d of sortedDensities) {
      cumSum += d;
      if (cumSum / totalDensity <= 0.95) {
        threshold95 = d;
      }
      if (cumSum / totalDensity <= 0.50) {
        threshold50 = d;
      }
    }

    const pts95 = grid.features.filter((f: any) => (f.properties?.density ?? 0) >= threshold95);
    const pts50 = grid.features.filter((f: any) => (f.properties?.density ?? 0) >= threshold50);

    let area95Km2 = 0;
    let area50Km2 = 0;

    if (pts95.length >= 3) {
      const hull95 = turf.convex(turf.featureCollection(pts95));
      if (hull95) {
        area95Km2 = turf.area(hull95) / 1e6;
        hull95.properties = {
          id,
          level: "95%",
          area_km2: Math.round(area95Km2 * 1000) / 1000,
          type: "kernel",
        };
        features.push(hull95);
      }
    }

    if (pts50.length >= 3) {
      const hull50 = turf.convex(turf.featureCollection(pts50));
      if (hull50) {
        area50Km2 = turf.area(hull50) / 1e6;
        hull50.properties = {
          id,
          level: "50%",
          area_km2: Math.round(area50Km2 * 1000) / 1000,
          type: "kernel",
        };
        features.push(hull50);
      }
    }

    areas.push({
      individual: id,
      area_95_km2: Math.round(area95Km2 * 1000) / 1000,
      area_50_km2: Math.round(area50Km2 * 1000) / 1000,
    });
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
    default:
      throw new Error(`Tipo de análisis no soportado: ${analysisType}`);
  }
}
