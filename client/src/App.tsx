import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import StudyDetail from "@/pages/study-detail";
import StudyVisualization from "@/pages/study-visualization";
import StudyFullscreen from "@/pages/study-fullscreen";
import AdminStudies from "@/pages/admin-studies";
import AdminUsers from "@/pages/admin-users";
import AdminSpeciesProfiles from "@/pages/admin-species-profiles";
import EmissionMonitor from "@/pages/emission-monitor";
import GeoAnalysis from "@/pages/geo-analysis";
import SelectStudyVisualize from "@/pages/select-study-visualize";
import AlertHistory from "@/pages/alert-history";
import RawData from "@/pages/raw-data";
import ImportCsv from "@/pages/import-csv";
import ImmobilityMonitor from "@/pages/immobility-monitor";
import LastPositions from "@/pages/last-positions";
import AdminSpecies from "@/pages/admin-species";
import AdminProjects from "@/pages/admin-projects";
import AdminAlerts from "@/pages/admin-alerts";
import { Loader2, Search, RefreshCw } from "lucide-react";
import { GlobalAnimalSearch } from "@/components/global-animal-search";
import { ChangelogModal } from "@/components/changelog-modal";
import { NotificationBell } from "@/components/notification-bell";
import { SyncStatusProvider, useSyncStatus } from "@/lib/sync-status";
import type { ComponentType } from "react";

function SyncStatusBadge() {
  const { active } = useSyncStatus();
  if (active.length === 0) return null;
  const label = active.length === 1 ? active[0] : `Sincronizando ${active.length} tareas`;
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-medium animate-pulse"
      data-testid="badge-sync-status"
      title={active.join(", ")}
    >
      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">Sincronizando…</span>
    </div>
  );
}

function RoleGuard({ component: Component, allowed }: { component: ComponentType; allowed: string[] }) {
  const { user } = useAuth();
  if (!user || !allowed.includes(user.role)) {
    return <Redirect to="/" />;
  }
  return <Component />;
}

function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/study/:id" component={StudyDetail} />
      <Route path="/visualize" component={SelectStudyVisualize} />
      <Route path="/study/:id/visualize" component={StudyVisualization} />
      <Route path="/study/:id/analysis" component={GeoAnalysis} />
      <Route path="/study/:id/data" component={RawData} />
      <Route path="/study/:id/import">{() => <RoleGuard component={ImportCsv} allowed={["superuser", "user"]} />}</Route>
      <Route path="/import">{() => <RoleGuard component={ImportCsv} allowed={["superuser", "user"]} />}</Route>
      <Route path="/admin/studies">{() => <RoleGuard component={AdminStudies} allowed={["superuser"]} />}</Route>
      <Route path="/admin/species-profiles">{() => <RoleGuard component={AdminSpeciesProfiles} allowed={["superuser"]} />}</Route>
      <Route path="/admin/users">{() => <RoleGuard component={AdminUsers} allowed={["superuser"]} />}</Route>
      <Route path="/admin/ref-species">{() => <RoleGuard component={AdminSpecies} allowed={["superuser"]} />}</Route>
      <Route path="/admin/ref-projects">{() => <RoleGuard component={AdminProjects} allowed={["superuser"]} />}</Route>
      <Route path="/admin/alerts">{() => <RoleGuard component={AdminAlerts} allowed={["superuser"]} />}</Route>
      <Route path="/last-positions/:id" component={LastPositions} />
      <Route path="/last-positions" component={LastPositions} />
      <Route path="/monitor" component={EmissionMonitor} />
      <Route path="/immobility" component={ImmobilityMonitor} />
      <Route path="/alerts" component={AlertHistory} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  const style = {
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <Switch>
      <Route path="/study/:id/fullscreen" component={StudyFullscreen} />
      <Route>
        <FullLayout style={style as React.CSSProperties} />
      </Route>
    </Switch>
  );
}

function FullLayout({ style }: { style: React.CSSProperties }) {
  return (
    <SidebarProvider style={style}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 bg-background z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <SyncStatusBadge />
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
                className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground border rounded-md px-3 py-1 hover-elevate"
                data-testid="button-global-search"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Buscar animal...</span>
                <kbd className="text-xs bg-muted px-1.5 py-0.5 rounded">Ctrl+K</kbd>
              </button>
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <GlobalAnimalSearch />
          <ChangelogModal />
          <main className="flex-1 overflow-auto">
            <AuthenticatedRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <SyncStatusProvider>
              <AppLayout />
            </SyncStatusProvider>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
