import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Study } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  HeartPulse,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Skull,
  WifiOff,
  CheckCircle2,
  ChevronDown,
  Play,
  MapPin,
  Activity,
  Users,
  ShieldAlert,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { MapLayerControl, GoogleMapsClick, googleMapsLink } from "@/components/map-layers";
import { Breadcrumbs } from "@/components/breadcrumbs";
import "leaflet/dist/leaflet.css";

interface ImmobilityAlert {
  individual: string;
  species: string;
  alertStart: number;
  alertEnd: number;
  hoursImmobile: number;
  daysImmobile: number;
  numRecords: number;
  lastLat: number;
  lastLon: number;
  avgSpeed: number;
  maxSpeed: number;
  googleMapsUrl: string;
  status: string;
  severity: string;
}

interface NoTransmissionAlert {
  individual: string;
  species: string;
  lastTransmission: number | null;
  hoursSinceLast: number | null;
  daysSinceLast: number | null;
  lastLat: number | null;
  lastLon: number | null;
  googleMapsUrl: string | null;
  status: string;
  severity: string;
}

interface ActiveAnimal {
  individual: string;
  species: string;
  lastTransmission: number;
  lastSpeed: number | null;
  lastLat: number;
  lastLon: number;
  status: string;
}

interface AnalysisResult {
  summary: {
    totalAnimals: number;
    transmitting: number;
    noTransmission: number;
    immobile: number;
    criticalAlerts: number;
    analyzedAt: number;
    config: {
      hoursToAnalyze: number;
      immobilityThresholdHours: number;
      noTransmissionThresholdHours: number;
      speedThreshold: number;
      positionChangeThreshold: number;
    };
  };
  immobilityAlerts: ImmobilityAlert[];
  noTransmissionAlerts: NoTransmissionAlert[];
  activeAnimals: ActiveAnimal[];
  stats: {
    totalGpsPoints: number;
    immobilePoints: number;
    immobilityGroups: number;
  };
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MapFitter({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = points.map((p) => [p.lat, p.lng] as [number, number]);
    try {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    } catch {}
  }, [points, map]);
  return null;
}

