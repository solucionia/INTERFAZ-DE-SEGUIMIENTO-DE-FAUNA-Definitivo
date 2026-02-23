import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import type { Study } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  MapPin,
  RefreshCw,
  ChevronDown,
  ExternalLink,
  Crosshair,
  Search,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from "react-leaflet";
import { MapLayerControl, GoogleMapsClick, googleMapsLink } from "@/components/map-layers";
import { Breadcrumbs } from "@/components/breadcrumbs";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface AnimalPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  groundSpeed: number | null;
  heading: number | null;
  altitude: number | null;
}

interface AnimalData {
  individual: string;
  nickName: string | null;
  taxon: string | null;
  points: AnimalPoint[];
}

interface LastPositionsResponse {
  summary: {
    totalIndividuals: number;
    withData: number;
    withoutData: number;
    lastUpdate: number | null;
  };
  animals: AnimalData[];
}

function getAgeColor(timestamp: number): string {
  const now = Date.now();
  const diffHours = (now - timestamp) / (1000 * 60 * 60);
  if (diffHours < 24) return "#22c55e";
  if (diffHours < 72) return "#eab308";
  if (diffHours < 168) return "#f97316";
  return "#ef4444";
}

function getAgeLabel(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return `Hace ${mins} min`;
  }
  if (diffHours < 24) {
    return `Hace ${Math.floor(diffHours)}h`;
  }
  if (diffDays < 30) {
    return `Hace ${Math.floor(diffDays)} días`;
  }
  return `Hace ${Math.floor(diffDays)} días`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FitBounds({ animals }: { animals: AnimalData[] }) {
  const map = useMap();

  useEffect(() => {
    if (animals.length === 0) return;
    const bounds: [number, number][] = [];
    animals.forEach((a) => {
      if (a.points.length > 0) {
        bounds.push([a.points[0].latitude, a.points[0].longitude]);
      }
    });
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 14 });
    }
  }, [animals, map]);

  return null;
}

function FlyToAnimal({ target, onDone }: { target: { lat: number; lng: number } | null; onDone: () => void }) {
  const map = useMap();

  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], 15, { duration: 1 });
    onDone();
  }, [target, map, onDone]);

  return null;
}

