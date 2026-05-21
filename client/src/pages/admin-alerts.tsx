import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Bell, Info, Cloud } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";

interface ThresholdSetting {
  days: number;
  options: number[];
  default: number;
}

interface MovebankAutoSync {
  enabled: boolean;
  default: boolean;
}

const QUERY_KEY = ["/api/admin/settings/no-transmission-threshold-days"] as const;
const MOVEBANK_QUERY_KEY = ["/api/admin/settings/movebank-auto-sync"] as const;

export default function AdminAlerts() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ThresholdSetting>({
    queryKey: QUERY_KEY,
  });

  const mutation = useMutation({
    mutationFn: async (days: number) => {
      const res = await apiRequest("PUT", "/api/admin/settings/no-transmission-threshold-days", { days });
      return res.json();
    },
    onSuccess: (resp: { days: number }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({
        title: "Umbral actualizado",
        description: `Las alertas de "sin transmisión" dispararán a partir de ${resp.days} días sin posición GPS.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: movebankData, isLoading: movebankLoading } = useQuery<MovebankAutoSync>({
    queryKey: MOVEBANK_QUERY_KEY,
  });

  const movebankMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/admin/settings/movebank-auto-sync", { enabled });
      return res.json();
    },
    onSuccess: (resp: { enabled: boolean }) => {
      queryClient.invalidateQueries({ queryKey: MOVEBANK_QUERY_KEY });
      toast({
        title: resp.enabled ? "Sync automático activado" : "Sync automático desactivado",
        description: resp.enabled
          ? "El sistema descargará datos de Movebank periódicamente."
          : "Movebank solo se consultará cuando inicies un sync manual.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const breadcrumbs = [{ label: "Administración" }, { label: "Alertas" }];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex items-center gap-3">
        <Bell className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Configuración de alertas</h1>
          <p className="text-sm text-muted-foreground">Ajustes globales del sistema de alertas</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="w-4 h-4" />
            Sincronización automática con Movebank
          </CardTitle>
          <CardDescription>
            Cuando está activado, el sistema descarga periódicamente nuevos GPS/ACC de Movebank
            en segundo plano según el cron configurado. Cuando está desactivado, Movebank solo
            se consulta cuando alguien pulsa "Sincronizar datos GPS" en un estudio o ejecuta el
            sync manual. Recomendado: <strong>desactivado</strong> para ahorrar peticiones del
            límite diario (100/día).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {movebankLoading || !movebankData ? (
            <Skeleton className="h-10 w-48" />
          ) : (
            <div className="flex items-center gap-3">
              <Switch
                checked={movebankData.enabled}
                onCheckedChange={(v) => movebankMutation.mutate(v)}
                disabled={movebankMutation.isPending}
                data-testid="switch-movebank-auto-sync"
              />
              <span className="text-sm" data-testid="text-movebank-auto-sync-state">
                {movebankMutation.isPending
                  ? "Guardando..."
                  : movebankData.enabled
                    ? "Sync automático ACTIVADO"
                    : "Sync automático DESACTIVADO (solo manual)"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Umbral "Sin transmisión"</CardTitle>
          <CardDescription>
            Días sin recibir una posición GPS antes de generar una alerta de no-transmisión.
            Solo aplica a estudios con sincronización Ornitela activa; los estudios Movebank no
            generan estas alertas porque tienen ciclos de transmisión muy variables.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-10 w-48" />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="threshold-select">Umbral (días)</Label>
              <Select
                value={String(data.days)}
                onValueChange={(v) => mutation.mutate(Number.parseInt(v, 10))}
                disabled={mutation.isPending}
              >
                <SelectTrigger id="threshold-select" className="w-48" data-testid="select-no-transmission-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.options.map((d) => (
                    <SelectItem key={d} value={String(d)} data-testid={`select-no-transmission-${d}`}>
                      {d} días
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground" data-testid="text-current-threshold">
                Valor actual: <strong>{data.days} días</strong>
                {data.days !== data.default && (
                  <> (por defecto: {data.default} días)</>
                )}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              El cambio se aplica al siguiente ciclo de detección (cron de inmovilidad o
              análisis manual). Las alertas existentes no se modifican retroactivamente.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
