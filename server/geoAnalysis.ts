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
  kernelPercentages: number[];
  areas: { individual: string; areas: Record<string, number> }[];
  geojson: GeoJSON.FeatureCollection;
}

interface DistanceResult {
  analysisType: "distance";
  individuals: {
    individual: string;
    total_km: number;
    average_daily_km: number;
    net_displacement_km: number;
    linearity_index: number | null;
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
  kernelPercentages: number[];
  perIndividual: IndividualComprehensiveMetrics[];
  geojson: GeoJSON.FeatureCollection;
  distance: DistanceResult["individuals"];
  speed: SpeedResult["individuals"];
}

export type AnalysisResult = McpResult | KernelResult | DistanceResult | SpeedResult | ComprehensiveResult;

export const KERNEL_PERCENTAGES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
export const DEFAULT_KERNEL_PERCENTAGES = [50, 95];
export const MAX_KERNEL_PERCENTAGES = 10;
export const MCP_PERCENTAGES = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

export function normalizeKernelPercentages(input: unknown): number[] {
  if (!Array.isArray(input) || input.length === 0) return [...DEFAULT_KERNEL_PERCENTAGES];
  const valid: number[] = [];
  for (const v of input) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    const i = Math.round(n);
    if (i >= 1 && i <= 99 && !valid.includes(i)) valid.push(i);
  }
  if (valid.length === 0) return [...DEFAULT_KERNEL_PERCENTAGES];
  valid.sort((a, b) => a - b);
  return valid.slice(0, MAX_KERNEL_PERCENTAGES);
}
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

function gaussianKernel2D(dx: number, dy: number, bandwidth: number): number {
  const u2 = (dx * dx + dy * dy) / (bandwidth * bandwidth);
  return Math.exp(-0.5 * u2) / (2 * Math.PI * bandwidth * bandwidth);
}

function gaussianKernel(distance: number, bandwidth: number): number {
  const u = distance / bandwidth;
  return Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
}

function projectToMeters(points: GpsPoint[]): { x: number[]; y: number[]; meanLat: number; meanLng: number } {
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const meanLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const x = points.map((p) => (p.lng - meanLng) * 111320 * cosLat);
  const y = points.map((p) => (p.lat - meanLat) * 111320);
  return { x, y, meanLat, meanLng };
}

function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s: number, v: number) => s + v, 0) / n;
  const variance = values.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function iqr(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 4) return stdDev(values) * 1.34;
  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);
  return sorted[q3Idx] - sorted[q1Idx];
}