export default function LastPositions() {
  const [, params] = useRoute("/last-positions/:id");
  const routeStudyId = params?.id;

  const { data: studies } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const [selectedStudyId, setSelectedStudyId] = useState<string>("");
  const [numPoints, setNumPoints] = useState(5);
  const [inputPoints, setInputPoints] = useState("5");
  const [tableOpen, setTableOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [tablePage, setTablePage] = useState(0);
  const PAGE_SIZE = 20;
  const markerRefs = useRef<Record<string, L.CircleMarker>>({});

  useEffect(() => {
    if (routeStudyId) {
      setSelectedStudyId(routeStudyId);
    } else if (!selectedStudyId && studies && studies.length > 0) {
      setSelectedStudyId(studies[0].id);
    }
  }, [routeStudyId, studies, selectedStudyId]);

  const { data, isLoading, refetch, isFetching } = useQuery<LastPositionsResponse>({
    queryKey: [`/api/studies/${selectedStudyId}/last-positions?points=${numPoints}`],
    enabled: !!selectedStudyId,
    staleTime: 60000,
  });

  const studyName = studies?.find((s) => s.id === selectedStudyId)?.name || "";

  const handleUpdatePoints = () => {
    const val = Math.min(Math.max(parseInt(inputPoints) || 1, 1), 50);
    setInputPoints(String(val));
    setNumPoints(val);
  };

  const filteredAnimals = useMemo(() => {
    if (!data?.animals) return [];
    if (!searchQuery.trim()) return data.animals;
    const norm = searchQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return data.animals.filter((a) => {
      const fields = [a.individual, a.nickName || "", a.taxon || ""];
      return fields.some((f) =>
        f.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(norm)
      );
    });
  }, [data?.animals, searchQuery]);

  const sortedAnimals = useMemo(() => {
    return [...filteredAnimals].sort((a, b) => {
      const tsA = a.points[0]?.timestamp || 0;
      const tsB = b.points[0]?.timestamp || 0;
      return tsB - tsA;
    });
  }, [filteredAnimals]);

  const totalPages = Math.ceil(sortedAnimals.length / PAGE_SIZE);
  const paginatedAnimals = sortedAnimals.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);

  useEffect(() => { setTablePage(0); }, [searchQuery]);

  const handleCenterOnAnimal = (animal: AnimalData) => {
    if (animal.points.length === 0) return;
    const p = animal.points[0];
    setFlyTarget({ lat: p.latitude, lng: p.longitude });
    setTimeout(() => {
      const ref = markerRefs.current[animal.individual];
      if (ref) ref.openPopup();
    }, 1200);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Breadcrumbs
        items={[
          ...(studyName ? [{ label: studyName, href: `/study/${selectedStudyId}` }] : []),
          { label: "Últimas posiciones" },
        ]}
      />

      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Últimas posiciones</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Estudio</label>
          <Select value={selectedStudyId} onValueChange={setSelectedStudyId}>
            <SelectTrigger className="w-64" data-testid="select-study">
              <SelectValue placeholder="Seleccionar estudio" />
            </SelectTrigger>
            <SelectContent>
              {studies?.map((s) => (
                <SelectItem key={s.id} value={s.id} data-testid={`select-study-${s.id}`}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Últimos N puntos</label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={50}
              value={inputPoints}
              onChange={(e) => setInputPoints(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUpdatePoints()}
              className="w-20"
              data-testid="input-points"
            />
            {[1, 5, 10, 25].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={numPoints === n ? "default" : "outline"}
                onClick={() => {
                  setInputPoints(String(n));
                  setNumPoints(n);
                }}
                data-testid={`button-points-${n}`}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>

        <Button
          onClick={() => refetch()}
          disabled={isFetching || !selectedStudyId}
          data-testid="button-refresh"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Total animales</p>
                  <p className="text-xl font-bold" data-testid="text-total-animals">{data.summary.totalIndividuals}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Con datos</p>
                  <p className="text-xl font-bold text-emerald-500" data-testid="text-with-data">{data.summary.withData}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Sin datos</p>
                  <p className="text-xl font-bold text-red-500" data-testid="text-without-data">{data.summary.withoutData}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Última actualización</p>
                  <p className="text-sm font-medium" data-testid="text-last-update">
                    {data.summary.lastUpdate ? formatTimestamp(data.summary.lastUpdate) : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ height: "60vh", minHeight: 400 }}>
        {isLoading ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <MapContainer
            center={[40, -3]}
            zoom={6}
            className="w-full h-full z-0"
            data-testid="map-last-positions"
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
            <MapLayerControl />
            <GoogleMapsClick />
            {data && <FitBounds animals={data.animals} />}
            <FlyToAnimal target={flyTarget} onDone={() => setFlyTarget(null)} />

            {data?.animals.map((animal) => {
              if (animal.points.length === 0) return null;
              const lastPoint = animal.points[0];
              const color = getAgeColor(lastPoint.timestamp);
              const displayName = animal.nickName || animal.individual;

              return (
                <span key={animal.individual}>
                  {animal.points.length > 1 && (
                    <Polyline
                      positions={animal.points.map((p) => [p.latitude, p.longitude] as [number, number])}
                      pathOptions={{ color, weight: 2, opacity: 0.6, dashArray: "5,5" }}
                    />
                  )}
                  <CircleMarker
                    center={[lastPoint.latitude, lastPoint.longitude]}
                    radius={8}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}
                    ref={(ref) => {
                      if (ref) markerRefs.current[animal.individual] = ref;
                    }}
                  >
                    <Popup>
                      <div className="text-sm min-w-[200px]" data-testid={`popup-${animal.individual}`}>
                        <p className="font-bold text-base mb-1">{displayName}</p>
                        {animal.taxon && <p className="italic text-muted-foreground text-xs mb-1">{animal.taxon}</p>}
                        <hr className="my-1.5" />
                        <p><span className="font-medium">Último dato:</span> {formatTimestamp(lastPoint.timestamp)}</p>
                        <p className="text-xs" style={{ color }}>{getAgeLabel(lastPoint.timestamp)}</p>
                        {lastPoint.groundSpeed != null && (
                          <p><span className="font-medium">Velocidad:</span> {lastPoint.groundSpeed.toFixed(2)} m/s</p>
                        )}
                        {lastPoint.altitude != null && (
                          <p><span className="font-medium">Altitud:</span> {lastPoint.altitude.toFixed(0)} m</p>
                        )}
                        <p><span className="font-medium">Coordenadas:</span> {lastPoint.latitude.toFixed(5)}, {lastPoint.longitude.toFixed(5)}</p>
                        <div className="flex flex-col gap-1 mt-2">
                          <a
                            href={googleMapsLink(lastPoint.latitude, lastPoint.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline text-xs flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" /> Ver en Google Maps
                          </a>
                          <Link
                            href={`/study/${selectedStudyId}/visualize?individuals=${animal.individual}`}
                            className="text-blue-500 hover:underline text-xs flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" /> Ver trayectoria completa
                          </Link>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                </span>
              );
            })}

            <div className="leaflet-bottom leaflet-left" style={{ pointerEvents: "none" }}>
              <div className="leaflet-control" style={{ pointerEvents: "auto", background: "rgba(255,255,255,0.9)", padding: "8px 12px", borderRadius: 6, fontSize: 12, margin: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Antigüedad</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#22c55e", marginRight: 6 }} />&lt; 24h</span>
                  <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#eab308", marginRight: 6 }} />24-72h</span>
                  <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#f97316", marginRight: 6 }} />3-7 días</span>
                  <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#ef4444", marginRight: 6 }} />&gt; 7 días</span>
                </div>
              </div>
            </div>
          </MapContainer>
        )}
      </div>

      {data && data.animals.length > 0 && (
        <Collapsible open={tableOpen} onOpenChange={setTableOpen}>
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2" data-testid="button-toggle-table">
                <ChevronDown className={`w-4 h-4 transition-transform ${tableOpen ? "" : "-rotate-90"}`} />
                <span className="font-semibold text-sm">Tabla de posiciones ({data.animals.length} animales)</span>
              </Button>
            </CollapsibleTrigger>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar animal..."
                className="pl-8 w-56"
                data-testid="input-search-table"
              />
            </div>
          </div>
          <CollapsibleContent>
            <Card className="mt-2">
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Animal</TableHead>
                        <TableHead>Especie</TableHead>
                        <TableHead>Última posición</TableHead>
                        <TableHead>Hace cuánto</TableHead>
                        <TableHead>Velocidad</TableHead>
                        <TableHead>Altitud</TableHead>
                        <TableHead>Coordenadas</TableHead>
                        <TableHead>Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedAnimals.map((animal) => {
                        const lastPoint = animal.points[0];
                        if (!lastPoint) return null;
                        const color = getAgeColor(lastPoint.timestamp);
                        const displayName = animal.nickName || animal.individual;

                        return (
                          <TableRow key={animal.individual} data-testid={`row-animal-${animal.individual}`}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="font-medium">{displayName}</span>
                              </div>
                            </TableCell>
                            <TableCell className="italic text-muted-foreground text-sm">
                              {animal.taxon || "—"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {formatTimestamp(lastPoint.timestamp)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                style={{ borderColor: color, color }}
                              >
                                {getAgeLabel(lastPoint.timestamp)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {lastPoint.groundSpeed != null ? `${lastPoint.groundSpeed.toFixed(2)} m/s` : "—"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {lastPoint.altitude != null ? `${lastPoint.altitude.toFixed(0)} m` : "—"}
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {lastPoint.latitude.toFixed(5)}, {lastPoint.longitude.toFixed(5)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <a
                                  href={googleMapsLink(lastPoint.latitude, lastPoint.longitude)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button size="sm" variant="ghost" data-testid={`button-gmaps-${animal.individual}`}>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </Button>
                                </a>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleCenterOnAnimal(animal)}
                                  data-testid={`button-center-${animal.individual}`}
                                >
                                  <Crosshair className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-xs text-muted-foreground">
                      Mostrando {tablePage * PAGE_SIZE + 1}-{Math.min((tablePage + 1) * PAGE_SIZE, sortedAnimals.length)} de {sortedAnimals.length}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={tablePage === 0}
                        onClick={() => setTablePage((p) => p - 1)}
                        data-testid="button-prev-page"
                      >
                        Anterior
                      </Button>
                      <span className="text-xs text-muted-foreground px-2">
                        {tablePage + 1} / {totalPages}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={tablePage >= totalPages - 1}
                        onClick={() => setTablePage((p) => p + 1)}
                        data-testid="button-next-page"
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      {data && data.animals.length === 0 && !isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No hay datos GPS almacenados para este estudio.
              <br />
              Sincronice el estudio con Movebank o importe datos CSV primero.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
