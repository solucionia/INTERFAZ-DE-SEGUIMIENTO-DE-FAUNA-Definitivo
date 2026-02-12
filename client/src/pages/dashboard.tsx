import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import type { Study, DetectedEvent } from "@shared/schema";
import { EVENT_LABELS, EVENT_COLORS } from "@shared/schema";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, PawPrint, Activity, ArrowRight, AlertTriangle, Bell, Wifi } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface DashboardSummary {
  totalAnimals: number;
  recentAlerts: DetectedEvent[];
  alertCountsByType: Record<string, number>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
  });

  const activeCount = studies?.filter((s) => s.active).length || 0;
  const totalCount = studies?.length || 0;
  const totalAlerts = summary ? Object.values(summary.alertCountsByType).reduce((s, n) => s + n, 0) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-dashboard-title">
          Bienvenido, {user?.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Panel de seguimiento de fauna silvestre
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Total estudios</p>
                <p className="text-2xl font-bold" data-testid="text-total-studies">
                  {isLoading ? <Skeleton className="h-8 w-12 rounded" /> : totalCount}
                </p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <Radio className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Estudios activos</p>
                <p className="text-2xl font-bold" data-testid="text-active-studies">
                  {isLoading ? <Skeleton className="h-8 w-12 rounded" /> : activeCount}
                </p>
              </div>
              <div className="p-2 rounded-md bg-emerald-500/10">
                <Activity className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Animales registrados</p>
                <p className="text-2xl font-bold" data-testid="text-total-animals">
                  {summaryLoading ? <Skeleton className="h-8 w-12 rounded" /> : summary?.totalAnimals || 0}
                </p>
              </div>
              <div className="p-2 rounded-md bg-blue-500/10">
                <PawPrint className="w-5 h-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Alertas (30 dias)</p>
                <p className="text-2xl font-bold" data-testid="text-total-alerts">
                  {summaryLoading ? <Skeleton className="h-8 w-12 rounded" /> : totalAlerts}
                </p>
              </div>
              <div className="p-2 rounded-md bg-amber-500/10">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {summary && totalAlerts > 0 && (
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Alertas por tipo (ultimo mes)
              </h2>
              <Link href="/alerts">
                <span className="text-xs text-primary hover:underline cursor-pointer" data-testid="link-view-all-alerts">Ver historial completo</span>
              </Link>
            </div>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(summary.alertCountsByType).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: EVENT_COLORS[type as keyof typeof EVENT_COLORS] || "#888" }} />
                  <span className="text-sm">{EVENT_LABELS[type as keyof typeof EVENT_LABELS] || type}: <strong>{count}</strong></span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {summary && summary.recentAlerts.length > 0 && (
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Alertas recientes
            </h2>
            <div className="space-y-2">
              {summary.recentAlerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="flex items-center gap-3 text-sm flex-wrap" data-testid={`alert-recent-${alert.id}`}>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: EVENT_COLORS[alert.eventType as keyof typeof EVENT_COLORS] || "#888" }} />
                  <span className="font-medium">{alert.individualLocalId}</span>
                  <span className="text-muted-foreground">{EVENT_LABELS[alert.eventType as keyof typeof EVENT_LABELS] || alert.eventType}</span>
                  <Badge variant="outline" className="text-xs" style={{
                    borderColor: alert.severity === "critical" ? "#ef4444" : alert.severity === "high" ? "#f97316" : "#22c55e",
                    color: alert.severity === "critical" ? "#ef4444" : alert.severity === "high" ? "#f97316" : "#22c55e",
                  }}>
                    {alert.severity === "critical" ? "Critica" : alert.severity === "high" ? "Alta" : "Info"}
                  </Badge>
                  {alert.createdAt && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {format(new Date(alert.createdAt), "dd/MM/yyyy HH:mm", { locale: es })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Tus estudios</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <Skeleton className="h-5 w-3/4 mb-3 rounded" />
                  <Skeleton className="h-4 w-1/2 mb-2 rounded" />
                  <Skeleton className="h-4 w-1/3 rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : studies && studies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {studies.map((study) => (
              <Link key={study.id} href={`/study/${study.id}`}>
                <Card className="hover-elevate cursor-pointer group" data-testid={`card-study-${study.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                        {study.name}
                      </h3>
                      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        Movebank ID: {study.movebankStudyId}
                      </span>
                      {study.active ? (
                        <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs opacity-50">Inactivo</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Radio className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No tienes estudios asignados aun</p>
              {user?.role === "superuser" && (
                <Link href="/admin/studies">
                  <span className="text-sm text-primary hover:underline mt-2 inline-block cursor-pointer">
                    Crear un estudio
                  </span>
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