export default function ImmobilityMonitor() {
  const { toast } = useToast();
  const [selectedStudyId, setSelectedStudyId] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showActiveAnimals, setShowActiveAnimals] = useState(false);

  const [hoursToAnalyze, setHoursToAnalyze] = useState(96);
  const [immobilityThreshold, setImmobilityThreshold] = useState(24);
  const [noTransmissionThreshold, setNoTransmissionThreshold] = useState(48);
  const [speedThreshold, setSpeedThreshold] = useState(0.5);
  const [positionThreshold, setPositionThreshold] = useState(0.0001);

  const { data: studies, isLoading: studiesLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/studies/${selectedStudyId}/immobility-analysis`, {
        hoursToAnalyze,
        immobilityThresholdHours: immobilityThreshold,
        noTransmissionThresholdHours: noTransmissionThreshold,
        speedThreshold,
        positionChangeThreshold: positionThreshold,
      });
      return res.json();
    },
    onSuccess: (data: AnalysisResult) => {
      setResult(data);
      toast({
        title: "Análisis completado",
        description: `${data.summary.immobile} inmóviles, ${data.summary.noTransmission} sin transmisión de ${data.summary.totalAnimals} animales`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error en análisis", description: err.message, variant: "destructive" });
    },
  });

  const mapPoints: { lat: number; lng: number; color: string; label: string; individual: string; species: string; detail: string }[] = [];

  if (result) {
    for (const a of result.immobilityAlerts) {
      mapPoints.push({
        lat: a.lastLat,
        lng: a.lastLon,
        color: "#ef4444",
        label: "INMÓVIL",
        individual: a.individual,
        species: a.species,
        detail: `${a.hoursImmobile}h inmóvil`,
      });
    }
    for (const a of result.noTransmissionAlerts) {
      if (a.lastLat && a.lastLon) {
        mapPoints.push({
          lat: a.lastLat,
          lng: a.lastLon,
          color: "#f97316",
          label: "SIN TRANSMISIÓN",
          individual: a.individual,
          species: a.species,
          detail: a.hoursSinceLast ? `${Math.round(a.hoursSinceLast)}h sin datos` : "Sin datos GPS",
        });
      }
    }
    for (const a of result.activeAnimals) {
      mapPoints.push({
        lat: a.lastLat,
        lng: a.lastLon,
        color: "#22c55e",
        label: "ACTIVO",
        individual: a.individual,
        species: a.species,
        detail: a.lastSpeed != null ? `${a.lastSpeed.toFixed(2)} m/s` : "Activo",
      });
    }
  }

  const breadcrumbs = [
    { label: "Detector de mortalidad" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex items-center gap-3">
        <HeartPulse className="w-7 h-7 text-red-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Detector de Inmovilidad / Mortalidad</h1>
          <p className="text-sm text-muted-foreground">Analiza el movimiento GPS para detectar posible mortalidad o inmovilidad prolongada</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configuración del análisis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Estudio</Label>
              {studiesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedStudyId} onValueChange={setSelectedStudyId} data-testid="select-study">
                  <SelectTrigger data-testid="select-study-trigger">
                    <SelectValue placeholder="Seleccionar estudio..." />
                  </SelectTrigger>
                  <SelectContent>
                    {studies?.map((s) => (
                      <SelectItem key={s.id} value={s.id} data-testid={`select-study-${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Horas a analizar: {hoursToAnalyze}h ({(hoursToAnalyze / 24).toFixed(0)} días)</Label>
              <Slider
                value={[hoursToAnalyze]}
                onValueChange={([v]) => setHoursToAnalyze(v)}
                min={24}
                max={720}
                step={24}
                data-testid="slider-hours"
              />
            </div>

            <div className="space-y-2">
              <Label>Umbral de inmovilidad: {immobilityThreshold}h</Label>
              <Slider
                value={[immobilityThreshold]}
                onValueChange={([v]) => setImmobilityThreshold(v)}
                min={6}
                max={168}
                step={6}
                data-testid="slider-immobility"
              />
            </div>

            <div className="space-y-2">
              <Label>Umbral sin transmisión: {noTransmissionThreshold}h</Label>
              <Slider
                value={[noTransmissionThreshold]}
                onValueChange={([v]) => setNoTransmissionThreshold(v)}
                min={12}
                max={240}
                step={12}
                data-testid="slider-no-transmission"
              />
            </div>

            <div className="space-y-2">
              <Label>Velocidad máxima para inmovilidad: {speedThreshold} m/s</Label>
              <Input
                type="number"
                value={speedThreshold}
                onChange={(e) => setSpeedThreshold(parseFloat(e.target.value) || 0)}
                step={0.1}
                min={0}
                data-testid="input-speed-threshold"
              />
            </div>

            <div className="space-y-2">
              <Label>Cambio de posición mínimo: {positionThreshold}°</Label>
              <Input
                type="number"
                value={positionThreshold}
                onChange={(e) => setPositionThreshold(parseFloat(e.target.value) || 0)}
                step={0.00005}
                min={0}
                data-testid="input-position-threshold"
              />
            </div>

            <Button
              onClick={() => analysisMutation.mutate()}
              disabled={!selectedStudyId || analysisMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
              data-testid="button-run-analysis"
            >
              {analysisMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analizando...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Ejecutar análisis
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {result ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card>
                  <CardContent className="p-3 text-center">
                    <Users className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-2xl font-bold" data-testid="text-total-animals">{result.summary.totalAnimals}</p>
                    <p className="text-xs text-muted-foreground">Total animales</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <Activity className="w-5 h-5 mx-auto mb-1 text-green-500" />
                    <p className="text-2xl font-bold text-green-500" data-testid="text-transmitting">{result.summary.transmitting}</p>
                    <p className="text-xs text-muted-foreground">Transmitiendo</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <WifiOff className="w-5 h-5 mx-auto mb-1 text-orange-500" />
                    <p className="text-2xl font-bold text-orange-500" data-testid="text-no-transmission">{result.summary.noTransmission}</p>
                    <p className="text-xs text-muted-foreground">Sin transmisión</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <Skull className="w-5 h-5 mx-auto mb-1 text-red-500" />
                    <p className="text-2xl font-bold text-red-500" data-testid="text-immobile">{result.summary.immobile}</p>
                    <p className="text-xs text-muted-foreground">Inmóviles</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <ShieldAlert className="w-5 h-5 mx-auto mb-1 text-red-600" />
                    <p className="text-2xl font-bold text-red-600" data-testid="text-critical">{result.summary.criticalAlerts}</p>
                    <p className="text-xs text-muted-foreground">Alertas críticas</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-0 h-[350px]">
                  <MapContainer
                    center={mapPoints.length > 0 ? [mapPoints[0].lat, mapPoints[0].lng] : [0, 0]}
                    zoom={6}
                    style={{ height: "100%", width: "100%" }}
                    data-testid="map-immobility"
                  >
                    <MapLayerControl />
                    <GoogleMapsClick />
                    {mapPoints.length > 0 && (
                      <MapFitter points={mapPoints.map((p) => ({ lat: p.lat, lng: p.lng }))} />
                    )}
                    {mapPoints.map((p, i) => (
                      <CircleMarker
                        key={i}
                        center={[p.lat, p.lng]}
                        radius={p.color === "#ef4444" ? 10 : p.color === "#f97316" ? 8 : 6}
                        pathOptions={{
                          color: p.color,
                          fillColor: p.color,
                          fillOpacity: 0.8,
                          weight: p.color === "#ef4444" ? 3 : 2,
                        }}
                      >
                        <Popup>
                          <div className="text-sm">
                            <p className="font-bold">{p.individual}</p>
                            <p className="text-xs text-gray-500">{p.species}</p>
                            <p style={{ color: p.color, fontWeight: "bold" }}>{p.label}</p>
                            <p>{p.detail}</p>
                            <p className="text-xs">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</p>
                            <a href={googleMapsLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "underline", fontSize: "12px" }}>Ver en Google Maps</a>
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </CardContent>
                <p className="text-[10px] text-muted-foreground mt-1 text-center px-3 pb-2">Clic en el mapa para abrir en Google Maps</p>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <HeartPulse className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-lg font-medium text-muted-foreground">Selecciona un estudio y ejecuta el análisis</p>
                <p className="text-sm text-muted-foreground mt-1">El detector analizará los datos GPS para identificar animales inmóviles o sin transmisión</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          {result.immobilityAlerts.length > 0 && (
            <Card className="border-red-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-red-500">
                  <Skull className="w-5 h-5" />
                  Alertas de Inmovilidad / Mortalidad ({result.immobilityAlerts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Animal</TableHead>
                        <TableHead>Especie</TableHead>
                        <TableHead>Horas inmóvil</TableHead>
                        <TableHead>Registros</TableHead>
                        <TableHead>Vel. prom</TableHead>
                        <TableHead>Vel. máx</TableHead>
                        <TableHead>Severidad</TableHead>
                        <TableHead>Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.immobilityAlerts.map((a, i) => (
                        <TableRow key={i} data-testid={`row-immobility-${i}`}>
                          <TableCell className="font-medium">{a.individual}</TableCell>
                          <TableCell className="text-xs">{a.species}</TableCell>
                          <TableCell>
                            <span className="font-bold text-red-500">{a.hoursImmobile}h</span>
                            <span className="text-xs text-muted-foreground ml-1">({a.daysImmobile}d)</span>
                          </TableCell>
                          <TableCell>{a.numRecords}</TableCell>
                          <TableCell>{a.avgSpeed} m/s</TableCell>
                          <TableCell>{a.maxSpeed} m/s</TableCell>
                          <TableCell>
                            <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} data-testid={`badge-severity-${i}`}>
                              {a.severity === "critical" ? "CRÍTICO" : "WARNING"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <a
                              href={a.googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                              data-testid={`link-maps-immobility-${i}`}
                            >
                              <MapPin className="w-3 h-3" />
                              Google Maps
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.noTransmissionAlerts.length > 0 && (
            <Card className="border-orange-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-orange-500">
                  <WifiOff className="w-5 h-5" />
                  Sin Transmisión ({result.noTransmissionAlerts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Animal</TableHead>
                        <TableHead>Especie</TableHead>
                        <TableHead>Última transmisión</TableHead>
                        <TableHead>Horas sin datos</TableHead>
                        <TableHead>Severidad</TableHead>
                        <TableHead>Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.noTransmissionAlerts.map((a, i) => (
                        <TableRow key={i} data-testid={`row-no-transmission-${i}`}>
                          <TableCell className="font-medium">{a.individual}</TableCell>
                          <TableCell className="text-xs">{a.species}</TableCell>
                          <TableCell>{formatDate(a.lastTransmission)}</TableCell>
                          <TableCell>
                            <span className="font-bold text-orange-500">
                              {a.hoursSinceLast ? `${Math.round(a.hoursSinceLast)}h` : "Sin datos"}
                            </span>
                            {a.daysSinceLast && (
                              <span className="text-xs text-muted-foreground ml-1">({a.daysSinceLast}d)</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>
                              {a.severity === "critical" ? "CRÍTICO" : "WARNING"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {a.googleMapsUrl ? (
                              <a
                                href={a.googleMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                              >
                                <MapPin className="w-3 h-3" />
                                Google Maps
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin ubicación</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.activeAnimals.length > 0 && (
            <Collapsible open={showActiveAnimals} onOpenChange={setShowActiveAnimals}>
              <Card className="border-green-500/30">
                <CardHeader className="pb-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent" data-testid="button-toggle-active">
                      <CardTitle className="text-base flex items-center gap-2 text-green-500">
                        <CheckCircle2 className="w-5 h-5" />
                        Animales Activos ({result.activeAnimals.length})
                      </CardTitle>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showActiveAnimals ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Animal</TableHead>
                            <TableHead>Especie</TableHead>
                            <TableHead>Última transmisión</TableHead>
                            <TableHead>Velocidad</TableHead>
                            <TableHead>Estado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.activeAnimals.map((a, i) => (
                            <TableRow key={i} data-testid={`row-active-${i}`}>
                              <TableCell className="font-medium">{a.individual}</TableCell>
                              <TableCell className="text-xs">{a.species}</TableCell>
                              <TableCell>{formatDate(a.lastTransmission)}</TableCell>
                              <TableCell>{a.lastSpeed != null ? `${a.lastSpeed.toFixed(2)} m/s` : "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                                  ACTIVO
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {result.immobilityAlerts.length === 0 && result.noTransmissionAlerts.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
                <p className="text-lg font-medium text-green-600">Sin alertas</p>
                <p className="text-sm text-muted-foreground">Todos los animales están activos y transmitiendo normalmente</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Estadísticas del análisis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Puntos GPS analizados</p>
                  <p className="font-bold" data-testid="text-gps-points">{result.stats.totalGpsPoints.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Puntos inmóviles</p>
                  <p className="font-bold">{result.stats.immobilePoints.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Grupos de inmovilidad</p>
                  <p className="font-bold">{result.stats.immobilityGroups}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Analizado a las</p>
                  <p className="font-bold">{formatDate(result.summary.analyzedAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
