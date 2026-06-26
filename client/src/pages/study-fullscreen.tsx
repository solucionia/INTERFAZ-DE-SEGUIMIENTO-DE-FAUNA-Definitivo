import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useSearch, useLocation } from "wouter";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
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
import { Loader2, MapPin, Activity, ChevronRight, SlidersHorizontal, Minimize2, Eye, EyeOff, Route, GripVertical, FileDown, Image as ImageIcon, FileText, Globe, Database } from "lucide-react";
import { MapLayerControl, GoogleMapsClick, googleMapsLink } from "@/components/map-layers";
import { formatAnimalLabelById } from "@/lib/animal-label";
import { AnimalSearch } from "@/components/animal-search";
import { computeDateRange, type QuickRange } from "@/components/quick-date-range";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
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
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

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
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>(null);
  const [hideLowQuality, setHideLowQuality] = useState(false);
  const [showTrackLine, setShowTrackLine] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [hiddenAnimals, setHiddenAnimals] = useState<string[]>([]);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const s = localStorage.getItem("fullscreen-panel-pos");
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const dragParentRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const latestPosRef = useRef<{ x: number; y: number } | null>(panelPos);

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

  // Mantener la lista de animales ocultos sincronizada con la selección.
  useEffect(() => {
    setHiddenAnimals((prev) => prev.filter((a) => selectedAnimals.includes(a)));
  }, [selectedAnimals]);

  const handleQuickRange = useCallback((range: QuickRange) => {
    const { start, end } = computeDateRange(range);
    setActiveQuickRange(range);
    setDateStart(start);
    setDateEnd(end);
  }, []);

  const toggleAnimalVisibility = useCallback((a: string) => {
    setHiddenAnimals((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }, []);

  // Arrastrar el panel de controles por su cabecera.
  const onPanelDragStart = useCallback((e: React.PointerEvent) => {
    if (!panelRef.current || !dragParentRef.current) return;
    const panelRect = panelRef.current.getBoundingClientRect();
    const parentRect = dragParentRef.current.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: panelRect.left - parentRect.left,
      origY: panelRect.top - parentRect.top,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPanelDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current || !dragParentRef.current || !panelRef.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const parentRect = dragParentRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(dragState.current.origX + dx, parentRect.width - panelRect.width));
    const ny = Math.max(0, Math.min(dragState.current.origY + dy, parentRect.height - panelRect.height));
    const pos = { x: nx, y: ny };
    latestPosRef.current = pos;
    setPanelPos(pos);
  }, []);

  const onPanelDragEnd = useCallback(() => {
    if (dragState.current && latestPosRef.current) {
      try {
        localStorage.setItem("fullscreen-panel-pos", JSON.stringify(latestPosRef.current));
      } catch {
        /* ignore */
      }
    }
    dragState.current = null;
  }, []);

  // Recolocar el panel dentro de los límites si la ventana cambia de tamaño
  // (una posición guardada en una pantalla mayor podría quedar fuera de vista).
  useEffect(() => {
    if (!panelOpen) return;
    const clampToBounds = () => {
      if (!panelRef.current || !dragParentRef.current) return;
      setPanelPos((prev) => {
        if (!prev) return prev;
        const parentRect = dragParentRef.current!.getBoundingClientRect();
        const panelRect = panelRef.current!.getBoundingClientRect();
        const nx = Math.max(0, Math.min(prev.x, parentRect.width - panelRect.width));
        const ny = Math.max(0, Math.min(prev.y, parentRect.height - panelRect.height));
        if (nx === prev.x && ny === prev.y) return prev;
        const next = { x: nx, y: ny };
        latestPosRef.current = next;
        try {
          localStorage.setItem("fullscreen-panel-pos", JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    clampToBounds();
    window.addEventListener("resize", clampToBounds);
    return () => window.removeEventListener("resize", clampToBounds);
  }, [panelOpen]);

  const toggleBtnClass = useCallback(
    (active: boolean) =>
      `inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${
        active ? "bg-primary text-primary-foreground border-primary" : "border-input text-foreground hover-elevate"
      }`,
    []
  );

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

  const sanitizeFilename = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Captura un mapa Leaflet con html2canvas corrigiendo el desplazamiento de las
  // capas vectoriales SVG: html2canvas ignora el transform CSS propio del <svg> al
  // rasterizarlo (pero respeta su viewBox), por lo que se desplazan hacia el oeste.
  // Movemos el offset al layout (left/top).
  const captureMap = async (el: HTMLElement, backgroundColor: string | null) => {
    const parseTranslate = (t: string): { tx: number; ty: number } | null => {
      if (!t || t === "none") return null;
      let m: RegExpMatchArray | null;
      if ((m = t.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/))) {
        return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
      }
      if ((m = t.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/))) {
        return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
      }
      if ((m = t.match(/matrix3d\(([^)]+)\)/))) {
        const v = m[1].split(",").map((n) => parseFloat(n.trim()));
        if (v.length === 16) return { tx: v[12], ty: v[13] };
      }
      if ((m = t.match(/matrix\(([^)]+)\)/))) {
        const v = m[1].split(",").map((n) => parseFloat(n.trim()));
        if (v.length === 6) return { tx: v[4], ty: v[5] };
      }
      return null;
    };

    return html2canvas(el, {
      backgroundColor,
      useCORS: true,
      onclone: (_doc, clonedEl) => {
        const panes = clonedEl.querySelectorAll<HTMLElement>(
          ".leaflet-pane, .leaflet-tile, .leaflet-zoom-animated, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-overlay-pane svg"
        );
        panes.forEach((p) => {
          const parsed = parseTranslate(p.style.transform);
          if (!parsed) return;
          if (p.tagName.toLowerCase() === "svg") {
            p.style.transform = "none";
            p.style.left = `${parsed.tx}px`;
            p.style.top = `${parsed.ty}px`;
          } else {
            p.style.transform = `translate(${parsed.tx}px, ${parsed.ty}px)`;
          }
        });
      },
    });
  };

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
      toast({ title: "Exportación completada", description: "Gráfica exportada como PNG" });
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
      const link = document.createElement("a");
      const studyName = sanitizeFilename(study?.name || "estudio");
      link.download = `mapa_${studyName}_${todayStr}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "Exportación completada", description: "Mapa exportado como PNG" });
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
      pdf.text(`Rango: ${dateStart} a ${dateEnd}`, margin, cursorY);
      cursorY += 5;
      pdf.text(`GPS: ${totalGps} puntos | Acelerometro: ${totalAcc} muestras`, margin, cursorY);
      cursorY += 8;

      if (chartContainerRef.current) {
        try {
          const chartCanvas = await html2canvas(chartContainerRef.current, { backgroundColor: "#ffffff", useCORS: true });
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
      toast({ title: "Exportación completada", description: "Informe PDF generado correctamente" });
    } catch (e: any) {
      toast({ title: "Error al exportar PDF", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const exportData = async (fmt: "kmz" | "shp") => {
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
          endDate: new Date(dateEnd + "T23:59:59").getTime(),
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
      link.download = filenameMatch ? filenameMatch[1] : `export.${fmt === "kmz" ? "kmz" : "zip"}`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      const labels: Record<string, string> = { kmz: "KMZ (Google Earth)", shp: "Shapefile" };
      toast({ title: "Exportación completada", description: `Datos exportados como ${labels[fmt]}` });
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const goToGeoAnalysis = () => {
    if (!studyId || selectedAnimals.length === 0) return;
    const p = new URLSearchParams({ animals: selectedAnimals.join(",") });
    setLocation(`/study/${studyId}/analysis?${p.toString()}`);
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-background" data-testid="view-fullscreen">
      {/* Mapa: tres cuartas partes superiores */}
      <div ref={dragParentRef} className="h-3/4 relative">
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
          <div
            ref={panelRef}
            className={`absolute z-[1001] w-80 max-w-[calc(100vw-1rem)] bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg ${panelPos ? "" : "top-2 right-2"}`}
            style={panelPos ? { top: panelPos.y, left: panelPos.x } : undefined}
            data-testid="panel-controls"
          >
            <div
              className="flex items-center justify-between px-3 py-2 border-b border-border cursor-move touch-none select-none"
              onPointerDown={onPanelDragStart}
              onPointerMove={onPanelDragMove}
              onPointerUp={onPanelDragEnd}
              onPointerCancel={onPanelDragEnd}
              onLostPointerCapture={onPanelDragEnd}
              data-testid="panel-drag-handle"
              title="Arrastra para mover el panel"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <GripVertical className="w-4 h-4 text-muted-foreground" />
                Controles
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-collapse-panel"
                title="Minimizar panel"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-3 max-h-[calc(75vh-3rem)] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
                  <Input type="date" value={dateStart} onChange={(e) => { setDateStart(e.target.value); setActiveQuickRange(null); }} className="h-8 text-xs" data-testid="input-fullscreen-date-start" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Fecha fin</Label>
                  <Input type="date" value={dateEnd} onChange={(e) => { setDateEnd(e.target.value); setActiveQuickRange(null); }} className="h-8 text-xs" data-testid="input-fullscreen-date-end" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Rango rápido</Label>
                <div className="flex flex-wrap gap-1">
                  {(["1h", "6h", "24h", "7d", "30d", "90d"] as QuickRange[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => handleQuickRange(r)}
                      className={toggleBtnClass(activeQuickRange === r)}
                      data-testid={`button-fullscreen-range-${r}`}
                    >
                      {r}
                    </button>
                  ))}
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
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Visualización</Label>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => setShowTrackLine((v) => !v)} className={toggleBtnClass(showTrackLine)} data-testid="button-toggle-track-line" title="Mostrar/ocultar línea de trayectoria">
                    <Route className="w-3 h-3" /> Línea
                  </button>
                  <button onClick={() => setShowPoints((v) => !v)} className={toggleBtnClass(showPoints)} data-testid="button-toggle-points" title="Mostrar/ocultar puntos individuales">
                    <MapPin className="w-3 h-3" /> Puntos
                  </button>
                  <button onClick={() => setHideLowQuality((v) => !v)} className={toggleBtnClass(hideLowQuality)} data-testid="button-toggle-hdop" title="Ocultar posiciones con HDOP > 5 (baja calidad)">
                    {hideLowQuality ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} HDOP&gt;5
                  </button>
                </div>
              </div>
              {selectedAnimals.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Mostrar track por animal</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAnimals.map((a) => {
                      const hidden = hiddenAnimals.includes(a);
                      return (
                        <button
                          key={a}
                          onClick={() => toggleAnimalVisibility(a)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border hover-elevate"
                          style={hidden
                            ? { borderColor: "hsl(var(--input))", color: "hsl(var(--muted-foreground))", opacity: 0.6 }
                            : { borderColor: animalColorMap[a], color: animalColorMap[a] }}
                          data-testid={`button-toggle-animal-${a}`}
                        >
                          {hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {formatAnimalLabelById(a, individualByLocalId)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
              <div className="space-y-1 pt-1 border-t border-border">
                <Label className="text-xs text-muted-foreground">Acciones</Label>
                <div className="flex flex-wrap gap-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs" disabled={exporting} data-testid="button-fullscreen-export-menu">
                        {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
                        Exportar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Imágenes</DropdownMenuLabel>
                      <DropdownMenuItem onClick={exportChartPng} data-testid="menu-fullscreen-export-chart-png">
                        <ImageIcon className="w-4 h-4 mr-2" />
                        Gráfica como PNG
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportMapPng} data-testid="menu-fullscreen-export-map-png">
                        <ImageIcon className="w-4 h-4 mr-2" />
                        Mapa como PNG
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportPdf} data-testid="menu-fullscreen-export-pdf">
                        <FileText className="w-4 h-4 mr-2" />
                        Informe PDF
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Exportar datos como...</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => exportData("kmz")} data-testid="menu-fullscreen-export-kmz">
                        <Globe className="w-4 h-4 mr-2" />
                        KMZ (Google Earth)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportData("shp")} data-testid="menu-fullscreen-export-shp">
                        <Database className="w-4 h-4 mr-2" />
                        Shapefile (SHP)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={goToGeoAnalysis}
                    disabled={selectedAnimals.length === 0}
                    data-testid="button-fullscreen-geo-analysis"
                    title="Abrir análisis geoespacial con estos animales preseleccionados"
                  >
                    <Globe className="w-3.5 h-3.5 mr-1.5" />
                    Análisis geoespacial
                  </Button>
                </div>
              </div>
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
          <div ref={mapContainerRef} className="h-full w-full">
          <MapContainer center={mapCenter || [0, 0]} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true}>
            <MapLayerControl />
            <GoogleMapsClick />
            <MapUpdater center={mapCenter} />
            {selectedAnimals.map((animalId) => {
              if (hiddenAnimals.includes(animalId)) return null;
              const points = gpsData[animalId] || [];
              if (points.length === 0) return null;
              const color = animalColorMap[animalId];
              const positions: [number, number][] = points.map((p) => [p.lat, p.lng]);
              const markerSource = hideLowQuality
                ? points.filter((p) => !(p.hdop != null && p.hdop > HDOP_QUALITY_THRESHOLD))
                : points;
              const markersToShow = downsample(markerSource, MAX_GPS_MARKERS);
              return (
                <span key={animalId}>
                  {showTrackLine && <Polyline positions={positions} pathOptions={{ color, weight: 2.5, opacity: 0.8 }} />}
                  {showPoints && markersToShow.map((p, idx) => {
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
          </div>
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
        <div className="flex-1 min-h-0" ref={chartContainerRef}>
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
