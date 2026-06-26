import { useState, useEffect, useRef, useMemo, type RefObject } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Individual, SavedAnalysis, Project } from "@shared/schema";
import { ANALYSIS_LABELS, type AnalysisType } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Play,
  Download,
  History,
  Trash2,
  BarChart3,
  Map as MapIcon,
  ChevronDown,
  ChevronUp,
  Globe,
  Ruler,
  Gauge,
  Activity,
  Info,
  FileText,
  FileJson,
  Image,
  FileCode,
  Table2,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import { MapLayerControl, GoogleMapsClick } from "@/components/map-layers";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { QuickDateRange, type QuickRange } from "@/components/quick-date-range";
import { AnimalSearch } from "@/components/animal-search";
import { usePermissions } from "@/hooks/use-permissions";

const ANIMAL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

const KERNEL_PCTS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
const MCP_PCTS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const KERNEL_PALETTE = ["#dc2626", "#ea580c", "#f59e0b", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899"];

function kernelColor(pct: number, sortedPcts?: number[]): string {
  if (sortedPcts && sortedPcts.length > 0) {
    const idx = sortedPcts.indexOf(pct);
    if (idx >= 0) return KERNEL_PALETTE[idx % KERNEL_PALETTE.length];
  }
  const t = pct / 95;
  const r = Math.round(220 - t * 140);
  const g = Math.round(40 + t * 80);
  const b = Math.round(40 + t * 40);
  return `rgb(${r},${g},${b})`;
}

function deriveKernelPcts(data: any): number[] {
  if (!data) return [50, 95];
  if (Array.isArray(data.kernelPercentages) && data.kernelPercentages.length > 0) {
    return [...data.kernelPercentages].map(Number).sort((a, b) => a - b);
  }
  const perInd = data.perIndividual?.[0]?.kernelHrefAreas;
  if (perInd) {
    const k = Object.keys(perInd).map(Number).filter((n) => Number.isFinite(n));
    if (k.length > 0) return k.sort((a, b) => a - b);
  }
  const a0 = data.areas?.[0];
  if (a0) {
    if (a0.areas && typeof a0.areas === "object") {
      const k = Object.keys(a0.areas).map(Number).filter((n) => Number.isFinite(n));
      if (k.length > 0) return k.sort((a, b) => a - b);
    }
    const legacy = Object.keys(a0)
      .map((k) => /^area_(\d+)_km2$/.exec(k)?.[1])
      .filter((m): m is string => !!m)
      .map(Number);
    if (legacy.length > 0) return legacy.sort((a, b) => a - b);
  }
  return [50, 95];
}

function getKernelAreaForPct(item: any, pct: number): number | undefined {
  if (item?.areas && typeof item.areas === "object") {
    const v = item.areas[String(pct)];
    if (typeof v === "number") return v;
  }
  const legacy = item?.[`area_${pct}_km2`];
  return typeof legacy === "number" ? legacy : undefined;
}

function FitBounds({ geojson }: { geojson: any }) {
  const map = useMap();
  useEffect(() => {
    if (geojson && geojson.features && geojson.features.length > 0) {
      try {
        const layer = L.geoJSON(geojson);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [30, 30] });
        }
      } catch {}
    }
  }, [geojson, map]);
  return null;
}

