"use client";
import { useState, useEffect } from "react";
import {
  DragDropContext,
  Draggable,
  type DropResult,
  type DraggableProvidedDragHandleProps,
} from "react-beautiful-dnd";
import {
  FiSearch,
  FiPlus,
  FiArrowUp,
  FiMoreHorizontal,
  FiLayers,
} from "react-icons/fi";
import { ISSUE_STATUSES, type IssueStatus } from "@/domain/types";
import { DropZone } from "./drop-zone";
import { dragPlacement } from "@/integration/drag-placement";
import { boardIssues } from "@/integration/workbench-selectors";
import { useWorkbench, type WorkIssue, statusNames } from "./data";
import { Person, Status, Blocked } from "./primitives";
import { MoveIssue } from "./dialogs";

export function useWorkFilters() {
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [blocked, setBlocked] = useState(false);
  return {
    search,
    setSearch,
    assignee,
    setAssignee,
    blocked,
    setBlocked,
    matches: (i: WorkIssue) =>
      (!search ||
        `${i.key} ${i.title}`.toLowerCase().includes(search.toLowerCase())) &&
      (!assignee || i.assigneeId === assignee) &&
      (!blocked || i.blocker.blocked),
  };
}
export function Filters({
  filters,
  count,
}: {
  filters: ReturnType<typeof useWorkFilters>;
  count: number;
}) {
  const { snapshot, projectId } = useWorkbench();
  const members = snapshot.state.projectsById[projectId]?.memberIds ?? [];
  return (
    <div className="nx-filters">
      <label className="nx-filter-search">
        <FiSearch />
        <input
          aria-label="Filter issues"
          placeholder="Filter issues…"
          value={filters.search}
          onChange={(e) => filters.setSearch(e.target.value)}
        />
      </label>
      <select
        aria-label="Filter by assignee"
        value={filters.assignee}
        onChange={(e) => filters.setAssignee(e.target.value)}
      >
        <option value="">All members</option>
        {members.map((id) => (
          <option key={id} value={id}>
            {snapshot.state.usersById[id]?.name}
          </option>
        ))}
      </select>
      <button
        className={`nx-filter-button ${filters.blocked ? "active" : ""}`}
        aria-pressed={filters.blocked}
        onClick={() => filters.setBlocked(!filters.blocked)}
      >
        Blocked only
      </button>
      {(filters.search || filters.assignee || filters.blocked) && (
        <button
          className="nx-text-button"
          onClick={() => {
            filters.setSearch("");
            filters.setAssignee("");
            filters.setBlocked(false);
          }}
        >
          Clear
        </button>
      )}
      <span className="nx-filter-count">{count} issues</span>
    </div>
  );
}
export function WorkBoard() {
  const { snapshot, projectId, repository, run, setCreate } = useWorkbench();
  const filters = useWorkFilters();

  const [mobileStatus, setMobileStatus] = useState<IssueStatus>("IN_PROGRESS");
  const [moving, setMoving] = useState<WorkIssue | null>(null);
  const sprints = Object.values(snapshot.state.sprintsById).filter(
    (s) => s.projectId === projectId && !s.deletedAt
  );
  const active = sprints.find((s) => s.status === "ACTIVE");
  const [scope, setScope] = useState("active");
  const [dragging, setDragging] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), 750);
    return () => clearTimeout(timer);
  }, [landed]);
  const issues = (status: IssueStatus) =>
    boardIssues(
      snapshot,
      projectId,
      status,
      scope === "all" ? undefined : active?.id ?? null
    ).filter(filters.matches);
  const onDrop = (result: DropResult) => {
    setDragging(false);
    const { destination, source, draggableId } = result;
    if (
      !destination ||
      (destination.droppableId === source.droppableId &&
        destination.index === source.index)
    )
      return;
    const status = destination.droppableId as IssueStatus;
    const issue = snapshot.state.issuesById[draggableId];
    if (!issue) return;
    void run(
      () =>
        repository.moveIssue({
          issueId: issue.id,
          expectedGeneration: snapshot.generation,
          expectedVersion: issue.version,
          destination: { view: "board", status },
          placement: dragPlacement(
            issues(status).map((i) => i.id),
            issue.id,
            destination.index
          ),
        }),
      issue.status === status
        ? "Order updated"
        : `${issue.key} moved to ${statusNames[status]}`
    ).then((ok) => {
      if (ok) setLanded(issue.id);
    });
  };
  return (
    <section className="nx-board-surface" aria-label="Issue board">
      <div className="nx-sprint-strip">
        <div>
          <span className="nx-live-dot" />
          <strong>{active?.name ?? "Unscheduled work"}</strong>
          <span className="nx-muted">
            {active?.goal ?? "Shape what comes next"}
          </span>
        </div>
        <select
          aria-label="Board scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="active">{active ? "Active sprint" : "Backlog"}</option>
          <option value="all">All project work</option>
        </select>
      </div>
      <Filters
        filters={filters}
        count={ISSUE_STATUSES.reduce((sum, s) => sum + issues(s).length, 0)}
      />
      <div
        className="nx-mobile-status"
        role="tablist"
        aria-label="Board status"
      >
        {ISSUE_STATUSES.map((s) => (
          <button
            role="tab"
            aria-selected={s === mobileStatus}
            key={s}
            onClick={() => setMobileStatus(s)}
          >
            <Status status={s} />
            {issues(s).length}
          </button>
        ))}
      </div>
      {
        <DragDropContext
          onDragStart={() => {
            setDragging(true);
            setLanded(null);
          }}
          onDragEnd={onDrop}
        >
          <div className={`nx-board ${dragging ? "is-dragging" : ""}`}>
            {ISSUE_STATUSES.map((status) => (
              <section
                className={`nx-lane ${
                  status === mobileStatus ? "mobile-active" : ""
                }`}
                key={status}
                aria-label={statusNames[status]}
              >
                <header>
                  <Status status={status} />
                  <span className="nx-lane-count">
                    {issues(status).length.toString().padStart(2, "0")}
                  </span>
                  <button
                    className="nx-icon"
                    aria-label={`Create issue in ${statusNames[status]}`}
                    onClick={() =>
                      setCreate({ status, sprintId: active?.id ?? null })
                    }
                  >
                    <FiPlus />
                  </button>
                </header>
                <DropZone droppableId={status}>
                  {(provided, state) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`nx-lane-body ${
                        state.isDraggingOver ? "accepting" : ""
                      }`}
                    >
                      {issues(status).map((issue, index) => (
                        <Draggable
                          key={issue.id}
                          draggableId={issue.id}
                          disableInteractiveElementBlocking
                          index={index}
                        >
                          {(drag, state) => (
                            <div
                              ref={drag.innerRef}
                              {...drag.draggableProps}
                              style={drag.draggableProps.style}
                              className={`nx-draggable ${
                                landed === issue.id ? "just-landed" : ""
                              } ${state.isDropAnimating ? "settling" : ""} ${
                                state.isDragging ? "dragging" : ""
                              }`}
                            >
                              <IssueCard
                                issue={issue}
                                handle={drag.dragHandleProps}
                                onMove={() => setMoving(issue)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {issues(status).length === 0 && (
                        <div className="nx-lane-empty">
                          {filters.search || filters.assignee || filters.blocked
                            ? "No matching work"
                            : "Room for what’s next"}
                          <span>Drop an issue here</span>
                        </div>
                      )}
                    </div>
                  )}
                </DropZone>
                <button
                  className="nx-lane-add"
                  onClick={() =>
                    setCreate({ status, sprintId: active?.id ?? null })
                  }
                >
                  <FiPlus />
                  Add issue
                </button>
              </section>
            ))}
          </div>
        </DragDropContext>
      }
      {moving && <MoveIssue issue={moving} onClose={() => setMoving(null)} />}
      <div className="nx-surface-foot">
        <span>
          <span className="nx-mini-mark">↳</span> Clarity creates momentum.
        </span>
        <span>Move with the handle · Open with the title</span>
      </div>
    </section>
  );
}
function IssueCard({
  issue,
  handle,
  onMove,
}: {
  issue: WorkIssue;
  handle: DraggableProvidedDragHandleProps | null | undefined;
  onMove: () => void;
}) {
  const { snapshot, openIssue, selected } = useWorkbench();
  const childCount = snapshot.state.childOrderByParent[issue.id]?.length ?? 0;
  return (
    <article
      className={`nx-card ${selected?.id === issue.id ? "selected" : ""}`}
    >
      <div className="nx-card-top">
        <span className={`nx-kind nx-kind-${issue.kind}`}>
          {issue.kind === "BUG" ? "◇" : issue.kind === "STORY" ? "▤" : "□"}
        </span>
        <span className="nx-key">{issue.key}</span>
        {issue.priority !== "NORMAL" && (
          <span
            className={`nx-priority nx-priority-${issue.priority}`}
            title={`${issue.priority.toLowerCase()} priority`}
          >
            <FiArrowUp />
            {issue.priority.toLowerCase()}
          </span>
        )}
        <button
          {...handle}
          className="nx-drag-handle"
          aria-label={`Drag ${issue.key}`}
        >
          ⠿
        </button>
      </div>
      <button
        className="nx-card-title"
        data-open-issue={issue.id}
        onClick={() => openIssue(issue)}
      >
        {issue.title}
      </button>
      {issue.blocker.blocked && <Blocked reason={issue.blocker.reason} />}
      <footer>
        <span className="nx-card-aux">
          {childCount > 0 && (
            <>
              <FiLayers />
              {childCount} child{childCount > 1 ? "ren" : ""}
            </>
          )}
        </span>
        <button
          className="nx-icon nx-card-move"
          aria-label={`Move ${issue.key}`}
          onClick={onMove}
        >
          <FiMoreHorizontal />
        </button>
        <Person user={snapshot.state.usersById[issue.assigneeId ?? ""]} />
      </footer>
    </article>
  );
}
