import { useState, useCallback, useMemo, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Study, Individual, DetectedEvent } from "@shared/schema";
import { EVENT_LABELS, EVENT_COLORS } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Loader2,
  Check,
  X,
  Download,
  MapPin,
  Activity,
  Zap,
  AlertTriangle,
  Skull,
  Utensils,
  Bird,
  ExternalLink,
  Search,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceDot,
} from "recharts";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const SENSOR_GPS = 653;
const SENSOR_ACC = 2365683;
const MAX_GPS_MARKERS = 500;
const MAX_CHART_POINTS = 2000;

const ANIMAL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
];

const EVENT_ICONS: Record<string, any> = {
  mortality: Skull,
  detachment: Zap,
  fight: AlertTriangle,
  feeding: Utensils,
  incubation: Bird,
};

interface GpsPoint {
  timestamp: number;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  animal: string;
}

interface AccPoint {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  animal: string;
}

function parseGpsEvents(animalId: string, rows: Record<string, string>[]): GpsPoint[] {
  return rows
    .filter((r) => r.location_lat && r.location_long)
    .map((r) => ({
      timestamp: new Date(r.timestamp).getTime(),
      lat: parseFloat(r.location_lat),
      lng: parseFloat(r.location_long),
      speed: r.ground_speed ? parseFloat(r.ground_speed) : null,
      heading: r.heading ? parseFloat(r.heading) : null,
      animal: animalId,
    }))
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lng) && !isNaN(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function parseAccEvents(animalId: string, rows: Record<string, string>[]): AccPoint[] {
  const points: AccPoint[] = [];
  for (const r of rows) {
    const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
    const ts = new Date(r.timestamp).getTime();
    if (isNaN(ts)) continue;
    if (rawAxes) {
      const vals = rawAxes.split(/\s+/).map(Number);
      for (let i = 0; i + 2 < vals.length; i += 3) {
        if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
          points.push({ timestamp: ts + i * 10, x: vals[i], y: vals[i + 1], z: vals[i + 2], animal: animalId });
        }
      }
    } else {
      points.push({
        timestamp: ts,
        x: parseFloat(r.acceleration_x || "0"),
        y: parseFloat(r.acceleration_y || "0"),
        z: parseFloat(r.acceleration_z || "0"),
        animal: animalId,
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

const highlightIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(239,68,68,0.8);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function MapUpdater({ center, zoom }: { center: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || map.getZoom(), { duration: 0.5 });
    }
  }, [center, zoom, map]);
  return null;
}

function severityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return <Badge variant="outline" className="text-xs" style={{ borderColor: "#ef4444", color: "#ef4444" }}>Critica</Badge>;
    case "high":
      return <Badge variant="outline" className="text-xs" style={{ borderColor: "#f97316", color: "#f97316" }}>Alta</Badge>;
    default:
      return <Badge variant="outline" className="text-xs" style={{ borderColor: "#22c55e", color: "#22c55e" }}>Info</Badge>;
  }
}

