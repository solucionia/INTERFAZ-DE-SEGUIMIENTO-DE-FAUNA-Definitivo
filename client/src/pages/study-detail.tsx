import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import type { Study, Individual, Deployment, Project } from "@shared/schema";
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
import { RefreshCw, PawPrint, AlertCircle, BarChart3, RadioTower, WifiOff, Globe, Database, AlertTriangle, Upload, Search, Pencil, Plus, Wrench, Link2, MapPin, ChevronDown, ChevronUp, Loader2, ExternalLink, ArrowRightLeft, Power, PowerOff, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useRegisterSync } from "@/lib/sync-status";
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
  const [projectFilterId, setProjectFilterId] = useState<string>("all");
  const [editingIndividual, setEditingIndividual] = useState<Individual | null>(null);
  const [transferringIndividual, setTransferringIndividual] = useState<Individual | null>(null);
  const [transferToId, setTransferToId] = useState<string>("");
  const [transferDate, setTransferDate] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [transferNotes, setTransferNotes] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  const [editForm, setEditForm] = useState({ nickName: "", taxon: "", sex: "", animalLifeStage: "", projectId: "" as string, historyNumber: "", officialRingId: "", pvcRingId: "" });
  const [deploymentStatus, setDeploymentStatus] = useState<"active" | "inactive">("active");
  const [deployOffDate, setDeployOffDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [ornitelaSyncing, setOrnitelaSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ processed: number; total: number; gps: number; acc: number; current?: string; stopped?: boolean } | null>(null);
  const [ornitelaDevices, setOrnitelaDevices] = useState<any[]>([]);
  const [ornitelaDevicesLoading, setOrnitelaDevicesLoading] = useState(false);
  const [ornitelaSyncResult, setOrnitelaSyncResult] = useState<any>(null);
  const [ornitelaProgress, setOrnitelaProgress] = useState<{ processed: number; total: number; gps: number; acc: number; current?: string } | null>(null);
  const [ornitelaPanelOpen, setOrnitelaPanelOpen] = useState(false);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    refetchInterval: 60000,
  });

  const { data: deployments } = useQuery<Deployment[]>({
    queryKey: ["/api/studies", studyId, "deployments"],
    enabled: !!studyId,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: gpsCounts } = useQuery<Record<string, { count: number; lastTimestamp: number | null }>>({
    queryKey: ["/api/studies", studyId, "gps-counts"],
    enabled: !!studyId,
    staleTime: 60000,
    refetchInterval: 60000,
  });

  useRegisterSync("Movebank: sincronizando estudio", syncing);
  useRegisterSync("Movebank: backfill", backfilling);
  useRegisterSync("Ornitela: sincronizando", ornitelaSyncing);

  const { data: allProjects } = useQuery<(Project & { animalCount: number })[]>({
    queryKey: ["/api/projects"],
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
    if (projectFilterId !== "all") {
      result = result.filter((ind) => ind.projectId === Number(projectFilterId));
    }
    if (searchQuery.trim()) {
      const norm = searchQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      result = result.filter((ind) => {
        const fields = [
          ind.localIdentifier || "",
          ind.nickName || "",
          ind.ornitelaName || "",
          ind.taxonCanonicalName || "",
        ];
        return fields.some((f) =>
          f.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(norm)
        );
      });
    }
    return result;
  }, [individuals, filterMode, activeDeploymentIndividualIds, searchQuery, projectFilterId]);

  const projectIdsInStudy = useMemo(() => {
    if (!individuals) return new Set<number | null>();
    return new Set(individuals.map(ind => ind.projectId).filter((id): id is number => id != null));
  }, [individuals]);

  const projectMap = useMemo(() => {
    if (!allProjects) return new Map<number, string>();
    return new Map(allProjects.map(p => [p.id, p.descripcion]));
  }, [allProjects]);

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

  const handleBackfill = async () => {
    if (!studyId) return;
    setBackfilling(true);
    setBackfillProgress({ processed: 0, total: 0, gps: 0, acc: 0 });

    let startIndex = 0;
    let totalAll = 0;
    let cumulativeProcessed = 0;
    let cumulativeGps = 0;
    let cumulativeAcc = 0;
    let aborted = false;
    let stoppedByRateLimit = false;
    let lastStatus: string = "success";
    let lastDuration: string | undefined;

    try {
      while (!aborted) {
        const res = await fetch(`/api/studies/${studyId}/backfill`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ startIndex, maxAnimals: 50 }),
        });
        if (!res.ok || !res.body) {
          let msg = `Error ${res.status}`;
          try { const j = await res.json(); if (j.message) msg = j.message; } catch {}
          toast({ title: "No se pudo iniciar el backfill", description: msg, variant: "destructive" });
          aborted = true;
          break;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let nextStartIndex: number | null = null;
        let hasMore = false;
        let receivedDone = false;
        let batchDone = false;

        while (!batchDone) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const lines = part.split("\n");
            let evtName = "message";
            let dataStr = "";
            for (const ln of lines) {
              if (ln.startsWith("event:")) evtName = ln.slice(6).trim();
              else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim();
            }
            if (!dataStr) continue;
            let payload: any = {};
            try { payload = JSON.parse(dataStr); } catch { continue; }

            if (evtName === "start") {
              totalAll = payload.totalAll || payload.total || 0;
              setBackfillProgress({
                processed: cumulativeProcessed,
                total: totalAll,
                gps: cumulativeGps,
                acc: cumulativeAcc,
              });
            } else if (evtName === "animal") {
              setBackfillProgress({
                processed: startIndex + (payload.processed || 0),
                total: totalAll,
                gps: cumulativeGps + (payload.totalGps || 0),
                acc: cumulativeAcc + (payload.totalAcc || 0),
                current: payload.localId,
              });
            } else if (evtName === "rate-limit") {
              stoppedByRateLimit = true;
              toast({ title: "Movebank limitado", description: payload.reason || "Se alcanzó el límite de Movebank", variant: "destructive" });
            } else if (evtName === "animal-error") {
              // continúa
            } else if (evtName === "done") {
              cumulativeProcessed = startIndex + (payload.processed || 0);
              cumulativeGps += payload.totalGps || 0;
              cumulativeAcc += payload.totalAcc || 0;
              hasMore = !!payload.hasMore;
              nextStartIndex = payload.nextStartIndex ?? null;
              if (payload.stoppedByRateLimit) stoppedByRateLimit = true;
              if (payload.aborted) aborted = true;
              lastStatus = payload.status || lastStatus;
              lastDuration = payload.durationSec;
              receivedDone = true;
              batchDone = true;
            } else if (evtName === "error") {
              toast({ title: "Error en backfill", description: payload.message || "Error desconocido", variant: "destructive" });
              aborted = true;
              batchDone = true;
            }
          }
        }

        if (aborted) break;
        if (!receivedDone) {
          aborted = true;
          toast({ title: "Conexión interrumpida", description: "El stream se cerró antes de completar el lote. Datos parciales guardados.", variant: "destructive" });
          break;
        }
        if (stoppedByRateLimit) break;
        if (!hasMore || nextStartIndex == null) break;
        if (nextStartIndex <= startIndex) {
          aborted = true;
          toast({ title: "Backfill interrumpido", description: "El servidor no avanzó el índice de paginación. Datos parciales guardados.", variant: "destructive" });
          break;
        }
        startIndex = nextStartIndex;
      }

      const finalTotal = totalAll || cumulativeProcessed;
      setBackfillProgress({
        processed: cumulativeProcessed,
        total: finalTotal,
        gps: cumulativeGps,
        acc: cumulativeAcc,
        stopped: stoppedByRateLimit,
      });

      const desc = `${cumulativeProcessed}/${finalTotal} animales · ${cumulativeGps} GPS · ${cumulativeAcc} ACC${lastDuration ? ` · último lote ${lastDuration}s` : ""}`;
      const finalStatus = stoppedByRateLimit ? "partial" : (aborted ? "aborted" : (lastStatus || "success"));
      if (!aborted || stoppedByRateLimit) {
        toast({
          title: finalStatus === "success" ? "Backfill completado" : finalStatus === "partial" ? "Backfill parcial (límite Movebank)" : "Backfill abortado",
          description: desc,
          variant: finalStatus === "success" ? "default" : "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "gps-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "last-positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movebank/status"] });
    } catch (e: any) {
      toast({ title: "Error en backfill", description: e.message || "Error desconocido", variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  };

  const handleOrnitelaSync = async () => {
    if (!studyId) return;
    setOrnitelaSyncing(true);
    setOrnitelaSyncResult(null);
    setOrnitelaProgress({ processed: 0, total: 0, gps: 0, acc: 0 });

    const accumulated: { devices: number; totalGps: number; totalAcc: number; totalGpsDup: number; totalAccDup: number; totalErrors: number; deviceResults: any[] } = {
      devices: 0, totalGps: 0, totalAcc: 0, totalGpsDup: 0, totalAccDup: 0, totalErrors: 0, deviceResults: [],
    };

    let startIndex = 0;
    let totalDevicesGlobal = 0;
    let aborted = false;

    try {
      while (!aborted) {
        const res = await fetch(`/api/studies/${studyId}/ornitela-sync`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ hoursBack: 168, startIndex, maxDevices: 50 }),
        });
        if (!res.ok || !res.body) {
          let msg = `Error ${res.status}`;
          try { const j = await res.json(); if (j.message) msg = j.message; } catch {}
          toast({ title: "Error Ornitela", description: msg, variant: "destructive" });
          aborted = true;
          break;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let nextStartIndex: number | null = null;
        let hasMore = false;
        let batchDone = false;
        let receivedDone = false;

        while (!batchDone) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const lines = part.split("\n");
            let evtName = "message";
            let dataStr = "";
            for (const ln of lines) {
              if (ln.startsWith("event:")) evtName = ln.slice(6).trim();
              else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim();
            }
            if (!dataStr) continue;
            let payload: any = {};
            try { payload = JSON.parse(dataStr); } catch { continue; }

            if (evtName === "start") {
              totalDevicesGlobal = payload.totalDevices || 0;
              setOrnitelaProgress(p => ({
                processed: p?.processed || 0,
                total: totalDevicesGlobal,
                gps: p?.gps || 0,
                acc: p?.acc || 0,
              }));
            } else if (evtName === "device") {
              accumulated.deviceResults.push({
                imei: payload.imei, name: payload.name,
                gps: payload.gps || 0, acc: payload.acc || 0,
                gpsDup: payload.gpsDup, accDup: payload.accDup,
                error: payload.error, subformat: payload.subformat,
              });
              accumulated.totalGps += payload.gps || 0;
              accumulated.totalAcc += payload.acc || 0;
              accumulated.totalGpsDup += payload.gpsDup || 0;
              accumulated.totalAccDup += payload.accDup || 0;
              accumulated.devices = accumulated.deviceResults.length;
              setOrnitelaProgress({
                processed: startIndex + (payload.processed || 0),
                total: totalDevicesGlobal,
                gps: accumulated.totalGps,
                acc: accumulated.totalAcc,
                current: payload.name || payload.imei,
              });
            } else if (evtName === "done") {
              hasMore = !!payload.hasMore;
              nextStartIndex = payload.nextStartIndex ?? null;
              receivedDone = true;
              batchDone = true;
            } else if (evtName === "error") {
              toast({ title: "Error Ornitela", description: payload.message || "Error desconocido", variant: "destructive" });
              aborted = true;
              batchDone = true;
            }
          }
        }

        if (aborted) break;
        if (!receivedDone) {
          aborted = true;
          toast({ title: "Conexión interrumpida", description: "El stream se cerró antes de completar el lote. Datos parciales guardados.", variant: "destructive" });
          break;
        }
        if (!hasMore || nextStartIndex == null) break;
        startIndex = nextStartIndex;
      }

      if (!aborted) {
        setOrnitelaSyncResult(accumulated);
        queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId] });
        queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
        queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "gps-counts"] });
        toast({
          title: "Sincronización Ornitela completada",
          description: `${accumulated.devices}/${totalDevicesGlobal || accumulated.devices} dispositivos · ${accumulated.totalGps} GPS · ${accumulated.totalAcc} ACC`,
        });
      } else if (accumulated.devices > 0) {
        setOrnitelaSyncResult(accumulated);
      }
    } catch (e: any) {
      toast({ title: "Error Ornitela", description: e.message || "Error desconocido", variant: "destructive" });
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
      projectId: ind.projectId ? String(ind.projectId) : "",
      historyNumber: ind.historyNumber || "",
      officialRingId: ind.officialRingId || "",
      pvcRingId: ind.pvcRingId || "",
    });
    setDeploymentStatus(hasActive ? "active" : "inactive");
    setDeployOffDate(activeDep?.deployOff || "");
  };

  const handleToggleActive = async (ind: Individual) => {
    const makeInactive = ind.isActive !== false;
    const label = ind.nickName || ind.localIdentifier || String(ind.movebankId);
    const msg = makeInactive
      ? `¿Marcar "${label}" como inactivo?\n\nDejará de generar alertas nuevas (mortalidad, sin transmisión, desviación de zona, eventos ACC). Su historial seguirá visible.`
      : `¿Reactivar "${label}"?\n\nVolverá a generar alertas normalmente.`;
    if (!window.confirm(msg)) return;
    setTogglingActiveId(ind.id);
    try {
      await apiRequest("PATCH", `/api/individuals/${ind.id}/active-status`, { isActive: !makeInactive });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/individuals/all"] });
      toast({
        title: makeInactive ? "Animal marcado como inactivo" : "Animal reactivado",
        description: makeInactive
          ? `${label} ya no generará alertas nuevas. Su historial sigue disponible.`
          : `${label} vuelve a generar alertas.`,
      });
    } catch (e: any) {
      toast({ title: "Error al cambiar estado", description: e.message || "Error desconocido", variant: "destructive" });
    } finally {
      setTogglingActiveId(null);
    }
  };

  const handleDeleteIndividual = async (ind: Individual) => {
    const label = ind.nickName || ind.localIdentifier || String(ind.movebankId);
    const msg = `¿Eliminar por completo a "${label}"?\n\nSe borrarán el individuo y TODOS sus datos asociados (posiciones GPS, acelerómetro, eventos detectados, etiquetas y despliegues). Esta acción NO se puede deshacer.`;
    if (!window.confirm(msg)) return;
    setDeletingId(ind.id);
    try {
      await apiRequest("DELETE", `/api/individuals/${ind.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/individuals/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "gps-counts"] });
      toast({
        title: "Individuo eliminado",
        description: `${label} y sus datos han sido eliminados por completo.`,
      });
    } catch (e: any) {
      toast({ title: "Error al eliminar", description: e.message || "Error desconocido", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
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
        projectId: editForm.projectId ? Number(editForm.projectId) : null,
        historyNumber: editForm.historyNumber.trim() || null,
        officialRingId: editForm.officialRingId.trim() || null,
        pvcRingId: editForm.pvcRingId.trim() || null,
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
          {isSuperuser && (
            <Button
              onClick={handleBackfill}
              disabled={backfilling || mbStatus?.blocked}
              variant="secondary"
              title={mbStatus?.blocked && mbStatus.blockedUntil ? `Disponible a las ${new Date(mbStatus.blockedUntil).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Descarga GPS/ACC de los últimos 90 días por animal"}
              data-testid="button-backfill-gps"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${backfilling ? "animate-spin" : ""}`} />
              {backfilling && backfillProgress
                ? `Descargando ${backfillProgress.processed}/${backfillProgress.total}…`
                : "Sincronizar datos GPS"}
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
              {ornitelaSyncing && ornitelaProgress && ornitelaProgress.total > 0
                ? `Ornitela ${ornitelaProgress.processed}/${ornitelaProgress.total}…`
                : ornitelaSyncing
                ? "Sincronizando..."
                : "Sincronizar Ornitela"}
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
              {projectIdsInStudy.size > 0 && (
                <Select value={projectFilterId} onValueChange={setProjectFilterId}>
                  <SelectTrigger className="w-52" data-testid="select-filter-project">
                    <SelectValue placeholder="Todos los proyectos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los proyectos</SelectItem>
                    {allProjects?.filter(p => projectIdsInStudy.has(p.id)).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.descripcion}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Nº Historial</TableHead>
                    <TableHead>Anilla oficial</TableHead>
                    <TableHead>Anilla PVC</TableHead>
                    <TableHead>GPS local</TableHead>
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
                            {ind.ornitelaName
                              ? `${ind.ornitelaName} (${ind.localIdentifier || `ID-${ind.movebankId}`})`
                              : (ind.localIdentifier || `ID-${ind.movebankId}`)}
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
                        <TableCell className="text-muted-foreground text-xs max-w-[180px] truncate">
                          {ind.projectId ? (projectMap.get(ind.projectId) || "—") : "—"}
                        </TableCell>
                        <TableCell>
                          {ind.historyNumber?.trim() ? (
                            <a
                              href={`http://192.168.2.1/buho/formulario_historiales.php?editar_exp=${encodeURIComponent(ind.historyNumber.trim())}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-400 hover:underline text-sm"
                              data-testid={`link-history-${ind.movebankId}`}
                            >
                              {ind.historyNumber.trim()}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ind.officialRingId || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ind.pvcRingId || "—"}
                        </TableCell>
                        <TableCell data-testid={`text-gps-count-${ind.movebankId}`}>
                          {(() => {
                            const entry = gpsCounts?.[ind.localIdentifier || `ID-${ind.movebankId}`];
                            const count = entry?.count ?? 0;
                            if (!entry || count === 0) {
                              return (
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                  <Database className="w-3.5 h-3.5" />
                                  <span className="text-xs">Sin datos</span>
                                </div>
                              );
                            }
                            const lastDate = entry.lastTimestamp
                              ? new Date(entry.lastTimestamp).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })
                              : null;
                            return (
                              <div className="flex flex-col gap-0.5">
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 w-fit">
                                  {count.toLocaleString()}
                                </Badge>
                                {lastDate && (
                                  <span className="text-xs text-muted-foreground">
                                    Último: {lastDate}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
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
                            {ind.isActive === false && (
                              <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/30 w-fit" data-testid={`badge-inactive-${ind.movebankId}`}>
                                Inactivo — sin alertas
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {canEditIndividuals && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEditDialog(ind)}
                                data-testid={`button-edit-individual-${ind.movebankId}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              {isSuperuser && ind.localIdentifier && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Transferir dispositivo a otro animal"
                                  onClick={() => {
                                    setTransferringIndividual(ind);
                                    setTransferToId("");
                                    setTransferDate(new Date().toISOString().slice(0, 16));
                                    setTransferNotes("");
                                  }}
                                  data-testid={`button-transfer-device-${ind.movebankId}`}
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {canEditIndividuals && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title={ind.isActive === false ? "Reactivar animal (volverá a generar alertas)" : "Marcar como inactivo (dejará de generar alertas)"}
                                  disabled={togglingActiveId === ind.id}
                                  onClick={() => handleToggleActive(ind)}
                                  data-testid={`button-toggle-active-${ind.movebankId}`}
                                >
                                  {togglingActiveId === ind.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : ind.isActive === false ? (
                                    <Power className="w-3.5 h-3.5 text-emerald-500" />
                                  ) : (
                                    <PowerOff className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                </Button>
                              )}
                              {isSuperuser && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Eliminar individuo por completo (borra todos sus datos)"
                                  disabled={deletingId === ind.id}
                                  onClick={() => handleDeleteIndividual(ind)}
                                  data-testid={`button-delete-individual-${ind.movebankId}`}
                                >
                                  {deletingId === ind.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                  )}
                                </Button>
                              )}
                            </div>
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
                    {ornitelaSyncing && ornitelaProgress && ornitelaProgress.total > 0
                      ? `${ornitelaProgress.processed}/${ornitelaProgress.total}…`
                      : ornitelaSyncing
                      ? "Sincronizando..."
                      : "Sincronizar ahora"}
                  </Button>
                  {ornitelaSyncing && ornitelaProgress && ornitelaProgress.total > 0 && (
                    <span className="text-xs text-muted-foreground" data-testid="text-ornitela-progress">
                      {ornitelaProgress.gps} GPS · {ornitelaProgress.acc} ACC{ornitelaProgress.current ? ` · ${ornitelaProgress.current}` : ""}
                    </span>
                  )}
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

      <Dialog
        open={!!transferringIndividual}
        onOpenChange={(open) => { if (!open) setTransferringIndividual(null); }}
      >
        <DialogContent data-testid="dialog-transfer-device">
          <DialogHeader>
            <DialogTitle>Transferir dispositivo</DialogTitle>
          </DialogHeader>
          {transferringIndividual && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Dispositivo:</span>{" "}
                  <span className="font-mono font-medium">{transferringIndividual.localIdentifier}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Animal origen:</span>{" "}
                  <span className="font-medium">
                    {transferringIndividual.nickName || transferringIndividual.ornitelaName || `ID-${transferringIndividual.movebankId}`}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Animal destino</Label>
                <Select value={transferToId} onValueChange={setTransferToId}>
                  <SelectTrigger data-testid="select-transfer-target">
                    <SelectValue placeholder="Selecciona un animal del mismo estudio" />
                  </SelectTrigger>
                  <SelectContent>
                    {(individuals || [])
                      .filter((i) => i.id !== transferringIndividual.id && !i.localIdentifier)
                      .map((i) => (
                        <SelectItem key={i.id} value={i.id} data-testid={`option-transfer-target-${i.movebankId}`}>
                          {i.nickName || i.ornitelaName || `ID-${i.movebankId}`}
                          {i.taxonCanonicalName ? ` — ${i.taxonCanonicalName}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Solo se listan animales del estudio sin dispositivo asignado.
                </p>
              </div>

              <div className="space-y-1">
                <Label>Fecha y hora de la transferencia</Label>
                <Input
                  type="datetime-local"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  data-testid="input-transfer-date"
                />
                <p className="text-xs text-muted-foreground">
                  Los datos GPS/ACC anteriores a esta fecha se atribuirán al animal de origen, y los posteriores al de destino.
                </p>
              </div>

              <div className="space-y-1">
                <Label>Notas (opcional)</Label>
                <Textarea
                  rows={2}
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="Motivo del cambio, observaciones..."
                  data-testid="input-transfer-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferringIndividual(null)} data-testid="button-cancel-transfer">
              Cancelar
            </Button>
            <Button
              disabled={!transferringIndividual || !transferToId || !transferDate || transferring}
              onClick={async () => {
                if (!transferringIndividual) return;
                setTransferring(true);
                try {
                  await apiRequest("POST", "/api/device-transfers", {
                    fromIndividualId: transferringIndividual.id,
                    toIndividualId: transferToId,
                    deviceLocalIdentifier: transferringIndividual.localIdentifier,
                    transferDate: new Date(transferDate).toISOString(),
                    notes: transferNotes || null,
                  });
                  toast({ title: "Dispositivo transferido", description: "Se actualizaron los animales y el historial del dispositivo." });
                  queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "individuals"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/studies", studyId, "gps-counts"] });
                  setTransferringIndividual(null);
                } catch (e: any) {
                  toast({ title: "No se pudo transferir", description: e?.message || "Error inesperado", variant: "destructive" });
                } finally {
                  setTransferring(false);
                }
              }}
              data-testid="button-confirm-transfer"
            >
              {transferring ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingIndividual} onOpenChange={(open) => !open && setEditingIndividual(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Editar: {editingIndividual?.ornitelaName
                ? `${editingIndividual.ornitelaName} (${editingIndividual.localIdentifier || `ID-${editingIndividual.movebankId}`})`
                : (editingIndividual?.localIdentifier || `ID-${editingIndividual?.movebankId}`)}
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
              <Label htmlFor="edit-project">Proyecto</Label>
              <Select value={editForm.projectId || "none"} onValueChange={(v) => setEditForm({ ...editForm, projectId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-edit-project">
                  <SelectValue placeholder="Sin proyecto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proyecto</SelectItem>
                  {allProjects?.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.descripcion}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-history-number">Nº Historial</Label>
              <Input
                id="edit-history-number"
                value={editForm.historyNumber}
                onChange={(e) => setEditForm({ ...editForm, historyNumber: e.target.value })}
                placeholder="Número de expediente"
                data-testid="input-edit-history-number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-official-ring">Anilla oficial</Label>
              <Input
                id="edit-official-ring"
                value={editForm.officialRingId}
                onChange={(e) => setEditForm({ ...editForm, officialRingId: e.target.value })}
                placeholder="Número de anilla oficial"
                data-testid="input-edit-official-ring"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-pvc-ring">Anilla PVC</Label>
              <Input
                id="edit-pvc-ring"
                value={editForm.pvcRingId}
                onChange={(e) => setEditForm({ ...editForm, pvcRingId: e.target.value })}
                placeholder="Número de anilla PVC"
                data-testid="input-edit-pvc-ring"
              />
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
