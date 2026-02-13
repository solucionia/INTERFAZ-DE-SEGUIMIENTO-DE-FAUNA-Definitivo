import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Individual, SavedAnalysis } from "@shared/schema";
import { ANALYSIS_LABELS, type AnalysisType } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
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

const ANIMAL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

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
  const { toast } = useToast();

  const [selectedAnimals, setSelectedAnimals] = useState<string[]>([]);
  const [analysisType, setAnalysisType] = useState<AnalysisType>("mcp");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [mcpPercent, setMcpPercent] = useState("95");
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>(null);
  const [autoLoadEnabled, setAutoLoadEnabled] = useState(false);
  const pendingAutoLoad = useRef(false);
  const [resultData, setResultData] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: individuals, isLoading: loadingIndividuals } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    queryFn: async () => {
      const res = await fetch(`/api/studies/${studyId}/individuals`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando individuos");
      return res.json();
    },
    enabled: !!studyId,
  });

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
      const tsEnd = new Date(dateEnd).getTime();
      if (isNaN(tsStart) || isNaN(tsEnd)) throw new Error("Fechas invalidas");

      const body: any = {
        analysisType,
        individuals: selectedAnimals,
        timestampStart: tsStart,
        timestampEnd: tsEnd,
      };
      if (analysisType === "mcp") {
        body.params = { percent: parseInt(mcpPercent, 10) };
      }

      const res = await apiRequest("POST", `/api/studies/${studyId}/analysis`, body);
      return res.json();
    },
    onSuccess: (data) => {
      setResultData(data);
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "analyses"] });
      toast({ title: "Analisis completado", description: `${ANALYSIS_LABELS[analysisType]} ejecutado exitosamente` });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteAnalysisMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/analyses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "analyses"] });
      toast({ title: "Analisis eliminado" });
    },
  });

  const toggleAnimal = (localId: string) => {
    setSelectedAnimals((prev) =>
      prev.includes(localId) ? prev.filter((a) => a !== localId) : [...prev, localId]
    );
  };

  const selectAllAnimals = () => {
    if (!individuals) return;
    const all = individuals.filter((i) => i.localIdentifier).map((i) => i.localIdentifier!);
    setSelectedAnimals(all);
  };

  const loadSavedResult = async (analysis: SavedAnalysis) => {
    const saved = analysis.resultData as any;
    setResultData({
      ...saved,
      geojson: analysis.resultGeojson,
    });
    setAnalysisType(analysis.analysisType as AnalysisType);
    setSelectedAnimals(analysis.individuals);
    const start = new Date(analysis.timestampStart);
    const end = new Date(analysis.timestampEnd);
    setDateStart(format(start, "yyyy-MM-dd"));
    setDateEnd(format(end, "yyyy-MM-dd"));
    toast({ title: "Analisis cargado" });
  };

  const exportCsv = () => {
    if (!resultData) return;
    let csv = "";

    if (resultData.analysisType === "mcp") {
      csv = "individual,area_km2\n";
      for (const a of resultData.areas || []) {
        csv += `${a.individual},${a.area_km2}\n`;
      }
    } else if (resultData.analysisType === "kernel") {
      csv = "individual,area_95_km2,area_50_km2\n";
      for (const a of resultData.areas || []) {
        csv += `${a.individual},${a.area_95_km2},${a.area_50_km2}\n`;
      }
    } else if (resultData.analysisType === "distance") {
      csv = "individual,date,distance_km\n";
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
          {resultData && (
            <Button variant="outline" onClick={exportCsv} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-2" />
              Exportar CSV
            </Button>
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
                  <SelectItem value="mcp">Home Range (MCP)</SelectItem>
                  <SelectItem value="kernel">Home Range (Kernel)</SelectItem>
                  <SelectItem value="distance">Distancia recorrida</SelectItem>
                  <SelectItem value="speed">Velocidad de movimiento</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
              <Label>Animales</Label>
              {loadingIndividuals ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : (
                <AnimalSearch
                  individuals={individuals?.filter((i) => i.localIdentifier) || []}
                  selected={selectedAnimals}
                  onChange={setSelectedAnimals}
                  multiple
                  placeholder="Buscar animal..."
                />
              )}
            </div>

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
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {analysisMutation.isPending && (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="w-10 h-10 mx-auto mb-3 animate-spin text-primary" />
                <p className="text-sm font-medium">Ejecutando analisis...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Obteniendo datos de Movebank y procesando analisis geoespacial
                </p>
              </CardContent>
            </Card>
          )}

          {resultData && !analysisMutation.isPending && (
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
                  <CardContent>
                    <div className="h-[400px] rounded-md overflow-hidden border">
                      <MapContainer
                        center={[0, 0]}
                        zoom={2}
                        style={{ height: "100%", width: "100%" }}
                        key={JSON.stringify(resultData.geojson).slice(0, 100)}
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <GeoJSON
                          data={resultData.geojson}
                          style={(feature: any) => {
                            const props = feature?.properties || {};
                            if (props.type === "mcp") {
                              return {
                                color: "#3b82f6",
                                weight: 2,
                                opacity: 0.8,
                                fillColor: "#3b82f6",
                                fillOpacity: 0.3,
                              };
                            }
                            if (props.type === "kernel") {
                              if (props.level === "50%") {
                                return {
                                  color: "#ef4444",
                                  weight: 2,
                                  opacity: 0.8,
                                  fillColor: "#ef4444",
                                  fillOpacity: 0.3,
                                };
                              }
                              return {
                                color: "#22c55e",
                                weight: 2,
                                opacity: 0.8,
                                fillColor: "#22c55e",
                                fillOpacity: 0.2,
                              };
                            }
                            const idx = resultData.geojson.features.indexOf(feature) || 0;
                            const color = ANIMAL_COLORS[idx % ANIMAL_COLORS.length];
                            return {
                              color,
                              weight: 2,
                              opacity: 0.8,
                              fillColor: color,
                              fillOpacity: 0.2,
                            };
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
                    {resultData.analysisType === "kernel" && (
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#22c55e", opacity: 0.6 }} />
                          Home Range (95%)
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#ef4444", opacity: 0.6 }} />
                          Core Area (50%)
                        </div>
                      </div>
                    )}
                    {resultData.analysisType === "mcp" && (
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#3b82f6", opacity: 0.6 }} />
                          MCP ({resultData.areas?.[0]?.percent || 95}%)
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {resultData.analysisType === "distance" && (
                <DistanceChart data={resultData} />
              )}

              {resultData.analysisType === "speed" && (
                <SpeedChart data={resultData} />
              )}

              <AnalysisResultTable data={resultData} />
            </>
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
            <p className="text-xl font-bold" data-testid="text-metric-total-area">{totalArea.toFixed(3)} km\u00B2</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-xs">Promedio</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-avg-area">
              {areas.length > 0 ? (totalArea / areas.length).toFixed(3) : "0"} km\u00B2
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.analysisType === "kernel") {
    const areas = data.areas || [];
    const total95 = areas.reduce((s: number, a: any) => s + (a.area_95_km2 || 0), 0);
    const total50 = areas.reduce((s: number, a: any) => s + (a.area_50_km2 || 0), 0);
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapIcon className="w-3.5 h-3.5" />
              <span className="text-xs">Animales</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-kernel-animals">{areas.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs">Area 95%</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-area-95">{total95.toFixed(3)} km\u00B2</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
              <span className="text-xs">Area 50%</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-area-50">{total50.toFixed(3)} km\u00B2</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-xs">Ratio 50/95</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-metric-ratio">
              {total95 > 0 ? ((total50 / total95) * 100).toFixed(1) : "0"}%
            </p>
          </CardContent>
        </Card>
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
                  <TableHead>Area (km\u00B2)</TableHead>
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
                  <TableHead>Area 95% (km\u00B2)</TableHead>
                  <TableHead>Area 50% (km\u00B2)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {areas.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell>{item.area_95_km2?.toFixed(3)}</TableCell>
                    <TableCell>{item.area_50_km2?.toFixed(3)}</TableCell>
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
                  <TableHead>Dias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inds.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell>{item.total_km?.toFixed(3)}</TableCell>
                    <TableCell>{item.average_daily_km?.toFixed(3)}</TableCell>
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
