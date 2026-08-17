import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRoute, useSearch, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Study, Individual, DetectedEvent, Project, AccelerometerLabel, BehaviorType } from "@shared/schema";
import { EVENT_LABELS, EVENT_COLORS, EVENT_TYPES, BEHAVIOR_TYPES, BEHAVIOR_LABELS, BEHAVIOR_COLORS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tag, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  RefreshCw,
  FileDown,
  Image,
  FileText,
  Globe,
  Database,
  FileCode,
  Table2,
  Maximize2,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { captureMap, captureChart, downloadCanvasAsPng, sanitizeFilename } from "@/lib/mapExport";
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
import { MapLayerControl, GoogleMapsClick, googleMapsLink } from "@/components/map-layers";
import { formatAnimalLabel, formatAnimalLabelById } from "@/lib/animal-label";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { QuickDateRange, type QuickRange } from "@/components/quick-date-range";
import { AnimalSearch } from "@/components/animal-search";
import { usePermissions } from "@/hooks/use-permissions";

const SENSOR_GPS = 653;
const SENSOR_ACC = 2365683;
const MAX_GPS_MARKERS = 500;
const MAX_CHART_POINTS = 2000;
// Límite de vértices de la línea de trayectoria (Polyline). Sin este tope,
// un rango de fechas largo puede generar miles de puntos y colgar el
// renderizado (especialmente al exportar el mapa con html2canvas).
const MAX_TRACK_POINTS = 1000;

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
  hdop: number | null;
  animal: string;
}

