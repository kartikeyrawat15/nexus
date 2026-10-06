"use client";
import { useEffect, useState } from "react";
import {
  DragDropContext,
  Draggable,
  type DropResult,
  type DraggableProvidedDragHandleProps,
} from "react-beautiful-dnd";
import {
  FiChevronDown,
  FiChevronRight,
  FiPlus,
  FiArrowRight,
  FiAlertCircle,
  FiMoreHorizontal,
  FiArrowUp,
} from "react-icons/fi";
import { type DeepReadonly, type Sprint } from "@/domain/types";
import { DropZone } from "./drop-zone";
import { dragPlacement } from "@/integration/drag-placement";
import { sprintCompletionSummary } from "@/integration/workbench-selectors";
import { useWorkbench, type WorkIssue } from "./data";
import { Filters, useWorkFilters } from "./board";
import { Person, Status, Modal } from "./primitives";
import { MoveIssue } from "./dialogs";
import { dateLabel } from "./inspector";

export function WorkBacklog() {
  const { snapshot, projectId, repository, run } = useWorkbench();
  const filters = useWorkFilters();
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), 750);
    return () => clearTimeout(timer);
  }, [landed]);

  const [sprintDialog, setSprintDialog] = useState<{
    sprint?: DeepReadonly<Sprint>;
    action: "create" | "edit" | "start" | "complete" | "delete";
  } | null>(null);
  const [move, setMove] = useState<WorkIssue | null>(null);
  const sprints = Object.values(snapshot.state.sprintsById)
    .filter((s) => s.projectId === projectId && !s.deletedAt)
    .sort(
      (a, b) =>
        ({ ACTIVE: 0, PENDING: 1, CLOSED: 2 }[a.status] -
        { ACTIVE: 0, PENDING: 1, CLOSED: 2 }[b.status])
    );
  const groups = [
    ...sprints
      .filter((s) => s.status !== "CLOSED")
      .map((s) => ({ id: s.id, sprint: s })),
    { id: "backlog", sprint: undefined },
    ...sprints
      .filter((s) => s.status === "CLOSED")
      .map((s) => ({ id: s.id, sprint: s })),
  ];
  const issues = (id: string) =>
    (id === "backlog"
      ? snapshot.state.planningOrderByProject[projectId]?.backlog ?? []
      : snapshot.state.planningOrderByProject[projectId]?.sprints[id] ?? []
    ).flatMap((id) => {
      const issue = snapshot.state.issuesById[id];
      return issue && !issue.deletedAt && filters.matches(issue) ? [issue] : [];
    });
  const drop = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (
      !destination ||
      (source.droppableId === destination.droppableId &&
        source.index === destination.index)
    )
      return;
    const issue = snapshot.state.issuesById[draggableId];
    if (!issue) return;
    void run(
      () =>
        repository.moveIssue({
          issueId: issue.id,
          expectedGeneration: snapshot.generation,
          expectedVersion: issue.version,
          destination: {
            view: "planning",
            sprintId:
              destination.droppableId === "backlog"
                ? null
                : destination.droppableId,
          },
          placement: dragPlacement(
            issues(destination.droppableId).map((i) => i.id),
            issue.id,
            destination.index
          ),
        }),
      `${issue.key} moved`
    ).then((ok) => {
      if (ok) setLanded(issue.id);
    });
  };
  return (
    <section className="nx-planning">
      <div className="nx-planning-intro">
        <p>Make room for the work that matters next.</p>
        <button
          className="nx-button"
          onClick={() => setSprintDialog({ action: "create" })}
        >
          <FiPlus />
          New sprint
        </button>
      </div>
      <Filters
        filters={filters}
        count={groups.reduce((n, g) => n + issues(g.id).length, 0)}
      />
      {
        <DragDropContext onDragStart={() => setLanded(null)} onDragEnd={drop}>
          {groups.map((group) => (
            <PlanningGroup
              key={group.id}
              id={group.id}
              sprint={group.sprint}
              issues={issues(group.id)}
              landed={landed}
              onMove={setMove}
              onSprint={(action) =>
                setSprintDialog({ sprint: group.sprint, action })
              }
            />
          ))}
        </DragDropContext>
      }
      {move && <MoveIssue issue={move} onClose={() => setMove(null)} />}
      {sprintDialog && (
        <SprintForm {...sprintDialog} onClose={() => setSprintDialog(null)} />
      )}
    </section>
  );
}
function PlanningGroup({
  id,
  sprint,
  issues,
  landed,
  onMove,
  onSprint,
}: {
  id: string;
  sprint?: DeepReadonly<Sprint>;
  issues: WorkIssue[];
  landed: string | null;
  onMove: (i: WorkIssue) => void;
  onSprint: (action: "edit" | "start" | "complete" | "delete") => void;
}) {
  const { snapshot, projectId, repository, run, busy } = useWorkbench();
  const [open, setOpen] = useState(sprint?.status !== "CLOSED");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const closed = sprint?.status === "CLOSED";
  return (
    <section className={`nx-planning-group ${closed ? "closed" : ""}`}>
      <header>
        <button
          className="nx-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <FiChevronDown /> : <FiChevronRight />}
          <h2>{sprint?.name ?? "Backlog"}</h2>
          <span>{issues.length}</span>
        </button>
        <span className={`nx-sprint-state ${sprint?.status ?? ""}`}>
          {sprint?.status === "ACTIVE"
            ? "In motion"
            : sprint?.status === "PENDING"
            ? "Planned"
            : sprint?.status === "CLOSED"
            ? "Completed"
            : "Unscheduled"}
        </span>
        {sprint?.startsAt && (
          <span className="nx-sprint-dates">
            {dateLabel(sprint.startsAt)} —{" "}
            {sprint.endsAt ? dateLabel(sprint.endsAt) : "Open"}
          </span>
        )}
        <div className="nx-sprint-actions">
          {sprint && !closed && (
            <>
              <button
                className="nx-text-button"
                onClick={() =>
                  onSprint(sprint.status === "ACTIVE" ? "complete" : "start")
                }
              >
                {sprint.status === "ACTIVE"
                  ? "Complete sprint"
                  : "Start sprint"}
                <FiArrowRight />
              </button>
              <button
                className="nx-icon"
                aria-label={`Edit ${sprint.name}`}
                onClick={() => onSprint("edit")}
              >
                <FiMoreHorizontal />
              </button>
            </>
          )}
        </div>
      </header>
      {open && (
        <>
          {sprint && <p className="nx-sprint-goal">{sprint.goal}</p>}
          <div className="nx-planning-columns">
            <span>ISSUE / TITLE</span>
            <span>STATUS</span>
            <span>OWNER</span>
          </div>
          <DropZone droppableId={id} isDropDisabled={closed}>
            {(provided, state) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`nx-planning-list ${
                  state.isDraggingOver ? "accepting" : ""
                }`}
              >
                {issues.map((issue, index) => (
                  <Draggable
                    draggableId={issue.id}
                    disableInteractiveElementBlocking
                    index={index}
                    key={issue.id}
                    isDragDisabled={closed}
                  >
                    {(drag, state) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        style={drag.draggableProps.style}
                        className={`${
                          state.isDragging ? "nx-row-dragging" : ""
                        } ${landed === issue.id ? "nx-row-landed" : ""}`}
                      >
                        <PlanningRow
                          issue={issue}
                          handle={drag.dragHandleProps}
                          onMove={() => onMove(issue)}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                {!issues.length && (
                  <div className="nx-planning-empty">
                    {closed
                      ? "No matching completed work"
                      : "Drop work here, or start with an issue."}
                  </div>
                )}
              </div>
            )}
          </DropZone>
          {!closed &&
            (adding ? (
              <form
                className="nx-inline-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      repository.createIssue({
                        expectedGeneration: snapshot.generation,
                        projectId,
                        title,
                        sprintId: sprint?.id ?? null,
                      }),
                    "Issue created"
                  ).then((ok) => {
                    if (ok) {
                      setTitle("");
                      setAdding(false);
                    }
                  });
                }}
              >
                <FiPlus />
                <input
                  autoFocus
                  aria-label={`New issue in ${sprint?.name ?? "Backlog"}`}
                  required
                  placeholder="What needs to happen?"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <button
                  className="nx-button primary"
                  disabled={busy || !title.trim()}
                >
                  Create
                </button>
                <button
                  type="button"
                  className="nx-button"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button className="nx-lane-add" onClick={() => setAdding(true)}>
                <FiPlus />
                Create issue
              </button>
            ))}
        </>
      )}
    </section>
  );
}
function PlanningRow({
  issue,
  handle,
  onMove,
}: {
  issue: WorkIssue;
  handle?: DraggableProvidedDragHandleProps | null;
  onMove: () => void;
}) {
  const { snapshot, openIssue, selected } = useWorkbench();
  const [expanded, setExpanded] = useState(false);
  const children = (snapshot.state.childOrderByParent[issue.id] ?? []).flatMap(
    (id) => {
      const child = snapshot.state.issuesById[id];
      return child && !child.deletedAt ? [child] : [];
    }
  );
  return (
    <>
      <div
        className={`nx-plan-row ${selected?.id === issue.id ? "selected" : ""}`}
      >
        <button
          {...handle}
          className="nx-drag-handle"
          aria-label={`Drag ${issue.key}`}
          disabled={!handle}
        >
          ⠿
        </button>
        {children.length ? (
          <button
            className="nx-child-toggle"
            aria-label={`Expand children of ${issue.key}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        ) : (
          <span className="nx-child-spacer" />
        )}
        <span className="nx-key">{issue.key}</span>
        <button
          className="nx-plan-title"
          data-open-issue={issue.id}
          onClick={() => openIssue(issue)}
        >
          {issue.title}
          {(issue.priority === "URGENT" || issue.priority === "HIGH") && (
            <span
              className={`nx-plan-priority ${issue.priority}`}
              title={`${issue.priority.toLowerCase()} priority`}
            >
              <FiArrowUp />
              <span className="nx-sr-only">
                {issue.priority.toLowerCase()} priority
              </span>
            </span>
          )}
        </button>
        {issue.blocker.blocked && (
          <span title={issue.blocker.reason} className="nx-row-blocked">
            <FiAlertCircle />
          </span>
        )}
        <Status status={issue.status} />
        <Person user={snapshot.state.usersById[issue.assigneeId ?? ""]} />
        <button
          className="nx-icon"
          aria-label={`Move ${issue.key}`}
          onClick={onMove}
        >
          <FiMoreHorizontal />
        </button>
      </div>
      {expanded &&
        children.map((child) => (
          <button
            className="nx-plan-child"
            key={child.id}
            onClick={() => openIssue(child)}
          >
            <span>↳</span>
            <span className="nx-key">{child.key}</span>
            <span>{child.title}</span>
            <Status status={child.status} label={false} />
          </button>
        ))}
    </>
  );
}
function SprintForm({
  sprint,
  action,
  onClose,
}: {
  sprint?: DeepReadonly<Sprint>;
  action: "create" | "edit" | "start" | "complete" | "delete";
  onClose: () => void;
}) {
  const { snapshot, repository, projectId, run, busy } = useWorkbench();
  const [mode, setMode] = useState(action);
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [start, setStart] = useState(sprint?.startsAt?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(sprint?.endsAt?.slice(0, 10) ?? "");
  const [destination, setDestination] = useState("");
  const summary = sprintCompletionSummary(snapshot, sprint?.id ?? "");
  const pending = Object.values(snapshot.state.sprintsById).filter(
    (s) =>
      s.projectId === projectId &&
      s.status === "PENDING" &&
      !s.deletedAt &&
      s.id !== sprint?.id
  );
  const submit = async () => {
    const ok = await run(
      async () => {
        const expectedGeneration = snapshot.generation;
        if (mode === "create")
          return repository.createSprint({
            projectId,
            name,
            goal,
            expectedGeneration,
          });
        if (!sprint) return;
        const context = {
          sprintId: sprint.id,
          expectedGeneration,
          expectedVersion: sprint.version,
        };
        if (mode === "complete")
          return repository.completeSprint({
            ...context,
            destinationSprintId: destination || null,
          });
        if (mode === "delete") return repository.deletePendingSprint(context);
        const fields = {
          ...context,
          name,
          goal,
          startsAt: start ? new Date(`${start}T09:00:00`).toISOString() : null,
          endsAt: end ? new Date(`${end}T18:00:00`).toISOString() : null,
        };
        return mode === "start"
          ? repository.startSprint(fields)
          : repository.updateSprint(fields);
      },
      mode === "complete"
        ? "Sprint completed. Open work moved together."
        : mode === "delete"
        ? "Sprint deleted. Its issues returned to the backlog."
        : mode === "start"
        ? "Sprint started"
        : "Sprint saved"
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title={`${
        {
          create: "Plan a sprint",
          edit: "Edit sprint",
          start: "Start sprint",
          complete: "Complete sprint",
          delete: "Delete sprint",
        }[mode]
      }${sprint ? ` · ${sprint.name}` : ""}`}
      onClose={onClose}
    >
      <form
        className="nx-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "complete" ? (
          <>
            <p>
              Close this chapter and give unfinished work a clear next step.
            </p>
            <div className="nx-completion-summary">
              <span>
                <strong>{summary.completed}</strong> completed
              </span>
              <span>
                <strong>{summary.carryForward}</strong> carry forward
              </span>
            </div>
            <p className="nx-small nx-muted">
              The whole sprint is included, even when filters are active. Parent
              and child work stay together.
            </p>
            <label className="nx-field">
              Move open work to
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">Backlog</option>
                {pending.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : mode === "delete" ? (
          <p>Delete this planned sprint? Its issues return to the backlog.</p>
        ) : (
          <>
            <label className="nx-field">
              Sprint name
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="nx-field">
              Goal
              <textarea
                required
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What will be meaningfully different?"
              />
            </label>
            {mode !== "create" && (
              <div className="nx-form-grid">
                <label className="nx-field">
                  Start date
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label className="nx-field">
                  End date
                  <input
                    type="date"
                    value={end}
                    min={start}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        )}
        <div className="nx-actions">
          {mode === "edit" && sprint?.status === "PENDING" && (
            <button
              type="button"
              className="nx-text-button"
              onClick={() => setMode("delete")}
            >
              Delete sprint
            </button>
          )}
          <button type="button" className="nx-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`nx-button ${mode === "delete" ? "danger" : "primary"}`}
            disabled={busy}
          >
            {busy
              ? "Saving…"
              : mode === "complete"
              ? "Complete sprint"
              : mode === "start"
              ? "Start sprint"
              : mode === "delete"
              ? "Delete sprint"
              : "Save sprint"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
