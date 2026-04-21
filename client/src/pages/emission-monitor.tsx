import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import type { EmissionAlert } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  WifiOff,
  Loader2,
  Search,
  ExternalLink,
  Bell,
  Plus,
  Trash2,
  AlertTriangle,
  RadioTower,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { usePermissions } from "@/hooks/use-permissions";

interface EmissionResult {
  animalId: string;
  studyName: string;
  studyId: string;
  lastEmission: number | null;
  daysSilent: number | null;
  lat: number | null;
  lng: number | null;
}

export default function EmissionMonitor() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { canConfigureAlerts } = usePermissions();
  const [days, setDays] = useState("3");
  const [results, setResults] = useState<EmissionResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; animalId: string } | null>(null);
  const [partialMessage, setPartialMessage] = useState<string | null>(null);
  const [showAlertDialog, setShowAlertDialog] = useState(false);
  const [alertDays, setAlertDays] = useState("3");
  const [alertEmail, setAlertEmail] = useState(user?.email || "");

  const { data: emissionAlerts, isLoading: alertsLoading } = useQuery<EmissionAlert[]>({
    queryKey: ["/api/emission-alerts"],
  });

  const createAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/emission-alerts", {
        daysThreshold: parseInt(alertDays, 10),
        email: alertEmail,
        active: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emission-alerts"] });
      setShowAlertDialog(false);
      toast({ title: "Alerta configurada", description: `Se te notificara si algun animal deja de emitir por mas de ${alertDays} dias` });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const toggleAlertMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/emission-alerts/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emission-alerts"] });
    },
  });

  const deleteAlertMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/emission-alerts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emission-alerts"] });
      toast({ title: "Alerta eliminada" });
    },
  });

  const handleSearch = async () => {
    const d = parseInt(days, 10);
    if (isNaN(d) || d < 1) {
      toast({ title: "Valor invalido", description: "Introduce un numero de dias valido", variant: "destructive" });
      return;
    }

    setSearching(true);
    setResults(null);
    setProgress(null);
    setPartialMessage(null);

    const collected: EmissionResult[] = [];

    try {
      const res = await fetch(`/api/monitor/emissions?days=${d}`, { credentials: "include" });
      if (!res.ok || !res.body) {
        throw new Error("Error al consultar emisiones");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "progress") {
            setProgress({ current: evt.current, total: evt.total, animalId: evt.animalId });
          } else if (evt.type === "result") {
            collected.push(evt.result);
            // update results live so user sees them appear
            setResults([...collected].sort((a, b) => (b.daysSilent ?? 9999) - (a.daysSilent ?? 9999)));
          } else if (evt.type === "done") {
            if (evt.partial && evt.message) {
              setPartialMessage(evt.message);
            }
            setResults([...collected].sort((a, b) => (b.daysSilent ?? 9999) - (a.daysSilent ?? 9999)));
          } else if (evt.type === "error") {
            throw new Error(evt.message || "Error en monitor");
          }
        }
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSearching(false);
      setProgress(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-monitor-title">
            Monitor de emision
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detecta animales activos que han dejado de enviar datos
          </p>
        </div>
        {canConfigureAlerts && (
          <Button variant="outline" onClick={() => setShowAlertDialog(true)} data-testid="button-configure-alert">
            <Bell className="w-4 h-4 mr-2" />
            Configurar alerta
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Dias sin emitir</Label>
              <Input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-28"
                data-testid="input-days-threshold"
              />
            </div>
            <Button onClick={handleSearch} disabled={searching} data-testid="button-search-emissions">
              {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Buscar
            </Button>
            {results !== null && (
              <p className="text-sm text-muted-foreground">
                {results.length === 0
                  ? "Todos los animales activos estan emitiendo normalmente"
                  : `${results.length} animal(es) sin emision`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {searching && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              {progress ? (
                <>
                  <p className="text-sm font-medium" data-testid="text-progress-counter">
                    Consultando animal {progress.current} de {progress.total}
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-progress-animal">
                    {progress.animalId}
                  </p>
                  <div className="w-full max-w-md h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Iniciando consulta...</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {partialMessage && !searching && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
            <p className="text-sm text-foreground" data-testid="text-partial-message">
              {partialMessage}
            </p>
          </CardContent>
        </Card>
      )}

      {results !== null && !searching && results.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Animal</TableHead>
                    <TableHead>Estudio</TableHead>
                    <TableHead>Ultima emision</TableHead>
                    <TableHead>Dias sin emitir</TableHead>
                    <TableHead>Ubicacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, idx) => (
                    <TableRow key={`${r.studyId}-${r.animalId}-${idx}`} data-testid={`row-emission-${r.animalId}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <WifiOff className="w-3.5 h-3.5 text-destructive shrink-0" />
                          <span className="font-medium">{r.animalId}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.studyName}</TableCell>
                      <TableCell>
                        {r.lastEmission ? (
                          format(new Date(r.lastEmission), "dd/MM/yyyy HH:mm", { locale: es })
                        ) : (
                          <span className="text-muted-foreground">Sin datos</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.daysSilent !== null ? (
                          <Badge
                            variant="outline"
                            className={
                              r.daysSilent >= 7
                                ? "border-destructive text-destructive"
                                : r.daysSilent >= 3
                                  ? "border-orange-500 text-orange-500"
                                  : ""
                            }
                          >
                            {r.daysSilent} dias
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-destructive text-destructive">Desconocido</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.lat && r.lng ? (
                          <a
                            href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm flex items-center gap-1 text-blue-500 hover:underline"
                            data-testid={`link-maps-${r.animalId}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            Google Maps
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
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

      {results !== null && !searching && results.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <RadioTower className="w-12 h-12 mx-auto mb-3 text-emerald-500/30" />
            <p className="text-sm text-muted-foreground">
              Todos los animales activos han emitido datos en los ultimos {days} dias
            </p>
          </CardContent>
        </Card>
      )}

      {emissionAlerts && emissionAlerts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Alertas configuradas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {emissionAlerts.map((alert) => (
              <Card key={alert.id} data-testid={`card-alert-${alert.id}`}>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-500" />
                      <span className="text-sm font-medium">
                        Avisar si &gt; {alert.daysThreshold} dias sin emitir
                      </span>
                    </div>
                    <Switch
                      checked={alert.active}
                      onCheckedChange={(val) => toggleAlertMutation.mutate({ id: alert.id, active: val })}
                      data-testid={`switch-alert-${alert.id}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{alert.email}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteAlertMutation.mutate(alert.id)}
                      data-testid={`button-delete-alert-${alert.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {alert.lastSentAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Ultimo envio: {format(new Date(alert.lastSentAt), "dd/MM/yyyy HH:mm", { locale: es })}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showAlertDialog} onOpenChange={setShowAlertDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar alerta de emision</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Avisar si un animal deja de emitir por mas de</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={alertDays}
                  onChange={(e) => setAlertDays(e.target.value)}
                  className="w-24"
                  data-testid="input-alert-days"
                />
                <span className="text-sm text-muted-foreground">dias</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email de notificacion</Label>
              <Input
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                data-testid="input-alert-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAlertDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => createAlertMutation.mutate()}
              disabled={createAlertMutation.isPending}
              data-testid="button-save-alert"
            >
              {createAlertMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar alerta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
