import { snapshotSchema } from "./schema";
import { DomainError, ISSUE_STATUSES, type DeepReadonly, type Entity, type Id, type ImmutableSnapshot, type Snapshot } from "./types";

function requireInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DomainError("VALIDATION", message);
}

function unique(ids: readonly Id[], name: string): void {
  requireInvariant(new Set(ids).size === ids.length, `${name} contains duplicates`);
}

function entityMap(records: Readonly<Record<Id, Readonly<Entity>>>, name: string): void {
  for (const [id, entity] of Object.entries(records)) {
    requireInvariant(id === entity.id, `${name} map key differs from entity ID`);
    requireInvariant(Date.parse(entity.updatedAt) >= Date.parse(entity.createdAt), `${name} has reversed timestamps`);
  }
}

/** Shape parsing clones input; relationships and canonical orders are checked separately. */
export function validateSnapshot(input: unknown): Snapshot {
  const result = snapshotSchema.safeParse(input);
  if (!result.success) throw new DomainError("VALIDATION", result.error.message);
  assertSnapshotInvariants(result.data);
  return result.data;
}

export function assertSnapshotInvariants(snapshot: ImmutableSnapshot): void {
  const state = snapshot.state;
  const workspace = state.workspace;
  entityMap({ [workspace.id]: workspace }, "Workspace");
  entityMap(state.projectsById, "Project");
  entityMap(state.usersById, "User");
  entityMap(state.issuesById, "Issue");
  entityMap(state.sprintsById, "Sprint");
  entityMap(state.commentsById, "Comment");
  requireInvariant(state.usersById[workspace.visitorId], "Visitor does not exist");
  requireInvariant(state.projectsById[workspace.featuredProjectId], "Featured project does not exist");
  unique(workspace.labels.map((label) => label.id), "Labels");
  const labels = new Set(workspace.labels.map((label) => label.id));
  const prefixes = new Set<string>();
  const slugs = new Set<string>();
  for (const user of Object.values(state.usersById)) {
    requireInvariant(user.workspaceId === workspace.id, "User belongs to another workspace");
  }
  for (const project of Object.values(state.projectsById)) {
    requireInvariant(project.workspaceId === workspace.id, "Project belongs to another workspace");
    requireInvariant(!prefixes.has(project.keyPrefix) && !slugs.has(project.slug), "Project prefix/slug is duplicated");
    prefixes.add(project.keyPrefix);
    slugs.add(project.slug);
    unique(project.memberIds, "Project members");
    requireInvariant(project.memberIds.includes(project.ownerId), "Project owner is not a member");
    requireInvariant(project.memberIds.includes(workspace.visitorId), "Visitor is not a project member");
    for (const id of project.memberIds) requireInvariant(state.usersById[id], "Project member does not exist");
    requireInvariant(state.boardOrderByProject[project.id] && state.planningOrderByProject[project.id], "Project orders are missing");
    const issues = Object.values(state.issuesById).filter((issue) => issue.projectId === project.id);
    const nextNumber = state.nextIssueNumberByProject[project.id];
    requireInvariant(nextNumber !== undefined && nextNumber > Math.max(0, ...issues.map((issue) => issue.number)), "Issue counter would reuse a number");
    unique(issues.map((issue) => issue.key), "Project issue keys");
    requireInvariant(Object.values(state.sprintsById).filter((sprint) => sprint.projectId === project.id && sprint.status === "ACTIVE").length <= 1, "Project has multiple active sprints");
  }
  for (const sprint of Object.values(state.sprintsById)) {
    requireInvariant(state.projectsById[sprint.projectId], "Sprint project does not exist");
    if (sprint.deletedAt) requireInvariant(sprint.status === "PENDING" && Date.parse(sprint.deletedAt) >= Date.parse(sprint.createdAt), "Only pending sprints may be deleted");
    if (sprint.startsAt && sprint.endsAt) requireInvariant(Date.parse(sprint.endsAt) > Date.parse(sprint.startsAt), "Sprint dates are reversed");
    if (sprint.status === "PENDING") requireInvariant(sprint.startedAt === null && sprint.completedAt === null, "Pending sprint has lifecycle timestamps");
    if (sprint.status !== "PENDING") requireInvariant(sprint.startedAt, "Started sprint has no start timestamp");
    if (sprint.status === "ACTIVE") requireInvariant(sprint.completedAt === null, "Active sprint is completed");
    if (sprint.status === "CLOSED") requireInvariant(sprint.completedAt && sprint.startedAt && Date.parse(sprint.completedAt) >= Date.parse(sprint.startedAt), "Closed sprint completion is invalid");
  }
  for (const issue of Object.values(state.issuesById)) {
    const project = state.projectsById[issue.projectId];
    requireInvariant(project, "Issue project does not exist");
    requireInvariant(issue.key === `${project.keyPrefix}-${issue.number}`, "Issue key does not match its project/number");
    requireInvariant(project.memberIds.includes(issue.reporterId), "Reporter is not a project member");
    requireInvariant(issue.assigneeId === null || project.memberIds.includes(issue.assigneeId), "Assignee is not a project member");
    unique(issue.labelIds, "Issue labels");
    for (const label of issue.labelIds) requireInvariant(labels.has(label), "Issue label does not exist");
    if (issue.sprintId !== null) {
      const sprint = state.sprintsById[issue.sprintId];
      requireInvariant(sprint?.projectId === issue.projectId, "Issue sprint belongs to another project");
      if (!issue.deletedAt) requireInvariant(!sprint.deletedAt, "Live issue belongs to a deleted sprint");
    }
    if (issue.parentId !== null) {
      const parent = state.issuesById[issue.parentId];
      requireInvariant(parent && parent.id !== issue.id && parent.parentId === null, "Children must have a top-level parent");
      requireInvariant(parent.projectId === issue.projectId && (issue.deletedAt || parent.sprintId === issue.sprintId), "Child project/sprint differs from parent");
      if (!issue.deletedAt) requireInvariant(parent.deletedAt === null, "Live child has a deleted parent");
    }
    if (issue.deletedAt) requireInvariant(Date.parse(issue.deletedAt) >= Date.parse(issue.createdAt), "Issue deleted before creation");
  }
  // Every live top-level issue must appear once in each independent order.
  const boardSeen: Id[] = [];
  const planningSeen: Id[] = [];
  for (const [projectId, columns] of Object.entries(state.boardOrderByProject)) {
    requireInvariant(state.projectsById[projectId], "Unknown board project");
    for (const status of ISSUE_STATUSES) for (const id of columns[status]) {
      const issue = state.issuesById[id];
      requireInvariant(issue && !issue.deletedAt && issue.parentId === null && issue.projectId === projectId && issue.status === status, "Invalid board membership");
      boardSeen.push(id);
    }
  }
  for (const [projectId, groups] of Object.entries(state.planningOrderByProject)) {
    requireInvariant(state.projectsById[projectId], "Unknown planning project");
    const checkGroup = (ids: readonly Id[], sprintId: Id | null) => {
      for (const id of ids) {
        const issue = state.issuesById[id];
        requireInvariant(issue && !issue.deletedAt && issue.parentId === null && issue.projectId === projectId && issue.sprintId === sprintId, "Invalid planning membership");
        planningSeen.push(id);
      }
    };
    checkGroup(groups.backlog, null);
    for (const [sprintId, ids] of Object.entries(groups.sprints)) {
      requireInvariant(state.sprintsById[sprintId]?.projectId === projectId, "Invalid planning sprint");
      requireInvariant(!state.sprintsById[sprintId]?.deletedAt || ids.length === 0, "Deleted sprint has live planning work");
      checkGroup(ids, sprintId);
    }
    for (const sprint of Object.values(state.sprintsById).filter((item) => item.projectId === projectId)) {
      requireInvariant(groups.sprints[sprint.id], "Sprint order is missing");
    }
  }
  const childSeen: Id[] = [];
  for (const [parentId, ids] of Object.entries(state.childOrderByParent)) {
    const parent = state.issuesById[parentId];
    requireInvariant(parent && parent.parentId === null && (!parent.deletedAt || ids.length === 0), "Invalid child-order parent");
    for (const id of ids) {
      const issue = state.issuesById[id];
      requireInvariant(issue && !issue.deletedAt && issue.parentId === parentId, "Invalid child order membership");
      childSeen.push(id);
    }
  }
  unique(boardSeen, "Board order"); unique(planningSeen, "Planning order"); unique(childSeen, "Child order");
  const topIds = Object.values(state.issuesById).filter((issue) => !issue.deletedAt && issue.parentId === null).map((issue) => issue.id);
  const childIds = Object.values(state.issuesById).filter((issue) => !issue.deletedAt && issue.parentId !== null).map((issue) => issue.id);
  requireInvariant(boardSeen.length === topIds.length && topIds.every((id) => boardSeen.includes(id)), "Board order is incomplete");
  requireInvariant(planningSeen.length === topIds.length && topIds.every((id) => planningSeen.includes(id)), "Planning order is incomplete");
  requireInvariant(childSeen.length === childIds.length && childIds.every((id) => childSeen.includes(id)), "Child order is incomplete");
  for (const projectId of Object.keys(state.nextIssueNumberByProject)) requireInvariant(state.projectsById[projectId], "Counter belongs to unknown project");
  for (const comment of Object.values(state.commentsById)) {
    const issue = state.issuesById[comment.issueId];
    requireInvariant(issue && state.projectsById[issue.projectId]?.memberIds.includes(comment.authorId), "Comment references invalid issue/author");
    requireInvariant(Date.parse(comment.createdAt) >= Date.parse(issue.createdAt), "Comment predates issue");
    if (comment.editedAt) requireInvariant(Date.parse(comment.editedAt) >= Date.parse(comment.createdAt) && Date.parse(comment.editedAt) <= Date.parse(comment.updatedAt), "Comment edit timestamp is invalid");
    if (comment.deletedAt) requireInvariant(Date.parse(comment.deletedAt) >= Date.parse(comment.createdAt) && comment.deletedAt === comment.updatedAt, "Comment deletion timestamp is invalid");
  }
  for (const [id, deletion] of Object.entries(state.deletionRecordsById)) {
    requireInvariant(id === deletion.id, "Deletion map key differs from ID");
    unique(deletion.issueIds, "Deletion record");
    for (const issueId of deletion.issueIds) requireInvariant(state.issuesById[issueId]?.deletedAt === deletion.deletedAt, "Deletion record references live/missing issue or wrong deletion time");
    if (deletion.placements) {
      requireInvariant(Object.keys(deletion.placements).length === deletion.issueIds.length && deletion.issueIds.every((issueId) => deletion.placements?.[issueId]), "Deletion placements are incomplete");
      for (const [issueId, placement] of Object.entries(deletion.placements)) {
        const issue = state.issuesById[issueId];
        requireInvariant(issue && (!placement.parentId || state.issuesById[placement.parentId]?.projectId === issue.projectId), "Deletion parent is invalid");
        for (const position of [placement.board, placement.planning, placement.children]) for (const anchor of [position.beforeId, position.afterId]) {
          requireInvariant(anchor === null || (anchor !== issueId && state.issuesById[anchor]?.projectId === issue.projectId), "Deletion placement anchor is invalid");
        }
      }
    }
    unique(deletion.detachedChildIds ?? [], "Detached children");
    for (const childId of deletion.detachedChildIds ?? []) requireInvariant(state.issuesById[childId], "Detached child is missing");
  }
  unique(Object.values(state.deletionRecordsById).flatMap((record) => [...record.issueIds]), "Recorded tombstones");
  unique(state.activityOrder, "Activity order");
  requireInvariant(state.activityOrder.length === Object.keys(state.activitiesById).length, "Activity order is incomplete");
  let previousTime = -Infinity;
  const latestChanges = new Map<string, string>();
  for (const [index, id] of state.activityOrder.entries()) {
    const event = state.activitiesById[id];
    requireInvariant(event && event.id === id && event.sequence === index + 1, "Invalid activity sequence");
    requireInvariant(state.projectsById[event.projectId]?.memberIds.includes(event.actorId), "Activity actor/project is invalid");
    const time = Date.parse(event.occurredAt);
    requireInvariant(time >= previousTime, "Activity is not chronological"); previousTime = time;
    if (event.issueId) {
      const issue = state.issuesById[event.issueId];
      requireInvariant(issue?.projectId === event.projectId && time >= Date.parse(issue.createdAt), "Activity issue/time is invalid");
      for (const change of event.changes) {
        if (event.commentId || !["title", "description", "kind", "reporterId", "status", "priority", "assigneeId", "sprintId", "blocker", "parentId", "deletedAt"].includes(change.field)) continue;
        const key = `${event.issueId}:${change.field}`;
        const previous = latestChanges.get(key);
        if (previous !== undefined) requireInvariant(previous === JSON.stringify(change.before), "Activity before/after chain is inconsistent");
        latestChanges.set(key, JSON.stringify(change.after));
      }
    }
    if (event.sprintId) {
      const sprint = state.sprintsById[event.sprintId];
      requireInvariant(sprint?.projectId === event.projectId && time >= Date.parse(sprint.createdAt), "Activity sprint/time is invalid");
    }
    if (event.commentId) {
      const comment = state.commentsById[event.commentId];
      requireInvariant(comment?.issueId === event.issueId && time >= Date.parse(comment.createdAt), "Activity comment/time is invalid");
    }
    for (const change of event.changes) {
      const entityId = event.commentId ? `comment:${event.commentId}` : !event.issueId && event.sprintId ? `sprint:${event.sprintId}` : null;
      if (!entityId) continue;
      const key = `${entityId}:${change.field}`;
      const previous = latestChanges.get(key);
      if (previous !== undefined) requireInvariant(previous === JSON.stringify(change.before), "Lifecycle activity before/after chain is inconsistent");
      latestChanges.set(key, JSON.stringify(change.after));
    }
  }
  for (const issue of Object.values(state.issuesById)) for (const field of ["title", "description", "kind", "reporterId", "status", "priority", "assigneeId", "sprintId", "blocker", "parentId", "deletedAt"] as const) {
    const latest = latestChanges.get(`${issue.id}:${field}`);
    if (latest !== undefined) requireInvariant(latest === JSON.stringify(issue[field]), "Activity history contradicts current issue");
  }
  for (const comment of Object.values(state.commentsById)) for (const [field, value] of [["commentBody", comment.body], ["deletedAt", comment.deletedAt]] as const) {
    const latest = latestChanges.get(`comment:${comment.id}:${field}`);
    if (latest !== undefined) requireInvariant(latest === JSON.stringify(value), "Comment history contradicts current comment");
  }
  for (const sprint of Object.values(state.sprintsById)) for (const [field, value] of [["sprintStatus", sprint.status], ["sprintName", sprint.name],
    ["sprintGoal", sprint.goal], ["startsAt", sprint.startsAt], ["endsAt", sprint.endsAt], ["deletedAt", sprint.deletedAt ?? null]] as const) {
    const latest = latestChanges.get(`sprint:${sprint.id}:${field}`);
    if (latest !== undefined) requireInvariant(latest === JSON.stringify(value), "Sprint history contradicts current sprint");
  }
}

/** Freeze nested entities and arrays, not only the envelope. */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
