"use client";
import { useEffect, useRef, useState } from "react";
import {
  FiArrowRight,
  FiSearch,
  FiPlus,
  FiColumns,
  FiList,
  FiGrid,
  FiRefreshCw,
  FiX,
} from "react-icons/fi";
import {
  ISSUE_STATUSES,
  ISSUE_KINDS,
  PRIORITIES,
  type IssueStatus,
  type IssueKind,
  type Priority,
} from "@/domain/types";
import { useWorkbench, statusNames, type WorkIssue } from "./data";
import { Modal, Person, Status } from "./primitives";

export function CreateIssue() {
  const { create, setCreate } = useWorkbench();
  return create ? <CreateForm onClose={() => setCreate(null)} /> : null;
}
function CreateForm({ onClose }: { onClose: () => void }) {
  const { create, snapshot, projectId, repository, run, busy, openIssue } =
    useWorkbench();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<IssueKind>("TASK");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState<IssueStatus>(create?.status ?? "TODO");
  const [sprint, setSprint] = useState(create?.sprintId ?? "");
  const project = snapshot.state.projectsById[projectId];
  const submit = () => {
    void run(async () => {
      const result = await repository.createIssue({
        expectedGeneration: snapshot.generation,
        projectId,
        title,
        kind,
        priority,
        status,
        assigneeId: assignee || null,
        sprintId: sprint || null,
        parentId: create?.parentId,
      });
      onClose();
      openIssue(result.issue);
    }, "Issue created");
  };
  return (
    <Modal
      title={create?.parentId ? "Create child issue" : "Create issue"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="nx-dialog-body"
      >
        <div className="nx-eyebrow">
          {project?.name} / {project?.keyPrefix}
        </div>
        <label className="nx-field">
          Title
          <input
            autoFocus
            required
            maxLength={240}
            placeholder="What needs to happen?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="nx-create-title"
          />
        </label>
        <div className="nx-form-grid">
          <label className="nx-field">
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as IssueKind)}
            >
              {ISSUE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="nx-field">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as IssueStatus)}
            >
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusNames[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="nx-field">
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="nx-field">
            Assignee
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {project?.memberIds.map((id) => (
                <option key={id} value={id}>
                  {snapshot.state.usersById[id]?.name}
                </option>
              ))}
            </select>
          </label>
          {!create?.parentId && (
            <label className="nx-field">
              Planning
              <select
                value={sprint}
                onChange={(e) => setSprint(e.target.value)}
              >
                <option value="">Backlog</option>
                {Object.values(snapshot.state.sprintsById)
                  .filter(
                    (s) =>
                      s.projectId === projectId &&
                      !s.deletedAt &&
                      s.status !== "CLOSED"
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <p className="nx-muted nx-small">
          A project number is assigned when you create. You can add context in
          the inspector.
        </p>
        <div className="nx-actions">
          <button type="button" className="nx-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="nx-button primary"
            disabled={busy || !title.trim()}
          >
            <FiPlus />
            {busy ? "Creating…" : "Create issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MoveIssue({
  issue,
  onClose,
}: {
  issue: WorkIssue;
  onClose: () => void;
}) {
  const { snapshot, repository, run, busy } = useWorkbench();
  const [view, setView] = useState<"board" | "planning">("board");
  const [target, setTarget] = useState<string>(issue.status);
  const [anchor, setAnchor] = useState("");
  const ids =
    view === "board"
      ? snapshot.state.boardOrderByProject[issue.projectId]?.[
          target as IssueStatus
        ] ?? []
      : (target
          ? snapshot.state.planningOrderByProject[issue.projectId]?.sprints[
              target
            ]
          : snapshot.state.planningOrderByProject[issue.projectId]?.backlog) ??
        [];
  return (
    <Modal title={`Move ${issue.key}`} onClose={onClose}>
      <form
        className="nx-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              repository.moveIssue({
                issueId: issue.id,
                expectedGeneration: snapshot.generation,
                expectedVersion: issue.version,
                destination:
                  view === "board"
                    ? { view, status: target as IssueStatus }
                    : { view, sprintId: target || null },
                placement: anchor ? { beforeIssueId: anchor } : { at: "end" },
              }),
            `${issue.key} moved`
          ).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <p>{issue.title}</p>
        <label className="nx-field">
          Move in
          <select
            value={view}
            onChange={(e) => {
              const v = e.target.value as "board" | "planning";
              setView(v);
              setTarget(v === "board" ? issue.status : issue.sprintId ?? "");
              setAnchor("");
            }}
          >
            <option value="board">Board status</option>
            {!issue.parentId && (
              <option value="planning">Sprint / backlog</option>
            )}
          </select>
        </label>
        <label className="nx-field">
          Destination
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setAnchor("");
            }}
          >
            {view === "board" ? (
              ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusNames[s]}
                </option>
              ))
            ) : (
              <>
                <option value="">Backlog</option>
                {Object.values(snapshot.state.sprintsById)
                  .filter(
                    (s) =>
                      s.projectId === issue.projectId &&
                      !s.deletedAt &&
                      s.status !== "CLOSED"
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </>
            )}
          </select>
        </label>
        {!issue.parentId && (
          <label className="nx-field">
            Position
            <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
              <option value="">At the end</option>
              {ids
                .filter((id) => id !== issue.id)
                .map((id) => {
                  const i = snapshot.state.issuesById[id];
                  return i ? (
                    <option key={id} value={id}>
                      Before {i.key} · {i.title}
                    </option>
                  ) : null;
                })}
            </select>
          </label>
        )}
        <p className="nx-small nx-muted">
          Positions use the full project order, including issues hidden by
          filters.
        </p>
        <div className="nx-actions">
          <button type="button" className="nx-button" onClick={onClose}>
            Cancel
          </button>
          <button className="nx-button primary" disabled={busy}>
            Move issue
            <FiArrowRight />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function CommandMenu({
  open,
  setOpen,
  onReset,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
  onReset: () => void;
}) {
  const { snapshot, openIssue, navigate, setCreate } = useWorkbench();
  const [search, setSearch] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open, setOpen]);
  useEffect(() => {
    if (open) {
      setSearch("");
      setPersonId(null);
      setIndex(0);
    }
  }, [open]);
  const query = search.trim().toLowerCase();
  const commands = [
    {
      label: "Create issue",
      detail: "Current project",
      icon: <FiPlus />,
      action: () => setCreate({ sprintId: null }),
    },
    {
      label: "Go to Overview",
      detail: "Workspace",
      icon: <FiGrid />,
      action: () => navigate("overview"),
    },
    {
      label: "Go to Board",
      detail: "Current project",
      icon: <FiColumns />,
      action: () => navigate("board"),
    },
    {
      label: "Go to Backlog",
      detail: "Current project",
      icon: <FiList />,
      action: () => navigate("backlog"),
    },
    ...Object.values(snapshot.state.projectsById).map((p) => ({
      label: p.name,
      detail: "Project",
      icon: <span className="nx-key">{p.keyPrefix}</span>,
      action: () => navigate("board", p.id),
    })),
    {
      label: "Reset demo",
      detail: "Requires confirmation",
      icon: <FiRefreshCw />,
      action: onReset,
    },
  ].filter(
    (c) => !personId && (!query || c.label.toLowerCase().includes(query))
  );
  const issues =
    query || personId
      ? Object.values(snapshot.state.issuesById)
          .filter(
            (i) =>
              !i.deletedAt &&
              (!personId ||
                (i.assigneeId === personId && i.status !== "DONE")) &&
              `${i.key} ${i.title}`.toLowerCase().includes(query)
          )
          .sort(
            (a, b) =>
              Number(b.key.toLowerCase() === query) -
              Number(a.key.toLowerCase() === query)
          )
          .slice(0, 12)
          .map((i) => ({
            label: i.title,
            detail: i.key,
            icon: <Status status={i.status} label={false} />,
            action: () => {
              openIssue(i);
            },
          }))
      : [];
  const people =
    query && !personId
      ? Object.values(snapshot.state.usersById)
          .filter((u) => u.name.toLowerCase().includes(query))
          .map((u) => ({
            label: u.name,
            detail: `${
              Object.values(snapshot.state.issuesById).filter(
                (i) =>
                  !i.deletedAt && i.assigneeId === u.id && i.status !== "DONE"
              ).length
            } open issues · ${u.roleLabel}`,
            icon: <Person user={u} />,
            keepOpen: true,
            action: () => {
              setPersonId(u.id);
              setSearch("");
              setIndex(0);
            },
          }))
      : [];
  const results = [...issues, ...commands, ...people];
  const choose = (result: { action: () => void; keepOpen?: boolean }) => {
    if (!result.keepOpen) setOpen(false);
    result.action();
  };
  return open ? (
    <Modal
      title="Find your next move"
      className="nx-command"
      onClose={() => setOpen(false)}
    >
      <div className="nx-command-input">
        <FiSearch />
        <input
          autoFocus
          role="combobox"
          aria-label="Search issues, projects, people and commands"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={`command-${index}`}
          placeholder="Search work, people, or a command…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = Math.max(
                0,
                Math.min(
                  results.length - 1,
                  index + (e.key === "ArrowDown" ? 1 : -1)
                )
              );
              setIndex(next);
              refs.current[next]?.scrollIntoView({ block: "nearest" });
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const result = results[index];
              if (result) choose(result);
            }
          }}
        />
      </div>
      {personId && (
        <div className="nx-command-person">
          <Person user={snapshot.state.usersById[personId]} name />
          <span>Open work</span>
          <button
            className="nx-icon"
            aria-label="Clear person filter"
            onClick={() => {
              setPersonId(null);
              setIndex(0);
            }}
          >
            <FiX />
          </button>
        </div>
      )}
      <div
        className="nx-command-results"
        role="listbox"
        id="command-results"
        aria-label="Search results"
      >
        {results.map((r, idx) => (
          <button
            ref={(el) => {
              refs.current[idx] = el;
            }}
            role="option"
            aria-selected={idx === index}
            id={`command-${idx}`}
            key={`${r.detail}-${r.label}`}
            onMouseEnter={() => setIndex(idx)}
            onClick={() => choose(r)}
          >
            {r.icon}
            <span>
              {r.label}
              <small>{r.detail}</small>
            </span>
            <FiArrowRight />
          </button>
        ))}
        {!results.length && (
          <p className="nx-empty">
            No matching work. Try an issue key or a person’s name.
          </p>
        )}
      </div>
      <footer>
        <span>↑ ↓ to explore</span>
        <span>↵ to open</span>
        <span>esc to close</span>
      </footer>
    </Modal>
  ) : null;
}
