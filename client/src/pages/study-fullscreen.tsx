import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Study, Individual } from "@shared/schema";
import {
  MapContainer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, MapPin, Activity, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { MapLayerControl, GoogleMapsClick, googleMapsLink } from "@/components/map-layers";
import { formatAnimalLabelById } from "@/lib/animal-label";
import { AnimalSearch } from "@/components/animal-search";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const SENSOR_GPS = 653;
const SENSOR_ACC = 2365683;
const MAX_GPS_MARKERS = 500;
const MAX_CHART_POINTS = 2000;
const HDOP_QUALITY_THRESHOLD = 5;
const ACC_GPS_MATCH_WINDOW_MS = 30 * 60 * 1000;

const ANIMAL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
];

interface GpsPoint {
  timestamp: number;
  lat: number;
  lng: number;
  speed: number | null;
  hdop: number | null;
  animal: string;
}

interface AccPoint {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  animal: string;
}

const highlightIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(239,68,68,0.8);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function parseGpsEvents(animal: string, rows: Record<string, string>[]): GpsPoint[] {
  return rows
    .filter((r) => r.location_lat && r.location_long)
    .map((r) => ({
      timestamp: new Date(r.timestamp).getTime(),
      lat: parseFloat(r.location_lat),
      lng: parseFloat(r.location_long),
      speed: r.ground_speed ? parseFloat(r.ground_speed) : null,
      hdop: r.hdop ? parseFloat(r.hdop) : null,
      animal,
    }))
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lng) && !isNaN(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function parseAccEvents(animal: string, rows: Record<string, string>[]): AccPoint[] {
  const points: AccPoint[] = [];
  for (const r of rows) {
    const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
    const ts = new Date(r.timestamp).getTime();
    if (isNaN(ts)) continue;
    if (rawAxes) {
      const vals = rawAxes.split(/\s+/).map(Number);
      for (let i = 0; i + 2 < vals.length; i += 3) {
        if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
          points.push({ timestamp: ts + i * 10, x: vals[i], y: vals[i + 1], z: vals[i + 2], animal });
        }
      }
    } else {
      points.push({
        timestamp: ts,
        x: parseFloat(r.acceleration_x || "0"),
        y: parseFloat(r.acceleration_y || "0"),
        z: parseFloat(r.acceleration_z || "0"),
        animal,
      });
    }
  }
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}

function formatTimestamp(ts: number) {
  try { return format(new Date(ts), "dd/MM HH:mm:ss", { locale: es }); }
  catch { return String(ts); }
}

function defaultRange() {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(now) };
}

function MapUpdater({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    if (center) map.flyTo(center, map.getZoom() || 12, { duration: 0.5 });
  }, [center, map]);
  return null;
}

