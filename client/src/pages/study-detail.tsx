import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import type { Study, Individual, Deployment } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RefreshCw, PawPrint, AlertCircle, BarChart3, RadioTower, WifiOff, Globe, Database, AlertTriangle, Upload, Search, Pencil, Plus, Wrench, Link2, MapPin, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type FilterMode = "all" | "active" | "inactive";

export default function StudyDetail() {
  const [, params] = useRoute("/study/:id");
  const studyId = params?.id;
  const { toast } = useToast();
  const { user } = useAuth();
  const { isSuperuser, canSync, canImport, canEditIndividuals, canRepair } = usePermissions();
  const [syncing, setSyncing] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingIndividual, setEditingIndividual] = useState<Individual | null>(null);
  const [editForm, setEditForm] = useState({ nickName: "", taxon: "", sex: "", animalLifeStage: "" });
  const [deploymentStatus, setDeploymentStatus] = useState<"active" | "inactive">("active");
  const [deployOffDate, setDeployOffDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [ornitelaSyncing, setOrnitelaSyncing] = useState(false);
  const [ornitelaDevices, setOrnitelaDevices] = useState<any[]>([]);
  const [ornitelaDevicesLoading, setOrnitelaDevicesLoading] = useState(false);
  const [ornitelaSyncResult, setOrnitelaSyncResult] = useState<any>(null);
  const [ornitelaPanelOpen, setOrnitelaPanelOpen] = useState(false);

  const { data: study, isLoading: studyLoading } = useQuery<Study>({
    queryKey: ["/api/studies", studyId],
    enabled: !!studyId,
  });

  const { data: mbStatus } = useQuery<{ blocked: boolean; blockedUntil: string | null; dailyCount: number; dailyLimit: number; reason: string }>({
    queryKey: ["/api/movebank/status"],
    refetchInterval: 60000,
  });

  const { data: individuals, isLoading: individualsLoading } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    enabled: !!studyId,
  });

  const { data: deployments } = useQuery<Deployment[]>({
    queryKey: ["/api/studies", studyId, "deployments"],
    enabled: !!studyId,
    staleTime: 30000,
  });

  const activeDeploymentIndividualIds = useMemo(() =>
    new Set(
      deployments?.filter((d) => !d.deployOff)
        .map((d) => String(d.individualId))
        .filter(id => id && id !== 'null' && id !== 'undefined') || []
    ),
    [deployments]
  );

  const filteredIndividuals = useMemo(() => {
    if (!individuals) return [];
    let result = individuals;
    switch (filterMode) {
      case "active":
        result = result.filter((ind) => activeDeploymentIndividualIds.has(String(ind.movebankId)));
        break;
      case "inactive":
        result = result.filter((ind) => !activeDeploymentIndividualIds.has(String(ind.movebankId)));
        break;
    }
    if (searchQuery.trim()) {
      const norm = searchQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      result = result.filter((ind) => {
        const fields = [
          ind.localIdentifier || "",
          ind.nickName || "",
          ind.taxonCanonicalName || "",
        ];
        return fields.some((f) =>
          f.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(norm)
        );
      });
    }
    return result;
  }, [individuals, filterMode, activeDeploymentIndividualIds, searchQuery]);

  const activeCount = individuals?.filter((ind) => activeDeploymentIndividualIds.has(String(ind.movebankId))).length || 0;
  const inactiveCount = (individuals?.length || 0) - activeCount;

  const unlinkedActiveCount = useMemo(() =>
    deployments?.filter((d) => !d.deployOff && (!d.individualId || String(d.individualId) === 'null')).length || 0,
    [deployments]
  );

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const localRes = await apiRequest("POST", `/api/studies/${studyId}/repair-deployments-local`);
      let localData: { total?: number; linked?: number; repaired?: number; unlinked?: number } = {};
      try { localData = await localRes.json(); } catch {}

      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "deployments"] });

      const repaired = localData.repaired || 0;
      const linked = localData.linked || 0;
      const unlinked = localData.unlinked || 0;
      const total = localData.total || 0;

      if (unlinked === 0) {
        toast({
          title: "Todos los deployments están vinculados",
          description: `${linked} de ${total} deployments vinculados correctamente`,
        });
      } else if (repaired > 0) {
        toast({
          title: "Vínculos reparados",
          description: `Se vincularon ${repaired} deployments. Quedan ${unlinked} sin vincular`,
        });
      } else {
        try {
          const mbRes = await apiRequest("POST", `/api/studies/${studyId}/repair-deployments`);
          let mbData: { total?: number; linked?: number; unlinked?: number } = {};
          try { mbData = await mbRes.json(); } catch {}
          queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "deployments"] });
          const mbRepaired = (mbData.linked || 0) - linked;
          const mbUnlinked = mbData.unlinked || 0;
          if (mbRepaired > 0) {
            toast({
              title: "Vínculos reparados (Movebank)",
              description: `Se vincularon ${mbRepaired} deployments. Quedan ${mbUnlinked} sin vincular`,
            });
          } else if (mbUnlinked === 0) {
            toast({
              title: "Todos los deployments están vinculados",
              description: `${mbData.linked || 0} de ${mbData.total || 0} deployments vinculados correctamente`,
            });
          } else {
            toast({
              title: "Sin cambios",
              description: `${mbData.linked || linked} de ${mbData.total || total} deployments vinculados. Los ${mbUnlinked} restantes requieren sincronización con Movebank`,
            });
          }
        } catch (mbErr: any) {
          toast({
            title: "Sin cambios adicionales",
            description: `${linked} de ${total} deployments vinculados. Los ${unlinked} restantes requieren sincronización con Movebank`,
          });
        }
      }
    } catch (e: any) {
      let errorMsg = "Error desconocido al reparar";
      if (e.message) {
        const colonIdx = e.message.indexOf(": ");
        const body = colonIdx >= 0 ? e.message.substring(colonIdx + 2) : e.message;
        try {
          const parsed = JSON.parse(body);
          if (parsed.message) errorMsg = parsed.message;
          else errorMsg = body;
        } catch {
          errorMsg = body;
        }
      }
      toast({ title: "Error al reparar", description: errorMsg, variant: "destructive" });
    } finally {
      setRepairing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiRequest("POST", `/api/studies/${studyId}/sync`);
      let data: { individuals?: number; deployments?: number } = {};
      try { data = await res.json(); } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/movebank/status"] });
      toast({
        title: "Sincronización completada",
        description: data.individuals != null
          ? `Se sincronizaron ${data.individuals} individuos y ${data.deployments} despliegues desde Movebank`
          : "Los datos se actualizaron desde Movebank",
      });
    } catch (e: any) {
      let errorMsg = "Error desconocido al sincronizar";
      if (e.message) {
        const colonIdx = e.message.indexOf(": ");
        const body = colonIdx >= 0 ? e.message.substring(colonIdx + 2) : e.message;
        try {
          const parsed = JSON.parse(body);
          if (parsed.message) errorMsg = parsed.message;
          else errorMsg = body;
        } catch {
          errorMsg = body;
        }
      }
      if (e.message?.includes("429") || errorMsg.includes("límite") || errorMsg.includes("bloqueado") || errorMsg.includes("Movebank rate")) {
        toast({ title: "Movebank limitado", description: errorMsg, variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: ["/api/movebank/status"] });
      } else {
        toast({ title: "Error al sincronizar", description: errorMsg, variant: "destructive" });
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleOrnitelaSync = async () => {
    setOrnitelaSyncing(true);
    setOrnitelaSyncResult(null);
    try {
      const res = await apiRequest("POST", `/api/studies/${studyId}/ornitela-sync`, { hoursBack: 168 });
      const data = await res.json();
      setOrnitelaSyncResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      toast({
        title: "Sincronización Ornitela completada",
        description: `Dispositivos: ${data.devices || 0}, GPS: ${data.totalGps || 0}, Acelerómetro: ${data.totalAcc || 0}`,
      });
    } catch (e: any) {
      let errorMsg = "Error desconocido al sincronizar con Ornitela";
      if (e.message) {
        const colonIdx = e.message.indexOf(": ");
        const body = colonIdx >= 0 ? e.message.substring(colonIdx + 2) : e.message;
        try {
          const parsed = JSON.parse(body);
          if (parsed.message) errorMsg = parsed.message;
          else errorMsg = body;
        } catch {
          errorMsg = body;
        }
      }
      toast({ title: "Error Ornitela", description: errorMsg, variant: "destructive" });
    } finally {
      setOrnitelaSyncing(false);
    }
  };

  const handleFetchOrnitelaDevices = async () => {
    setOrnitelaDevicesLoading(true);
    setOrnitelaDevices([]);
    try {
      const res = await apiRequest("GET", `/api/studies/${studyId}/ornitela-devices`);
      const data = await res.json();
      setOrnitelaDevices(data.devices || []);
      toast({ title: "Conexión exitosa", description: `Se encontraron ${(data.devices || []).length} dispositivos` });
    } catch (e: any) {
      let errorMsg = "Error al conectar con Ornitela";
      if (e.message) {
        const colonIdx = e.message.indexOf(": ");
        const body = colonIdx >= 0 ? e.message.substring(colonIdx + 2) : e.message;
        try {
          const parsed = JSON.parse(body);
          if (parsed.message) errorMsg = parsed.message;
          else errorMsg = body;
        } catch {
          errorMsg = body;
        }
      }
      toast({ title: "Error de conexión", description: errorMsg, variant: "destructive" });
    } finally {
      setOrnitelaDevicesLoading(false);
    }
  };

  const openEditDialog = (ind: Individual) => {
    const hasActive = activeDeploymentIndividualIds.has(String(ind.movebankId));
    const indDeployments = deployments?.filter(d => String(d.individualId) === String(ind.movebankId)) || [];
    const activeDep = indDeployments.find(d => !d.deployOff);
    setEditingIndividual(ind);
    setEditForm({
      nickName: ind.nickName || "",
      taxon: ind.taxonCanonicalName || "",
      sex: ind.sex || "",
      animalLifeStage: ind.animalLifeStage || "",
    });
    setDeploymentStatus(hasActive ? "active" : "inactive");
    setDeployOffDate(activeDep?.deployOff || "");
  };

  const handleSaveEdit = async () => {
    if (!editingIndividual || !studyId) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/individuals/${editingIndividual.id}`, {
        nickName: editForm.nickName || null,
        taxonCanonicalName: editForm.taxon || null,
        sex: editForm.sex || null,
        animalLifeStage: editForm.animalLifeStage || null,
      });

      const hasActive = activeDeploymentIndividualIds.has(String(editingIndividual.movebankId));
      const indDeployments = deployments?.filter(d => String(d.individualId) === String(editingIndividual.movebankId)) || [];
      const activeDep = indDeployments.find(d => !d.deployOff);
      const mostRecentInactiveDep = indDeployments.filter(d => d.deployOff).sort((a, b) => (b.deployOff || "").localeCompare(a.deployOff || ""))[0];

      if (hasActive && deploymentStatus === "inactive") {
        if (activeDep) {
          await apiRequest("PATCH", `/api/deployments/${activeDep.id}`, {
            deployOff: deployOffDate || new Date().toISOString().split("T")[0],
          });
        }
      } else if (!hasActive && deploymentStatus === "active") {
        if (mostRecentInactiveDep) {
          await apiRequest("PATCH", `/api/deployments/${mostRecentInactiveDep.id}`, {
            deployOff: null,
          });
        } else {
          await apiRequest("POST", `/api/studies/${studyId}/deployments`, {
            individualMovebankId: editingIndividual.movebankId,
            deployOn: new Date().toISOString().split("T")[0],
            deployOff: null,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "deployments"] });
      toast({ title: "Guardado", description: "Los datos del individuo se actualizaron correctamente" });
      setEditingIndividual(null);
    } catch (e: any) {
      toast({ title: "Error", description: "No se pudieron guardar los cambios", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (studyLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64 rounded" />
        <Skeleton className="h-4 w-48 rounded" />
        <Skeleton className="h-64 w-full rounded" />
      </div>
    );
  }

  if (!study) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Estudio no encontrado</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: study.name }]} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-study-name">
              {study.name}
            </h1>
            {study.active ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                Activo
              </Badge>
            ) : (
              <Badge variant="outline" className="opacity-50">Inactivo</Badge>
            )}
          </div>
          {study.movebankStudyId && (
            <p className="text-sm text-muted-foreground">
              Movebank Study ID: {study.movebankStudyId}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/study/${studyId}/visualize`}>
            <Button variant="outline" data-testid="button-visualize">
              <BarChart3 className="w-4 h-4 mr-2" />
              Visualizar datos
            </Button>
          </Link>
          <Link href={`/study/${studyId}/analysis`}>
            <Button variant="outline" data-testid="button-geo-analysis">
              <Globe className="w-4 h-4 mr-2" />
              Analisis geoespacial
            </Button>
          </Link>
          <Link href={`/last-positions/${studyId}`}>
            <Button variant="outline" data-testid="button-last-positions">
              <MapPin className="w-4 h-4 mr-2" />
              Últimas posiciones
            </Button>
          </Link>
          <Link href={`/study/${studyId}/data`}>
            <Button variant="outline" data-testid="button-raw-data">
              <Database className="w-4 h-4 mr-2" />
              Datos brutos
            </Button>
          </Link>
          {canImport && (
            <Link href={`/study/${studyId}/import`}>
              <Button variant="outline" data-testid="button-import-csv">
                <Upload className="w-4 h-4 mr-2" />
                Importar CSV
              </Button>
            </Link>
          )}
          {canRepair && unlinkedActiveCount > 0 && (
            <Button
              variant="outline"
              onClick={handleRepair}
              disabled={repairing}
              className="border-amber-500/30 text-amber-600 dark:text-amber-400"
              data-testid="button-repair-deployments"
            >
              <Wrench className={`w-4 h-4 mr-2 ${repairing ? "animate-spin" : ""}`} />
              {repairing ? "Reparando..." : "Reparar vinculos"}
            </Button>
          )}
          {canSync && (
            <Button
              onClick={handleSync}
              disabled={syncing || mbStatus?.blocked}
              title={mbStatus?.blocked && mbStatus.blockedUntil ? `Disponible a las ${new Date(mbStatus.blockedUntil).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : undefined}
              data-testid="button-sync-movebank"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando..." : mbStatus?.blocked ? "Movebank limitado" : "Sincronizar con Movebank"}
            </Button>
          )}
          {isSuperuser && study.ornitelaEnabled && (
            <Button
              onClick={handleOrnitelaSync}
              disabled={ornitelaSyncing}
              className="bg-orange-600 text-white border-orange-600"
              data-testid="button-sync-ornitela"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${ornitelaSyncing ? "animate-spin" : ""}`} />
              {ornitelaSyncing ? "Sincronizando..." : "Sincronizar Ornitela"}
            </Button>
          )}
        </div>
        {study.lastMovebankSync && (
          <p className="text-[11px] text-muted-foreground mt-1" data-testid="text-last-movebank-sync">
            Última sincronización Movebank: {new Date(study.lastMovebankSync).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Total individuos</p>
                <p className="text-2xl font-bold" data-testid="text-total-individuals">
                  {individualsLoading ? <Skeleton className="h-8 w-12 rounded" /> : individuals?.length || 0}
                </p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <PawPrint className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Con deployment activo</p>
                <p className="text-2xl font-bold text-emerald-500" data-testid="text-active-deployments">
                  {individualsLoading ? <Skeleton className="h-8 w-12 rounded" /> : activeCount}
                </p>
                {unlinkedActiveCount > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs" data-testid="badge-unlinked-deployments">
                      <Link2 className="w-3 h-3 mr-1" />
                      {unlinkedActiveCount} sin vincular (requieren Movebank)
                    </Badge>
                    {canRepair && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleRepair}
                        disabled={repairing}
                        className="text-xs text-amber-600 dark:text-amber-400"
                        data-testid="button-repair-card"
                      >
                        <Wrench className="w-3 h-3 mr-1" />
                        Reparar
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="p-2 rounded-md bg-emerald-500/10">
                <RadioTower className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Sin deployment</p>
                <p className="text-2xl font-bold text-muted-foreground" data-testid="text-inactive-deployments">
                  {individualsLoading ? <Skeleton className="h-8 w-12 rounded" /> : inactiveCount}
                </p>
              </div>
              <div className="p-2 rounded-md bg-muted">
                <WifiOff className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-0 flex-wrap">
            <h3 className="text-sm font-semibold">Individuos</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre, apodo o especie..."
                  className="pl-8 w-64"
                  data-testid="input-search-individuals"
                />
              </div>
              <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
                <SelectTrigger className="w-44" data-testid="select-filter-animals">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos ({individuals?.length || 0})</SelectItem>
                  <SelectItem value="active">Solo activos ({activeCount})</SelectItem>
                  <SelectItem value="inactive">Solo inactivos ({inactiveCount})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {individualsLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : filteredIndividuals.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identificador</TableHead>
                    <TableHead>Apodo</TableHead>
                    <TableHead>Especie</TableHead>
                    <TableHead>Sexo</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Estado</TableHead>
                    {canEditIndividuals && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIndividuals.map((ind) => {
                    const hasActive = activeDeploymentIndividualIds.has(String(ind.movebankId));
                    return (
                      <TableRow
                        key={ind.id}
                        className={hasActive ? "" : "opacity-50"}
                        data-testid={`row-individual-${ind.movebankId}`}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {hasActive ? (
                              <RadioTower className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <WifiOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            )}
                            {ind.localIdentifier || `ID-${ind.movebankId}`}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ind.nickName || "—"}
                        </TableCell>
                        <TableCell>
                          {ind.taxonCanonicalName ? (
                            <span className="italic">{ind.taxonCanonicalName}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ind.sex === "m" ? "Macho" : ind.sex === "f" ? "Hembra" : ind.sex || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ind.animalLifeStage || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {hasActive ? (
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                <span className="text-sm text-emerald-500">Rastreando</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />
                                <span className="text-sm text-muted-foreground">Sin dispositivo</span>
                              </div>
                            )}
                            {ind.synced === false && (
                              <div className="flex items-center gap-1.5" data-testid={`badge-unsynced-${ind.movebankId}`}>
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span className="text-xs text-amber-500">No encontrado en ultima sincronizacion</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        {canEditIndividuals && (
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEditDialog(ind)}
                              data-testid={`button-edit-individual-${ind.movebankId}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <PawPrint className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground mb-2">
                {individuals && individuals.length > 0
                  ? `No hay animales que coincidan con ${searchQuery.trim() ? "la busqueda" : "el filtro"}`
                  : "No hay individuos cargados"}
              </p>
              {(!individuals || individuals.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  Sincroniza con Movebank para obtener los datos
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperuser && study.ornitelaEnabled && (
        <Card data-testid="card-ornitela-panel">
          <CardContent className="p-0">
            <button
              onClick={() => setOrnitelaPanelOpen(!ornitelaPanelOpen)}
              className="flex items-center justify-between gap-3 p-4 w-full text-left"
              data-testid="button-toggle-ornitela-panel"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Panel Ornitela</h3>
                {study.ornitelaLastSync && (
                  <span className="text-xs text-muted-foreground">
                    Última sincronización: {new Date(study.ornitelaLastSync).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
              {ornitelaPanelOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {ornitelaPanelOpen && (
              <div className="px-4 pb-4 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleFetchOrnitelaDevices}
                    disabled={ornitelaDevicesLoading}
                    data-testid="button-ornitela-test-connection"
                  >
                    {ornitelaDevicesLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RadioTower className="w-4 h-4 mr-2" />}
                    {ornitelaDevicesLoading ? "Conectando..." : "Probar conexión"}
                  </Button>
                  <Button
                    onClick={handleOrnitelaSync}
                    disabled={ornitelaSyncing}
                    className="bg-orange-600 text-white border-orange-600"
                    data-testid="button-ornitela-sync-now"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${ornitelaSyncing ? "animate-spin" : ""}`} />
                    {ornitelaSyncing ? "Sincronizando..." : "Sincronizar ahora"}
                  </Button>
                </div>

                {ornitelaDevices.length > 0 && (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nombre</TableHead>
                          <TableHead>IMEI</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Último GPRS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ornitelaDevices.map((device: any, idx: number) => (
                          <TableRow key={device.imei || idx} data-testid={`row-ornitela-device-${idx}`}>
                            <TableCell className="font-medium">{device.name || "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{device.imei || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={device.status === "active" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : ""}>
                                {device.status || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{device.lastGPRS || device.lastGprs || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {ornitelaSyncResult && (
                  <div className="space-y-2" data-testid="ornitela-sync-results">
                    <h4 className="text-sm font-medium">Resultados de sincronización</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-2 rounded-md bg-muted/50">
                        <p className="text-lg font-bold" data-testid="text-ornitela-devices">{ornitelaSyncResult.devices || 0}</p>
                        <p className="text-xs text-muted-foreground">Dispositivos</p>
                      </div>
                      <div className="text-center p-2 rounded-md bg-muted/50">
                        <p className="text-lg font-bold" data-testid="text-ornitela-gps">{ornitelaSyncResult.totalGps || 0}</p>
                        <p className="text-xs text-muted-foreground">Registros GPS</p>
                      </div>
                      <div className="text-center p-2 rounded-md bg-muted/50">
                        <p className="text-lg font-bold" data-testid="text-ornitela-acc">{ornitelaSyncResult.totalAcc || 0}</p>
                        <p className="text-xs text-muted-foreground">Registros Acelerómetro</p>
                      </div>
                    </div>
                    {(ornitelaSyncResult.deviceResults || ornitelaSyncResult.results) && Array.isArray(ornitelaSyncResult.deviceResults || ornitelaSyncResult.results) && (
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Dispositivo</TableHead>
                              <TableHead>GPS</TableHead>
                              <TableHead>Acelerómetro</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(ornitelaSyncResult.deviceResults || ornitelaSyncResult.results).map((r: any, idx: number) => (
                              <TableRow key={idx} data-testid={`row-ornitela-result-${idx}`}>
                                <TableCell className="font-medium">{r.device || r.name || `Dispositivo ${idx + 1}`}</TableCell>
                                <TableCell>{r.gpsCount ?? r.gps ?? 0}</TableCell>
                                <TableCell>{r.accCount ?? r.acc ?? 0}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editingIndividual} onOpenChange={(open) => !open && setEditingIndividual(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Editar: {editingIndividual?.localIdentifier || `ID-${editingIndividual?.movebankId}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nickname">Apodo (nick name)</Label>
              <Input
                id="edit-nickname"
                value={editForm.nickName}
                onChange={(e) => setEditForm({ ...editForm, nickName: e.target.value })}
                placeholder="Nombre descriptivo"
                data-testid="input-edit-nickname"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-taxon">Especie</Label>
              <Input
                id="edit-taxon"
                value={editForm.taxon}
                onChange={(e) => setEditForm({ ...editForm, taxon: e.target.value })}
                placeholder="Nombre científico (ej: Aquila chrysaetos)"
                data-testid="input-edit-taxon"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-sex">Sexo</Label>
              <Select value={editForm.sex || "unknown"} onValueChange={(v) => setEditForm({ ...editForm, sex: v === "unknown" ? "" : v })}>
                <SelectTrigger data-testid="select-edit-sex">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Desconocido</SelectItem>
                  <SelectItem value="m">Macho</SelectItem>
                  <SelectItem value="f">Hembra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-lifestage">Etapa de vida</Label>
              <Select value={editForm.animalLifeStage || "unknown"} onValueChange={(v) => setEditForm({ ...editForm, animalLifeStage: v === "unknown" ? "" : v })}>
                <SelectTrigger data-testid="select-edit-lifestage">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Desconocido</SelectItem>
                  <SelectItem value="juvenile">Juvenil</SelectItem>
                  <SelectItem value="subadult">Subadulto</SelectItem>
                  <SelectItem value="adult">Adulto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estado del deployment</Label>
              <Select value={deploymentStatus} onValueChange={(v) => setDeploymentStatus(v as "active" | "inactive")}>
                <SelectTrigger data-testid="select-edit-deployment-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo (rastreando)</SelectItem>
                  <SelectItem value="inactive">Inactivo (sin dispositivo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {deploymentStatus === "inactive" && activeDeploymentIndividualIds.has(String(editingIndividual?.movebankId ?? 0)) && (
              <div className="space-y-2">
                <Label htmlFor="edit-deploy-off">Fecha fin del deployment</Label>
                <Input
                  id="edit-deploy-off"
                  type="date"
                  value={deployOffDate}
                  onChange={(e) => setDeployOffDate(e.target.value)}
                  data-testid="input-edit-deploy-off"
                />
                <p className="text-xs text-muted-foreground">Si se deja vacia, se usara la fecha de hoy</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingIndividual(null)} data-testid="button-cancel-edit">
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving} data-testid="button-save-edit">
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
