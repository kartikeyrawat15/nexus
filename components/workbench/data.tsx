"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ZodError } from "zod";
import { useRepository } from "@/context/repository-provider";
import {
  type DeepReadonly,
  type Issue,
  type ImmutableSnapshot,
  type IssueStatus,
} from "@/domain/types";
import { getRepositoryRuntime } from "@/integration/repository-runtime";
import { type FoundationRepository } from "@/repositories/contracts";
import { type UpdateIssueInput } from "@/repositories/contracts";

export type WorkIssue = DeepReadonly<Issue>;
export const statusNames: Record<IssueStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};
type Notice = { text: string; undo?: () => Promise<unknown>; error?: boolean };
type Workbench = {
  snapshot: ImmutableSnapshot;
  repository: FoundationRepository;
  projectId: string;
  selected: WorkIssue | undefined;
  openIssue: (issue?: WorkIssue) => void;
  navigate: (view: string, projectId?: string) => void;
  run: (action: () => Promise<unknown>, message?: string) => Promise<boolean>;
  update: (
    issue: WorkIssue,
    patch: UpdateIssueInput["patch"]
  ) => Promise<boolean>;
  notify: (notice: Notice) => void;
  busy: boolean;
  create: {
    sprintId: string | null;
    status?: IssueStatus;
    parentId?: string;
  } | null;
  setCreate: (value: Workbench["create"]) => void;
};
const Context = createContext<Workbench | null>(null);
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const { repository } = useRepository();
  const client = useQueryClient();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undoNotice, setUndoNotice] = useState<Notice | null>(null);
  const notify = (next: Notice | null) => {
    if (next?.undo) setUndoNotice(next);
    else setNotice(next);
  };
  const [create, setCreate] = useState<Workbench["create"]>(null);
  const query = useQuery({
    queryKey: ["workbench", "snapshot"],
    queryFn: () => repository.getSnapshot(),
    staleTime: Infinity,
  });
  useEffect(
    () =>
      getRepositoryRuntime().repository.subscribe(() => {
        void client.invalidateQueries({ queryKey: ["workbench", "snapshot"] });
      }),
    [repository, client]
  );
  useEffect(() => {
    if (!notice || notice.undo) return;
    if (notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setUndoNotice(null);
  }, [query.data?.generation]);
  if (!query.data)
    return (
      <div className="nx-boot" role="status">
        Opening your workspace…
      </div>
    );
  const snapshot = query.data;
  const projectId =
    snapshot.state.projectsById[params.get("project") ?? ""]?.id ??
    snapshot.state.workspace.featuredProjectId;
  const selected = Object.values(snapshot.state.issuesById).find(
    (i) => !i.deletedAt && i.key === params.get("selectedIssue")
  );
  const navigate = (view: string, project = projectId) => {
    setCreate(null);
    router.push(`/project/${view}?project=${project}`);
  };
  const openIssue = (issue?: WorkIssue) => {
    const next = new URLSearchParams(params.toString());
    if (issue) {
      next.set("selectedIssue", issue.key);
      next.set("project", issue.projectId);
    } else next.delete("selectedIssue");
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  };
  const run = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["workbench", "snapshot"] });
      if (message) notify({ text: message });
      return true;
    } catch (error) {
      notify({
        error: true,
        text:
          error instanceof ZodError
            ? error.issues[0]?.message ?? "Please check the details and try again."
            : error instanceof Error
            ? error.message
            : "That change could not be saved. Please try again.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const update = (issue: WorkIssue, patch: UpdateIssueInput["patch"]) =>
    run(
      () =>
        repository.updateIssue({
          issueId: issue.id,
          expectedGeneration: snapshot.generation,
          expectedVersion: issue.version,
          patch,
        }),
      "Issue updated"
    );
  return (
    <Context.Provider
      value={{
        snapshot,
        repository,
        projectId,
        selected,
        openIssue,
        navigate,
        run,
        update,
        notify,
        busy,
        create,
        setCreate,
      }}
    >
      {children}
      <div className="nx-notice-stack">
        {undoNotice && (
          <div className="nx-notice nx-undo-notice" role="status">
            <span>{undoNotice.text}</span>
            <button
              onClick={() => {
                const undo = undoNotice.undo;
                if (undo)
                  void run(undo, "Issue restored").then((ok) => {
                    if (ok) setUndoNotice(null);
                  });
              }}
            >
              Undo
            </button>
            <button
              aria-label="Dismiss Undo"
              onClick={() => setUndoNotice(null)}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div
            className={`nx-notice ${notice.error ? "error" : ""}`}
            role={notice.error ? "alert" : "status"}
          >
            <span>{notice.text}</span>
            {notice.undo && (
              <button
                onClick={() => {
                  const undo = notice.undo;
                  if (undo) void run(undo, "Issue restored");
                }}
              >
                Undo
              </button>
            )}
            <button
              aria-label="Dismiss notification"
              onClick={() => notify(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
export function useWorkbench() {
  const value = useContext(Context);
  if (!value) throw new Error("Workbench provider required");
  return value;
}