export default function StudyFullscreen() {
  const [, params] = useRoute("/study/:id/fullscreen");
  const studyId = params?.id;
  const search = useSearch();
  const { toast } = useToast();

  // Parámetros iniciales desde la URL (solo se leen una vez para sembrar el estado).
  const initial = useMemo(() => {
    const sp = new URLSearchParams(search);
    const fallback = defaultRange();
    const animalsParam = sp.get("animals") || sp.get("animal") || "";
    const animals = animalsParam.split(",").map((a) => a.trim()).filter(Boolean);
    return {
      animals,
      focus: sp.get("focus") || (animals.length === 1 ? animals[0] : ""),
      dateStart: sp.get("start") || fallback.start,
      dateEnd: sp.get("end") || fallback.end,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedAnimals, setSelectedAnimals] = useState<string[]>(initial.animals);
  const [dateStart, setDateStart] = useState(initial.dateStart);
  const [dateEnd, setDateEnd] = useState(initial.dateEnd);
  const [focusAnimal, setFocusAnimal] = useState<string>(initial.focus);
  const [panelOpen, setPanelOpen] = useState(true);

  const { data: study } = useQuery<Study>({
    queryKey: ["/api/studies", studyId],
    enabled: !!studyId,
  });

  const { data: individuals } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    enabled: !!studyId,
  });

  const individualByLocalId = useMemo(() => {
    const map = new Map<string, Individual>();
    (individuals || []).forEach((i) => { if (i.localIdentifier) map.set(i.localIdentifier, i); });
    return map;
  }, [individuals]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gpsData, setGpsData] = useState<Record<string, GpsPoint[]>>({});
  const [accData, setAccData] = useState<Record<string, AccPoint[]>>({});
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [highlightedTimestamp, setHighlightedTimestamp] = useState<number | null>(null);
  const [highlightedGpsPoint, setHighlightedGpsPoint] = useState<GpsPoint | null>(null);

  const animalColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    selectedAnimals.forEach((a, i) => { map[a] = ANIMAL_COLORS[i % ANIMAL_COLORS.length]; });
    return map;
  }, [selectedAnimals]);

  // Si el animal enfocado deja de estar seleccionado, limpiar el foco.
  useEffect(() => {
    if (focusAnimal && !selectedAnimals.includes(focusAnimal)) setFocusAnimal("");
  }, [selectedAnimals, focusAnimal]);

  // Al cambiar el animal enfocado, descartar el resaltado del contexto anterior.
  useEffect(() => {
    setHighlightedTimestamp(null);
    setHighlightedGpsPoint(null);
  }, [focusAnimal]);

  // Carga de datos: se reejecuta cuando cambian los animales o el rango de fechas.
  const animalsKey = selectedAnimals.join(",");
  useEffect(() => {
    if (!studyId || selectedAnimals.length === 0) {
      setLoading(false);
      setGpsData({});
      setAccData({});
      setError(selectedAnimals.length === 0 ? "Selecciona al menos un animal." : null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setHighlightedTimestamp(null);
      setHighlightedGpsPoint(null);
      try {
        const tsStart = new Date(dateStart).getTime();
        const tsEnd = new Date(dateEnd + "T23:59:59").getTime();
        if (isNaN(tsStart) || isNaN(tsEnd) || tsStart >= tsEnd) {
          throw new Error("Rango de fechas inválido.");
        }
        const baseParams = `individuals=${encodeURIComponent(animalsKey)}&timestamp_start=${tsStart}&timestamp_end=${tsEnd}`;
        const [gpsRes, accRes] = await Promise.all([
          fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_GPS}`, { credentials: "include" }),
          fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_ACC}`, { credentials: "include" }),
        ]);
        if (!gpsRes.ok || !accRes.ok) throw new Error("No se pudieron cargar los datos.");
        const gpsRaw: Record<string, Record<string, string>[]> = await gpsRes.json();
        const accRaw: Record<string, Record<string, string>[]> = await accRes.json();
        const parsedGps: Record<string, GpsPoint[]> = {};
        const parsedAcc: Record<string, AccPoint[]> = {};
        for (const [animalId, events] of Object.entries(gpsRaw)) parsedGps[animalId] = parseGpsEvents(animalId, events);
        for (const [animalId, events] of Object.entries(accRaw)) parsedAcc[animalId] = parseAccEvents(animalId, events);
        if (cancelled) return;
        setGpsData(parsedGps);
        setAccData(parsedAcc);
        const allGps = Object.values(parsedGps).flat();
        if (allGps.length > 0) {
          const avgLat = allGps.reduce((s, p) => s + p.lat, 0) / allGps.length;
          const avgLng = allGps.reduce((s, p) => s + p.lng, 0) / allGps.length;
          setMapCenter([avgLat, avgLng]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Error al cargar los datos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [studyId, animalsKey, dateStart, dateEnd]);

  const totalGps = useMemo(() => Object.values(gpsData).reduce((s, a) => s + a.length, 0), [gpsData]);
  const totalAcc = useMemo(() => Object.values(accData).reduce((s, a) => s + a.length, 0), [accData]);

  // Datos de la gráfica ACC: un animal si hay foco/uno solo, si no la mezcla ordenada.
  const chartData = useMemo(() => {
    const animalId = focusAnimal || (selectedAnimals.length === 1 ? selectedAnimals[0] : null);
    let data: AccPoint[];
    if (animalId) data = accData[animalId] || [];
    else data = Object.values(accData).flat().sort((a, b) => a.timestamp - b.timestamp);
    return downsample(data, MAX_CHART_POINTS);
  }, [accData, focusAnimal, selectedAnimals]);

  const findClosestGpsPoint = useCallback(
    (timestamp: number, animalFilter?: string, maxDiffMs: number = ACC_GPS_MATCH_WINDOW_MS): GpsPoint | null => {
      let closest: GpsPoint | null = null;
      let minDiff = Infinity;
      const entries = animalFilter
        ? [[animalFilter, gpsData[animalFilter] || []] as const]
        : Object.entries(gpsData);
      for (const [, points] of entries) {
        for (const p of points) {
          const diff = Math.abs(p.timestamp - timestamp);
          if (diff < minDiff) { minDiff = diff; closest = p; }
        }
      }
      if (closest && minDiff > maxDiffMs) return null;
      return closest;
    },
    [gpsData]
  );

  const findClosestAccPoint = useCallback(
    (timestamp: number, animalFilter?: string, maxDiffMs: number = ACC_GPS_MATCH_WINDOW_MS): AccPoint | null => {
      let closest: AccPoint | null = null;
      let minDiff = Infinity;
      const entries = animalFilter
        ? [[animalFilter, accData[animalFilter] || []] as const]
        : Object.entries(accData);
      for (const [, points] of entries) {
        for (const p of points) {
          const diff = Math.abs(p.timestamp - timestamp);
          if (diff < minDiff) { minDiff = diff; closest = p; }
        }
      }
      if (closest && minDiff > maxDiffMs) return null;
      return closest;
    },
    [accData]
  );

  const handleChartClick = useCallback(
    (data: any) => {
      if (!data?.activePayload?.[0]) return;
      const payload = data.activePayload[0].payload;
      const ts = payload.timestamp;
      const animal = payload.animal || focusAnimal || undefined;
      setHighlightedTimestamp(ts);
      const gp = findClosestGpsPoint(ts, animal);
      if (gp) {
        setHighlightedGpsPoint(gp);
        setMapCenter([gp.lat, gp.lng]);
      } else {
        setHighlightedGpsPoint(null);
        toast({ description: "Sin posición GPS disponible en este momento (±30 min).", duration: 2500 });
      }
    },
    [findClosestGpsPoint, focusAnimal, toast]
  );

  const handleMapPointClick = useCallback(
    (gpsPoint: GpsPoint) => {
      setHighlightedGpsPoint(gpsPoint);
      setMapCenter([gpsPoint.lat, gpsPoint.lng]);
      const accPt = findClosestAccPoint(gpsPoint.timestamp, gpsPoint.animal);
      if (accPt) setHighlightedTimestamp(accPt.timestamp);
      else {
        setHighlightedTimestamp(null);
        toast({ description: "Sin datos de acelerómetro en este momento (±30 min).", duration: 2500 });
      }
    },
    [findClosestAccPoint, toast]
  );

  const highlightedAccValues = useMemo(() => {
    if (!highlightedGpsPoint) return null;
    return findClosestAccPoint(highlightedGpsPoint.timestamp, highlightedGpsPoint.animal);
  }, [highlightedGpsPoint, findClosestAccPoint]);

  const headerLabel = useMemo(() => {
    if (selectedAnimals.length === 0) return "—";
    if (selectedAnimals.length === 1) return formatAnimalLabelById(selectedAnimals[0], individualByLocalId);
    return `${selectedAnimals.length} animales`;
  }, [selectedAnimals, individualByLocalId]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-background" data-testid="view-fullscreen">
      {/* Mapa: tres cuartas partes superiores */}
      <div className="h-3/4 relative">
        <div className="absolute top-2 left-2 z-[1000] bg-background/90 backdrop-blur-sm border border-border rounded-md px-3 py-1.5 shadow-md max-w-[60%]">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground" data-testid="text-fullscreen-animal">
            <MapPin className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">{headerLabel}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {study?.name ? `${study.name} · ` : ""}{dateStart} → {dateEnd}
          </div>
          {!loading && !error && (
            <div className="text-[11px] text-muted-foreground mt-0.5" data-testid="text-fullscreen-counts">
              {totalGps} GPS · {totalAcc} muestras ACC
            </div>
          )}
          {selectedAnimals.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {selectedAnimals.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: animalColorMap[a] }} />
                  {formatAnimalLabelById(a, individualByLocalId)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Panel de control flotante minimizable (esquina superior derecha) */}
        {panelOpen ? (
          <div className="absolute top-2 right-2 z-[1001] w-80 max-w-[calc(100vw-1rem)] bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg" data-testid="panel-controls">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                Controles
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-collapse-panel"
                title="Minimizar panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-3 max-h-[calc(75vh-3rem)] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
                  <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="h-8 text-xs" data-testid="input-fullscreen-date-start" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Fecha fin</Label>
                  <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="h-8 text-xs" data-testid="input-fullscreen-date-end" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Animales</Label>
                <AnimalSearch
                  individuals={individuals || []}
                  selected={selectedAnimals}
                  onChange={setSelectedAnimals}
                  multiple
                  placeholder="Añadir o quitar animal..."
                />
              </div>
              {selectedAnimals.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Acelerómetro: enfocar animal</Label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setFocusAnimal("")}
                      className={`text-[11px] px-2 py-1 rounded border ${focusAnimal === "" ? "bg-primary text-primary-foreground border-primary" : "border-input text-foreground hover-elevate"}`}
                      data-testid="button-focus-all"
                    >
                      Todos
                    </button>
                    {selectedAnimals.map((a) => (
                      <button
                        key={a}
                        onClick={() => setFocusAnimal(a)}
                        className="text-[11px] px-2 py-1 rounded border"
                        style={focusAnimal === a
                          ? { backgroundColor: animalColorMap[a], borderColor: animalColorMap[a], color: "white" }
                          : { borderColor: animalColorMap[a], color: animalColorMap[a] }}
                        data-testid={`button-focus-${a}`}
                      >
                        {formatAnimalLabelById(a, individualByLocalId)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setPanelOpen(true)}
            className="absolute top-2 right-2 z-[1001] flex items-center gap-1.5 bg-background/95 backdrop-blur-sm border border-border rounded-md px-2.5 py-1.5 shadow-md text-xs font-medium hover-elevate"
            data-testid="button-expand-panel"
            title="Mostrar controles"
          >
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            Controles
            <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          </button>
        )}

        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <p className="text-sm text-destructive" data-testid="text-fullscreen-error">{error}</p>
          </div>
        ) : totalGps === 0 ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="text-center space-y-2 max-w-sm">
              <MapPin className="w-10 h-10 mx-auto text-muted-foreground/30" />
              <p className="text-sm font-medium text-foreground">No hay datos GPS en este rango</p>
              <p className="text-xs text-muted-foreground">
                {selectedAnimals.length > 1 ? "Los animales seleccionados no han" : "Este animal no ha"} transmitido posiciones en las fechas elegidas. Prueba con un rango más amplio.
              </p>
            </div>
          </div>
        ) : (
          <MapContainer center={mapCenter || [0, 0]} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true}>
            <MapLayerControl />
            <GoogleMapsClick />
            <MapUpdater center={mapCenter} />
            {selectedAnimals.map((animalId) => {
              const points = gpsData[animalId] || [];
              if (points.length === 0) return null;
              const color = animalColorMap[animalId];
              const positions: [number, number][] = points.map((p) => [p.lat, p.lng]);
              const markersToShow = downsample(points, MAX_GPS_MARKERS);
              return (
                <span key={animalId}>
                  <Polyline positions={positions} pathOptions={{ color, weight: 2.5, opacity: 0.8 }} />
                  {markersToShow.map((p, idx) => {
                    const lowQuality = p.hdop != null && p.hdop > HDOP_QUALITY_THRESHOLD;
                    return (
                      <CircleMarker
                        key={`${animalId}-${idx}`}
                        center={[p.lat, p.lng]}
                        radius={3}
                        pathOptions={lowQuality
                          ? { color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.4, weight: 1, dashArray: "2,2" }
                          : { color, fillColor: color, fillOpacity: 0.7, weight: 1 }}
                        eventHandlers={{ click: () => handleMapPointClick(p) }}
                      >
                        <Popup>
                          <div className="text-xs space-y-0.5">
                            <div className="font-semibold">{formatAnimalLabelById(animalId, individualByLocalId)}</div>
                            <div>{format(new Date(p.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: es })}</div>
                            <div>Lat: {p.lat.toFixed(6)}, Lng: {p.lng.toFixed(6)}</div>
                            {p.speed !== null && <div>Velocidad: {p.speed.toFixed(2)} m/s</div>}
                            {p.hdop !== null && (
                              <div className={lowQuality ? "text-amber-600 font-semibold" : ""}>
                                HDOP: {p.hdop.toFixed(1)}{lowQuality && " (baja calidad)"}
                              </div>
                            )}
                            <a href={googleMapsLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Ver en Google Maps</a>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </span>
              );
            })}
            {highlightedGpsPoint && (
              <Marker position={[highlightedGpsPoint.lat, highlightedGpsPoint.lng]} icon={highlightIcon}>
                <Popup>
                  <div className="text-xs space-y-0.5" data-testid="popup-highlighted-gps">
                    <div className="font-bold" style={{ color: "#ef4444" }}>Punto seleccionado</div>
                    <div className="font-semibold">{formatAnimalLabelById(highlightedGpsPoint.animal, individualByLocalId)}</div>
                    <div>{format(new Date(highlightedGpsPoint.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: es })}</div>
                    <div>Lat: {highlightedGpsPoint.lat.toFixed(6)}, Lng: {highlightedGpsPoint.lng.toFixed(6)}</div>
                    {highlightedAccValues ? (
                      <div className="mt-1 pt-1 border-t border-border">
                        <div className="font-medium text-[11px] text-muted-foreground mb-0.5">
                          Acelerómetro {Math.abs(highlightedAccValues.timestamp - highlightedGpsPoint.timestamp) > 60000 && (
                            <span className="text-[10px]">
                              (Δ {Math.round(Math.abs(highlightedAccValues.timestamp - highlightedGpsPoint.timestamp) / 60000)} min)
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div><span style={{ color: "#3B82F6" }}>X:</span> {highlightedAccValues.x.toFixed(0)}</div>
                          <div><span style={{ color: "#EF4444" }}>Y:</span> {highlightedAccValues.y.toFixed(0)}</div>
                          <div><span style={{ color: "#EAB308" }}>Z:</span> {highlightedAccValues.z.toFixed(0)}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 pt-1 border-t border-border text-[11px] text-muted-foreground italic">
                        Sin datos de acelerómetro en este momento (±30 min)
                      </div>
                    )}
                    <a href={googleMapsLink(highlightedGpsPoint.lat, highlightedGpsPoint.lng)} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Ver en Google Maps</a>
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        )}
      </div>

      {/* Acelerómetro: cuarto inferior */}
      <div className="h-1/4 border-t border-border flex flex-col px-2 pt-1 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1 shrink-0">
          <Activity className="w-3.5 h-3.5" />
          Acelerómetro
          {focusAnimal
            ? <span className="text-muted-foreground font-normal">· {formatAnimalLabelById(focusAnimal, individualByLocalId)}</span>
            : selectedAnimals.length > 1
              ? <span className="text-muted-foreground font-normal">· {selectedAnimals.length} animales (combinado)</span>
              : null}
          <span className="text-muted-foreground font-normal ml-auto text-[10px]">Pincha un punto para resaltarlo en el mapa</span>
        </div>
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} onClick={handleChartClick}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="timestamp" tickFormatter={formatTimestamp} type="number" domain={["dataMin", "dataMax"]} fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <YAxis fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} width={40} />
                <RechartsTooltip
                  labelFormatter={(ts) => formatTimestamp(ts as number)}
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px", color: "hsl(var(--foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Line type="monotone" dataKey="x" stroke="#3B82F6" name="Eje X" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="y" stroke="#EF4444" name="Eje Y" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="z" stroke="#EAB308" name="Eje Z" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                {highlightedTimestamp !== null && chartData.length > 0 && (() => {
                  let nearest = chartData[0];
                  let minDiff = Math.abs(nearest.timestamp - highlightedTimestamp);
                  for (const d of chartData) {
                    const diff = Math.abs(d.timestamp - highlightedTimestamp);
                    if (diff < minDiff) { minDiff = diff; nearest = d; }
                  }
                  return <ReferenceDot x={nearest.timestamp} y={nearest.x} r={6} fill="#ef4444" stroke="white" strokeWidth={2} />;
                })()}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-muted-foreground">No hay datos de acelerómetro para este rango</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
