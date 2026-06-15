import { useEffect, useMemo, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Study, Individual } from "@shared/schema";
import {
  MapContainer,
  Polyline,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, MapPin, Activity } from "lucide-react";
import { MapLayerControl, GoogleMapsClick, googleMapsLink } from "@/components/map-layers";
import { formatAnimalLabelById } from "@/lib/animal-label";

const SENSOR_GPS = 653;
const SENSOR_ACC = 2365683;
const MAX_GPS_MARKERS = 500;
const MAX_CHART_POINTS = 2000;
const HDOP_QUALITY_THRESHOLD = 5;
const TRACK_COLOR = "#3b82f6";

interface GpsPoint {
  timestamp: number;
  lat: number;
  lng: number;
  speed: number | null;
  hdop: number | null;
}

interface AccPoint {
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

function parseGpsEvents(rows: Record<string, string>[]): GpsPoint[] {
  return rows
    .filter((r) => r.location_lat && r.location_long)
    .map((r) => ({
      timestamp: new Date(r.timestamp).getTime(),
      lat: parseFloat(r.location_lat),
      lng: parseFloat(r.location_long),
      speed: r.ground_speed ? parseFloat(r.ground_speed) : null,
      hdop: r.hdop ? parseFloat(r.hdop) : null,
    }))
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lng) && !isNaN(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function parseAccEvents(rows: Record<string, string>[]): AccPoint[] {
  const points: AccPoint[] = [];
  for (const r of rows) {
    const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
    const ts = new Date(r.timestamp).getTime();
    if (isNaN(ts)) continue;
    if (rawAxes) {
      const vals = rawAxes.split(/\s+/).map(Number);
      for (let i = 0; i + 2 < vals.length; i += 3) {
        if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
          points.push({ timestamp: ts + i * 10, x: vals[i], y: vals[i + 1], z: vals[i + 2] });
        }
      }
    } else {
      points.push({
        timestamp: ts,
        x: parseFloat(r.acceleration_x || "0"),
        y: parseFloat(r.acceleration_y || "0"),
        z: parseFloat(r.acceleration_z || "0"),
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

  const { animal, dateStart, dateEnd } = useMemo(() => {
    const sp = new URLSearchParams(search);
    const fallback = defaultRange();
    return {
      animal: sp.get("animal") || "",
      dateStart: sp.get("start") || fallback.start,
      dateEnd: sp.get("end") || fallback.end,
    };
  }, [search]);

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
  const [gps, setGps] = useState<GpsPoint[]>([]);
  const [acc, setAcc] = useState<AccPoint[]>([]);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!studyId || !animal) {
      setLoading(false);
      setError("Faltan parámetros (animal o estudio).");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const tsStart = new Date(dateStart).getTime();
        const tsEnd = new Date(dateEnd + "T23:59:59").getTime();
        if (isNaN(tsStart) || isNaN(tsEnd) || tsStart >= tsEnd) {
          throw new Error("Rango de fechas inválido.");
        }
        const baseParams = `individuals=${encodeURIComponent(animal)}&timestamp_start=${tsStart}&timestamp_end=${tsEnd}`;
        const [gpsRes, accRes] = await Promise.all([
          fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_GPS}`, { credentials: "include" }),
          fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_ACC}`, { credentials: "include" }),
        ]);
        if (!gpsRes.ok || !accRes.ok) throw new Error("No se pudieron cargar los datos.");
        const gpsRaw: Record<string, Record<string, string>[]> = await gpsRes.json();
        const accRaw: Record<string, Record<string, string>[]> = await accRes.json();
        const parsedGps = parseGpsEvents(Object.values(gpsRaw).flat());
        const parsedAcc = parseAccEvents(Object.values(accRaw).flat());
        if (cancelled) return;
        setGps(parsedGps);
        setAcc(parsedAcc);
        if (parsedGps.length > 0) {
          const avgLat = parsedGps.reduce((s, p) => s + p.lat, 0) / parsedGps.length;
          const avgLng = parsedGps.reduce((s, p) => s + p.lng, 0) / parsedGps.length;
          setMapCenter([avgLat, avgLng]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Error al cargar los datos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [studyId, animal, dateStart, dateEnd]);

  const positions = useMemo<[number, number][]>(() => gps.map((p) => [p.lat, p.lng]), [gps]);
  const markersToShow = useMemo(() => downsample(gps, MAX_GPS_MARKERS), [gps]);
  const chartData = useMemo(() => downsample(acc, MAX_CHART_POINTS), [acc]);

  const animalLabel = animal ? formatAnimalLabelById(animal, individualByLocalId) : "—";

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-background" data-testid="view-fullscreen">
      {/* Mapa: tres cuartas partes superiores */}
      <div className="h-3/4 relative">
        <div className="absolute top-2 left-2 z-[1000] bg-background/90 backdrop-blur-sm border border-border rounded-md px-3 py-1.5 shadow-md">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground" data-testid="text-fullscreen-animal">
            <MapPin className="w-4 h-4 text-primary" />
            {animalLabel}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {study?.name ? `${study.name} · ` : ""}{dateStart} → {dateEnd}
          </div>
          {!loading && !error && (
            <div className="text-[11px] text-muted-foreground mt-0.5" data-testid="text-fullscreen-counts">
              {gps.length} GPS · {acc.length} muestras ACC
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <p className="text-sm text-destructive" data-testid="text-fullscreen-error">{error}</p>
          </div>
        ) : gps.length === 0 ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="text-center space-y-2 max-w-sm">
              <MapPin className="w-10 h-10 mx-auto text-muted-foreground/30" />
              <p className="text-sm font-medium text-foreground">No hay datos GPS en este rango</p>
              <p className="text-xs text-muted-foreground">
                Este animal no ha transmitido posiciones en las fechas elegidas. Prueba con un rango más amplio.
              </p>
            </div>
          </div>
        ) : (
          <MapContainer center={mapCenter || [0, 0]} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true}>
            <MapLayerControl />
            <GoogleMapsClick />
            <MapUpdater center={mapCenter} />
            <Polyline positions={positions} pathOptions={{ color: TRACK_COLOR, weight: 2.5, opacity: 0.8 }} />
            {markersToShow.map((p, idx) => {
              const lowQuality = p.hdop != null && p.hdop > HDOP_QUALITY_THRESHOLD;
              return (
                <CircleMarker
                  key={idx}
                  center={[p.lat, p.lng]}
                  radius={3}
                  pathOptions={lowQuality
                    ? { color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.4, weight: 1, dashArray: "2,2" }
                    : { color: TRACK_COLOR, fillColor: TRACK_COLOR, fillOpacity: 0.7, weight: 1 }}
                >
                  <Popup>
                    <div className="text-xs space-y-0.5">
                      <div className="font-semibold">{animalLabel}</div>
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
          </MapContainer>
        )}
      </div>

      {/* Acelerómetro: cuarto inferior */}
      <div className="h-1/4 border-t border-border flex flex-col px-2 pt-1 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1 shrink-0">
          <Activity className="w-3.5 h-3.5" />
          Acelerómetro
        </div>
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
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
