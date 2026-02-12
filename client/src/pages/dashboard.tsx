import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import type { Study } from "@shared/schema";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, PawPrint, Activity, ArrowRight } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const activeCount = studies?.filter((s) => s.active).length || 0;
  const totalCount = studies?.length || 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-dashboard-title">
          Bienvenido, {user?.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Panel de seguimiento de fauna silvestre
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <p className="text-xs text-muted-foreground mb-1">Tu rol</p>
                <p className="text-lg font-semibold" data-testid="text-user-role">
                  {user?.role === "superuser" ? "Superusuario" : "Usuario"}
                </p>
              </div>
              <div className="p-2 rounded-md bg-amber-500/10">
                <PawPrint className="w-5 h-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
              <p className="text-sm text-muted-foreground">No tienes estudios asignados aún</p>
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
