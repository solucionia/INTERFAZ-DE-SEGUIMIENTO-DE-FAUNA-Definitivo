import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
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
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
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
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { QuickDateRange, type QuickRange } from "@/components/quick-date-range";
import { AnimalSearch } from "@/components/animal-search";
import { usePermissions } from "@/hooks/use-permissions";

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
  const { canExport, canDetectEvents, isObserver } = usePermissions();

  const [selectedAnimals, setSelectedAnimals] = useState<string[]>([]);
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
  const [exporting, setExporting] = useState(false);

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

  const handleDateStartChange = (val: string) => {
    setDateStart(val);
    setActiveQuickRange(null);
  };

  const handleDateEndChange = (val: string) => {
    setDateEnd(val);
    setActiveQuickRange(null);
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

  const sanitizeFilename = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const exportChartPng = async () => {
    if (!chartContainerRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(chartContainerRef.current, { backgroundColor: null, useCORS: true });
      const link = document.createElement("a");
      const studyName = sanitizeFilename(study?.name || "estudio");
      const animals = sanitizeFilename(selectedAnimals.join("_") || "todos");
      link.download = `${studyName}_${animals}_${todayStr}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
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
      const canvas = await html2canvas(mapContainerRef.current, { backgroundColor: null, useCORS: true });
      const link = document.createElement("a");
      const studyName = sanitizeFilename(study?.name || "estudio");
      link.download = `mapa_${studyName}_${todayStr}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
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
        const chartCanvas = await html2canvas(chartContainerRef.current, { backgroundColor: "#ffffff", useCORS: true });
        const chartImg = chartCanvas.toDataURL("image/png");
        const chartAspect = chartCanvas.width / chartCanvas.height;
        const chartImgW = contentW;
        const chartImgH = contentW / chartAspect;
        const finalH = Math.min(chartImgH, (pageH - cursorY - margin - 10) * 0.6);
        const finalW = finalH * chartAspect;
        pdf.text("Grafica de acelerometro", margin, cursorY);
        cursorY += 4;
        pdf.addImage(chartImg, "PNG", margin, cursorY, Math.min(finalW, contentW), finalH);
        cursorY += finalH + 6;
      }

      if (mapContainerRef.current && cursorY + 40 < pageH - margin) {
        const mapCanvas = await html2canvas(mapContainerRef.current, { backgroundColor: "#ffffff", useCORS: true });
        const mapImg = mapCanvas.toDataURL("image/png");
        const mapAspect = mapCanvas.width / mapCanvas.height;
        const remainH = pageH - cursorY - margin - 10;
        const mapImgH = Math.min(remainH, 70);
        const mapImgW = Math.min(mapImgH * mapAspect, contentW);
        pdf.text("Mapa GPS", margin, cursorY);
        cursorY += 4;
        pdf.addImage(mapImg, "PNG", margin, cursorY, mapImgW, mapImgH);
        cursorY += mapImgH + 6;
      }

      if (detectedEvents.length > 0) {
        if (cursorY + 30 > pageH - margin) {
          pdf.addPage();
          cursorY = margin;
        }

        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text(`Eventos detectados (${detectedEvents.length})`, margin, cursorY);
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
        for (const ev of detectedEvents) {
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

        <QuickDateRange
          activeRange={activeQuickRange}
          onRangeSelect={handleQuickRange}
          autoLoad={autoLoadEnabled}
          onAutoLoadChange={setAutoLoadEnabled}
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
                  <span>{detectedEvents.length} eventos</span>
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
                <Badge variant={activeAnimalFilter === null ? "default" : "outline"} className="cursor-pointer select-none text-xs" onClick={() => setActiveAnimalFilter(null)}>Todos</Badge>
                {selectedAnimals.map((a) => (
                  <Badge key={`filter-${a}`} variant={activeAnimalFilter === a ? "default" : "outline"} className="cursor-pointer select-none text-xs"
                    style={activeAnimalFilter === a ? { backgroundColor: animalColorMap[a], borderColor: animalColorMap[a], color: "white" } : {}}
                    onClick={() => setActiveAnimalFilter(a)} data-testid={`badge-filter-${a}`}>{a}</Badge>
                ))}
              </>
            )}
          </div>
          {individuals ? (
            <AnimalSearch
              individuals={selectableAnimals}
              selected={selectedAnimals}
              onChange={setSelectedAnimals}
              multiple
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
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              <div>
                <div className="flex flex-col p-3" style={{ height: "400px" }}>
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
                                    <a href={googleMapsLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Ver en Google Maps</a>
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
                              <a href={googleMapsLink(highlightedGpsPoint.lat, highlightedGpsPoint.lng)} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Ver en Google Maps</a>
                            </div>
                          </Popup>
                        </Marker>
                      )}
                    </MapContainer>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">Clic en el mapa para abrir en Google Maps</p>
                </div>
              </div>
            </div>
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
