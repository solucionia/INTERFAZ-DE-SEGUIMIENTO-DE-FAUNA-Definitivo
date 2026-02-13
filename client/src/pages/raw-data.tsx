import { useState, useMemo, useRef, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Study, Individual } from "@shared/schema";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Download, Loader2, MapPin, Activity, ChevronLeft, ChevronRight, FileDown,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { QuickDateRange, type QuickRange } from "@/components/quick-date-range";

const SENSOR_GPS = 653;
const SENSOR_ACC = 2365683;
const PAGE_SIZE = 100;

interface GpsRow {
  timestamp: string;
  location_lat: string;
  location_long: string;
  ground_speed?: string;
  heading?: string;
  [key: string]: string | undefined;
}

interface AccRow {
  timestamp: string;
  accelerations_raw?: string;
  eobs_accelerations_raw?: string;
  acceleration_x?: string;
  acceleration_y?: string;
  acceleration_z?: string;
  [key: string]: string | undefined;
}

function downloadCSV(data: Record<string, string | undefined>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map((row) => headers.map((h) => `"${(row[h] || "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RawData() {
  const [, params] = useRoute("/study/:id/data");
  const studyId = params?.id;
  const { toast } = useToast();

  const [selectedAnimal, setSelectedAnimal] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>(null);
  const [autoLoadEnabled, setAutoLoadEnabled] = useState(false);
  const pendingAutoLoad = useRef(false);
  const [gpsRows, setGpsRows] = useState<GpsRow[]>([]);
  const [accRows, setAccRows] = useState<AccRow[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [gpsPage, setGpsPage] = useState(0);
  const [accPage, setAccPage] = useState(0);

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

  const loadData = async () => {
    if (!studyId || !selectedAnimal || !dateStart || !dateEnd) {
      toast({ title: "Datos incompletos", description: "Seleccione animal y rango de fechas", variant: "destructive" });
      return;
    }
    const tsStart = new Date(dateStart).getTime();
    const tsEnd = new Date(dateEnd + "T23:59:59").getTime();
    setLoading(true);
    setDataLoaded(false);

    try {
      const baseParams = `individuals=${encodeURIComponent(selectedAnimal)}&timestamp_start=${tsStart}&timestamp_end=${tsEnd}`;
      const [gpsRes, accRes] = await Promise.all([
        fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_GPS}`, { credentials: "include" }),
        fetch(`/api/studies/${studyId}/events?${baseParams}&sensor_type=${SENSOR_ACC}`, { credentials: "include" }),
      ]);

      if (gpsRes.status === 429 || accRes.status === 429) {
        const errBody = await (gpsRes.status === 429 ? gpsRes : accRes).json().catch(() => ({}));
        toast({ title: "Limite de peticiones", description: errBody.message || "Movebank ha limitado las peticiones temporalmente. Intente de nuevo mas tarde.", variant: "destructive" });
        return;
      }

      if (!gpsRes.ok || !accRes.ok) throw new Error("Error al obtener datos");

      const gpsRaw = await gpsRes.json();
      const accRaw = await accRes.json();

      setGpsRows(gpsRaw[selectedAnimal] || []);
      setAccRows(accRaw[selectedAnimal] || []);
      setDataLoaded(true);
      setGpsPage(0);
      setAccPage(0);

      const gpsCount = (gpsRaw[selectedAnimal] || []).length;
      const accCount = (accRaw[selectedAnimal] || []).length;
      toast({ title: "Datos cargados", description: `${gpsCount} registros GPS, ${accCount} registros de acelerometro` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRange = (range: QuickRange, start: string, end: string) => {
    setDateStart(start);
    setDateEnd(end);
    setActiveQuickRange(range);
    if (autoLoadEnabled && selectedAnimal) {
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
    if (pendingAutoLoad.current && dateStart && dateEnd && selectedAnimal && !loading) {
      pendingAutoLoad.current = false;
      loadData();
    }
  }, [dateStart, dateEnd]);

  const pagedGps = gpsRows.slice(gpsPage * PAGE_SIZE, (gpsPage + 1) * PAGE_SIZE);
  const gpsTotalPages = Math.ceil(gpsRows.length / PAGE_SIZE);
  const pagedAcc = accRows.slice(accPage * PAGE_SIZE, (accPage + 1) * PAGE_SIZE);
  const accTotalPages = Math.ceil(accRows.length / PAGE_SIZE);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[
        { label: study?.name || "Estudio", href: `/study/${studyId}` },
        { label: "Datos brutos" },
      ]} />

      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-raw-data-title">
          Datos brutos — {study?.name || "Cargando..."}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta y exporta datos GPS y de acelerometro
        </p>
      </div>

      <Card>
        <CardContent className="pt-5 pb-4 px-5 space-y-3">
          <QuickDateRange
            activeRange={activeQuickRange}
            onRangeSelect={handleQuickRange}
            autoLoad={autoLoadEnabled}
            onAutoLoadChange={setAutoLoadEnabled}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Animal</Label>
              <select
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={selectedAnimal}
                onChange={(e) => setSelectedAnimal(e.target.value)}
                data-testid="select-animal"
              >
                <option value="">Seleccionar...</option>
                {selectableAnimals.map((ind) => (
                  <option key={ind.id} value={ind.localIdentifier!}>{ind.localIdentifier}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={dateStart} onChange={(e) => handleDateStartChange(e.target.value)} className="w-40" data-testid="input-raw-date-start" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={dateEnd} onChange={(e) => handleDateEndChange(e.target.value)} className="w-40" data-testid="input-raw-date-end" />
            </div>
            <Button onClick={loadData} disabled={loading || !selectedAnimal} data-testid="button-load-raw-data">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Cargar datos
            </Button>
          </div>
        </CardContent>
      </Card>

      {dataLoaded && (
        <Tabs defaultValue="gps" className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <TabsList>
              <TabsTrigger value="gps" data-testid="tab-gps">
                <MapPin className="w-4 h-4 mr-1.5" />
                GPS ({gpsRows.length})
              </TabsTrigger>
              <TabsTrigger value="acc" data-testid="tab-acc">
                <Activity className="w-4 h-4 mr-1.5" />
                Acelerometro ({accRows.length})
              </TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => downloadCSV(gpsRows, `${selectedAnimal}_gps.csv`)} disabled={gpsRows.length === 0} data-testid="button-export-gps-csv">
                <FileDown className="w-4 h-4 mr-1.5" />
                Exportar GPS CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadCSV(accRows, `${selectedAnimal}_acc.csv`)} disabled={accRows.length === 0} data-testid="button-export-acc-csv">
                <FileDown className="w-4 h-4 mr-1.5" />
                Exportar Acc CSV
              </Button>
            </div>
          </div>

          <TabsContent value="gps">
            <Card>
              <CardContent className="p-0">
                {gpsRows.length > 0 ? (
                  <>
                    <div className="overflow-auto max-h-[500px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Latitud</TableHead>
                            <TableHead>Longitud</TableHead>
                            <TableHead>Velocidad</TableHead>
                            <TableHead>Rumbo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pagedGps.map((row, i) => (
                            <TableRow key={i} data-testid={`row-gps-${i}`}>
                              <TableCell className="text-sm">{row.timestamp || "-"}</TableCell>
                              <TableCell className="text-sm font-mono">{row.location_lat || "-"}</TableCell>
                              <TableCell className="text-sm font-mono">{row.location_long || "-"}</TableCell>
                              <TableCell className="text-sm">{row.ground_speed || "-"}</TableCell>
                              <TableCell className="text-sm">{row.heading || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {gpsTotalPages > 1 && (
                      <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
                        <span className="text-sm text-muted-foreground">Pagina {gpsPage + 1} de {gpsTotalPages}</span>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" onClick={() => setGpsPage((p) => Math.max(0, p - 1))} disabled={gpsPage === 0}>
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => setGpsPage((p) => Math.min(gpsTotalPages - 1, p + 1))} disabled={gpsPage >= gpsTotalPages - 1}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <MapPin className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No hay datos GPS para este rango</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="acc">
            <Card>
              <CardContent className="p-0">
                {accRows.length > 0 ? (
                  <>
                    <div className="overflow-auto max-h-[500px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Datos crudos</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pagedAcc.map((row, i) => (
                            <TableRow key={i} data-testid={`row-acc-${i}`}>
                              <TableCell className="text-sm">{row.timestamp || "-"}</TableCell>
                              <TableCell className="text-sm font-mono max-w-md truncate">
                                {row.accelerations_raw || row.eobs_accelerations_raw || `X:${row.acceleration_x} Y:${row.acceleration_y} Z:${row.acceleration_z}` || "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {accTotalPages > 1 && (
                      <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
                        <span className="text-sm text-muted-foreground">Pagina {accPage + 1} de {accTotalPages}</span>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" onClick={() => setAccPage((p) => Math.max(0, p - 1))} disabled={accPage === 0}>
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => setAccPage((p) => Math.min(accTotalPages - 1, p + 1))} disabled={accPage >= accTotalPages - 1}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <Activity className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No hay datos de acelerometro para este rango</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {!dataLoaded && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="w-16 h-16 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Selecciona un animal y rango de fechas para ver los datos brutos</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
