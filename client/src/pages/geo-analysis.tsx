import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useAuth } from "@/lib/auth";
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
  MapPin,
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
    setResultData({
      analysisType: analysis.analysisType,
      areas: analysis.resultData,
      summary: analysis.resultData,
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

    if (resultData.analysisType === "mcp" || resultData.analysisType === "kernel") {
      const areas = resultData.areas;
      if (Array.isArray(areas)) {
        const keys = Object.keys(areas[0] || {});
        csv = keys.join(",") + "\n";
        for (const row of areas) {
          csv += keys.map((k) => row[k] ?? "").join(",") + "\n";
        }
      }
    } else if (resultData.analysisType === "distance") {
      const daily = resultData.dailyDistances || [];
      csv = "individual,date,distance_km\n";
      for (const d of daily) {
        csv += `${d.individual},${d.date},${d.distance_km}\n`;
      }
    } else if (resultData.analysisType === "speed") {
      const series = resultData.speedSeries || [];
      csv = "individual,timestamp,speed_kmh\n";
      for (const s of series) {
        csv += `${s.individual},${new Date(s.timestamp).toISOString()},${s.speed_kmh}\n`;
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

  const canExecute = selectedAnimals.length > 0 && dateStart && dateEnd;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-analysis-title">
            Analisis geoespacial
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analisis estadisticos con adehabitatHR/LT (R)
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
              <Label>Fecha inicio</Label>
              <Input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                data-testid="input-date-start"
              />
            </div>

            <div className="space-y-2">
              <Label>Fecha fin</Label>
              <Input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                data-testid="input-date-end"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Animales</Label>
                <Button variant="ghost" size="sm" onClick={selectAllAnimals} data-testid="button-select-all">
                  Todos
                </Button>
              </div>
              {loadingIndividuals ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {individuals?.filter((i) => i.localIdentifier).map((ind, idx) => (
                    <label
                      key={ind.id}
                      className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover-elevate"
                      data-testid={`checkbox-animal-${ind.localIdentifier}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAnimals.includes(ind.localIdentifier!)}
                        onChange={() => toggleAnimal(ind.localIdentifier!)}
                        className="rounded"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: ANIMAL_COLORS[idx % ANIMAL_COLORS.length] }}
                      />
                      <span className="truncate">{ind.localIdentifier}</span>
                    </label>
                  ))}
                </div>
              )}
              {selectedAnimals.length > 0 && (
                <p className="text-xs text-muted-foreground">{selectedAnimals.length} seleccionado(s)</p>
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
                  Ejecutando R...
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
                <p className="text-sm font-medium">Ejecutando analisis en R...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Obteniendo datos de Movebank y procesando con adehabitat
                </p>
              </CardContent>
            </Card>
          )}

          {resultData && !analysisMutation.isPending && (
            <>
              <AnalysisResultSummary data={resultData} />

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
                            const percent = feature?.properties?.percent;
                            const idx = resultData.geojson.features.indexOf(feature) || 0;
                            const color = ANIMAL_COLORS[idx % ANIMAL_COLORS.length];
                            return {
                              color,
                              weight: 2,
                              opacity: 0.8,
                              fillColor: color,
                              fillOpacity: percent === 50 ? 0.4 : 0.15,
                            };
                          }}
                          onEachFeature={(feature: any, layer: any) => {
                            const props = feature.properties || {};
                            let popup = `<b>${props.id || "Animal"}</b>`;
                            if (props.area_km2 !== undefined) popup += `<br/>Area: ${props.area_km2.toFixed(2)} km²`;
                            if (props.area !== undefined) popup += `<br/>Area: ${(props.area / 100).toFixed(2)} km²`;
                            if (props.percent !== undefined) popup += `<br/>Nivel: ${props.percent}%`;
                            layer.bindPopup(popup);
                          }}
                        />
                        <FitBounds geojson={resultData.geojson} />
                      </MapContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(resultData.analysisType === "distance" || resultData.dailyDistances) && (
                <DistanceChart data={resultData} />
              )}

              {(resultData.analysisType === "speed" || resultData.speedSeries) && (
                <SpeedChart data={resultData} />
              )}
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

function AnalysisResultSummary({ data }: { data: any }) {
  const areas = data.areas || data.summary;
  if (!areas) return null;

  const isList = Array.isArray(areas);
  const items = isList ? areas : [areas];

  if (items.length === 0) return null;

  if (data.analysisType === "mcp" || data.analysisType === "kernel") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resultados: {ANALYSIS_LABELS[data.analysisType as AnalysisType]}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  {data.analysisType === "mcp" && (
                    <>
                      <TableHead>Area (km²)</TableHead>
                      <TableHead>Porcentaje</TableHead>
                    </>
                  )}
                  {data.analysisType === "kernel" && (
                    <>
                      <TableHead>Area 50% (km²)</TableHead>
                      <TableHead>Area 95% (km²)</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual || item.id || `#${idx + 1}`}</TableCell>
                    {data.analysisType === "mcp" && (
                      <>
                        <TableCell>{typeof item.area_km2 === "number" ? item.area_km2.toFixed(3) : "—"}</TableCell>
                        <TableCell>{data.percent || 95}%</TableCell>
                      </>
                    )}
                    {data.analysisType === "kernel" && (
                      <>
                        <TableCell>{typeof item.area_50_km2 === "number" ? item.area_50_km2.toFixed(3) : "—"}</TableCell>
                        <TableCell>{typeof item.area_95_km2 === "number" ? item.area_95_km2.toFixed(3) : "—"}</TableCell>
                      </>
                    )}
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
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resultados: Distancia recorrida</CardTitle>
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
                  <TableHead>Puntos GPS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell>{item.total_km}</TableCell>
                    <TableCell>{item.avg_daily_km}</TableCell>
                    <TableCell>{item.n_days}</TableCell>
                    <TableCell>{item.n_points}</TableCell>
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
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resultados: Velocidad de movimiento</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  <TableHead>Velocidad media (km/h)</TableHead>
                  <TableHead>Velocidad max (km/h)</TableHead>
                  <TableHead>Mediana (km/h)</TableHead>
                  <TableHead>Segmentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.individual}</TableCell>
                    <TableCell>{item.mean_speed_kmh}</TableCell>
                    <TableCell>{item.max_speed_kmh}</TableCell>
                    <TableCell>{item.median_speed_kmh}</TableCell>
                    <TableCell>{item.n_segments}</TableCell>
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
  const daily = data.dailyDistances || [];
  if (daily.length === 0) return null;

  const individuals = Array.from(new Set(daily.map((d: any) => d.individual))) as string[];
  const dates = Array.from(new Set(daily.map((d: any) => d.date))) as string[];
  dates.sort();

  const chartData = dates.map((date) => {
    const row: any = { date };
    for (const ind of individuals) {
      const entry = daily.find((d: any) => d.date === date && d.individual === ind);
      row[ind] = entry ? entry.distance_km : 0;
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
              {individuals.map((ind, idx) => (
                <Bar
                  key={ind}
                  dataKey={ind}
                  fill={ANIMAL_COLORS[idx % ANIMAL_COLORS.length]}
                  name={ind}
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
  const series = data.speedSeries || [];
  if (series.length === 0) return null;

  const individuals = Array.from(new Set(series.map((s: any) => s.individual))) as string[];

  const chartData = series
    .sort((a: any, b: any) => a.timestamp - b.timestamp)
    .map((s: any) => ({
      ...s,
      time: format(new Date(s.timestamp), "dd/MM HH:mm"),
    }));

  const grouped: Record<string, any[]> = {};
  for (const ind of individuals) {
    grouped[ind] = chartData.filter((d: any) => d.individual === ind);
  }

  const mergedData: any[] = [];
  const allTimes = Array.from(new Set(chartData.map((d: any) => d.timestamp))) as number[];
  allTimes.sort((a, b) => a - b);

  for (const ts of allTimes) {
    const row: any = { time: format(new Date(ts), "dd/MM HH:mm"), timestamp: ts };
    for (const ind of individuals) {
      const point = series.find((s: any) => s.timestamp === ts && s.individual === ind);
      if (point) row[ind] = point.speed_kmh;
    }
    mergedData.push(row);
  }

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
              {individuals.map((ind, idx) => (
                <Line
                  key={ind}
                  type="monotone"
                  dataKey={ind}
                  stroke={ANIMAL_COLORS[idx % ANIMAL_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  name={ind}
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