const HDOP_QUALITY_THRESHOLD = 5;

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
      hdop: r.hdop ? parseFloat(r.hdop) : null,
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
  const [, setLocation] = useLocation();
  const studyId = params?.id;
  const search = useSearch();
  const { toast } = useToast();
  const { canExport, canDetectEvents, isObserver } = usePermissions();

  const [selectedAnimals, setSelectedAnimals] = useState<string[]>([]);
  const [projectFilterId, setProjectFilterId] = useState<string>("all");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>(null);
  const [autoLoadEnabled, setAutoLoadEnabled] = useState(false);
  const pendingAutoLoad = useRef(false);

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
  const [eventTypeFilter, setEventTypeFilter] = useState<Set<string>>(new Set(EVENT_TYPES));
  const [exporting, setExporting] = useState(false);

  const [labelMode, setLabelMode] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [pendingLabelRange, setPendingLabelRange] = useState<{ start: number; end: number } | null>(null);
  const [labelBehavior, setLabelBehavior] = useState<BehaviorType>("feeding");
  const [labelConfidence, setLabelConfidence] = useState<number>(80);
  const [labelNotes, setLabelNotes] = useState("");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const { data: study } = useQuery<Study>({
    queryKey: ["/api/studies", studyId],
    enabled: !!studyId,
  });

  const { data: individuals } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    enabled: !!studyId,
  });

  const { data: allProjects } = useQuery<(Project & { animalCount: number })[]>({
    queryKey: ["/api/projects"],
  });

  const projectIdsInStudy = useMemo(() => {
    if (!individuals) return new Set<number | null>();
    return new Set(individuals.map(ind => ind.projectId).filter((id): id is number => id != null));
  }, [individuals]);

  const { data: deviceDeployments } = useQuery<{ individualId: string }[]>({
    queryKey: ["/api/studies", studyId, "device-deployments"],
    enabled: !!studyId,
  });

  // Animales que ya no portan el emisor (localIdentifier=NULL) pero tienen
  // histórico de deployments → seleccionables por individualId para ver su periodo.
  const historicalIndividualIds = useMemo(() => {
    return new Set((deviceDeployments || []).map((d) => d.individualId));
  }, [deviceDeployments]);

  // Token de datos: emisor actual (localIdentifier) o, si fue transferido, el id del animal.
  const tokenFor = (ind: Individual): string =>
    ind.localIdentifier && ind.localIdentifier.trim() !== "" ? ind.localIdentifier : ind.id;

  const selectableAnimals = useMemo(() => {
    const base = (individuals || []).filter(
      (i) =>
        (i.localIdentifier && i.localIdentifier.trim() !== "") ||
        historicalIndividualIds.has(i.id)
    );
    if (projectFilterId === "all") return base;
    return base.filter(ind => ind.projectId === Number(projectFilterId));
  }, [individuals, projectFilterId, historicalIndividualIds]);

  const individualByLocalId = useMemo(() => {
    const map = new Map<string, Individual>();
    for (const ind of individuals || []) {
      if (ind.localIdentifier && ind.localIdentifier.trim() !== "") {
        map.set(ind.localIdentifier, ind);
      } else if (historicalIndividualIds.has(ind.id)) {
        map.set(ind.id, ind);
      }
    }
    return map;
  }, [individuals, historicalIndividualIds]);

  const toggleAnimal = (localId: string) => {
    setSelectedAnimals((prev) =>
      prev.includes(localId) ? prev.filter((a) => a !== localId) : [...prev, localId]
    );
  };

  const selectAll = () => setSelectedAnimals(selectableAnimals.map((i) => tokenFor(i)));
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

  const [forceLoading, setForceLoading] = useState(false);

  const loadData = async (force = false) => {
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

    if (force) setForceLoading(true);
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
      const forceParam = force ? "&force=true" : "";
      const baseParams = `individuals=${encodeURIComponent(animalParam)}&timestamp_start=${tsStart}&timestamp_end=${tsEnd}${forceParam}`;

      const [gpsRes, accRes, eventsRes] = await Promise.all([
        fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_GPS}`, { credentials: "include" }),
        fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_ACC}`, { credentials: "include" }),
        fetch(`/api/studies/${studyId}/detected-events?timestamp_start=${tsStart}&timestamp_end=${tsEnd}`, { credentials: "include" }),
      ]);

      if (gpsRes.status === 429 || accRes.status === 429) {
        const errBody = await (gpsRes.status === 429 ? gpsRes : accRes).json().catch(() => ({}));
        toast({ title: "Limite de peticiones", description: errBody.message || "Movebank ha limitado las peticiones temporalmente. Intente de nuevo mas tarde.", variant: "destructive" });
        return;
      }

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
      const source = force ? " (desde Movebank)" : "";
      toast({ title: "Datos cargados", description: `${totalGps} puntos GPS, ${totalAcc} muestras de acelerometro${source}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setForceLoading(false);
    }
  };

  const handleQuickRange = useCallback((range: QuickRange, start: string, end: string) => {
    setDateStart(start);
    setDateEnd(end);
    setActiveQuickRange(range);
    if (autoLoadEnabled && selectedAnimals.length > 0) {
      pendingAutoLoad.current = true;
    }
  }, [autoLoadEnabled, selectedAnimals]);

  useEffect(() => {
    if (pendingAutoLoad.current && dateStart && dateEnd && selectedAnimals.length > 0 && !loading) {
      pendingAutoLoad.current = false;
      loadData(false);
    }
  }, [dateStart, dateEnd]);

  // Apertura directa desde alertas/inmovilidad/buscador global: ?animal=<localId>
  // preselecciona el animal, fija un rango de 7 días y carga sus datos
  // automáticamente. Reacciona a cambios del parámetro para que seleccionar otro
  // animal funcione aunque la página ya esté montada.
  const lastAppliedAnimal = useRef<string | null>(null);
  useEffect(() => {
    if (!individuals || individuals.length === 0) return;
    const sp = new URLSearchParams(search);
    const animal = sp.get("animal");
    if (!animal) return;
    // Clave de aplicación: incluye start/end para que abrir el mismo animal en
    // otra fecha (p.ej. desde otro punto del detector) vuelva a aplicar el rango.
    const urlStart = sp.get("start");
    const urlEnd = sp.get("end");
    const applyKey = `${animal}|${urlStart ?? ""}|${urlEnd ?? ""}`;
    if (applyKey === lastAppliedAnimal.current) return;
    if (!individuals.some((i) => i.localIdentifier === animal || i.id === animal)) return;
    lastAppliedAnimal.current = applyKey;
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    setSelectedAnimals([animal]);
    setActiveAnimalFilter(animal);
    if (urlStart && urlEnd && dateRe.test(urlStart) && dateRe.test(urlEnd)) {
      setDateStart(urlStart);
      setDateEnd(urlEnd);
      setActiveQuickRange(null);
    } else {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setDateStart(fmt(start));
      setDateEnd(fmt(now));
      setActiveQuickRange("7d");
    }
    pendingAutoLoad.current = true;
  }, [individuals, search]);

  const handleDateStartChange = (val: string) => {
    setDateStart(val);
    setActiveQuickRange(null);
  };

  const handleDateEndChange = (val: string) => {
    setDateEnd(val);
    setActiveQuickRange(null);
  };

  // Margen máximo (±30 min) para vincular un timestamp de acelerómetro con un punto GPS y viceversa.
  const ACC_GPS_MATCH_WINDOW_MS = 30 * 60 * 1000;

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
      const animal = payload.animal || activeAnimalFilter;
      setHighlightedTimestamp(ts);
      const gp = findClosestGpsPoint(ts, animal || undefined);
      if (gp) {
        setHighlightedGpsPoint(gp);
        setMapCenter([gp.lat, gp.lng]);
      } else {
        setHighlightedGpsPoint(null);
        toast({
          description: "Sin posición GPS disponible en este momento (±30 min).",
          duration: 2500,
        });
      }
    },
    [findClosestGpsPoint, activeAnimalFilter, toast]
  );

  const handleMapPointClick = useCallback(
    (gpsPoint: GpsPoint) => {
      setHighlightedGpsPoint(gpsPoint);
      setMapCenter([gpsPoint.lat, gpsPoint.lng]);
      const accPt = findClosestAccPoint(gpsPoint.timestamp, gpsPoint.animal);
      if (accPt) {
        setHighlightedTimestamp(accPt.timestamp);
      } else {
        setHighlightedTimestamp(null);
        toast({
          description: "Sin datos de acelerómetro en este momento (±30 min).",
          duration: 2500,
        });
      }
    },
    [findClosestAccPoint, toast]
  );

  // Valores ACC asociados al punto GPS resaltado (para mostrarlos en el popup del marcador).
  const highlightedAccValues = useMemo(() => {
    if (!highlightedGpsPoint) return null;
    return findClosestAccPoint(highlightedGpsPoint.timestamp, highlightedGpsPoint.animal);
  }, [highlightedGpsPoint, findClosestAccPoint]);

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
          hdop: null,
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

  // Siempre un único animal (el filtrado, o el primero de la selección si no
  // hay filtro explícito). Ya no existe una vista "combinada" que mezcle los
  // puntos de varios animales en una sola serie.
  const chartData = useMemo(() => {
    const animalId = activeAnimalFilter || selectedAnimals[0] || null;
    let data: AccPoint[] = animalId ? accData[animalId] || [] : [];

    if (zoomStart !== null && zoomEnd !== null) {
      const left = Math.min(zoomStart, zoomEnd);
      const right = Math.max(zoomStart, zoomEnd);
      data = data.filter((d) => d.timestamp >= left && d.timestamp <= right);
    }

    return downsample(data, MAX_CHART_POINTS);
  }, [accData, selectedAnimals, activeAnimalFilter, zoomStart, zoomEnd]);

  const currentDeviceId = useMemo(() => {
    return activeAnimalFilter || selectedAnimals[0] || null;
  }, [activeAnimalFilter, selectedAnimals]);

  const labelsRange = useMemo(() => {
    if (zoomStart !== null && zoomEnd !== null) {
      return { start: Math.min(zoomStart, zoomEnd), end: Math.max(zoomStart, zoomEnd) };
    }
    if (chartData.length > 0) {
      return { start: chartData[0].timestamp, end: chartData[chartData.length - 1].timestamp };
    }
    if (dateStart && dateEnd) {
      return { start: new Date(dateStart).getTime(), end: new Date(dateEnd + "T23:59:59").getTime() };
    }
    return null;
  }, [zoomStart, zoomEnd, chartData, dateStart, dateEnd]);

  const { data: accLabels = [] } = useQuery<AccelerometerLabel[]>({
    queryKey: ["/api/acc-labels", currentDeviceId, labelsRange?.start, labelsRange?.end],
    queryFn: async () => {
      if (!currentDeviceId || !labelsRange) return [];
      const params = new URLSearchParams({
        deviceId: currentDeviceId,
        start: String(labelsRange.start),
        end: String(labelsRange.end),
      });
      const res = await fetch(`/api/acc-labels?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentDeviceId && !!labelsRange,
  });

  const createLabelMutation = useMutation({
    mutationFn: async (payload: { deviceId: string; startTimestamp: number; endTimestamp: number; behaviorType: BehaviorType; confidence: number; notes: string | null }) => {
      const res = await apiRequest("POST", "/api/acc-labels", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/acc-labels"] });
      toast({ title: "Etiqueta guardada" });
      setPendingLabelRange(null);
      setLabelNotes("");
    },
    onError: (e: any) => {
      toast({ title: "Error al guardar etiqueta", description: e?.message, variant: "destructive" });
    },
  });

  const deleteLabelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/acc-labels/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/acc-labels"] });
      toast({ title: "Etiqueta eliminada" });
    },
  });

  // Conteo de eventos por tipo, ya filtrado por animal (currentDeviceId) y por
  // el rango de fechas (aplicado al hacer fetch). Sirve para mostrar cuántos
  // eventos hay de cada tipo junto a su checkbox.
  const eventCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of detectedEvents) {
      if (currentDeviceId && e.individualLocalId !== currentDeviceId) continue;
      counts[e.eventType] = (counts[e.eventType] || 0) + 1;
    }
    return counts;
  }, [detectedEvents, currentDeviceId]);

  const filteredDetectedEvents = useMemo(() => {
    return detectedEvents.filter((e) => {
      if (currentDeviceId && e.individualLocalId !== currentDeviceId) return false;
      if (!eventTypeFilter.has(e.eventType)) return false;
      return true;
    });
  }, [detectedEvents, currentDeviceId, eventTypeFilter]);

  const toggleEventType = useCallback((type: string) => {
    setEventTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const chartEventBands = useMemo(() => {
    if (!showEvents || chartData.length === 0) return [];
    const chartMin = chartData[0]?.timestamp ?? 0;
    const chartMax = chartData[chartData.length - 1]?.timestamp ?? 0;
    return filteredDetectedEvents.filter(
      (e) => e.timestampEnd >= chartMin && e.timestampStart <= chartMax
    );
  }, [filteredDetectedEvents, chartData, showEvents]);

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

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const exportChartPng = async () => {
    if (!chartContainerRef.current) return;
    setExporting(true);
    try {
      const canvas = await captureChart(chartContainerRef.current, null);
      const studyName = sanitizeFilename(study?.name || "estudio");
      const animals = sanitizeFilename(selectedAnimals.join("_") || "todos");
      downloadCanvasAsPng(canvas, `${studyName}_${animals}_${todayStr}.png`);
      toast({ title: "Exportacion completada", description: "Grafica exportada como PNG" });
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const exportMapPng = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const canvas = await captureMap(mapContainerRef.current, null);
      const studyName = sanitizeFilename(study?.name || "estudio");
      downloadCanvasAsPng(canvas, `mapa_${studyName}_${todayStr}.png`);
      toast({ title: "Exportacion completada", description: "Mapa exportado como PNG" });
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentW = pageW - margin * 2;
      let cursorY = margin;

      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text(study?.name || "Estudio", margin, cursorY + 6);
      cursorY += 12;

      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Animales: ${selectedAnimals.join(", ")}`, margin, cursorY);
      cursorY += 5;
      const rangeText = dateStart && dateEnd
        ? `Rango: ${dateStart} a ${dateEnd}`
        : "Rango no especificado";
      pdf.text(rangeText, margin, cursorY);
      cursorY += 5;
      pdf.text(`GPS: ${totalGpsPoints} puntos | Acelerometro: ${totalAccPoints} muestras`, margin, cursorY);
      cursorY += 8;

      if (chartContainerRef.current) {
        try {
          const chartCanvas = await captureChart(chartContainerRef.current, "#ffffff");
          if (chartCanvas.width > 0 && chartCanvas.height > 0) {
            const chartImg = chartCanvas.toDataURL("image/png");
            const chartAspect = chartCanvas.width / chartCanvas.height;
            const chartImgH = contentW / chartAspect;
            const finalH = Math.min(chartImgH, (pageH - cursorY - margin - 10) * 0.6);
            const finalW = finalH * chartAspect;
            if (finalH > 0 && finalW > 0 && Number.isFinite(finalH) && Number.isFinite(finalW)) {
              pdf.text("Grafica de acelerometro", margin, cursorY);
              cursorY += 4;
              pdf.addImage(chartImg, "PNG", margin, cursorY, Math.min(finalW, contentW), finalH);
              cursorY += finalH + 6;
            }
          }
        } catch (err) {
          console.error("No se pudo capturar la grafica para el PDF:", err);
          pdf.setFontSize(9);
          pdf.setTextColor(150, 150, 150);
          pdf.text("(No se pudo incluir la grafica de acelerometro)", margin, cursorY);
          pdf.setTextColor(0, 0, 0);
          cursorY += 6;
        }
      }

      if (mapContainerRef.current && cursorY + 40 < pageH - margin) {
        try {
          const mapCanvas = await captureMap(mapContainerRef.current, "#ffffff");
          if (mapCanvas.width > 0 && mapCanvas.height > 0) {
            const mapImg = mapCanvas.toDataURL("image/png");
            const mapAspect = mapCanvas.width / mapCanvas.height;
            const remainH = pageH - cursorY - margin - 10;
            const mapImgH = Math.min(remainH, 70);
            const mapImgW = Math.min(mapImgH * mapAspect, contentW);
            if (mapImgH > 0 && mapImgW > 0 && Number.isFinite(mapImgH) && Number.isFinite(mapImgW)) {
              pdf.text("Mapa GPS", margin, cursorY);
              cursorY += 4;
              pdf.addImage(mapImg, "PNG", margin, cursorY, mapImgW, mapImgH);
              cursorY += mapImgH + 6;
            }
          }
        } catch (err) {
          console.error("No se pudo capturar el mapa para el PDF:", err);
          pdf.setFontSize(9);
          pdf.setTextColor(150, 150, 150);
          pdf.text("(No se pudo incluir el mapa GPS)", margin, cursorY);
          pdf.setTextColor(0, 0, 0);
          cursorY += 6;
        }
      }

      if (filteredDetectedEvents.length > 0) {
        if (cursorY + 30 > pageH - margin) {
          pdf.addPage();
          cursorY = margin;
        }

        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text(`Eventos detectados (${filteredDetectedEvents.length})`, margin, cursorY);
        cursorY += 6;

        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        const colWidths = [contentW * 0.2, contentW * 0.2, contentW * 0.25, contentW * 0.2, contentW * 0.15];
        const headers = ["Tipo", "Animal", "Fecha", "Coordenadas", "Severidad"];
        headers.forEach((h, i) => {
          const xPos = margin + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
          pdf.text(h, xPos, cursorY);
        });
        cursorY += 4;
        pdf.setDrawColor(200, 200, 200);
        pdf.line(margin, cursorY, margin + contentW, cursorY);
        cursorY += 2;

        pdf.setFont("helvetica", "normal");
        for (const ev of filteredDetectedEvents) {
          if (cursorY + 6 > pageH - margin) {
            pdf.addPage();
            cursorY = margin;
          }
          const label = EVENT_LABELS[ev.eventType as keyof typeof EVENT_LABELS] || ev.eventType;
          const dateStr = formatTimestamp(ev.timestampStart);
          const coords = ev.lat && ev.lng ? `${ev.lat.toFixed(4)}, ${ev.lng.toFixed(4)}` : "—";
          const sev = ev.severity === "critical" ? "Critica" : ev.severity === "high" ? "Alta" : "Info";
          const rowData = [label, ev.individualLocalId, dateStr, coords, sev];
          rowData.forEach((val, i) => {
            const xPos = margin + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
            pdf.text(String(val), xPos, cursorY);
          });
          cursorY += 5;
        }
      }

      pdf.setFontSize(7);
      pdf.setFont("helvetica", "italic");
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `Generado el ${format(new Date(), "dd/MM/yyyy HH:mm:ss", { locale: es })} — WildTrack`,
        margin,
        pageH - 5
      );

      const studyName = sanitizeFilename(study?.name || "estudio");
      pdf.save(`informe_${studyName}_${todayStr}.pdf`);
      toast({ title: "Exportacion completada", description: "Informe PDF generado correctamente" });
    } catch (e: any) {
      toast({ title: "Error al exportar PDF", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const exportData = async (fmt: "csv" | "kmz" | "shp" | "geojson") => {
    if (!studyId || selectedAnimals.length === 0 || !dateStart || !dateEnd) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/studies/${studyId}/export-visualization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          individualIds: selectedAnimals,
          startDate: new Date(dateStart).getTime(),
          endDate: new Date(dateEnd).getTime(),
          format: fmt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Error desconocido" }));
        throw new Error(err.message || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = res.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      link.download = filenameMatch ? filenameMatch[1] : `export.${fmt === "kmz" ? "kmz" : fmt === "shp" ? "zip" : fmt}`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      const labels: Record<string, string> = { csv: "CSV", kmz: "KMZ (Google Earth)", shp: "Shapefile", geojson: "GeoJSON" };
      toast({ title: "Exportación completada", description: `Datos exportados como ${labels[fmt]}` });
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
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

        <QuickDateRange
          activeRange={activeQuickRange}
          onRangeSelect={handleQuickRange}
          autoLoad={autoLoadEnabled}
          onAutoLoadChange={setAutoLoadEnabled}
          studyId={studyId}
          individuals={selectedAnimals}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
            <Input type="date" value={dateStart} onChange={(e) => handleDateStartChange(e.target.value)} className="w-40" data-testid="input-date-start" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fecha fin</Label>
            <Input type="date" value={dateEnd} onChange={(e) => handleDateEndChange(e.target.value)} className="w-40" data-testid="input-date-end" />
          </div>
          <Button onClick={() => loadData(false)} disabled={loading || selectedAnimals.length === 0} data-testid="button-load-data">
            {loading && !forceLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Cargar datos
          </Button>
          {selectedAnimals.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                if (!studyId || selectedAnimals.length === 0 || !dateStart || !dateEnd) return;
                const p = new URLSearchParams({ animals: selectedAnimals.join(","), start: dateStart, end: dateEnd });
                if (currentDeviceId) p.set("focus", currentDeviceId);
                window.open(`/study/${studyId}/fullscreen?${p.toString()}`, "_blank");
              }}
              data-testid="button-fullscreen"
              title="Abrir mapa + acelerómetro a pantalla completa en una nueva pestaña"
            >
              <Maximize2 className="w-4 h-4 mr-2" />
              Pantalla completa
            </Button>
          )}
          {dataLoaded && !isObserver && (
            <Button
              variant="outline"
              onClick={() => loadData(true)}
              disabled={loading || selectedAnimals.length === 0}
              data-testid="button-force-reload"
            >
              {forceLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Forzar recarga
            </Button>
          )}
          {dataLoaded && selectedAnimals.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                if (!studyId || selectedAnimals.length === 0) return;
                const p = new URLSearchParams({ animals: selectedAnimals.join(",") });
                setLocation(`/study/${studyId}/analysis?${p.toString()}`);
              }}
              data-testid="button-geo-analysis"
              title="Abrir análisis geoespacial con estos animales preseleccionados"
            >
              <Globe className="w-4 h-4 mr-2" />
              Análisis geoespacial
            </Button>
          )}
          {dataLoaded && canDetectEvents && (
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
          {dataLoaded && canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting} data-testid="button-export-menu">
                  {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Imágenes</DropdownMenuLabel>
                <DropdownMenuItem onClick={exportChartPng} data-testid="menu-export-chart-png">
                  <Image className="w-4 h-4 mr-2" />
                  Gráfica como PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportMapPng} data-testid="menu-export-map-png">
                  <Image className="w-4 h-4 mr-2" />
                  Mapa como PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportPdf} data-testid="menu-export-pdf">
                  <FileText className="w-4 h-4 mr-2" />
                  Informe PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Exportar datos como...</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportData("csv")} data-testid="menu-export-csv">
                  <Table2 className="w-4 h-4 mr-2" />
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportData("kmz")} data-testid="menu-export-kmz">
                  <Globe className="w-4 h-4 mr-2" />
                  KMZ (Google Earth)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportData("shp")} data-testid="menu-export-shp">
                  <Database className="w-4 h-4 mr-2" />
                  Shapefile (SHP)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportData("geojson")} data-testid="menu-export-geojson">
                  <FileCode className="w-4 h-4 mr-2" />
                  GeoJSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                  <span>{filteredDetectedEvents.length} eventos</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs text-muted-foreground">Animales</Label>
            {dataLoaded && selectedAnimals.length > 1 && (
              <>
                <span className="text-xs text-muted-foreground mx-1">|</span>
                <Label className="text-xs text-muted-foreground">Filtrar grafica:</Label>
                {selectedAnimals.map((a) => (
                  <Badge key={`filter-${a}`} variant={currentDeviceId === a ? "default" : "outline"} className="cursor-pointer select-none text-xs"
                    style={currentDeviceId === a ? { backgroundColor: animalColorMap[a], borderColor: animalColorMap[a], color: "white" } : {}}
                    onClick={() => setActiveAnimalFilter(a)} data-testid={`badge-filter-${a}`}>{formatAnimalLabelById(a, individualByLocalId)}</Badge>
                ))}
              </>
            )}
          </div>
          {projectIdsInStudy.size > 0 && (
            <Select value={projectFilterId} onValueChange={(v) => { setProjectFilterId(v); setSelectedAnimals([]); }}>
              <SelectTrigger className="w-52 mb-2" data-testid="select-filter-project">
                <SelectValue placeholder="Todos los proyectos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proyectos</SelectItem>
                {allProjects?.filter(p => projectIdsInStudy.has(p.id)).map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.descripcion}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {individuals ? (
            <AnimalSearch
              individuals={selectableAnimals}
              selected={selectedAnimals}
              onChange={setSelectedAnimals}
              multiple
              getKey={tokenFor}
              placeholder="Buscar animal por nombre, apodo o especie..."
            />
          ) : (
            <Skeleton className="h-9 w-full rounded" />
          )}
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
        <div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              <div>
                <div className="flex flex-col p-3" style={{ height: "800px" }}>
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Activity className="w-4 h-4" />
                      Acelerometro
                      {currentDeviceId && (
                        <Badge variant="outline" className="text-xs ml-1" style={{ borderColor: animalColorMap[currentDeviceId], color: animalColorMap[currentDeviceId] }}>
                          {formatAnimalLabelById(currentDeviceId, individualByLocalId)}
                        </Badge>
                      )}
                    </h2>
                    <div className="flex items-center gap-1">
                      {currentDeviceId && (
                        <Button
                          variant={labelMode ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setLabelMode((v) => !v)}
                          className="h-6 text-xs gap-1"
                          data-testid="button-toggle-label-mode"
                          title={labelMode ? "Salir del modo etiquetado" : "Arrastra sobre la grafica para etiquetar un tramo"}
                        >
                          <Tag className="w-3 h-3" />
                          {labelMode ? "Etiquetando" : "Etiquetar"}
                        </Button>
                      )}
                      {accLabels.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setShowLabels(!showLabels)} className="h-6 text-xs" data-testid="button-toggle-labels">
                          {showLabels ? "Ocultar etiquetas" : "Mostrar etiquetas"}
                        </Button>
                      )}
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
                    <div className="flex-1 min-h-0" ref={chartContainerRef}>
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
                              if (right - left > 100) {
                                if (labelMode && currentDeviceId) {
                                  setPendingLabelRange({ start: left, end: right });
                                  setZoomStart(null);
                                  setZoomEnd(null);
                                } else {
                                  setZoomStart(left);
                                  setZoomEnd(right);
                                }
                              }
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
                          <Line type="monotone" dataKey="x" stroke="#3B82F6" name="Eje X" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                          <Line type="monotone" dataKey="y" stroke="#EF4444" name="Eje Y" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                          <Line type="monotone" dataKey="z" stroke="#EAB308" name="Eje Z" dot={false} strokeWidth={1.5} isAnimationActive={false} />

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

                          {showLabels && accLabels.map((lb) => {
                            const chartMin = chartData[0]?.timestamp ?? 0;
                            const chartMax = chartData[chartData.length - 1]?.timestamp ?? 0;
                            if (lb.endTimestamp < chartMin || lb.startTimestamp > chartMax) return null;
                            const color = BEHAVIOR_COLORS[lb.behaviorType as BehaviorType] || "#888";
                            return (
                              <ReferenceArea
                                key={`lb-${lb.id}`}
                                x1={Math.max(lb.startTimestamp, chartMin)}
                                x2={Math.min(lb.endTimestamp, chartMax)}
                                fill={color}
                                fillOpacity={0.18}
                                stroke={color}
                                strokeOpacity={0.6}
                                label={{ value: BEHAVIOR_LABELS[lb.behaviorType as BehaviorType] || lb.behaviorType, position: "insideTop", fontSize: 10, fill: color }}
                              />
                            );
                          })}

                          {dragging && zoomStart !== null && dragEnd !== null && (
                            <ReferenceArea x1={zoomStart} x2={dragEnd} strokeOpacity={0.3} fill="hsl(var(--primary))" fillOpacity={0.15} />
                          )}
                          {highlightedTimestamp !== null && chartData.length > 0 && (() => {
                            // Snap al punto de chartData más cercano (el chart está downsampled,
                            // así que una coincidencia exacta puede no existir tras un clic en el mapa).
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
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm text-muted-foreground">No hay datos de acelerometro para este rango</p>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="p-3 flex flex-col" style={{ height: "500px" }}>
                  <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                    <MapPin className="w-4 h-4" />
                    Track GPS
                    {selectedAnimals.length > 1 && (
                      <span className="text-xs text-muted-foreground font-normal ml-1">({selectedAnimals.length} animales)</span>
                    )}
                  </h2>
                  <div className="flex-1 min-h-0 rounded-md overflow-hidden border" ref={mapContainerRef}>
                    {totalGpsPoints === 0 ? (
                      <div className="h-full flex items-center justify-center p-4" data-testid="empty-gps-map">
                        <div className="text-center space-y-2 max-w-sm">
                          <MapPin className="w-10 h-10 mx-auto text-muted-foreground/30" />
                          <p className="text-sm font-medium text-foreground">No hay datos GPS en este rango</p>
                          <p className="text-xs text-muted-foreground">
                            {selectedAnimals.length > 1 ? "Los animales seleccionados no han" : "Este animal no ha"} transmitido posiciones en las fechas elegidas. Prueba con un rango de fechas más amplio (por ejemplo 30d o 90d).
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
                        const positions: [number, number][] = downsample(points, MAX_TRACK_POINTS).map((p) => [p.lat, p.lng]);
                        const markersToShow = downsample(points, MAX_GPS_MARKERS);
                        return (
                          <span key={animalId}>
                            <Polyline positions={positions} pathOptions={{ color, weight: 2.5, opacity: 0.8 }} />
                            {markersToShow.map((p, idx) => {
                              const lowQuality = p.hdop != null && p.hdop > HDOP_QUALITY_THRESHOLD;
                              return (
                              <CircleMarker key={`${animalId}-${idx}`} center={[p.lat, p.lng]} radius={3}
                                pathOptions={lowQuality
                                  ? { color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.4, weight: 1, dashArray: "2,2" }
                                  : { color, fillColor: color, fillOpacity: 0.7, weight: 1 }}
                                eventHandlers={{ click: () => handleMapPointClick(p) }}>
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
                              <div className="font-semibold">{highlightedGpsPoint.animal}</div>
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
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">Clic en el mapa para abrir en Google Maps</p>
                </div>
              </div>
            </div>
          </div>

          {detectedEvents.length > 0 && (
            <div className="w-80 border-l flex flex-col shrink-0">
              <div className="p-3 border-b space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Eventos detectados ({filteredDetectedEvents.length})
                </h3>
                <div className="space-y-1.5" data-testid="filter-event-types">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">Filtrar por tipo</span>
                    <div className="flex gap-1">
                      <Badge
                        variant="outline"
                        className="cursor-pointer select-none text-[10px]"
                        onClick={() => setEventTypeFilter(new Set(EVENT_TYPES))}
                        data-testid="badge-event-type-all"
                      >
                        Todos
                      </Badge>
                      <Badge
                        variant="outline"
                        className="cursor-pointer select-none text-[10px]"
                        onClick={() => setEventTypeFilter(new Set())}
                        data-testid="badge-event-type-none"
                      >
                        Ninguno
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-1 max-h-52 overflow-y-auto pr-1">
                    {EVENT_TYPES.map((t) => {
                      const color = EVENT_COLORS[t as keyof typeof EVENT_COLORS] || "#888";
                      const count = eventCountsByType[t] || 0;
                      return (
                        <label
                          key={t}
                          className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] leading-tight"
                          data-testid={`label-event-type-${t}`}
                        >
                          <Checkbox
                            checked={eventTypeFilter.has(t)}
                            onCheckedChange={() => toggleEventType(t)}
                            className="h-3.5 w-3.5"
                            data-testid={`checkbox-event-type-${t}`}
                          />
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate flex-1">
                            {EVENT_LABELS[t as keyof typeof EVENT_LABELS] || t}
                          </span>
                          <span className="text-muted-foreground tabular-nums">{count}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1.5">
                  {filteredDetectedEvents.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2 text-center" data-testid="text-no-events">
                      No hay eventos para los filtros seleccionados.
                    </p>
                  )}
                  {filteredDetectedEvents.map((ev) => {
                    const Icon = EVENT_ICONS[ev.eventType] || AlertTriangle;
                    const color = EVENT_COLORS[ev.eventType as keyof typeof EVENT_COLORS] || "#888";
                    const isSelected = selectedEventId === ev.id;
                    return (
                      <Card
                        key={ev.id}
                        className={`cursor-pointer transition-colors ${isSelected ? "ring-2" : ""}`}
                        style={isSelected ? ({ borderColor: color, "--tw-ring-color": color } as React.CSSProperties) : {}}
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

      <Dialog
        open={pendingLabelRange !== null}
        onOpenChange={(open) => { if (!open) setPendingLabelRange(null); }}
      >
        <DialogContent className="max-w-md" data-testid="dialog-label-acc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Etiquetar tramo
            </DialogTitle>
          </DialogHeader>
          {pendingLabelRange && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <div>Inicio: {formatTimestamp(pendingLabelRange.start)}</div>
                <div>Fin: {formatTimestamp(pendingLabelRange.end)}</div>
                <div>Duracion: {Math.round((pendingLabelRange.end - pendingLabelRange.start) / 1000)} s</div>
                {currentDeviceId && <div>Dispositivo: {currentDeviceId}</div>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Comportamiento</Label>
                <Select value={labelBehavior} onValueChange={(v) => setLabelBehavior(v as BehaviorType)}>
                  <SelectTrigger data-testid="select-label-behavior">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BEHAVIOR_TYPES.map((b) => (
                      <SelectItem key={b} value={b}>
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: BEHAVIOR_COLORS[b] }} />
                          {BEHAVIOR_LABELS[b]}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Confianza: {labelConfidence}%</Label>
                <Slider
                  value={[labelConfidence]}
                  onValueChange={(v) => setLabelConfidence(v[0])}
                  min={0}
                  max={100}
                  step={10}
                  data-testid="slider-label-confidence"
                />
                <div className="flex gap-1 flex-wrap">
                  {[70, 80, 90, 100].map((c) => (
                    <Badge
                      key={c}
                      variant={labelConfidence === c ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => setLabelConfidence(c)}
                      data-testid={`badge-confidence-${c}`}
                    >
                      {c}%
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Notas (opcional)</Label>
                <Textarea
                  value={labelNotes}
                  onChange={(e) => setLabelNotes(e.target.value)}
                  placeholder="Observaciones..."
                  rows={3}
                  data-testid="textarea-label-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLabelRange(null)} data-testid="button-cancel-label">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!pendingLabelRange || !currentDeviceId) return;
                createLabelMutation.mutate({
                  deviceId: currentDeviceId,
                  startTimestamp: pendingLabelRange.start,
                  endTimestamp: pendingLabelRange.end,
                  behaviorType: labelBehavior,
                  confidence: labelConfidence,
                  notes: labelNotes.trim() || null,
                });
              }}
              disabled={createLabelMutation.isPending}
              data-testid="button-save-label"
            >
              {createLabelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Guardar etiqueta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
