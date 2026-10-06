"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { defaultProjectId, getRepositoryRuntime, type RepositoryContextValue } from "../integration/repository-runtime";
import { connectQueryBridge } from "../integration/query-bridge";

const RepositoryContext = createContext<RepositoryContextValue | null>(null);
export function RepositoryProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [value, setValue] = useState<RepositoryContextValue>({ repository: null, ready: false, error: null, projectId: null, persistence: null });
  useEffect(() => {
    const runtime = getRepositoryRuntime();
    let active = true; let stopBridge: (() => void) | undefined;
    const stopStatus = runtime.repository.subscribe(() => {
      if (active) setValue((previous) => {
        const persistence = runtime.repository.getPersistenceState();
        return previous.persistence === persistence ? previous : { ...previous, persistence };
      });
    });
    void runtime.initialize().then((snapshot) => {
      if (!active) return;
      stopBridge = connectQueryBridge(runtime.repository, client, snapshot);
      setValue({ repository: runtime.repository, ready: true, error: null,
        projectId: defaultProjectId(snapshot), persistence: runtime.repository.getPersistenceState() });
    }).catch((error: unknown) => {
      if (active) setValue((previous) => ({ ...previous, error: error instanceof Error ? error.message : "Repository initialization failed" }));
    });
    return () => { active = false; stopStatus(); stopBridge?.(); };
  }, [client]);
  return <RepositoryContext.Provider value={value}>
    {value.error ? <div role="alert">Unable to load the demo: {value.error}</div>
      : value.ready ? children : <div role="status">Loading project…</div>}
  </RepositoryContext.Provider>;
}
export function useRepositoryStatus() {
  const value = useContext(RepositoryContext);
  if (!value) throw new Error("Repository status requires RepositoryProvider");
  return value;
}
export function useRepository() {
  const value = useContext(RepositoryContext);
  if (!value?.repository || !value.projectId) throw new Error("Repository reads require an initialized RepositoryProvider");
  return { ...value, repository: value.repository, projectId: value.projectId };
}
