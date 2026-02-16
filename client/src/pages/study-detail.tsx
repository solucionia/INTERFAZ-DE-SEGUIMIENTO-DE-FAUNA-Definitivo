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
import { RefreshCw, PawPrint, AlertCircle, BarChart3, RadioTower, WifiOff, Globe, Database, AlertTriangle, Upload, Search, Pencil, Plus, Wrench, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
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
  const isSuperuser = user?.role === "superuser";
  const [syncing, setSyncing] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingIndividual, setEditingIndividual] = useState<Individual | null>(null);
  const [editForm, setEditForm] = useState({ nickName: "", sex: "", animalLifeStage: "" });
  const [deploymentStatus, setDeploymentStatus] = useState<"active" | "inactive">("active");
  const [deployOffDate, setDeployOffDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const { data: study, isLoading: studyLoading } = useQuery<Study>({
    queryKey: ["/api/studies", studyId],
    enabled: !!studyId,
  });

  const { data: individuals, isLoading: individualsLoading } = useQuery<Individual[]>({
    queryKey: ["/api/studies", studyId, "individuals"],
    enabled: !!studyId,
  });

  const { data: deployments } = useQuery<Deployment[]>({
    queryKey: ["/api/studies", studyId, "deployments"],
    enabled: !!studyId,
  });

  const activeDeploymentIndividualIds = useMemo(() =>
    new Set(deployments?.filter((d) => !d.deployOff).map((d) => d.individualId) || []),
    [deployments]
  );

  const filteredIndividuals = useMemo(() => {
    if (!individuals) return [];
    let result = individuals;
    switch (filterMode) {
      case "active":
        result = result.filter((ind) => activeDeploymentIndividualIds.has(ind.movebankId));
        break;
      case "inactive":
        result = result.filter((ind) => !activeDeploymentIndividualIds.has(ind.movebankId));
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

  const activeCount = individuals?.filter((ind) => activeDeploymentIndividualIds.has(ind.movebankId)).length || 0;
  const inactiveCount = (individuals?.length || 0) - activeCount;

  const unlinkedActiveCount = useMemo(() =>
    deployments?.filter((d) => !d.deployOff && !d.individualId).length || 0,
    [deployments]
  );

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const res = await apiRequest("POST", `/api/studies/${studyId}/repair-deployments`);
      let data: { total?: number; linked?: number; unlinked?: number } = {};
      try { data = await res.json(); } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "deployments"] });
      toast({
        title: "Reparacion completada",
        description: `${data.linked || 0} deployments vinculados, ${data.unlinked || 0} sin vincular de ${data.total || 0} total`,
      });
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
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "deployments"] });
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
      toast({ title: "Error al sincronizar", description: errorMsg, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const openEditDialog = (ind: Individual) => {
    const hasActive = activeDeploymentIndividualIds.has(ind.movebankId);
    const indDeployments = deployments?.filter(d => d.individualId === ind.movebankId) || [];
    const activeDep = indDeployments.find(d => !d.deployOff);
    setEditingIndividual(ind);
    setEditForm({
      nickName: ind.nickName || "",
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
        sex: editForm.sex || null,
        animalLifeStage: editForm.animalLifeStage || null,
      });

      const hasActive = activeDeploymentIndividualIds.has(editingIndividual.movebankId);
      const indDeployments = deployments?.filter(d => d.individualId === editingIndividual.movebankId) || [];
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
          <p className="text-sm text-muted-foreground">
            Movebank Study ID: {study.movebankStudyId}
          </p>
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
          <Link href={`/study/${studyId}/data`}>
            <Button variant="outline" data-testid="button-raw-data">
              <Database className="w-4 h-4 mr-2" />
              Datos brutos
            </Button>
          </Link>
          <Link href={`/study/${studyId}/import`}>
            <Button variant="outline" data-testid="button-import-csv">
              <Upload className="w-4 h-4 mr-2" />
              Importar CSV
            </Button>
          </Link>
          {isSuperuser && unlinkedActiveCount > 0 && (
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
          <Button
            onClick={handleSync}
            disabled={syncing}
            data-testid="button-sync-movebank"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar con Movebank"}
          </Button>
        </div>
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
                      {unlinkedActiveCount} deployments sin vincular
                    </Badge>
                    {isSuperuser && (
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
                    {isSuperuser && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIndividuals.map((ind) => {
                    const hasActive = activeDeploymentIndividualIds.has(ind.movebankId);
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
                        {isSuperuser && (
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
            {deploymentStatus === "inactive" && activeDeploymentIndividualIds.has(editingIndividual?.movebankId ?? 0) && (
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
