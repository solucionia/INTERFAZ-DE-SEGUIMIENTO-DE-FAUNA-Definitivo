import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Study, DetectedEvent } from "@shared/schema";
import { EVENT_LABELS, EVENT_COLORS, EVENT_TYPES } from "@shared/schema";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatAnimalLabelById } from "@/lib/animal-label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, Check, CheckCheck, Eye, EyeOff, ChevronLeft, ChevronRight,
  Skull, Zap, Utensils, Bird, Filter,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const EVENT_ICONS: Record<string, any> = {
  mortality: Skull,
  detachment: Zap,
  fight: AlertTriangle,
  feeding: Utensils,
  incubation: Bird,
};

const PAGE_SIZE = 20;

interface AlertHistoryResponse {
  events: DetectedEvent[];
  total: number;
  stats: Record<string, number>;
}

export default function AlertHistory() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    studyId: "",
    eventType: "",
    readStatus: "",
    resolvedStatus: "",
    dateStart: "",
    dateEnd: "",
  });
  const [page, setPage] = useState(0);

  const { data: studies } = useQuery<Study[]>({ queryKey: ["/api/studies"] });
  const { data: allIndividuals } = useQuery<import("@shared/schema").Individual[]>({ queryKey: ["/api/individuals/all"] });
  const individualMap = useMemo(() => {
    const m = new Map<string, import("@shared/schema").Individual>();
    for (const ind of allIndividuals || []) if (ind.localIdentifier) m.set(ind.localIdentifier, ind);
    return m;
  }, [allIndividuals]);

  const queryParams = new URLSearchParams();
  if (filters.studyId) queryParams.set("studyId", filters.studyId);
  if (filters.eventType) queryParams.set("eventType", filters.eventType);
  if (filters.readStatus) queryParams.set("readStatus", filters.readStatus);
  if (filters.resolvedStatus) queryParams.set("resolvedStatus", filters.resolvedStatus);
  if (filters.dateStart) queryParams.set("timestampStart", String(new Date(filters.dateStart).getTime()));
  if (filters.dateEnd) queryParams.set("timestampEnd", String(new Date(filters.dateEnd + "T23:59:59").getTime()));
  queryParams.set("limit", String(PAGE_SIZE));
  queryParams.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading } = useQuery<AlertHistoryResponse>({
    queryKey: ["/api/alerts/history", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/alerts/history?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando historial");
      return res.json();
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/alerts/${id}`, { readStatus: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/history"] });
      toast({ title: "Alerta marcada como leida" });
    },
  });

  const markResolvedMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/alerts/${id}`, { resolvedStatus: true, readStatus: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/history"] });
      toast({ title: "Alerta marcada como resuelta" });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      if (!data?.events) return;
      const unreadIds = data.events.filter((e) => !e.readStatus).map((e) => e.id);
      if (unreadIds.length === 0) return;
      await apiRequest("PATCH", "/api/alerts/bulk/read", { ids: unreadIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/history"] });
      toast({ title: "Alertas marcadas como leidas" });
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const totalAlerts = data ? Object.values(data.stats).reduce((s, n) => s + n, 0) : 0;

  const studyMap = new Map((studies || []).map((s) => [s.id, s.name]));

  const clearFilters = () => {
    setFilters({ studyId: "", eventType: "", readStatus: "", resolvedStatus: "", dateStart: "", dateEnd: "" });
    setPage(0);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Historial de alertas" }]} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-alert-history-title">
            Historial de alertas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data ? `${data.total} alertas encontradas` : "Cargando..."}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending || !data?.events?.some((e) => !e.readStatus)}
          data-testid="button-mark-all-read"
        >
          <CheckCheck className="w-4 h-4 mr-2" />
          Marcar todo como leido
        </Button>
      </div>

      {data?.stats && totalAlerts > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {EVENT_TYPES.map((type) => {
            const count = data.stats[type] || 0;
            const Icon = EVENT_ICONS[type] || AlertTriangle;
            return (
              <Card key={type}>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" style={{ color: EVENT_COLORS[type] }} />
                    <span className="text-xs text-muted-foreground truncate">{EVENT_LABELS[type]}</span>
                  </div>
                  <p className="text-xl font-bold mt-1" data-testid={`stat-${type}`}>{count}</p>
                  <p className="text-xs text-muted-foreground">ultimo mes</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filtros</span>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto" data-testid="button-clear-filters">
              Limpiar
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Estudio</Label>
              <Select value={filters.studyId} onValueChange={(v) => { setFilters((f) => ({ ...f, studyId: v === "all" ? "" : v })); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-study"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {(studies || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo de evento</Label>
              <Select value={filters.eventType} onValueChange={(v) => { setFilters((f) => ({ ...f, eventType: v === "all" ? "" : v })); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-type"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{EVENT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Estado lectura</Label>
              <Select value={filters.readStatus} onValueChange={(v) => { setFilters((f) => ({ ...f, readStatus: v === "all" ? "" : v })); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-read"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="false">No leida</SelectItem>
                  <SelectItem value="true">Leida</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Estado</Label>
              <Select value={filters.resolvedStatus} onValueChange={(v) => { setFilters((f) => ({ ...f, resolvedStatus: v === "all" ? "" : v })); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-resolved"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="false">Pendiente</SelectItem>
                  <SelectItem value="true">Resuelta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={filters.dateStart} onChange={(e) => { setFilters((f) => ({ ...f, dateStart: e.target.value })); setPage(0); }} data-testid="input-filter-date-start" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={filters.dateEnd} onChange={(e) => { setFilters((f) => ({ ...f, dateEnd: e.target.value })); setPage(0); }} data-testid="input-filter-date-end" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
            </div>
          ) : data && data.events.length > 0 ? (
            <>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Estado</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Animal</TableHead>
                      <TableHead>Estudio</TableHead>
                      <TableHead>Severidad</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.events.map((event) => {
                      const Icon = EVENT_ICONS[event.eventType] || AlertTriangle;
                      return (
                        <TableRow key={event.id} className={!event.readStatus ? "bg-primary/5" : ""} data-testid={`row-alert-${event.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {event.readStatus ? (
                                <Eye className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <EyeOff className="w-4 h-4 text-primary" />
                              )}
                              {event.resolvedStatus && (
                                <Check className="w-4 h-4 text-emerald-500" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4" style={{ color: EVENT_COLORS[event.eventType as keyof typeof EVENT_COLORS] }} />
                              <span className="text-sm">{EVENT_LABELS[event.eventType as keyof typeof EVENT_LABELS] || event.eventType}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{formatAnimalLabelById(event.individualLocalId, individualMap)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{studyMap.get(event.studyId) || event.studyId}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs" style={{
                              borderColor: event.severity === "critical" ? "#ef4444" : event.severity === "high" ? "#f97316" : "#22c55e",
                              color: event.severity === "critical" ? "#ef4444" : event.severity === "high" ? "#f97316" : "#22c55e",
                            }}>
                              {event.severity === "critical" ? "Critica" : event.severity === "high" ? "Alta" : "Info"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {event.createdAt ? format(new Date(event.createdAt), "dd/MM/yyyy HH:mm", { locale: es }) : "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {!event.readStatus && (
                                <Button variant="ghost" size="icon" onClick={() => markReadMutation.mutate(event.id)} data-testid={`button-mark-read-${event.id}`}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              )}
                              {!event.resolvedStatus && (
                                <Button variant="ghost" size="icon" onClick={() => markResolvedMutation.mutate(event.id)} data-testid={`button-mark-resolved-${event.id}`}>
                                  <Check className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    Pagina {page + 1} de {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} data-testid="button-prev-page">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} data-testid="button-next-page">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No se encontraron alertas con los filtros seleccionados</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