function silvermanBandwidth(points: GpsPoint[]): number {
  if (points.length < 2) return 1;
  const n = points.length;

  const { x, y } = projectToMeters(points);

  const sdX = stdDev(x);
  const sdY = stdDev(y);
  const iqrX = iqr(x);
  const iqrY = iqr(y);

  const sd = Math.sqrt((sdX * sdX + sdY * sdY) / 2);
  const iqrCombined = Math.sqrt((iqrX * iqrX + iqrY * iqrY) / 2);

  const sigma = Math.min(sd, iqrCombined / 1.34);
  const h_meters = 0.9 * sigma * Math.pow(n, -1 / 6);
  const h_km = h_meters / 1000;

  console.log(`[HREF] n=${n}, sdX=${sdX.toFixed(1)}m, sdY=${sdY.toFixed(1)}m, iqrX=${iqrX.toFixed(1)}m, iqrY=${iqrY.toFixed(1)}m, sd=${sd.toFixed(1)}m, iqr/1.34=${(iqrCombined / 1.34).toFixed(1)}m, sigma=${sigma.toFixed(1)}m, h=${h_km.toFixed(3)}km`);

  return Math.max(h_km, 0.05);
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

const MAX_GRID_SIDE = 80;

type GridPt = [number, number];

// Interpolación lineal de la posición de cruce del umbral entre dos valores de celda.
function lerpCrossing(va: number, vb: number, threshold: number): number {
  const d = vb - va;
  if (d === 0) return 0.5;
  const t = (threshold - va) / d;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Marching squares sobre una rejilla regular de densidad (row-major, ancho W, alto H).
// Devuelve los anillos cerrados de la isolínea para `threshold`, en coordenadas de
// rejilla. La rejilla debe venir con un borde "exterior" (valor < umbral) para que
// todos los contornos cierren dentro del dominio. Equivalente al trazado de
// getverticeshr() de adehabitatHR: sigue la forma real de la densidad, no su
// envolvente convexa.
function marchingSquaresRings(values: number[], W: number, H: number, threshold: number): GridPt[][] {
  const at = (r: number, c: number) => values[r * W + c];
  const key = (p: GridPt) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const segs: [GridPt, GridPt][] = [];

  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const tl = at(r, c);
      const tr = at(r, c + 1);
      const br = at(r + 1, c + 1);
      const bl = at(r + 1, c);

      let code = 0;
      if (tl >= threshold) code |= 8;
      if (tr >= threshold) code |= 4;
      if (br >= threshold) code |= 2;
      if (bl >= threshold) code |= 1;
      if (code === 0 || code === 15) continue;

      const T = (): GridPt => [c + lerpCrossing(tl, tr, threshold), r];
      const R = (): GridPt => [c + 1, r + lerpCrossing(tr, br, threshold)];
      const B = (): GridPt => [c + lerpCrossing(bl, br, threshold), r + 1];
      const L = (): GridPt => [c, r + lerpCrossing(tl, bl, threshold)];
      const seg = (a: GridPt, b: GridPt) => segs.push([a, b]);

      switch (code) {
        case 1: seg(L(), B()); break;
        case 2: seg(B(), R()); break;
        case 3: seg(L(), R()); break;
        case 4: seg(T(), R()); break;
        case 5: {
          const center = (tl + tr + br + bl) / 4;
          if (center >= threshold) { seg(T(), L()); seg(B(), R()); }
          else { seg(T(), R()); seg(L(), B()); }
          break;
        }
        case 6: seg(T(), B()); break;
        case 7: seg(L(), T()); break;
        case 8: seg(T(), L()); break;
        case 9: seg(T(), B()); break;
        case 10: {
          const center = (tl + tr + br + bl) / 4;
          if (center >= threshold) { seg(T(), R()); seg(L(), B()); }
          else { seg(T(), L()); seg(B(), R()); }
          break;
        }
        case 11: seg(T(), R()); break;
        case 12: seg(L(), R()); break;
        case 13: seg(R(), B()); break;
        case 14: seg(L(), B()); break;
      }
    }
  }

  // Coser los segmentos en anillos cerrados conectando extremos compartidos.
  const adj = new Map<string, { pt: GridPt; segId: number }[]>();
  segs.forEach((s, i) => {
    const ka = key(s[0]);
    const kb = key(s[1]);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ pt: s[1], segId: i });
    adj.get(kb)!.push({ pt: s[0], segId: i });
  });

  const used = new Array(segs.length).fill(false);
  const rings: GridPt[][] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const start = segs[i][0];
    let current = segs[i][1];
    used[i] = true;
    const ring: GridPt[] = [start, current];
    let guard = 0;
    while (key(current) !== key(start) && guard++ <= segs.length) {
      const nbrs = adj.get(key(current)) || [];
      let nextSeg = -1;
      let nextPt: GridPt | null = null;
      for (const nb of nbrs) {
        if (!used[nb.segId]) { nextSeg = nb.segId; nextPt = nb.pt; break; }
      }
      if (nextSeg === -1 || !nextPt) break;
      used[nextSeg] = true;
      current = nextPt;
      ring.push(current);
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) {
      rings.push(ring);
    }
  }

  return rings;
}