export default function GeoAnalysis() {
  const [, routeParams] = useRoute("/study/:id/analysis");
  const studyId = routeParams?.id || "";
  const search = useSearch();
  const { toast } = useToast();
  const { canAnalyze, canExport } = usePermissions();

  // Animales preseleccionados desde la URL (?animals=id1,id2 o ?animal=id).
  const initialAnimals = useMemo(() => {
    const sp = new URLSearchParams(search);
    const p = sp.get("animals") || sp.get("animal") || "";
    return p.split(",").map((s) => s.trim()).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedAnimals, setSelectedAnimals] = useState<string[]>(initialAnimals);
  const [projectFilterId, setProjectFilterId] = useState<string>("all");
  const [analysisType, setAnalysisType] = useState<AnalysisType>("comprehensive");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [mcpPercent, setMcpPercent] = useState("95");
  const [maxPoints, setMaxPoints] = useState(2000);
  const [bandwidthMethod, setBandwidthMethod] = useState("href");
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>(null);
  const [autoLoadEnabled, setAutoLoadEnabled] = useState(false);
  const pendingAutoLoad = useRef(false);
  const [resultData, setResultData] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [mapMethod, setMapMethod] = useState<"href" | "lscv">("href");
  const [kernelPercentages, setKernelPercentages] = useState<number[]>([50, 95]);
  const [kernelPctInput, setKernelPctInput] = useState("");
  const [showKernelPcts, setShowKernelPcts] = useState<number[]>([50, 95]);
  const [showMcpPcts, setShowMcpPcts] = useState<number[]>([50, 100]);
  const [mapLayer, setMapLayer] = useState<"kernel" | "mcp">("kernel");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const { data: individuals, isLoading: loadingIndividuals } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    queryFn: async () => {
      const res = await fetch(`/api/studies/${studyId}/individuals`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando individuos");
      return res.json();
    },
    enabled: !!studyId,
  });

  const { data: allProjects } = useQuery<(Project & { animalCount: number })[]>({
    queryKey: ["/api/projects"],
  });

  const projectIdsInStudy = useMemo(() => {
    if (!individuals) return new Set<number | null>();
    return new Set(individuals.map(ind => ind.projectId).filter((id): id is number => id != null));
  }, [individuals]);

  const filteredByProject = useMemo(() => {
    if (!individuals) return [];
    if (projectFilterId === "all") return individuals;
    return individuals.filter(ind => ind.projectId === Number(projectFilterId));
  }, [individuals, projectFilterId]);

  const { data: savedAnalyses, isLoading: loadingHistory } = useQuery<SavedAnalysis[]>({
    queryKey: ["/api/studies", studyId, "analyses"],
    queryFn: async () => {
      const res = await fetch(`/api/studies/${studyId}/analyses`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando historial");
      return res.json();
    },
    enabled: !!studyId,
  });

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const tsStart = new Date(dateStart).getTime();
      const tsEnd = new Date(dateEnd + "T23:59:59.999").getTime();
      if (isNaN(tsStart) || isNaN(tsEnd)) throw new Error("Fechas invalidas");

      const body: any = {
        analysisType,
        individuals: selectedAnimals,
        timestampStart: tsStart,
        timestampEnd: tsEnd,
      };
      const params: any = { maxPoints };
      if (analysisType === "mcp") {
        params.percent = parseInt(mcpPercent, 10);
      }
      if (analysisType === "comprehensive") {
        params.bandwidthMethod = bandwidthMethod;
        params.kernelPercentages = kernelPercentages;
      }
      if (analysisType === "kernel") {
        params.kernelPercentages = kernelPercentages;
      }
      body.params = params;

      const res = await apiRequest("POST", `/api/studies/${studyId}/analysis`, body);
      return res.json();
    },
    onSuccess: (data) => {
      setResultData(data);
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "analyses"] });
      toast({ title: "Analisis completado", description: `${ANALYSIS_LABELS[analysisType]} ejecutado exitosamente` });
    },
    onError: (e: any) => {
      const isTimeout = e.message?.includes("tardó demasiado") || e.message?.includes("408");
      toast({
        title: isTimeout ? "Tiempo excedido" : "Error",
        description: isTimeout
          ? "El cálculo tardó demasiado. Intente con un rango de fechas menor o menos animales."
          : e.message,
        variant: "destructive",
      });
    },
  });

  const countTsStart = dateStart ? new Date(dateStart).getTime() : NaN;
  const countTsEnd = dateEnd ? new Date(dateEnd + "T23:59:59.999").getTime() : NaN;
  const countEnabled =
    !!studyId &&
    selectedAnimals.length > 0 &&
    Number.isFinite(countTsStart) &&
    Number.isFinite(countTsEnd);

  const { data: pointCountData, isFetching: isCountFetching } = useQuery<{ count: number; maxPerAnimal: number }>({
    queryKey: [
      "/api/studies",
      studyId,
      "gps-point-count",
      selectedAnimals.join(","),
      countTsStart,
      countTsEnd,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({
        individuals: selectedAnimals.join(","),
        start: String(countTsStart),
        end: String(countTsEnd),
      });
      const res = await apiRequest("GET", `/api/studies/${studyId}/gps-point-count?${qs.toString()}`);
      return res.json();
    },
    enabled: countEnabled,
  });
  const availablePoints = pointCountData?.count ?? null;
  const maxPointsPerAnimal = pointCountData?.maxPerAnimal ?? 0;

  const deleteAnalysisMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/analyses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "analyses"] });
      toast({ title: "Analisis eliminado" });
    },
  });

  const loadSavedResult = async (analysis: SavedAnalysis) => {
    const saved = analysis.resultData as any;
    setResultData({
      ...saved,
      id: analysis.id,
      geojson: analysis.resultGeojson,
    });
    setAnalysisType(analysis.analysisType as AnalysisType);
    setSelectedAnimals(analysis.individuals);
    const start = new Date(analysis.timestampStart);
    const end = new Date(analysis.timestampEnd);
    setDateStart(format(start, "yyyy-MM-dd"));
    setDateEnd(format(end, "yyyy-MM-dd"));
    const savedPcts = deriveKernelPcts(saved);
    setKernelPercentages(savedPcts);
    setShowKernelPcts(savedPcts);
    toast({ title: "Analisis cargado" });
  };

  useEffect(() => {
    if (!resultData) return;
    const pcts = deriveKernelPcts(resultData);
    setShowKernelPcts(pcts);
  }, [resultData?.id, (resultData as any)?.kernelPercentages?.join(",")]);

  const addKernelPct = () => {
    const v = parseInt(kernelPctInput, 10);
    if (!Number.isFinite(v) || v < 1 || v > 99) {
      toast({ title: "Valor inválido", description: "Introduce un entero entre 1 y 99", variant: "destructive" });
      return;
    }
    if (kernelPercentages.includes(v)) {
      setKernelPctInput("");
      return;
    }
    if (kernelPercentages.length >= 10) {
      toast({ title: "Máximo 10 percentiles", variant: "destructive" });
      return;
    }
    setKernelPercentages([...kernelPercentages, v].sort((a, b) => a - b));
    setKernelPctInput("");
  };

  const removeKernelPct = (pct: number) => {
    if (kernelPercentages.length <= 1) {
      toast({ title: "Mínimo 1 percentil", variant: "destructive" });
      return;
    }
    setKernelPercentages(kernelPercentages.filter((p) => p !== pct));
  };

  const toggleKernelCalcPct = (pct: number) => {
    if (kernelPercentages.includes(pct)) {
      if (kernelPercentages.length <= 1) {
        toast({ title: "Mínimo 1 percentil", variant: "destructive" });
        return;
      }
      setKernelPercentages(kernelPercentages.filter((p) => p !== pct));
    } else {
      if (kernelPercentages.length >= 10) {
        toast({ title: "Máximo 10 percentiles", variant: "destructive" });
        return;
      }
      setKernelPercentages([...kernelPercentages, pct].sort((a, b) => a - b));
    }
  };

  const exportCsvLegacy = () => {
    if (!resultData) return;
    let csv = "";

    if (resultData.analysisType === "mcp") {
      csv = "individual,area_km2\n";
      for (const a of resultData.areas || []) {
        csv += `${a.individual},${a.area_km2}\n`;
      }
    } else if (resultData.analysisType === "kernel") {
      const pcts = deriveKernelPcts(resultData);
      csv = `individual,${pcts.map((p) => `area_${p}_km2`).join(",")}\n`;
      for (const a of resultData.areas || []) {
        const row: (string | number)[] = [a.individual];
        for (const p of pcts) {
          const v = getKernelAreaForPct(a, p);
          row.push(v != null ? v : "");
        }
        csv += row.join(",") + "\n";
      }
    } else if (resultData.analysisType === "distance") {
      csv = "individual,total_km,average_daily_km,net_displacement_km,linearity_index\n";
      for (const ind of resultData.individuals || []) {
        const lin = typeof ind.linearity_index === "number" ? ind.linearity_index : "";
        csv += `${ind.individual},${ind.total_km},${ind.average_daily_km},${ind.net_displacement_km},${lin}\n`;
      }
      csv += "\nindividual,date,distance_km\n";
      for (const ind of resultData.individuals || []) {
        for (const d of ind.daily || []) {
          csv += `${ind.individual},${d.date},${d.distance_km}\n`;
        }
      }
    } else if (resultData.analysisType === "speed") {
      csv = "individual,timestamp,speed_kmh\n";
      for (const ind of resultData.individuals || []) {
        for (const s of ind.speeds || []) {
          csv += `${ind.individual},${new Date(s.timestamp).toISOString()},${s.speed_kmh}\n`;
        }
      }
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analisis_${resultData.analysisType}_${format(new Date(), "yyyyMMdd_HHmmss")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsvComprehensive = async () => {
    if (!resultData?.id) {
      exportCsvLegacy();
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${resultData.id}/export-csv`, { credentials: "include" });
      if (!res.ok) throw new Error("Error exportando");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `VALORES_${format(new Date(), "yyyyMMdd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "No se pudo exportar el CSV", variant: "destructive" });
    }
  };

  const [exportingValores, setExportingValores] = useState(false);

  const exportValoresOnTheFly = async () => {
    if (!studyId || selectedAnimals.length === 0 || !dateStart || !dateEnd) return;
    setExportingValores(true);
    try {
      const body = {
        individuals: selectedAnimals,
        timestampStart: new Date(dateStart).getTime(),
        timestampEnd: new Date(dateEnd + "T23:59:59.999").getTime(),
      };
      const res = await fetch(`/api/studies/${studyId}/export-valores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Error exportando");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `VALORES_${format(new Date(), "yyyyMMdd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exportación completada", description: "VALORES.csv generado con todas las métricas" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "No se pudo exportar el CSV", variant: "destructive" });
    } finally {
      setExportingValores(false);
    }
  };

  const downloadExport = async (type: "hrref" | "mpc" | "geojson") => {
    if (!resultData?.id) return;
    try {
      const endpoint = `/api/analyses/${resultData.id}/export-${type}`;
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Error exportando");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = type === "geojson" ? "geojson" : "csv";
      const name = type === "hrref" ? "HRREF" : type === "mpc" ? "MPC" : "analisis_geoespacial";
      a.download = `${name}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "No se pudo exportar", variant: "destructive" });
    }
  };

  const captureMap = async (el: HTMLElement, backgroundColor: string | null) => {
    // Extrae el desplazamiento (tx, ty) de cualquier transform CSS de Leaflet
    // (translate / translate3d / matrix / matrix3d). Devuelve null si no hay.
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
      scale: 2,
      useCORS: true,
      onclone: (_doc, clonedEl) => {
        const panes = clonedEl.querySelectorAll<HTMLElement>(
          ".leaflet-pane, .leaflet-tile, .leaflet-zoom-animated, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-overlay-pane svg"
        );
        panes.forEach((p) => {
          const parsed = parseTranslate(p.style.transform);
          if (!parsed) return;
          // html2canvas IGNORA el transform CSS propio de un <svg> al rasterizarlo
          // (pero sí respeta su viewBox), por lo que las capas vectoriales KDE/MCP
          // se desplazaban hacia el oeste. Para el SVG movemos el desplazamiento al
          // posicionamiento de layout (left/top), que html2canvas sí respeta.
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
    const el = chartContainerRef.current;
    if (!el) { toast({ title: "Error", description: "No hay gráfica visible para exportar", variant: "destructive" }); return; }
    try {
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 2 });
      const link = document.createElement("a");
      link.download = `analisis_grafica_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "Exportado", description: "Gráfica exportada como PNG" });
    } catch { toast({ title: "Error", description: "No se pudo exportar la gráfica", variant: "destructive" }); }
  };

  const exportMapPng = async () => {
    const el = mapContainerRef.current;
    if (!el) { toast({ title: "Error", description: "No hay mapa visible para exportar", variant: "destructive" }); return; }
    try {
      const canvas = await captureMap(el, null);
      const link = document.createElement("a");
      link.download = `analisis_mapa_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "Exportado", description: "Mapa exportado como PNG" });
    } catch { toast({ title: "Error", description: "No se pudo exportar el mapa", variant: "destructive" }); }
  };

  const exportPdf = async () => {
    try {
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;

      pdf.setFontSize(16);
      pdf.text("Análisis Geoespacial", margin, 15);
      pdf.setFontSize(10);
      pdf.text(`Tipo: ${analysisType.toUpperCase()}`, margin, 22);
      pdf.text(`Animales: ${selectedAnimals.join(", ")}`, margin, 28);
      pdf.text(`Periodo: ${dateStart} a ${dateEnd}`, margin, 34);
      pdf.text(`Fecha: ${new Date().toLocaleString("es-ES")}`, margin, 40);

      let yOffset = 48;

      const chartEl = chartContainerRef.current;
      if (chartEl) {
        const chartCanvas = await html2canvas(chartEl, { backgroundColor: "#ffffff", scale: 2 });
        const chartImg = chartCanvas.toDataURL("image/png");
        const aspect = chartCanvas.width / chartCanvas.height;
        const imgW = pageW - margin * 2;
        const imgH = Math.min(imgW / aspect, pageH - yOffset - margin);
        pdf.addImage(chartImg, "PNG", margin, yOffset, imgW, imgH);
        yOffset += imgH + 5;
      }

      const mapEl = mapContainerRef.current;
      if (mapEl) {
        if (yOffset + 60 > pageH) { pdf.addPage(); yOffset = margin; }
        const mapCanvas = await captureMap(mapEl, "#ffffff");
        const mapImg = mapCanvas.toDataURL("image/png");
        const aspect = mapCanvas.width / mapCanvas.height;
        const imgW = pageW - margin * 2;
        const imgH = Math.min(imgW / aspect, pageH - yOffset - margin);
        pdf.addImage(mapImg, "PNG", margin, yOffset, imgW, imgH);
      }

      pdf.save(`analisis_geoespacial_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: "Exportado", description: "Informe PDF generado" });
    } catch { toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" }); }
  };

  const exportGeoData = async (format: "csv" | "kmz" | "shp" | "geojson") => {
    if (!studyId || selectedAnimals.length === 0 || !dateStart || !dateEnd) {
      toast({ title: "Error", description: "Selecciona animales y rango de fechas", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const tsStart = new Date(dateStart).getTime();
      const tsEnd = new Date(dateEnd + "T23:59:59.999").getTime();
      const res = await fetch(`/api/studies/${studyId}/export-geospatial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          individualIds: selectedAnimals,
          startDate: tsStart,
          endDate: tsEnd,
          analysisType,
          format,
          mcpPercent: parseInt(mcpPercent) || 95,
          bandwidthMethod,
          kernelPercentages,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Error exportando");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "kmz" ? "kmz" : format === "shp" ? "zip" : format;
      a.download = `geo_${analysisType}_${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exportado", description: `Datos exportados como ${format.toUpperCase()}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "No se pudo exportar", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleQuickRange = (range: QuickRange, start: string, end: string) => {
    setDateStart(start);
    setDateEnd(end);
    setActiveQuickRange(range);
    if (autoLoadEnabled && selectedAnimals.length > 0) {
      pendingAutoLoad.current = true;
    }
  };

  const handleDateStartChange = (val: string) => {
    setDateStart(val);
    setActiveQuickRange(null);
  };

  const handleDateEndChange = (val: string) => {
    setDateEnd(val);
    setActiveQuickRange(null);
  };

  useEffect(() => {
    if (pendingAutoLoad.current && dateStart && dateEnd && selectedAnimals.length > 0 && !analysisMutation.isPending) {
      pendingAutoLoad.current = false;
      analysisMutation.mutate();
    }
  }, [dateStart, dateEnd]);

  const filteredGeojson = useMemo(() => {
    if (!resultData?.geojson?.features) return null;
    if (resultData.analysisType !== "comprehensive") return resultData.geojson;

    const filtered = resultData.geojson.features.filter((f: any) => {
      const props = f.properties || {};
      if (props.type === "trajectory") return true;
      if (props.type === "kernel") {
        if (props.method !== mapMethod) return false;
        if (mapLayer !== "kernel") return false;
        return showKernelPcts.includes(props.percent);
      }
      if (props.type === "mcp") {
        if (mapLayer !== "mcp") return false;
        return showMcpPcts.includes(props.percent);
      }
      return true;
    });

    return { type: "FeatureCollection", features: filtered };
  }, [resultData, mapMethod, showKernelPcts, showMcpPcts, mapLayer]);

  const canExecute = selectedAnimals.length > 0 && dateStart && dateEnd;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-analysis-title">
            Analisis geoespacial
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analisis estadisticos de movimiento y home range (Turf.js)
          </p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting} data-testid="button-export-dropdown">
                  <Download className="w-4 h-4 mr-2" />
                  {exporting ? "Exportando..." : "Exportar"}
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Imágenes</DropdownMenuLabel>
                <DropdownMenuItem onClick={exportChartPng} disabled={!chartContainerRef.current} data-testid="menu-export-chart-png">
                  <Image className="w-4 h-4 mr-2" />
                  Gráfica como PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportMapPng} disabled={!mapContainerRef.current} data-testid="menu-export-map-png">
                  <Image className="w-4 h-4 mr-2" />
                  Mapa como PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportPdf} data-testid="menu-export-pdf">
                  <FileText className="w-4 h-4 mr-2" />
                  Informe PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Exportar datos como...</DropdownMenuLabel>
                {resultData && resultData.analysisType === "comprehensive" && (
                  <>
                    <DropdownMenuItem onClick={exportCsvComprehensive} data-testid="menu-export-valores">
                      <Table2 className="w-4 h-4 mr-2" />
                      VALORES.csv
                    </DropdownMenuItem>
                    {resultData.id && (
                      <>
                        <DropdownMenuItem onClick={() => downloadExport("hrref")} data-testid="menu-export-hrref">
                          <FileText className="w-4 h-4 mr-2" />
                          HRREF.csv
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => downloadExport("mpc")} data-testid="menu-export-mpc">
                          <FileText className="w-4 h-4 mr-2" />
                          MPC.csv
                        </DropdownMenuItem>
                      </>
                    )}
                  </>
                )}
                {resultData && resultData.analysisType !== "comprehensive" && (
                  <DropdownMenuItem onClick={exportCsvLegacy} data-testid="menu-export-current">
                    <Table2 className="w-4 h-4 mr-2" />
                    Métricas del análisis actual
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => exportGeoData("csv")} disabled={!canExecute} data-testid="menu-export-csv">
                  <FileText className="w-4 h-4 mr-2" />
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportGeoData("kmz")} disabled={!canExecute} data-testid="menu-export-kmz">
                  <Globe className="w-4 h-4 mr-2" />
                  KMZ (Google Earth)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportGeoData("shp")} disabled={!canExecute} data-testid="menu-export-shp">
                  <FileCode className="w-4 h-4 mr-2" />
                  Shapefile (SHP)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportGeoData("geojson")} disabled={!canExecute} data-testid="menu-export-geojson">
                  <FileJson className="w-4 h-4 mr-2" />
                  GeoJSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="outline"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="button-toggle-history"
          >
            <History className="w-4 h-4 mr-2" />
            Historial
            {showHistory ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
          </Button>
        </div>
      </div>

      {showHistory && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" />
              Analisis guardados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingHistory ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : savedAnalyses && savedAnalyses.length > 0 ? (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Animales</TableHead>
                      <TableHead>Periodo</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedAnalyses.map((a) => (
                      <TableRow key={a.id} data-testid={`row-analysis-${a.id}`}>
                        <TableCell>
                          <Badge variant="outline">{ANALYSIS_LABELS[a.analysisType as AnalysisType]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {a.individuals.join(", ")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(a.timestampStart), "dd/MM/yy")} - {format(new Date(a.timestampEnd), "dd/MM/yy")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {a.createdAt ? format(new Date(a.createdAt), "dd/MM/yy HH:mm", { locale: es }) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => loadSavedResult(a)} data-testid={`button-load-analysis-${a.id}`}>
                              Cargar
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => deleteAnalysisMutation.mutate(a.id)} data-testid={`button-delete-analysis-${a.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Sin analisis guardados</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Parametros
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de analisis</Label>
              <Select value={analysisType} onValueChange={(v) => setAnalysisType(v as AnalysisType)}>
                <SelectTrigger data-testid="select-analysis-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comprehensive">Analisis completo</SelectItem>
                  <SelectItem value="mcp">Home Range (MCP)</SelectItem>
                  <SelectItem value="kernel">Home Range (Kernel)</SelectItem>
                  <SelectItem value="distance">Distancia recorrida</SelectItem>
                  <SelectItem value="speed">Velocidad de movimiento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {analysisType === "comprehensive" && (
              <div className="space-y-2">
                <Label>Metodo de bandwidth</Label>
                <Select value={bandwidthMethod} onValueChange={setBandwidthMethod}>
                  <SelectTrigger data-testid="select-bandwidth-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="href">HREF (Silverman)</SelectItem>
                    <SelectItem value="lscv">LSCV (Cross Validation)</SelectItem>
                    <SelectItem value="both">Ambos (HREF + LSCV)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {bandwidthMethod === "href" && "Regla de referencia de Silverman — rapido y robusto"}
                  {bandwidthMethod === "lscv" && "Validacion cruzada — puede no converger, usa HREF como fallback"}
                  {bandwidthMethod === "both" && "Calcula ambos metodos para comparar"}
                </p>
              </div>
            )}

            {(analysisType === "kernel" || analysisType === "comprehensive") && (
              <div className="space-y-2">
                <Label>Percentiles Kernel (%)</Label>
                <div className="flex flex-wrap gap-1" data-testid="presets-kernel-percentages">
                  {KERNEL_PCTS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => toggleKernelCalcPct(pct)}
                      className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                        kernelPercentages.includes(pct)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                      data-testid={`preset-kernel-pct-${pct}`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 mb-1" data-testid="taginput-kernel-percentages">
                  {kernelPercentages.map((pct) => (
                    <span
                      key={pct}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-primary/10 text-primary border-primary/30"
                      style={{ borderColor: kernelColor(pct, kernelPercentages) }}
                      data-testid={`tag-kernel-pct-${pct}`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: kernelColor(pct, kernelPercentages) }} />
                      {pct}%
                      <button
                        type="button"
                        onClick={() => removeKernelPct(pct)}
                        className="ml-0.5 hover:text-destructive"
                        data-testid={`button-remove-kernel-pct-${pct}`}
                        aria-label={`Eliminar ${pct}%`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={kernelPctInput}
                    onChange={(e) => setKernelPctInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKernelPct(); } }}
                    placeholder="Añadir (1-99)"
                    className="w-32"
                    data-testid="input-kernel-percentage"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={addKernelPct}
                    data-testid="button-add-kernel-pct"
                  >
                    Añadir
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Hasta 10 percentiles. Por defecto 50 y 95.</p>
              </div>
            )}

            {analysisType === "mcp" && (
              <div className="space-y-2">
                <Label>Porcentaje MCP</Label>
                <Input
                  type="number"
                  min={50}
                  max={100}
                  value={mcpPercent}
                  onChange={(e) => setMcpPercent(e.target.value)}
                  className="w-24"
                  data-testid="input-mcp-percent"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Rango rapido</Label>
              <QuickDateRange
                activeRange={activeQuickRange}
                onRangeSelect={handleQuickRange}
                autoLoad={autoLoadEnabled}
                onAutoLoadChange={setAutoLoadEnabled}
                ranges={["6h", "24h", "7d", "14d", "30d", "90d", "1a", "todo"]}
              />
            </div>

            <div className="space-y-2">
              <Label>Fecha inicio</Label>
              <Input
                type="date"
                value={dateStart}
                onChange={(e) => handleDateStartChange(e.target.value)}
                data-testid="input-date-start"
              />
            </div>

            <div className="space-y-2">
              <Label>Fecha fin</Label>
              <Input
                type="date"
                value={dateEnd}
                onChange={(e) => handleDateEndChange(e.target.value)}
                data-testid="input-date-end"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Máximo de puntos</Label>
                <span className="text-sm font-medium tabular-nums" data-testid="text-max-points">
                  {maxPoints.toLocaleString("es-ES")}
                </span>
              </div>
              <Slider
                min={100}
                max={5000}
                step={100}
                value={[maxPoints]}
                onValueChange={(v) => setMaxPoints(v[0])}
                data-testid="slider-max-points"
              />
              <p className="text-xs text-muted-foreground" data-testid="text-available-points">
                {!countEnabled ? (
                  "Seleccione animales y rango de fechas para ver los puntos disponibles."
                ) : isCountFetching || availablePoints === null ? (
                  "Calculando puntos disponibles…"
                ) : (
                  <>
                    {availablePoints.toLocaleString("es-ES")} puntos GPS disponibles
                    {selectedAnimals.length > 1 ? " (en total)" : ""}.{" "}
                    {maxPointsPerAnimal > maxPoints ? (
                      <span className="text-amber-600 dark:text-amber-500">
                        Se submuestreará a {maxPoints.toLocaleString("es-ES")} por animal.
                      </span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-500">
                        Sin submuestreo.
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>

            {projectIdsInStudy.size > 0 && (
              <div className="space-y-2">
                <Label>Proyecto</Label>
                <Select value={projectFilterId} onValueChange={(v) => { setProjectFilterId(v); setSelectedAnimals([]); }}>
                  <SelectTrigger data-testid="select-filter-project">
                    <SelectValue placeholder="Todos los proyectos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los proyectos</SelectItem>
                    {allProjects?.filter(p => projectIdsInStudy.has(p.id)).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.descripcion}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Animales</Label>
              {loadingIndividuals ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : (
                <AnimalSearch
                  individuals={filteredByProject.filter((i) => i.localIdentifier) || []}
                  selected={selectedAnimals}
                  onChange={setSelectedAnimals}
                  multiple
                  placeholder="Buscar animal..."
                />
              )}
            </div>

            {canAnalyze && (
              <Button
                className="w-full"
                onClick={() => analysisMutation.mutate()}
                disabled={!canExecute || analysisMutation.isPending}
                data-testid="button-run-analysis"
              >
                {analysisMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Ejecutando...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Ejecutar analisis
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {analysisMutation.isPending && (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="w-10 h-10 mx-auto mb-3 animate-spin text-primary" />
                <p className="text-sm font-medium">Calculando... esto puede tardar unos segundos</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Procesando datos GPS y generando análisis geoespacial
                </p>
              </CardContent>
            </Card>
          )}

          {resultData && !analysisMutation.isPending && (
            <div ref={chartContainerRef}>
              {resultData.analysisType === "comprehensive" ? (
                <ComprehensiveResults
                  data={resultData}
                  filteredGeojson={filteredGeojson}
                  mapMethod={mapMethod}
                  setMapMethod={setMapMethod}
                  showKernelPcts={showKernelPcts}
                  setShowKernelPcts={setShowKernelPcts}
                  showMcpPcts={showMcpPcts}
                  setShowMcpPcts={setShowMcpPcts}
                  mapLayer={mapLayer}
                  setMapLayer={setMapLayer}
                  mapContainerRef={mapContainerRef}
                />
              ) : (
                <>
                  <MetricsPanel data={resultData} />

                  {resultData.geojson && resultData.geojson.features?.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <MapIcon className="w-4 h-4" />
                          Mapa
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {resultData.analysisType === "kernel" && (
                          <div className="flex flex-wrap gap-1" data-testid="kernel-only-pcts-toggle">
                            {deriveKernelPcts(resultData).map((pct) => {
                              const active = showKernelPcts.includes(pct);
                              const c = kernelColor(pct, deriveKernelPcts(resultData));
                              return (
                                <button
                                  key={pct}
                                  onClick={() =>
                                    setShowKernelPcts(
                                      active ? showKernelPcts.filter((p) => p !== pct) : [...showKernelPcts, pct]
                                    )
                                  }
                                  className={`text-xs px-2 py-0.5 rounded-md border transition-colors flex items-center gap-1 ${
                                    active ? "bg-primary/10" : "text-muted-foreground"
                                  }`}
                                  style={{ borderColor: active ? c : undefined }}
                                  data-testid={`toggle-kernel-only-${pct}`}
                                >
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                                  {pct}%
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div className="h-[400px] rounded-md overflow-hidden border" ref={mapContainerRef}>
                          <MapContainer
                            center={[0, 0]}
                            zoom={2}
                            style={{ height: "100%", width: "100%" }}
                            key={`${JSON.stringify(resultData.geojson).slice(0, 100)}-${showKernelPcts.join(",")}`}
                          >
                            <MapLayerControl />
                            <GoogleMapsClick />
                            <GeoJSON
                              data={resultData.geojson}
                              style={(feature: any) => {
                                const props = feature?.properties || {};
                                if (props.type === "mcp") {
                                  return { color: "#3b82f6", weight: 2, opacity: 0.8, fillColor: "#3b82f6", fillOpacity: 0.3 };
                                }
                                if (props.type === "kernel") {
                                  const kpcts = deriveKernelPcts(resultData);
                                  const pct = props.percent || parseInt(String(props.level || "").replace("%", ""), 10) || kpcts[kpcts.length - 1];
                                  if (!showKernelPcts.includes(pct)) {
                                    return { color: "transparent", weight: 0, fillOpacity: 0, opacity: 0 };
                                  }
                                  const c = kernelColor(pct, kpcts);
                                  return { color: c, weight: 2, opacity: 0.8, fillColor: c, fillOpacity: 0.3 };
                                }
                                const idx = resultData.geojson.features.indexOf(feature) || 0;
                                const color = ANIMAL_COLORS[idx % ANIMAL_COLORS.length];
                                return { color, weight: 2, opacity: 0.8, fillColor: color, fillOpacity: 0.2 };
                              }}
                              onEachFeature={(feature: any, layer: any) => {
                                const props = feature.properties || {};
                                let popup = `<b>${props.id || "Animal"}</b>`;
                                if (props.type === "mcp") {
                                  popup += `<br/>MCP ${props.percent || 95}%`;
                                  popup += `<br/>Area: ${props.area_km2?.toFixed(3)} km\u00B2`;
                                } else if (props.type === "kernel") {
                                  popup += `<br/>Kernel ${props.level}`;
                                  popup += `<br/>Area: ${props.area_km2?.toFixed(3)} km\u00B2`;
                                } else if (props.area_km2 !== undefined) {
                                  popup += `<br/>Area: ${props.area_km2?.toFixed(3)} km\u00B2`;
                                }
                                layer.bindPopup(popup);
                              }}
                            />
                            <FitBounds geojson={resultData.geojson} />
                          </MapContainer>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 text-center">Clic en el mapa para abrir en Google Maps</p>
                      </CardContent>
                    </Card>
                  )}

                  {resultData.analysisType === "distance" && <DistanceChart data={resultData} />}
                  {resultData.analysisType === "speed" && <SpeedChart data={resultData} />}
                  <AnalysisResultTable data={resultData} />
                </>
              )}
            </div>
          )}

          {!resultData && !analysisMutation.isPending && (
            <Card>
              <CardContent className="py-16 text-center">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Selecciona animales, rango de fechas y tipo de analisis para comenzar
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ComprehensiveResults({
  data,
  filteredGeojson,
  mapMethod,
  setMapMethod,
  showKernelPcts,
  setShowKernelPcts,
  showMcpPcts,
  setShowMcpPcts,
  mapLayer,
  setMapLayer,
  mapContainerRef,
}: {
  data: any;
  filteredGeojson: any;
  mapMethod: "href" | "lscv";
  setMapMethod: (v: "href" | "lscv") => void;
  showKernelPcts: number[];
  setShowKernelPcts: (v: number[]) => void;
  showMcpPcts: number[];
  setShowMcpPcts: (v: number[]) => void;
  mapLayer: "kernel" | "mcp";
  setMapLayer: (v: "kernel" | "mcp") => void;
  mapContainerRef: RefObject<HTMLDivElement>;
}) {
  const perInd = data.perIndividual || [];
  const isMulti = perInd.length > 1;
  const hasBoth = data.bandwidthMethod === "both";
  const hasLscv = data.bandwidthMethod === "lscv" || hasBoth;

  const toggleKernelPct = (pct: number) => {
    setShowKernelPcts(
      showKernelPcts.includes(pct)
        ? showKernelPcts.filter((p) => p !== pct)
        : [...showKernelPcts, pct]
    );
  };

  const toggleMcpPct = (pct: number) => {
    setShowMcpPcts(
      showMcpPcts.includes(pct)
        ? showMcpPcts.filter((p) => p !== pct)
        : [...showMcpPcts, pct]
    );
  };

  return (
    <div className="space-y-4">
      {data.sampled && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
          <Info className="w-4 h-4 shrink-0" />
          Se han muestreado {data.sampleSize.toLocaleString()} de {data.totalPoints.toLocaleString()} puntos para optimizar el calculo
        </div>
      )}

      {isMulti ? (
        <>
          <ComparisonTable data={data} />
          {perInd.map((ind: any, idx: number) => (
            <div key={ind.individual} className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground mt-2" style={{ color: ANIMAL_COLORS[idx % ANIMAL_COLORS.length] }}>
                {ind.individual}
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <HrrefChart ind={ind} pcts={deriveKernelPcts(data)} />
                <McpChart ind={ind} />
              </div>
            </div>
          ))}
        </>
      ) : perInd.length === 1 ? (
        <SingleAnimalMetrics ind={perInd[0]} bandwidthMethod={data.bandwidthMethod} kernelPcts={deriveKernelPcts(data)} />
      ) : null}

      {filteredGeojson && filteredGeojson.features?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapIcon className="w-4 h-4" />
              Mapa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={mapLayer === "kernel" ? "default" : "outline"}
                  onClick={() => setMapLayer("kernel")}
                  data-testid="button-map-kernel"
                >
                  Kernel
                </Button>
                <Button
                  size="sm"
                  variant={mapLayer === "mcp" ? "default" : "outline"}
                  onClick={() => setMapLayer("mcp")}
                  data-testid="button-map-mcp"
                >
                  MCP
                </Button>
              </div>

              {mapLayer === "kernel" && hasBoth && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={mapMethod === "href" ? "default" : "outline"}
                    onClick={() => setMapMethod("href")}
                    data-testid="button-map-href"
                  >
                    HREF
                  </Button>
                  <Button
                    size="sm"
                    variant={mapMethod === "lscv" ? "default" : "outline"}
                    onClick={() => setMapMethod("lscv")}
                    data-testid="button-map-lscv"
                  >
                    LSCV
                  </Button>
                </div>
              )}
            </div>

            {mapLayer === "kernel" && (
              <div className="flex flex-wrap gap-1">
                {deriveKernelPcts(data).map((pct) => {
                  const active = showKernelPcts.includes(pct);
                  const c = kernelColor(pct, deriveKernelPcts(data));
                  return (
                    <button
                      key={pct}
                      onClick={() => toggleKernelPct(pct)}
                      className={`text-xs px-2 py-0.5 rounded-md border transition-colors flex items-center gap-1 ${
                        active ? "bg-primary/10" : "text-muted-foreground"
                      }`}
                      style={{ borderColor: active ? c : undefined }}
                      data-testid={`toggle-kernel-${pct}`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                      {pct}%
                    </button>
                  );
                })}
              </div>
            )}

            {mapLayer === "mcp" && (
              <div className="flex flex-wrap gap-1">
                {MCP_PCTS.map((pct) => (
                  <button
                    key={pct}
                    onClick={() => toggleMcpPct(pct)}
                    className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                      showMcpPcts.includes(pct)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                    data-testid={`toggle-mcp-${pct}`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            )}

            <div className="h-[450px] rounded-md overflow-hidden border" ref={mapContainerRef}>
              <MapContainer
                center={[0, 0]}
                zoom={2}
                style={{ height: "100%", width: "100%" }}
                key={`${mapLayer}-${mapMethod}-${showKernelPcts.join(",")}-${showMcpPcts.join(",")}`}
              >
                <MapLayerControl />
                <GoogleMapsClick />
                <GeoJSON
                  data={filteredGeojson}
                  style={(feature: any) => {
                    const props = feature?.properties || {};
                    if (props.type === "trajectory") {
                      return { color: "#f59e0b", weight: 1.5, opacity: 0.6, dashArray: "4 4", fillOpacity: 0 };
                    }
                    if (props.type === "kernel") {
                      const pctsForColor = deriveKernelPcts(data);
                      const maxPct = Math.max(...pctsForColor, 95);
                      const pct = props.percent || maxPct;
                      const color = kernelColor(pct, pctsForColor);
                      const fillOpacity = 0.15 + (1 - pct / maxPct) * 0.3;
                      return { color, weight: 1.5, opacity: 0.7, fillColor: color, fillOpacity };
                    }
                    if (props.type === "mcp") {
                      const pct = props.percent || 100;
                      const opacity = 0.15 + (1 - pct / 100) * 0.3;
                      return { color: "#3b82f6", weight: 1.5, opacity: 0.7, fillColor: "#3b82f6", fillOpacity: opacity, dashArray: "6 3" };
                    }
                    return { color: "#888", weight: 1, fillOpacity: 0.1 };
                  }}
                  onEachFeature={(feature: any, layer: any) => {
                    const props = feature.properties || {};
                    let popup = `<b>${props.id || "Animal"}</b>`;
                    if (props.type === "trajectory") {
                      popup += `<br/>Trayectoria`;
                    } else if (props.type === "kernel") {
                      popup += `<br/>Kernel ${props.level} (${props.method?.toUpperCase() || "HREF"})`;
                    } else if (props.type === "mcp") {
                      popup += `<br/>MCP ${props.percent}%`;
                    }
                    if (props.area_km2 !== undefined) {
                      popup += `<br/>Area: ${props.area_km2?.toFixed(3)} km\u00B2`;
                    }
                    layer.bindPopup(popup);
                  }}
                />
                <FitBounds geojson={filteredGeojson} />
              </MapContainer>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 text-center">Clic en el mapa para abrir en Google Maps</p>

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5" style={{ backgroundColor: "#f59e0b", borderTop: "2px dashed #f59e0b" }} />
                Trayectoria
              </div>
              {mapLayer === "kernel" && [...showKernelPcts].sort((a, b) => a - b).map((pct) => (
                <div key={pct} className="flex items-center gap-1.5" data-testid={`legend-kernel-${pct}`}>
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: kernelColor(pct, deriveKernelPcts(data)), opacity: 0.7 }}
                  />
                  Kernel {pct}%
                </div>
              ))}
              {mapLayer === "mcp" && [...showMcpPcts].sort((a, b) => a - b).map((pct) => (
                <div key={pct} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#3b82f6", opacity: 0.3 + (1 - pct / 100) * 0.5 }} />
                  MCP {pct}%
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {Array.isArray(data.distance) && data.distance.length > 0 && (
        <DistanceChart data={{ individuals: data.distance }} />
      )}
      {Array.isArray(data.speed) && data.speed.length > 0 && (
        <SpeedChart data={{ individuals: data.speed }} />
      )}
    </div>
  );
}

function VisualBar({ value, max = 1, label }: { value: number | null | undefined; max?: number; label: string }) {
  const safeVal = typeof value === "number" && isFinite(value) ? value : 0;
  const pct = Math.min(100, Math.max(0, (safeVal / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value != null && isFinite(value as number) ? (value as number).toFixed(4) : "—"}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AreaTable({ areas, pcts, title }: { areas: Record<string, number> | null; pcts: number[]; title: string }) {
  if (!areas) return null;
  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Porcentaje</TableHead>
            <TableHead>Area (m²)</TableHead>
            <TableHead>Area (km²)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pcts.map((pct) => {
            const km2 = areas[`${pct}`];
            return (
              <TableRow key={pct}>
                <TableCell>{pct}%</TableCell>
                <TableCell>{km2 != null ? (km2 * 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—"}</TableCell>
                <TableCell>{km2 ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function HrrefChart({ ind, pcts }: { ind: any; pcts?: number[] }) {
  const usePcts = pcts && pcts.length > 0
    ? pcts
    : Object.keys(ind.kernelHrefAreas || {}).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const data = usePcts.map((pct) => ({
    pct,
    area: ind.kernelHrefAreas?.[`${pct}`] != null ? ind.kernelHrefAreas[`${pct}`] * 1e6 : 0,
  })).filter((d) => d.area > 0);
  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          HRREF — Area vs Porcentaje
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="pct" label={{ value: "Porcentaje (%)", position: "insideBottom", offset: -5, fontSize: 11 }} tick={{ fontSize: 10 }} />
              <YAxis label={{ value: "Area (m²)", angle: -90, position: "insideLeft", fontSize: 11 }} tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [v.toLocaleString("es-ES", { maximumFractionDigits: 2 }), "Area (m²)"]}
                labelFormatter={(l) => `${l}%`}
              />
              <Line type="monotone" dataKey="area" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function McpChart({ ind }: { ind: any }) {
  const data = MCP_PCTS.map((pct) => ({
    pct,
    area: ind.mcpAreas?.[`${pct}`] != null ? ind.mcpAreas[`${pct}`] * 1e6 : 0,
  })).filter((d) => d.area > 0);
  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          MPC — Area vs Porcentaje
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="pct" label={{ value: "Home-range level (%)", position: "insideBottom", offset: -5, fontSize: 11 }} tick={{ fontSize: 10 }} />
              <YAxis label={{ value: "Home-range size (m²)", angle: -90, position: "insideLeft", fontSize: 11 }} tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [v.toLocaleString("es-ES", { maximumFractionDigits: 2 }), "Area (m²)"]}
                labelFormatter={(l) => `${l}%`}
              />
              <Line type="monotone" dataKey="area" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function SingleAnimalMetrics({ ind, bandwidthMethod, kernelPcts }: { ind: any; bandwidthMethod: string; kernelPcts?: number[] }) {
  const effectiveKernelPcts = kernelPcts && kernelPcts.length > 0
    ? kernelPcts
    : Object.keys(ind.kernelHrefAreas || {}).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const hasBoth = bandwidthMethod === "both";
  const hasLscv = bandwidthMethod === "lscv" || hasBoth;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Datos generales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Localizaciones:</span>{" "}
              <span className="font-medium" data-testid="text-metric-locations">{ind.locations?.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Dias de analisis:</span>{" "}
              <span className="font-medium" data-testid="text-metric-days">{ind.analysisDays}</span>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <span className="text-muted-foreground">Periodo:</span>{" "}
              <span className="font-medium" data-testid="text-metric-period">
                {ind.firstDate ? format(new Date(ind.firstDate), "dd/MM/yyyy") : "—"} — {ind.lastDate ? format(new Date(ind.lastDate), "dd/MM/yyyy") : "—"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Distancias</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Total recorrido:</span>{" "}
              <span className="font-medium" data-testid="text-metric-total-dist">{ind.totalDistanceKm} km</span>
            </div>
            <div>
              <span className="text-muted-foreground">Entre loc. min:</span>{" "}
              <span className="font-medium">{ind.minConsecutiveDistKm} km</span>
            </div>
            <div>
              <span className="text-muted-foreground">Entre loc. max:</span>{" "}
              <span className="font-medium">{ind.maxConsecutiveDistKm} km</span>
            </div>
            <div>
              <span className="text-muted-foreground">Diaria min:</span>{" "}
              <span className="font-medium">{ind.minDailyDistKm} km</span>
            </div>
            <div>
              <span className="text-muted-foreground">Diaria max:</span>{" "}
              <span className="font-medium">{ind.maxDailyDistKm} km</span>
            </div>
            <div>
              <span className="text-muted-foreground">Diaria media:</span>{" "}
              <span className="font-medium">{ind.avgDailyDistKm} km</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Forma del movimiento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <VisualBar value={ind.eccentricity} label="Excentricidad (0=circular, 1=elongado)" />
          <VisualBar value={ind.linearity} label="Linearidad (0=sinuoso, 1=lineal)" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Home Range (HREF) — H = {ind.hHref}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AreaTable areas={ind.kernelHrefAreas} pcts={effectiveKernelPcts} title="HREF" />
        </CardContent>
      </Card>

      <HrrefChart ind={ind} pcts={effectiveKernelPcts} />

      {hasLscv && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Home Range (LSCV) — H = {ind.hLscv ?? "—"}
              {ind.lscvConverged === false && (
                <span className="text-xs text-amber-500 ml-2 font-normal">LSCV no convergio, se uso HREF como fallback</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <AreaTable areas={ind.kernelLscvAreas || ind.kernelHrefAreas} pcts={effectiveKernelPcts} title="LSCV" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">MCP</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AreaTable areas={ind.mcpAreas} pcts={MCP_PCTS} title="MCP" />
        </CardContent>
      </Card>

      <McpChart ind={ind} />
    </div>
  );
}

function ComparisonTable({ data }: { data: any }) {
  const perInd = data.perIndividual || [];
  const hasBoth = data.bandwidthMethod === "both";
  const hasLscv = data.bandwidthMethod === "lscv" || hasBoth;

  const metrics: { label: string; key: string; format?: (v: any) => string }[] = [
    { label: "Localizaciones", key: "locations" },
    { label: "Dias de analisis", key: "analysisDays" },
    { label: "Periodo", key: "_period", format: (ind: any) => {
      const s = ind.firstDate ? format(new Date(ind.firstDate), "dd/MM/yy") : "—";
      const e = ind.lastDate ? format(new Date(ind.lastDate), "dd/MM/yy") : "—";
      return `${s} — ${e}`;
    }},
    { label: "Distancia total (km)", key: "totalDistanceKm" },
    { label: "Dist. min entre loc. (km)", key: "minConsecutiveDistKm" },
    { label: "Dist. max entre loc. (km)", key: "maxConsecutiveDistKm" },
    { label: "Dist. min diaria (km)", key: "minDailyDistKm" },
    { label: "Dist. max diaria (km)", key: "maxDailyDistKm" },
    { label: "Dist. media diaria (km)", key: "avgDailyDistKm" },
    { label: "Excentricidad", key: "eccentricity" },
    { label: "Linearidad", key: "linearity" },
    { label: "H (HREF)", key: "hHref" },
  ];

  if (hasLscv) {
    metrics.push({ label: "H (LSCV)", key: "hLscv", format: (ind: any) => ind.hLscv ?? "—" });
    metrics.push({ label: "LSCV convergido", key: "lscvConverged", format: (ind: any) => ind.lscvConverged ? "Si" : "No" });
  }

  const dataKernelPcts = deriveKernelPcts(data);
  for (const pct of dataKernelPcts) {
    metrics.push({
      label: `HR HREF ${pct}% (m²)`,
      key: `_hr_href_m2_${pct}`,
      format: (ind: any) => {
        const km2 = ind.kernelHrefAreas?.[`${pct}`];
        return km2 != null ? (km2 * 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—";
      },
    });
    metrics.push({
      label: `HR HREF ${pct}% (km²)`,
      key: `_hr_href_${pct}`,
      format: (ind: any) => ind.kernelHrefAreas?.[`${pct}`] ?? "—",
    });
  }

  if (hasBoth) {
    for (const pct of dataKernelPcts) {
      metrics.push({
        label: `HR LSCV ${pct}% (m²)`,
        key: `_hr_lscv_m2_${pct}`,
        format: (ind: any) => {
          const km2 = ind.kernelLscvAreas?.[`${pct}`];
          return km2 != null ? (km2 * 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—";
        },
      });
      metrics.push({
        label: `HR LSCV ${pct}% (km²)`,
        key: `_hr_lscv_${pct}`,
        format: (ind: any) => ind.kernelLscvAreas?.[`${pct}`] ?? "—",
      });
    }
  }

  for (const pct of MCP_PCTS) {
    metrics.push({
      label: `MCP ${pct}% (m²)`,
      key: `_mcp_m2_${pct}`,
      format: (ind: any) => {
        const km2 = ind.mcpAreas?.[`${pct}`];
        return km2 != null ? (km2 * 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—";
      },
    });
    metrics.push({
      label: `MCP ${pct}% (km²)`,
      key: `_mcp_${pct}`,
      format: (ind: any) => ind.mcpAreas?.[`${pct}`] ?? "—",
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Comparacion multi-animal
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card z-10 min-w-[180px]">Metrica</TableHead>
                {perInd.map((ind: any) => (
                  <TableHead key={ind.individual} className="min-w-[120px] text-center">
                    {ind.individual}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m) => (
                <TableRow key={m.key}>
                  <TableCell className="sticky left-0 bg-card z-10 text-xs font-medium">{m.label}</TableCell>
                  {perInd.map((ind: any) => (
                    <TableCell key={ind.individual} className="text-center text-xs">
                      {m.format ? m.format(ind) : ind[m.key] ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsPanel({ data }: { data: any }) {
  if (data.analysisType === "mcp") {
    const areas = data.areas || [];
    const totalArea = areas.reduce((s: number, a: any) => s + (a.area_km2 || 0), 0);
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapIcon className="w-3.5 h-3.5" />
              <span className="text-xs">Animales</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-animals">{areas.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Ruler className="w-3.5 h-3.5" />
              <span className="text-xs">Area total</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-total-area">{totalArea.toFixed(3)} km²</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-xs">Promedio</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-avg-area">
              {areas.length > 0 ? (totalArea / areas.length).toFixed(3) : "0"} km²
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.analysisType === "kernel") {
    const areas = data.areas || [];
    const pcts = deriveKernelPcts(data);
    const totals: Record<number, number> = {};
    for (const p of pcts) {
      totals[p] = areas.reduce((s: number, a: any) => s + (getKernelAreaForPct(a, p) || 0), 0);
    }
    const maxPct = pcts[pcts.length - 1];
    const minPct = pcts[0];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="metrics-kernel-summary">
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapIcon className="w-3.5 h-3.5" />
              <span className="text-xs">Animales</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-kernel-animals">{areas.length}</p>
          </CardContent>
        </Card>
        {pcts.map((p) => (
          <Card key={p}>
            <CardContent className="py-4 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: kernelColor(p, pcts) }} />
                <span className="text-xs">Area {p}%</span>
              </div>
              <p className="text-xl font-bold" data-testid={`text-metric-area-${p}`}>{totals[p].toFixed(3)} km²</p>
            </CardContent>
          </Card>
        ))}
        {pcts.length >= 2 && totals[maxPct] > 0 && (
          <Card>
            <CardContent className="py-4 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Activity className="w-3.5 h-3.5" />
                <span className="text-xs">Ratio {minPct}/{maxPct}</span>
              </div>
              <p className="text-xl font-bold" data-testid="text-metric-ratio">
                {((totals[minPct] / totals[maxPct]) * 100).toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (data.analysisType === "distance") {
    const inds = data.individuals || [];
    const totalKm = inds.reduce((s: number, i: any) => s + (i.total_km || 0), 0);
    const avgDaily = inds.reduce((s: number, i: any) => s + (i.average_daily_km || 0), 0) / Math.max(inds.length, 1);
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Ruler className="w-3.5 h-3.5" />
              <span className="text-xs">Distancia total</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-total-dist">{totalKm.toFixed(1)} km</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-xs">Promedio diario</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-avg-daily">{avgDaily.toFixed(1)} km</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapIcon className="w-3.5 h-3.5" />
              <span className="text-xs">Animales</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-dist-animals">{inds.length}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.analysisType === "speed") {
    const inds = data.individuals || [];
    const avgKmh = inds.reduce((s: number, i: any) => s + (i.average_kmh || 0), 0) / Math.max(inds.length, 1);
    const maxKmh = Math.max(0, ...inds.map((i: any) => i.max_kmh || 0));
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Gauge className="w-3.5 h-3.5" />
              <span className="text-xs">Velocidad media</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-avg-speed">{avgKmh.toFixed(1)} km/h</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Gauge className="w-3.5 h-3.5" />
              <span className="text-xs">Velocidad maxima</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-max-speed">{maxKmh.toFixed(1)} km/h</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapIcon className="w-3.5 h-3.5" />
              <span className="text-xs">Animales</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-speed-animals">{inds.length}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

function AnalysisResultTable({ data }: { data: any }) {
  if (data.analysisType === "mcp") {
    const areas = data.areas || [];
    if (areas.length === 0) return null;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle por animal: MCP</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  <TableHead>Area (km²)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {areas.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell>{item.area_km2?.toFixed(3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.analysisType === "kernel") {
    const areas = data.areas || [];
    if (areas.length === 0) return null;
    const pcts = deriveKernelPcts(data);
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle por animal: Kernel</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  {pcts.map((p) => (
                    <TableHead key={p}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: kernelColor(p, pcts) }} />
                        Area {p}% (km²)
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {areas.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    {pcts.map((p) => {
                      const v = getKernelAreaForPct(item, p);
                      return (
                        <TableCell key={p} data-testid={`cell-kernel-${item.individual}-${p}`}>
                          {v != null ? v.toFixed(3) : "—"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.analysisType === "distance") {
    const inds = data.individuals || [];
    if (inds.length === 0) return null;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle por animal: Distancia</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  <TableHead>Distancia total (km)</TableHead>
                  <TableHead>Promedio diario (km)</TableHead>
                  <TableHead>Distancia neta (inicio→fin) (km)</TableHead>
                  <TableHead>Índice de linealidad</TableHead>
                  <TableHead>Dias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inds.map((item: any, idx: number) => (
                  <TableRow key={idx} data-testid={`row-distance-${item.individual}`}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell data-testid={`text-total-km-${item.individual}`}>{item.total_km?.toFixed(3)}</TableCell>
                    <TableCell>{item.average_daily_km?.toFixed(3)}</TableCell>
                    <TableCell data-testid={`text-net-displacement-${item.individual}`}>
                      {typeof item.net_displacement_km === "number" ? item.net_displacement_km.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell data-testid={`text-linearity-${item.individual}`}>
                      {typeof item.linearity_index === "number" ? item.linearity_index.toFixed(3) : "—"}
                    </TableCell>
                    <TableCell>{item.daily?.length || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.analysisType === "speed") {
    const inds = data.individuals || [];
    if (inds.length === 0) return null;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle por animal: Velocidad</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  <TableHead>Velocidad media (km/h)</TableHead>
                  <TableHead>Velocidad max (km/h)</TableHead>
                  <TableHead>Mediciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inds.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell>{item.average_kmh?.toFixed(2)}</TableCell>
                    <TableCell>{item.max_kmh?.toFixed(2)}</TableCell>
                    <TableCell>{item.speeds?.length || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function DistanceChart({ data }: { data: any }) {
  const inds = data.individuals || [];
  if (inds.length === 0) return null;

  const allDates = new Set<string>();
  for (const ind of inds) {
    for (const d of ind.daily || []) {
      allDates.add(d.date);
    }
  }
  const dates = Array.from(allDates).sort();
  if (dates.length === 0) return null;

  const chartData = dates.map((date) => {
    const row: any = { date };
    for (const ind of inds) {
      const entry = (ind.daily || []).find((d: any) => d.date === date);
      row[ind.individual] = entry ? entry.distance_km : 0;
    }
    return row;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Distancia diaria (km)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend />
              {inds.map((ind: any, idx: number) => (
                <Bar
                  key={ind.individual}
                  dataKey={ind.individual}
                  fill={ANIMAL_COLORS[idx % ANIMAL_COLORS.length]}
                  name={ind.individual}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function SpeedChart({ data }: { data: any }) {
  const inds = data.individuals || [];
  if (inds.length === 0) return null;

  const allTimestamps = new Set<number>();
  for (const ind of inds) {
    for (const s of ind.speeds || []) {
      allTimestamps.add(s.timestamp);
    }
  }
  const timestamps = Array.from(allTimestamps).sort((a, b) => a - b);
  if (timestamps.length === 0) return null;

  const maxPoints = 500;
  const step = Math.max(1, Math.floor(timestamps.length / maxPoints));
  const sampledTs = timestamps.filter((_, i) => i % step === 0);

  const mergedData = sampledTs.map((ts) => {
    const row: any = { time: format(new Date(ts), "dd/MM HH:mm"), timestamp: ts };
    for (const ind of inds) {
      const point = (ind.speeds || []).find((s: any) => s.timestamp === ts);
      if (point) row[ind.individual] = point.speed_kmh;
    }
    return row;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Velocidad en el tiempo (km/h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend />
              {inds.map((ind: any, idx: number) => (
                <Line
                  key={ind.individual}
                  type="monotone"
                  dataKey={ind.individual}
                  stroke={ANIMAL_COLORS[idx % ANIMAL_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  name={ind.individual}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
