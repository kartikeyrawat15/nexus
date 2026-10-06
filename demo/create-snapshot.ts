import { validateSnapshot } from "../domain/invariants";
import { idSchema, timestampSchema } from "../domain/schema";
import { DomainError, type ActivityEvent, type Entity, type Id, type ISODateTime, type Issue, type Snapshot } from "../domain/types";
import { COMMENTS, HISTORY_ISSUE_IDS, ISSUES, PROJECTS, SPRINTS, USERS, WAYLINE, documentFromParagraphs } from "./wayline";

/** A fixed input anchor produces byte-for-byte equivalent scenario state. */
export function createSnapshot(input: { anchor: ISODateTime; generation: Id }): Snapshot {
  const anchor = new Date(timestampSchema.parse(input.anchor)).toISOString();
  const generation = idSchema.parse(input.generation);
  const atHours = (hours: number) => new Date(Date.parse(anchor) + hours * 3_600_000).toISOString();
  const entity = (id: string, days = -40): Entity => ({ id, createdAt: atHours(days * 24), updatedAt: atHours(days * 24), version: 1 });
  const snapshot: Snapshot = {
    schemaVersion: 1, scenarioVersion: 1, generation, revision: 0, scenarioAnchor: anchor,
    lastWriterId: "seed", lastTransactionId: null,
    state: {
      workspace: { ...entity(WAYLINE.workspaceId), name: WAYLINE.name, visitorId: WAYLINE.visitorId,
        featuredProjectId: WAYLINE.featuredProjectId, labels: WAYLINE.labels.map((label) => ({ ...label })) },
      usersById: Object.fromEntries(USERS.map((user) => [user.id, { ...entity(user.id), ...user, workspaceId: WAYLINE.workspaceId }])),
      projectsById: Object.fromEntries(PROJECTS.map((project) => [project.id, { ...entity(project.id), ...project, memberIds: [...project.memberIds], workspaceId: WAYLINE.workspaceId }])),
      issuesById: {}, sprintsById: {}, commentsById: {}, activitiesById: {}, activityOrder: [],
      boardOrderByProject: {}, planningOrderByProject: {}, childOrderByParent: {}, nextIssueNumberByProject: {}, deletionRecordsById: {},
    },
  };
  const state = snapshot.state;
  for (const project of PROJECTS) {
    state.boardOrderByProject[project.id] = { TODO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] };
    state.planningOrderByProject[project.id] = { backlog: [], sprints: {} };
    state.nextIssueNumberByProject[project.id] = 1;
  }
  for (const sprint of SPRINTS) {
    state.sprintsById[sprint.id] = { ...entity(sprint.id), projectId: sprint.projectId, name: sprint.name, goal: sprint.goal,
      status: sprint.status, startsAt: atHours(sprint.startDays * 24), endsAt: atHours(sprint.endDays * 24),
      startedAt: sprint.status === "PENDING" ? null : atHours(sprint.startDays * 24),
      completedAt: sprint.completedDays === null ? null : atHours(sprint.completedDays * 24),
    };
    const planning = state.planningOrderByProject[sprint.projectId];
    if (!planning) throw new DomainError("VALIDATION", "Seed sprint project is missing");
    planning.sprints[sprint.id] = [];
  }
  for (const seed of ISSUES) {
    const project = state.projectsById[seed.projectId];
    const board = state.boardOrderByProject[seed.projectId];
    const planning = state.planningOrderByProject[seed.projectId];
    if (!project || !board || !planning) throw new DomainError("VALIDATION", "Seed issue project is missing");
    const issue: Issue = { ...entity(seed.id, seed.sprintId === "ops-sprint-3" ? -35 : -12),
      id: seed.id, projectId: seed.projectId, key: `${project.keyPrefix}-${seed.number}`, number: seed.number,
      title: seed.title, description: seed.description, kind: seed.kind, status: seed.status, priority: seed.priority,
      blocker: seed.blockedReason ? { blocked: true, reason: seed.blockedReason } : { blocked: false, reason: null },
      labelIds: [...seed.labelIds], reporterId: WAYLINE.visitorId, assigneeId: seed.assigneeId,
      parentId: seed.parentId, sprintId: seed.sprintId, deletedAt: null,
    };
    state.issuesById[issue.id] = issue;
    state.nextIssueNumberByProject[project.id] = Math.max(state.nextIssueNumberByProject[project.id] ?? 1, issue.number + 1);
    if (issue.parentId) {
      (state.childOrderByParent[issue.parentId] ??= []).push(issue.id);
    } else {
      board[issue.status].push(issue.id);
      const group = issue.sprintId ? planning.sprints[issue.sprintId] : planning.backlog;
      if (!group) throw new DomainError("VALIDATION", "Seed issue sprint is missing");
      group.push(issue.id);
    }
  }
  const events: ActivityEvent[] = [];
  const addEvent = (event: Omit<ActivityEvent, "id" | "sequence" | "transactionId">) => {
    const id = `seed-event-${String(events.length + 1).padStart(3, "0")}`;
    events.push({ ...event, id, transactionId: `transaction-${id}`, sequence: 0 });
  };
  for (const id of HISTORY_ISSUE_IDS) {
    const issue = state.issuesById[id];
    if (!issue) throw new DomainError("VALIDATION", "History issue is missing");
    const context = { actorId: issue.assigneeId ?? WAYLINE.visitorId, projectId: issue.projectId, issueId: id, sprintId: issue.sprintId, commentId: null };
    addEvent({ ...context, kind: "ISSUE_CREATED", occurredAt: atHours(-11 * 24), changes: [
      { field: "title", before: null, after: issue.title }, { field: "status", before: null, after: "TODO" },
    ] });
    const path = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
    const end = path.indexOf(issue.status);
    for (let step = 1; step <= end; step++) {
      const before = path[step - 1]; const after = path[step];
      if (!before || !after) throw new DomainError("VALIDATION", "Invalid status history");
      addEvent({ ...context, kind: "ISSUE_UPDATED", occurredAt: atHours((-8 + step) * 24), changes: [{ field: "status", before, after }] });
    }
    if (issue.blocker.blocked) addEvent({ ...context, kind: "ISSUE_UPDATED", occurredAt: atHours(-4 * 24), changes: [
      { field: "blocker", before: { blocked: false, reason: null }, after: issue.blocker },
    ] });
  }
  for (const sprint of Object.values(state.sprintsById).filter((item) => item.status === "ACTIVE")) {
    const project = state.projectsById[sprint.projectId];
    if (!project || !sprint.startedAt) throw new DomainError("VALIDATION", "Invalid active sprint");
    addEvent({ actorId: project.ownerId, projectId: project.id, issueId: null, sprintId: sprint.id, commentId: null,
      kind: "SPRINT_STARTED", occurredAt: sprint.startedAt, changes: [{ field: "sprintStatus", before: "PENDING", after: "ACTIVE" }] });
  }
  for (const [index, [issueId, authorId, body, hours]] of COMMENTS.entries()) {
    const issue = state.issuesById[issueId];
    if (!issue) throw new DomainError("VALIDATION", "Comment issue is missing");
    const id = `wayline-comment-${String(index + 1).padStart(2, "0")}`;
    state.commentsById[id] = { ...entity(id), createdAt: atHours(hours), updatedAt: atHours(hours),
      issueId, authorId, body: documentFromParagraphs(body), editedAt: null, deletedAt: null };
    addEvent({ actorId: authorId, projectId: issue.projectId, issueId, sprintId: issue.sprintId, commentId: id,
      kind: "COMMENT_CREATED", changes: [], occurredAt: atHours(hours) });
  }
  events.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id));
  for (const [index, event] of events.entries()) {
    event.sequence = index + 1;
    state.activitiesById[event.id] = event;
    state.activityOrder.push(event.id);
    if (event.issueId && !event.kind.startsWith("COMMENT_")) {
      const issue = state.issuesById[event.issueId];
      if (issue) { issue.updatedAt = event.occurredAt; issue.version += 1; }
    }
  }
  // Closed-sprint records are historical; their work predates sprint completion.
  for (const issue of Object.values(state.issuesById)) {
    if (issue.sprintId === "ops-sprint-3") issue.updatedAt = atHours(-15 * 24);
  }
  return validateSnapshot(snapshot);
}