// Test punto-en-polígono (ray casting) en espacio de rejilla, para anidar agujeros.
function pointInGridRing(pt: GridPt, ring: GridPt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function computeKernelMultiPercent(
  pts: GpsPoint[],
  id: string,
  bandwidth: number,
  method: string,
  percentages: number[] = DEFAULT_KERNEL_PERCENTAGES,
): { areas: Record<string, number>; features: GeoJSON.Feature[] } {
  const areas: Record<string, number> = {};
  const features: GeoJSON.Feature[] = [];

  if (pts.length < 5) return { areas, features };

  const t0 = Date.now();
  console.log(`KDE [${id}]: Iniciando con ${pts.length} puntos, bandwidth=${bandwidth.toFixed(3)} km, método=${method}`);

  const turfPoints = pts.map((p) => turf.point([p.lng, p.lat]));
  const fc = turf.featureCollection(turfPoints);
  const bboxArr = turf.bbox(fc);

  const padDeg = (bandwidth / 111) * 3;
  const paddedBbox: [number, number, number, number] = [
    bboxArr[0] - padDeg,
    bboxArr[1] - padDeg,
    bboxArr[2] + padDeg,
    bboxArr[3] + padDeg,
  ];

  const bboxWidthKm = turf.distance(
    turf.point([paddedBbox[0], paddedBbox[1]]),
    turf.point([paddedBbox[2], paddedBbox[1]]),
    { units: "kilometers" }
  );
  const bboxHeightKm = turf.distance(
    turf.point([paddedBbox[0], paddedBbox[1]]),
    turf.point([paddedBbox[0], paddedBbox[3]]),
    { units: "kilometers" }
  );

  const minCellSize = Math.max(bboxWidthKm, bboxHeightKm) / MAX_GRID_SIDE;
  const cellSizeKm = Math.max(bandwidth / 4, minCellSize, 0.05);
  const grid = turf.pointGrid(paddedBbox, cellSizeKm, { units: "kilometers" });
  const cellAreaKm2 = cellSizeKm * cellSizeKm;

  console.log(`KDE [${id}]: Grid generado con ${grid.features.length} celdas (cellSize=${cellSizeKm.toFixed(3)} km, cellArea=${cellAreaKm2.toFixed(4)} km²)`);

  const cutoffDist = 3 * bandwidth;
  const h_km = bandwidth;

  const ptsCoords = pts.map((p) => ({ lng: p.lng, lat: p.lat }));
  const n = pts.length;

  const densities: number[] = [];
  for (const gridPt of grid.features) {
    let density = 0;
    const gCoords = gridPt.geometry.coordinates;
    const cosLat = Math.cos((gCoords[1] * Math.PI) / 180);
    for (const p of ptsCoords) {
      const dxKm = (gCoords[0] - p.lng) * 111.32 * cosLat;
      const dyKm = (gCoords[1] - p.lat) * 111.32;
      if (Math.abs(dxKm) > cutoffDist || Math.abs(dyKm) > cutoffDist) continue;
      const dist2 = dxKm * dxKm + dyKm * dyKm;
      if (dist2 > cutoffDist * cutoffDist) continue;
      density += gaussianKernel2D(dxKm, dyKm, h_km);
    }
    density /= n;
    densities.push(density);
    gridPt.properties = gridPt.properties || {};
    gridPt.properties.density = density;
  }

  console.log(`KDE [${id}]: Densidades calculadas en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (densities.length === 0) return { areas, features };

  const cellVolumes = densities.map((d) => d * cellAreaKm2);
  const totalVolume = cellVolumes.reduce((s, v) => s + v, 0);

  if (totalVolume === 0) return { areas, features };

  const indexed = cellVolumes.map((v, i) => ({ v, i, d: densities[i] }));
  indexed.sort((a, b) => b.d - a.d);

  const thresholds: Record<number, number> = {};
  let cumVolume = 0;
  for (const item of indexed) {
    cumVolume += item.v;
    const cumPct = cumVolume / totalVolume;
    for (const pct of percentages) {
      if (thresholds[pct] === undefined && cumPct >= pct / 100) {
        thresholds[pct] = item.d;
      }
    }
  }
  for (const pct of percentages) {
    if (thresholds[pct] === undefined) {
      thresholds[pct] = 0;
    }
  }

  // Reconstruir la rejilla regular (lattice lng/lat) a partir de los puntos de
  // densidad ya calculados, para poder extraer isolíneas con marching squares.
  const fkey = (v: number) => v.toFixed(8);
  const xMap = new Map<string, number>();
  const yMap = new Map<string, number>();
  for (const f of grid.features as any[]) {
    const lng = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    xMap.set(fkey(lng), lng);
    yMap.set(fkey(lat), lat);
  }
  const xs = Array.from(xMap.values()).sort((a, b) => a - b);
  const ys = Array.from(yMap.values()).sort((a, b) => a - b);
  const gnx = xs.length;
  const gny = ys.length;

  let structured: { W: number; H: number; padded: number[]; toGeo: (p: GridPt) => [number, number] } | null = null;
  if (gnx >= 2 && gny >= 2) {
    const xIdx = new Map(xs.map((v, i) => [fkey(v), i]));
    const yIdx = new Map(ys.map((v, i) => [fkey(v), i]));
    const dens2d = new Array(gnx * gny).fill(0);
    grid.features.forEach((f: any, k: number) => {
      const ci = xIdx.get(fkey(f.geometry.coordinates[0]));
      const ri = yIdx.get(fkey(f.geometry.coordinates[1]));
      if (ci !== undefined && ri !== undefined) dens2d[ri * gnx + ci] = densities[k];
    });
    // Borde exterior con valor < cualquier densidad (densidades >= 0) para que
    // todos los contornos cierren dentro del dominio.
    const W = gnx + 2;
    const H = gny + 2;
    const padded = new Array(W * H).fill(-1);
    for (let r = 0; r < gny; r++) {
      for (let c = 0; c < gnx; c++) {
        padded[(r + 1) * W + (c + 1)] = dens2d[r * gnx + c];
      }
    }
    const dxDeg = (xs[gnx - 1] - xs[0]) / (gnx - 1);
    const dyDeg = (ys[gny - 1] - ys[0]) / (gny - 1);
    const toGeo = (p: GridPt): [number, number] => [
      xs[0] + (p[0] - 1) * dxDeg,
      ys[0] + (p[1] - 1) * dyDeg,
    ];
    structured = { W, H, padded, toGeo };
  }

  const closeRing = (r: [number, number][]): [number, number][] => {
    const a = r[0];
    const b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
    return r;
  };

  for (const pct of percentages) {
    const threshold = thresholds[pct];
    const cellsAbove = grid.features.filter((f: any) => (f.properties?.density ?? 0) >= threshold);

    let polygonFeature: GeoJSON.Feature | null = null;
    let areaKm2: number | null = null;

    // 1) Contorno real de densidad (isolínea) vía marching squares.
    if (structured && threshold > 0) {
      const rings = marchingSquaresRings(structured.padded, structured.W, structured.H, threshold);
      if (rings.length > 0) {
        const geoRings = rings.map((r) => closeRing(r.map(structured!.toGeo)));
        // Profundidad de anidamiento: par = anillo exterior, impar = agujero.
        const depth = rings.map((r, ri) => {
          let d = 0;
          const tp = r[0];
          for (let si = 0; si < rings.length; si++) {
            if (si !== ri && pointInGridRing(tp, rings[si])) d++;
          }
          return d;
        });
        const polygons: [number, number][][][] = [];
        rings.forEach((_, oi) => {
          if (depth[oi] % 2 !== 0) return; // sólo anillos exteriores
          const coords: [number, number][][] = [geoRings[oi]];
          rings.forEach((_, hi) => {
            if (depth[hi] === depth[oi] + 1 && pointInGridRing(rings[hi][0], rings[oi])) {
              coords.push(geoRings[hi]);
            }
          });
          polygons.push(coords);
        });

        try {
          if (polygons.length === 1) polygonFeature = turf.polygon(polygons[0]);
          else if (polygons.length > 1) polygonFeature = turf.multiPolygon(polygons);
        } catch {
          polygonFeature = null;
        }

        if (polygonFeature) {
          const a = turf.area(polygonFeature) / 1e6;
          if (Number.isFinite(a) && a > 0) areaKm2 = a;
          else polygonFeature = null;
        }
      }
    }

    // 2) Fallback: envolvente convexa si la isolínea falla o queda vacía.
    if (!polygonFeature && cellsAbove.length >= 3) {
      const hull = turf.convex(turf.featureCollection(cellsAbove));
      if (hull) {
        polygonFeature = hull;
        const a = turf.area(hull) / 1e6;
        areaKm2 = Number.isFinite(a) && a > 0 ? a : cellsAbove.length * cellAreaKm2;
      }
    }

    if (polygonFeature && areaKm2 !== null) {
      const rounded = Math.round(areaKm2 * 1000) / 1000;
      areas[`${pct}`] = rounded;
      polygonFeature.properties = {
        id,
        level: `${pct}%`,
        percent: pct,
        area_km2: rounded,
        type: "kernel",
        method,
      };
      features.push(polygonFeature);
    }
  }

  console.log(`KDE [${id}]: Completado en ${((Date.now() - t0) / 1000).toFixed(1)}s, ${Object.keys(areas).length} contornos generados (${percentages.join(",")}%)`);

  return { areas, features };
}

export function computeKernel(points: GpsPoint[], params?: { bandwidth?: number; kernelPercentages?: number[] }): KernelResult {
  const groups = groupByIndividual(points);
  const features: GeoJSON.Feature[] = [];
  const areas: { individual: string; areas: Record<string, number> }[] = [];
  const kernelPercentages = normalizeKernelPercentages(params?.kernelPercentages);

  for (const id of Object.keys(groups)) {
    const rawPts = groups[id];
    if (rawPts.length < 5) continue;

    const { sampled: pts } = samplePoints(rawPts, MAX_SAMPLE_SIZE);
    const bandwidth = params?.bandwidth ?? silvermanBandwidth(pts);
    const result = computeKernelMultiPercent(pts, id, bandwidth, "href", kernelPercentages);

    areas.push({ individual: id, areas: result.areas });
    for (const f of result.features) features.push(f);
  }

  return {
    analysisType: "kernel",
    kernelPercentages,
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
      individuals.push({
        individual: id,
        total_km: 0,
        average_daily_km: 0,
        net_displacement_km: 0,
        linearity_index: null,
        daily: [],
      });
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

    const netDisplacementKm = turf.distance(
      turf.point([pts[0].lng, pts[0].lat]),
      turf.point([pts[pts.length - 1].lng, pts[pts.length - 1].lat]),
      { units: "kilometers" }
    );

    const linearityIndex = totalKm > 0
      ? Math.min(1, Math.round((netDisplacementKm / totalKm) * 1000) / 1000)
      : null;

    individuals.push({
      individual: id,
      total_km: Math.round(totalKm * 1000) / 1000,
      average_daily_km: Math.round(avgDaily * 1000) / 1000,
      net_displacement_km: Math.round(netDisplacementKm * 100) / 100,
      linearity_index: linearityIndex,
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

function buildTrajectoryFeature(pts: GpsPoint[], id: string): GeoJSON.Feature | null {
  if (pts.length < 2) return null;
  const coords = pts.map((p) => [p.lng, p.lat]);
  return {
    type: "Feature",
    properties: { id, type: "trajectory" },
    geometry: { type: "LineString", coordinates: coords },
  };
}

export function computeComprehensive(
  points: GpsPoint[],
  params?: { bandwidthMethod?: string; kernelPercentages?: number[] }
): ComprehensiveResult {
  const bandwidthMethod = params?.bandwidthMethod || "href";
  const kernelPercentages = normalizeKernelPercentages(params?.kernelPercentages);
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

    const trajectory = buildTrajectoryFeature(pts, id);
    if (trajectory) allFeatures.push(trajectory);

    if (bandwidthMethod === "href" || bandwidthMethod === "both") {
      const kernelHref = computeKernelMultiPercent(pts, id, hHref, "href", kernelPercentages);
      for (const f of kernelHref.features) allFeatures.push(f);

      if (bandwidthMethod === "both") {
        const lscvResult = computeLSCVBandwidth(pts, hHref);
        hLscv = lscvResult.h;
        lscvConverged = lscvResult.converged;

        const effectiveH = lscvResult.converged ? lscvResult.h : hHref;
        const kernelLscv = computeKernelMultiPercent(pts, id, effectiveH, "lscv", kernelPercentages);
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
      const kernelResult = computeKernelMultiPercent(pts, id, effectiveH, "lscv", kernelPercentages);
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
    kernelPercentages,
    geojson: turf.featureCollection(allFeatures),
    distance: computeDistance(points).individuals,
    speed: computeSpeed(points).individuals,
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
