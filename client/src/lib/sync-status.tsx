import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type SyncActions = {
  add: (label: string) => void;
  remove: (label: string) => void;
};

const SyncStateContext = createContext<string[]>([]);
const SyncActionsContext = createContext<SyncActions | null>(null);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string[]>([]);

  const actions = useMemo<SyncActions>(() => ({
    add: (label) => setActive((prev) => (prev.includes(label) ? prev : [...prev, label])),
    remove: (label) => setActive((prev) => prev.filter((l) => l !== label)),
  }), []);

  return (
    <SyncActionsContext.Provider value={actions}>
      <SyncStateContext.Provider value={active}>
        {children}
      </SyncStateContext.Provider>
    </SyncActionsContext.Provider>
  );
}

export function useSyncStatus() {
  const active = useContext(SyncStateContext);
  const actions = useContext(SyncActionsContext);
  if (!actions) throw new Error("useSyncStatus must be used within SyncStatusProvider");
  return { active, ...actions };
}

export function useRegisterSync(label: string, isActive: boolean) {
  const actions = useContext(SyncActionsContext);
  const add = actions?.add;
  const remove = actions?.remove;
  useEffect(() => {
    if (!add || !remove || !isActive) return;
    add(label);
    return () => remove(label);
  }, [add, remove, label, isActive]);
}
