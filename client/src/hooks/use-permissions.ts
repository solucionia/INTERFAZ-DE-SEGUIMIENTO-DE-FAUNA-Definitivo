import { useAuth } from "@/lib/auth";

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role;
  return {
    canExport: role === "superuser" || role === "user",
    canImport: role === "superuser" || role === "user",
    canAnalyze: role === "superuser" || role === "user",
    canDetectEvents: role === "superuser" || role === "user",
    canEditStudies: role === "superuser",
    canEditIndividuals: role === "superuser" || role === "user",
    canManageUsers: role === "superuser",
    canManageProfiles: role === "superuser",
    canSync: role === "superuser",
    canRepair: role === "superuser",
    canConfigureAlerts: role === "superuser" || role === "user",
    isObserver: role === "observer",
    isSuperuser: role === "superuser",
  };
}

export const ROLE_LABELS: Record<string, string> = {
  superuser: "Superusuario",
  user: "Investigador",
  observer: "Observador",
};