export default function StudyVisualization() {
  const [, params] = useRoute("/study/:id/visualize");
  const studyId = params?.id;
  const { toast } = useToast();

  const [selectedAnimals, setSelectedAnimals] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [loading, setLoading] = useState(false);

  const [gpsData, setGpsData] = useState<Record<string, GpsPoint[]>>({});
  const [accData, setAccData] = useState<Record<string, AccPoint[]>>({});
  const [dataLoaded, setDataLoaded] = useState(false);

  const [highlightedTimestamp, setHighlightedTimestamp] = useState<number | null>(null);
  const [highlightedGpsPoint, setHighlightedGpsPoint] = useState<GpsPoint | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  const [zoomStart, setZoomStart] = useState<number | null>(null);
  const [zoomEnd, setZoomEnd] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  const [activeAnimalFilter, setActiveAnimalFilter] = useState<string | null>(null);
  const [detectedEvents, setDetectedEvents] = useState<DetectedEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(true);

  const { data: study } = useQuery<Study>({
    queryKey: ["/api/studies", studyId],
    enabled: !!studyId,
  });

  const { data: individuals } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    enabled: !!studyId,
  });

  const selectableAnimals = useMemo(() => {
    return (individuals || []).filter((i) => i.localIdentifier && i.localIdentifier.trim() !== "");
  }, [individuals]);

  const toggleAnimal = (localId: string) => {
    setSelectedAnimals((prev) =>
      prev.includes(localId) ? prev.filter((a) => a !== localId) : [...prev, localId]
    );
  };

  const selectAll = () => setSelectedAnimals(selectableAnimals.map((i) => i.localIdentifier!));
  const deselectAll = () => setSelectedAnimals([]);

  const detectMutation = useMutation({
    mutationFn: async () => {
      if (!studyId || !dateStart || !dateEnd || selectedAnimals.length === 0) return;
      const tsStart = new Date(dateStart).getTime();
      const tsEnd = new Date(dateEnd + "T23:59:59").getTime();
      const res = await apiRequest("POST", `/api/studies/${studyId}/detect-events`, {
        individuals: selectedAnimals.join(","),
        timestamp_start: String(tsStart),
        timestamp_end: String(tsEnd),
      });
      return res.json();
    },
    onSuccess: async (data) => {
      toast({
        title: "Deteccion completada",
        description: `${data?.totalEvents || 0} eventos detectados, ${data?.emailsSent || 0} alertas enviadas`,
      });
      if (studyId) {
        const tsStart = new Date(dateStart).getTime();
        const tsEnd = new Date(dateEnd + "T23:59:59").getTime();
        const res = await fetch(
          `/api/studies/${studyId}/detected-events?timestamp_start=${tsStart}&timestamp_end=${tsEnd}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const events = await res.json();
          setDetectedEvents(events);
        }
      }
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const loadData = async () => {
    if (!studyId || selectedAnimals.length === 0 || !dateStart || !dateEnd) {
      toast({ title: "Datos incompletos", description: "Selecciona animales y rango de fechas", variant: "destructive" });
      return;
    }

    const tsStart = new Date(dateStart).getTime();
    const tsEnd = new Date(dateEnd + "T23:59:59").getTime();

    if (tsStart >= tsEnd) {
      toast({ title: "Fechas invalidas", description: "La fecha de inicio debe ser anterior a la de fin", variant: "destructive" });
      return;
    }

    setLoading(true);
    setDataLoaded(false);
    setHighlightedTimestamp(null);
    setHighlightedGpsPoint(null);
    setZoomStart(null);
    setZoomEnd(null);
    setActiveAnimalFilter(null);
    setDetectedEvents([]);
    setSelectedEventId(null);

    try {
      const animalParam = selectedAnimals.join(",");
      const baseParams = `individuals=${encodeURIComponent(animalParam)}&timestamp_start=${tsStart}&timestamp_end=${tsEnd}`;

      const [gpsRes, accRes, eventsRes] = await Promise.all([
        fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_GPS}`, { credentials: "include" }),
        fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_ACC}`, { credentials: "include" }),
        fetch(`/api/studies/${studyId}/detected-events?timestamp_start=${tsStart}&timestamp_end=${tsEnd}`, { credentials: "include" }),
      ]);

      if (!gpsRes.ok || !accRes.ok) throw new Error("Error al obtener datos de Movebank");

      const gpsRaw: Record<string, Record<string, string>[]> = await gpsRes.json();
      const accRaw: Record<string, Record<string, string>[]> = await accRes.json();

      const parsedGps: Record<string, GpsPoint[]> = {};
      const parsedAcc: Record<string, AccPoint[]> = {};

      for (const [animalId, events] of Object.entries(gpsRaw)) {
        parsedGps[animalId] = parseGpsEvents(animalId, events);
      }
      for (const [animalId, events] of Object.entries(accRaw)) {
        parsedAcc[animalId] = parseAccEvents(animalId, events);
      }

      setGpsData(parsedGps);
      setAccData(parsedAcc);
      setDataLoaded(true);

      if (eventsRes.ok) {
        const events = await eventsRes.json();
        setDetectedEvents(events);
      }

      const allGps = Object.values(parsedGps).flat();
      if (allGps.length > 0) {
        const avgLat = allGps.reduce((s, p) => s + p.lat, 0) / allGps.length;
        const avgLng = allGps.reduce((s, p) => s + p.lng, 0) / allGps.length;
        setMapCenter([avgLat, avgLng]);
      }

      const totalGps = Object.values(parsedGps).reduce((s, a) => s + a.length, 0);
      const totalAcc = Object.values(parsedAcc).reduce((s, a) => s + a.length, 0);
      toast({ title: "Datos cargados", description: `${totalGps} puntos GPS, ${totalAcc} muestras de acelerometro` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const findClosestGpsPoint = useCallback(
    (timestamp: number, animalFilter?: string): GpsPoint | null => {
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
      return closest;
    },
    [gpsData]
  );

  const findClosestAccTimestamp = useCallback(
    (timestamp: number, animalFilter?: string): number | null => {
      let closest: number | null = null;
      let minDiff = Infinity;
      const entries = animalFilter
        ? [[animalFilter, accData[animalFilter] || []] as const]
        : Object.entries(accData);
      for (const [, points] of entries) {
        for (const p of points) {
          const diff = Math.abs(p.timestamp - timestamp);
          if (diff < minDiff) { minDiff = diff; closest = p.timestamp; }
        }
      }
      return closest;
    },
    [accData]
  );

  const handleChartClick = useCallback(
    (data: any) => {
      if (!data?.activePayload?.[0]) return;
      const payload = data.activePayload[0].payload;
      const ts = payload.timestamp;
      const animal = payload.animal || activeAnimalFilter;
      setHighlightedTimestamp(ts);
      const gp = findClosestGpsPoint(ts, animal || undefined);
      if (gp) { setHighlightedGpsPoint(gp); setMapCenter([gp.lat, gp.lng]); }
    },
    [findClosestGpsPoint, activeAnimalFilter]
  );

  const handleMapPointClick = useCallback(
    (gpsPoint: GpsPoint) => {
      setHighlightedGpsPoint(gpsPoint);
      setMapCenter([gpsPoint.lat, gpsPoint.lng]);
      const accTs = findClosestAccTimestamp(gpsPoint.timestamp, gpsPoint.animal);
      if (accTs !== null) setHighlightedTimestamp(accTs);
    },
    [findClosestAccTimestamp]
  );

  const handleEventClick = useCallback(
    (event: DetectedEvent) => {
      setSelectedEventId(event.id);
      const midTs = (event.timestampStart + event.timestampEnd) / 2;
      setHighlightedTimestamp(midTs);

      if (event.lat && event.lng) {
        setMapCenter([event.lat, event.lng]);
        setHighlightedGpsPoint({
          timestamp: midTs,
          lat: event.lat,
          lng: event.lng,
          speed: null,
          heading: null,
          animal: event.individualLocalId,
        });
      } else {
        const gp = findClosestGpsPoint(midTs, event.individualLocalId);
        if (gp) { setHighlightedGpsPoint(gp); setMapCenter([gp.lat, gp.lng]); }
      }

      const margin = (event.timestampEnd - event.timestampStart) * 2;
      setZoomStart(event.timestampStart - margin);
      setZoomEnd(event.timestampEnd + margin);
      setActiveAnimalFilter(event.individualLocalId);
    },
    [findClosestGpsPoint]
  );

  const chartData = useMemo(() => {
    const animalId = activeAnimalFilter || (selectedAnimals.length === 1 ? selectedAnimals[0] : null);
    let data: AccPoint[];
    if (animalId) {
      data = accData[animalId] || [];
    } else {
      data = Object.values(accData).flat().sort((a, b) => a.timestamp - b.timestamp);
    }

    if (zoomStart !== null && zoomEnd !== null) {
      const left = Math.min(zoomStart, zoomEnd);
      const right = Math.max(zoomStart, zoomEnd);
      data = data.filter((d) => d.timestamp >= left && d.timestamp <= right);
    }

    return downsample(data, MAX_CHART_POINTS);
  }, [accData, selectedAnimals, activeAnimalFilter, zoomStart, zoomEnd]);

  const chartEventBands = useMemo(() => {
    if (!showEvents || chartData.length === 0) return [];
    const chartMin = chartData[0]?.timestamp ?? 0;
    const chartMax = chartData[chartData.length - 1]?.timestamp ?? 0;
    return detectedEvents.filter((e) => {
      if (activeAnimalFilter && e.individualLocalId !== activeAnimalFilter) return false;
      return e.timestampEnd >= chartMin && e.timestampStart <= chartMax;
    });
  }, [detectedEvents, chartData, activeAnimalFilter, showEvents]);

  const animalColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    selectedAnimals.forEach((a, i) => { map[a] = ANIMAL_COLORS[i % ANIMAL_COLORS.length]; });
    return map;
  }, [selectedAnimals]);

  const resetZoom = () => { setZoomStart(null); setZoomEnd(null); };

  const formatTimestamp = (ts: number) => {
    try { return format(new Date(ts), "dd/MM HH:mm:ss", { locale: es }); }
    catch { return String(ts); }
  };

  const totalGpsPoints = Object.values(gpsData).reduce((s, a) => s + a.length, 0);
  const totalAccPoints = Object.values(accData).reduce((s, a) => s + a.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b space-y-4 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/study/${studyId}`}>
            <Button variant="ghost" size="icon" data-testid="button-back-study">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground truncate" data-testid="text-viz-title">
              {study?.name || "Cargando..."} — Visualizacion
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
            <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-40" data-testid="input-date-start" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fecha fin</Label>
            <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" data-testid="input-date-end" />
          </div>
          <Button onClick={loadData} disabled={loading || selectedAnimals.length === 0} data-testid="button-load-data">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Cargar datos
          </Button>
          {dataLoaded && (
            <Button
              variant="outline"
              onClick={() => detectMutation.mutate()}
              disabled={detectMutation.isPending}
              data-testid="button-detect-events"
            >
              {detectMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Detectar eventos
            </Button>
          )}
          {dataLoaded && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" />
              <span>{totalGpsPoints} GPS</span>
              <Activity className="w-3.5 h-3.5 ml-1" />
              <span>{totalAccPoints} Acc</span>
              {detectedEvents.length > 0 && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 ml-1" />
                  <span>{detectedEvents.length} eventos</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs text-muted-foreground">Animales</Label>
            <Button variant="ghost" size="sm" onClick={selectAll} className="h-6 text-xs px-2" data-testid="button-select-all">Todos</Button>
            <Button variant="ghost" size="sm" onClick={deselectAll} className="h-6 text-xs px-2" data-testid="button-deselect-all">Ninguno</Button>
            {dataLoaded && selectedAnimals.length > 1 && (
              <>
                <span className="text-xs text-muted-foreground mx-1">|</span>
                <Label className="text-xs text-muted-foreground">Filtrar grafica:</Label>
                <Badge variant={activeAnimalFilter === null ? "default" : "outline"} className="cursor-pointer select-none text-xs" onClick={() => setActiveAnimalFilter(null)}>Todos</Badge>
                {selectedAnimals.map((a) => (
                  <Badge key={`filter-${a}`} variant={activeAnimalFilter === a ? "default" : "outline"} className="cursor-pointer select-none text-xs"
                    style={activeAnimalFilter === a ? { backgroundColor: animalColorMap[a], borderColor: animalColorMap[a], color: "white" } : {}}
                    onClick={() => setActiveAnimalFilter(a)} data-testid={`badge-filter-${a}`}>{a}</Badge>
                ))}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {selectableAnimals.map((ind, idx) => {
              const localId = ind.localIdentifier!;
              const isSelected = selectedAnimals.includes(localId);
              const color = ANIMAL_COLORS[idx % ANIMAL_COLORS.length];
              return (
                <Badge key={ind.id} variant={isSelected ? "default" : "outline"} className="cursor-pointer select-none gap-1"
                  style={isSelected ? { backgroundColor: color, borderColor: color, color: "white" } : {}}
                  onClick={() => toggleAnimal(localId)} data-testid={`badge-animal-${ind.movebankId}`}>
                  {isSelected ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-40" />}
                  {localId}
                </Badge>
              );
            })}
            {selectableAnimals.length === 0 && individuals && individuals.length > 0 && (
              <p className="text-xs text-muted-foreground">No hay animales con identificador local. Sincroniza con Movebank primero.</p>
            )}
            {!individuals && <Skeleton className="h-6 w-32 rounded" />}
          </div>
        </div>
      </div>

      {!dataLoaded ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Activity className="w-16 h-16 mx-auto text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Selecciona animales, rango de fechas y pulsa "Cargar datos"</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0">
            <PanelGroup direction="vertical" className="h-full">
              <Panel defaultSize={45} minSize={20}>
                <div className="h-full flex flex-col p-3">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Activity className="w-4 h-4" />
                      Acelerometro
                      {activeAnimalFilter && (
                        <Badge variant="outline" className="text-xs ml-1" style={{ borderColor: animalColorMap[activeAnimalFilter], color: animalColorMap[activeAnimalFilter] }}>
                          {activeAnimalFilter}
                        </Badge>
                      )}
                    </h2>
                    <div className="flex items-center gap-1">
                      {detectedEvents.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setShowEvents(!showEvents)} className="h-6 text-xs" data-testid="button-toggle-events">
                          {showEvents ? "Ocultar eventos" : "Mostrar eventos"}
                        </Button>
                      )}
                      {(zoomStart !== null && zoomEnd !== null) && (
                        <Button variant="ghost" size="sm" onClick={resetZoom} className="h-6 text-xs" data-testid="button-reset-zoom">
                          Restablecer zoom
                        </Button>
                      )}
                    </div>
                  </div>
                  {chartData.length > 0 ? (
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chartData}
                          onClick={handleChartClick}
                          onMouseDown={(e: any) => {
                            if (e?.activeLabel != null) {
                              setDragging(true);
                              setDragEnd(null);
                              setZoomStart(e.activeLabel);
                              setZoomEnd(null);
                            }
                          }}
                          onMouseMove={(e: any) => {
                            if (dragging && e?.activeLabel != null) setDragEnd(e.activeLabel);
                          }}
                          onMouseUp={() => {
                            if (dragging && zoomStart !== null && dragEnd !== null) {
                              const left = Math.min(zoomStart, dragEnd);
                              const right = Math.max(zoomStart, dragEnd);
                              if (right - left > 100) { setZoomStart(left); setZoomEnd(right); }
                            }
                            setDragging(false);
                            setDragEnd(null);
                          }}
                        >
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="timestamp" tickFormatter={formatTimestamp} type="number" domain={["dataMin", "dataMax"]} fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                          <RechartsTooltip
                            labelFormatter={(ts) => formatTimestamp(ts as number)}
                            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px", color: "hsl(var(--foreground))" }}
                          />
                          <Legend wrapperStyle={{ fontSize: "11px" }} />
                          <Line type="monotone" dataKey="x" stroke="#ef4444" name="Eje X" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                          <Line type="monotone" dataKey="y" stroke="#22c55e" name="Eje Y" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                          <Line type="monotone" dataKey="z" stroke="#3b82f6" name="Eje Z" dot={false} strokeWidth={1.5} isAnimationActive={false} />

                          {chartEventBands.map((ev) => (
                            <ReferenceArea
                              key={ev.id}
                              x1={Math.max(ev.timestampStart, chartData[0]?.timestamp ?? 0)}
                              x2={Math.min(ev.timestampEnd, chartData[chartData.length - 1]?.timestamp ?? 0)}
                              fill={EVENT_COLORS[ev.eventType as keyof typeof EVENT_COLORS] || "#888"}
                              fillOpacity={selectedEventId === ev.id ? 0.35 : 0.12}
                              strokeOpacity={0}
                            />
                          ))}

                          {dragging && zoomStart !== null && dragEnd !== null && (
                            <ReferenceArea x1={zoomStart} x2={dragEnd} strokeOpacity={0.3} fill="hsl(var(--primary))" fillOpacity={0.15} />
                          )}
                          {highlightedTimestamp !== null && (() => {
                            const match = chartData.find((d) => Math.abs(d.timestamp - highlightedTimestamp) < 500);
                            return match ? <ReferenceDot x={match.timestamp} y={match.x} r={6} fill="#ef4444" stroke="white" strokeWidth={2} /> : null;
                          })()}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm text-muted-foreground">No hay datos de acelerometro para este rango</p>
                    </div>
                  )}
                </div>
              </Panel>
              <PanelResizeHandle className="h-2 bg-border hover:bg-primary/30 transition-colors cursor-row-resize flex items-center justify-center">
                <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
              </PanelResizeHandle>
              <Panel defaultSize={55} minSize={20}>
                <div className="h-full p-3 flex flex-col">
                  <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                    <MapPin className="w-4 h-4" />
                    Track GPS
                    {selectedAnimals.length > 1 && (
                      <span className="text-xs text-muted-foreground font-normal ml-1">({selectedAnimals.length} animales)</span>
                    )}
                  </h2>
                  <div className="flex-1 min-h-0 rounded-md overflow-hidden border">
                    <MapContainer center={mapCenter || [0, 0]} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true}>
                      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
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
                            {markersToShow.map((p, idx) => (
                              <CircleMarker key={`${animalId}-${idx}`} center={[p.lat, p.lng]} radius={3}
                                pathOptions={{ color, fillColor: color, fillOpacity: 0.7, weight: 1 }}
                                eventHandlers={{ click: () => handleMapPointClick(p) }}>
                                <Popup>
                                  <div className="text-xs space-y-0.5">
                                    <div className="font-semibold">{animalId}</div>
                                    <div>{format(new Date(p.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: es })}</div>
                                    <div>Lat: {p.lat.toFixed(6)}, Lng: {p.lng.toFixed(6)}</div>
                                    {p.speed !== null && <div>Velocidad: {p.speed.toFixed(2)} m/s</div>}
                                  </div>
                                </Popup>
                              </CircleMarker>
                            ))}
                          </span>
                        );
                      })}
                      {highlightedGpsPoint && (
                        <Marker position={[highlightedGpsPoint.lat, highlightedGpsPoint.lng]} icon={highlightIcon}>
                          <Popup>
                            <div className="text-xs space-y-0.5">
                              <div className="font-bold" style={{ color: "#ef4444" }}>Punto seleccionado</div>
                              <div className="font-semibold">{highlightedGpsPoint.animal}</div>
                              <div>{format(new Date(highlightedGpsPoint.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: es })}</div>
                              <div>Lat: {highlightedGpsPoint.lat.toFixed(6)}, Lng: {highlightedGpsPoint.lng.toFixed(6)}</div>
                            </div>
                          </Popup>
                        </Marker>
                      )}
                    </MapContainer>
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </div>

          {detectedEvents.length > 0 && (
            <div className="w-80 border-l flex flex-col shrink-0">
              <div className="p-3 border-b">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Eventos detectados ({detectedEvents.length})
                </h3>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1.5">
                  {detectedEvents.map((ev) => {
                    const Icon = EVENT_ICONS[ev.eventType] || AlertTriangle;
                    const color = EVENT_COLORS[ev.eventType as keyof typeof EVENT_COLORS] || "#888";
                    const isSelected = selectedEventId === ev.id;
                    return (
                      <Card
                        key={ev.id}
                        className={`cursor-pointer transition-colors ${isSelected ? "ring-2" : ""}`}
                        style={isSelected ? { borderColor: color, ringColor: color } : {}}
                        onClick={() => handleEventClick(ev)}
                        data-testid={`card-event-${ev.id}`}
                      >
                        <CardContent className="p-2.5 space-y-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                            <span className="text-xs font-medium truncate">
                              {EVENT_LABELS[ev.eventType as keyof typeof EVENT_LABELS] || ev.eventType}
                            </span>
                            {severityBadge(ev.severity)}
                          </div>
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div>{ev.individualLocalId}</div>
                            <div>{formatTimestamp(ev.timestampStart)}</div>
                            {ev.description && (
                              <div className="text-xs opacity-75 line-clamp-2">{ev.description}</div>
                            )}
                          </div>
                          {ev.lat && ev.lng && (
                            <a
                              href={`https://www.google.com/maps?q=${ev.lat},${ev.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs flex items-center gap-1 text-blue-500 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`link-maps-${ev.id}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                              Google Maps
                            </a>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
