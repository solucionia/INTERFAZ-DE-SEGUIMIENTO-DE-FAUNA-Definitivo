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
import AdminStudies from "@/pages/admin-studies";
import AdminUsers from "@/pages/admin-users";
import AdminSpeciesProfiles from "@/pages/admin-species-profiles";
import EmissionMonitor from "@/pages/emission-monitor";
import GeoAnalysis from "@/pages/geo-analysis";
import AlertHistory from "@/pages/alert-history";
import RawData from "@/pages/raw-data";
import ImportCsv from "@/pages/import-csv";
import ImmobilityMonitor from "@/pages/immobility-monitor";
import { Loader2, Search } from "lucide-react";
import { GlobalAnimalSearch } from "@/components/global-animal-search";
import type { ComponentType } from "react";

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
      <Route path="/study/:id/visualize" component={StudyVisualization} />
      <Route path="/study/:id/analysis" component={GeoAnalysis} />
      <Route path="/study/:id/data" component={RawData} />
      <Route path="/study/:id/import">{() => <RoleGuard component={ImportCsv} allowed={["superuser", "user"]} />}</Route>
      <Route path="/import">{() => <RoleGuard component={ImportCsv} allowed={["superuser", "user"]} />}</Route>
      <Route path="/admin/studies">{() => <RoleGuard component={AdminStudies} allowed={["superuser"]} />}</Route>
      <Route path="/admin/species-profiles">{() => <RoleGuard component={AdminSpeciesProfiles} allowed={["superuser"]} />}</Route>
      <Route path="/admin/users">{() => <RoleGuard component={AdminUsers} allowed={["superuser"]} />}</Route>
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
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 bg-background z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
                className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground border rounded-md px-3 py-1 hover-elevate"
                data-testid="button-global-search"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Buscar animal...</span>
                <kbd className="text-xs bg-muted px-1.5 py-0.5 rounded">Ctrl+K</kbd>
              </button>
              <ThemeToggle />
            </div>
          </header>
          <GlobalAnimalSearch />
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
            <AppLayout />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
