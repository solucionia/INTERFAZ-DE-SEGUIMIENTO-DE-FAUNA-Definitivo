import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { usePermissions, ROLE_LABELS } from "@/hooks/use-permissions";
import type { Study } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PawPrint, LayoutDashboard, Settings, Users, ChevronUp, LogOut, Radio, Dna, WifiOff, Bell, FileText, Upload, HeartPulse, MapPin, Bug, FolderOpen, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { isSuperuser, canImport } = usePermissions();

  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="p-1.5 rounded-md bg-primary/10">
              <PawPrint className="w-5 h-5 text-primary" />
            </div>
            <span className="font-bold text-base text-sidebar-foreground">WildTrack</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {isSuperuser && (
          <SidebarGroup>
            <SidebarGroupLabel>Administracion</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/studies"}>
                    <Link href="/admin/studies" data-testid="link-admin-studies">
                      <Settings className="w-4 h-4" />
                      <span>Gestionar estudios</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/species-profiles"}>
                    <Link href="/admin/species-profiles" data-testid="link-admin-species">
                      <Dna className="w-4 h-4" />
                      <span>Perfiles de especie</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/users"}>
                    <Link href="/admin/users" data-testid="link-admin-users">
                      <Users className="w-4 h-4" />
                      <span>Usuarios</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/ref-species"}>
                    <Link href="/admin/ref-species" data-testid="link-admin-ref-species">
                      <Bug className="w-4 h-4" />
                      <span>Especies</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/ref-projects"}>
                    <Link href="/admin/ref-projects" data-testid="link-admin-ref-projects">
                      <FolderOpen className="w-4 h-4" />
                      <span>Proyectos</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/alerts"}>
                    <Link href="/admin/alerts" data-testid="link-admin-alerts">
                      <Bell className="w-4 h-4" />
                      <span>Alertas</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Herramientas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/last-positions")}>
                  <Link href="/last-positions" data-testid="link-last-positions">
                    <MapPin className="w-4 h-4" />
                    <span>Últimas posiciones</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {studies && studies.length > 0 && (() => {
                const currentStudyId = location.match(/^\/study\/([^/]+)/)?.[1];
                const targetStudyId = (currentStudyId && studies.some((s) => s.id === currentStudyId))
                  ? currentStudyId
                  : studies[0].id;
                return (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.endsWith("/analysis")}>
                      <Link href={`/study/${targetStudyId}/analysis`} data-testid="link-geo-analysis">
                        <Globe className="w-4 h-4" />
                        <span>Análisis geoespacial</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })()}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/immobility"}>
                  <Link href="/immobility" data-testid="link-immobility-monitor">
                    <HeartPulse className="w-4 h-4" />
                    <span>Detector de mortalidad</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/monitor"}>
                  <Link href="/monitor" data-testid="link-emission-monitor">
                    <WifiOff className="w-4 h-4" />
                    <span>Monitor de emision</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/alerts"}>
                  <Link href="/alerts" data-testid="link-alert-history">
                    <Bell className="w-4 h-4" />
                    <span>Historial de alertas</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {canImport && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/import" || location.endsWith("/import")}>
                    <Link href="/import" data-testid="link-import-csv">
                      <Upload className="w-4 h-4" />
                      <span>Importar datos</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Estudios</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <>
                  {[1, 2, 3].map((i) => (
                    <SidebarMenuItem key={i}>
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <Skeleton className="w-4 h-4 rounded" />
                        <Skeleton className="h-4 flex-1 rounded" />
                      </div>
                    </SidebarMenuItem>
                  ))}
                </>
              ) : studies && studies.length > 0 ? (
                studies.map((study) => (
                  <SidebarMenuItem key={study.id}>
                    <SidebarMenuButton asChild isActive={location === `/study/${study.id}` || location.startsWith(`/study/${study.id}/`)}>
                      <Link href={`/study/${study.id}`} data-testid={`link-study-${study.id}`}>
                        <Radio className="w-4 h-4" />
                        <span className="truncate flex-1">{study.name}</span>
                        {study.active ? (
                          <Badge variant="outline" className="text-xs ml-auto bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs ml-auto opacity-50">
                            Inactivo
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <div className="px-3 py-6 text-center">
                  <Radio className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">Sin estudios asignados</p>
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 px-2" data-testid="button-user-menu">
              <Avatar className="w-7 h-7">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start text-left flex-1 min-w-0">
                <span className="text-sm font-medium truncate w-full">{user?.name}</span>
                <span className="text-xs text-muted-foreground truncate w-full">{user?.email}</span>
              </div>
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[user?.role || "user"]}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Cerrar sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
