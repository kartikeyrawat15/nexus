import { createIssueActivity, issueChanges, issueCreatedChanges } from "../domain/activity";
import { deepFreeze, validateSnapshot } from "../domain/invariants";
import { insertAtAnchor, sameOrder } from "../domain/ordering";
import { createIssueSchema, idSchema, moveIssueSchema, snapshotSchema, timestampSchema, updateIssueSchema } from "../domain/schema";
import { DomainError, type Id, type ImmutableSnapshot, type Issue, type ISODateTime, type Snapshot } from "../domain/types";
import { type CreateIssueInput, type IssueMutationResult, type MoveIssueInput, type UpdateIssueInput } from "./contracts";

export type FoundationCommand =
  | { kind: "create"; input: CreateIssueInput }
  | { kind: "update"; input: UpdateIssueInput }
  | { kind: "move"; input: MoveIssueInput };
export interface CommandContext { now: ISODateTime; writerId: Id; idFactory: () => Id }
export interface CommandResult { snapshot: ImmutableSnapshot; result: IssueMutationResult }

function liveIssue(state: Snapshot["state"], id: Id): Issue {
  const issue = state.issuesById[id];
  if (!issue || issue.deletedAt) throw new DomainError("NOT_FOUND", "Issue does not exist");
  return issue;
}

function planningGroup(state: Snapshot["state"], projectId: Id, sprintId: Id | null): Id[] {
  const planning = state.planningOrderByProject[projectId];
  const group = sprintId === null ? planning?.backlog : planning?.sprints[sprintId];
  if (!group) throw new DomainError("VALIDATION", "Planning destination does not exist");
  return group;
}

function setPlanningGroup(state: Snapshot["state"], projectId: Id, sprintId: Id | null, ids: Id[]): void {
  const planning = state.planningOrderByProject[projectId];
  if (!planning) throw new DomainError("VALIDATION", "Project planning order does not exist");
  if (sprintId === null) planning.backlog = ids; else planning.sprints[sprintId] = ids;
}

function assertDestinationSprint(state: Snapshot["state"], projectId: Id, sprintId: Id | null): void {
  if (sprintId === null) return;
  const sprint = state.sprintsById[sprintId];
  if (!sprint || sprint.deletedAt || sprint.projectId !== projectId || sprint.status === "CLOSED") {
    throw new DomainError("VALIDATION", "Destination sprint must be open and belong to this project");
  }
}

/** Pure transaction: either returns a validated immutable snapshot or leaves input untouched. */
export function applyCommand(snapshot: ImmutableSnapshot, command: FoundationCommand, context: CommandContext): CommandResult {
  const next = snapshotSchema.parse(snapshot);
  const state = next.state;
  const now = timestampSchema.parse(context.now);
  idSchema.parse(context.writerId);
  const allocated = new Set<string>([
    snapshot.generation, state.workspace.id, ...Object.keys(state.usersById), ...Object.keys(state.projectsById),
    ...Object.keys(state.issuesById), ...Object.keys(state.sprintsById), ...Object.keys(state.commentsById),
    ...Object.keys(state.activitiesById), ...Object.values(state.activitiesById).map((event) => event.transactionId),
    ...Object.keys(state.deletionRecordsById),
    ...(snapshot.lastTransactionId ? [snapshot.lastTransactionId] : []),
  ]);
  const allocateId = () => {
    const id = idSchema.parse(context.idFactory());
    if (allocated.has(id)) throw new DomainError("CONFLICT", "ID factory produced an existing identifier");
    allocated.add(id);
    return id;
  };
  const assertContext = (generation: Id, issue?: Issue, expectedVersion?: number) => {
    if (generation !== snapshot.generation) throw new DomainError("STALE_GENERATION", "This operation belongs to a previous demo generation");
    if (issue && expectedVersion !== undefined && issue.version !== expectedVersion) throw new DomainError("CONFLICT", "Issue changed since it was read");
    const lastEvent = state.activitiesById[state.activityOrder[state.activityOrder.length - 1] ?? ""];
    if (Date.parse(now) < Math.max(Date.parse(snapshot.scenarioAnchor),
      ...[...Object.values(state.issuesById), ...Object.values(state.commentsById), ...Object.values(state.sprintsById)].map((item) => Date.parse(item.updatedAt)),
      lastEvent ? Date.parse(lastEvent.occurredAt) : 0)) {
      throw new DomainError("VALIDATION", "Mutation clock cannot move backwards");
    }
  };
  let issue: Issue;
  const changed: { before: Issue | null; after: Issue }[] = [];
  let orderChanged = false;
  if (command.kind === "create") {
    const input = createIssueSchema.parse(command.input);
    assertContext(input.expectedGeneration);
    const project = state.projectsById[input.projectId];
    if (!project) throw new DomainError("NOT_FOUND", "Project does not exist");
    const parent = input.parentId ? liveIssue(state, input.parentId) : null;
    if (parent && (parent.parentId !== null || parent.projectId !== project.id)) {
      throw new DomainError("VALIDATION", "Child parent must be top-level and belong to this project");
    }
    const sprintId = input.sprintId === undefined ? parent?.sprintId ?? null : input.sprintId;
    if (parent && sprintId !== parent.sprintId) throw new DomainError("VALIDATION", "Child must inherit the parent sprint");
    assertDestinationSprint(state, project.id, sprintId);
    const number = state.nextIssueNumberByProject[project.id];
    if (number === undefined || !Number.isSafeInteger(number + 1)) throw new DomainError("VALIDATION", "Issue counter is unavailable or exhausted");
    issue = { id: allocateId(), projectId: project.id, key: `${project.keyPrefix}-${number}`, number,
      title: input.title, description: input.description ?? { format: "nexus-rich-text", version: 1, root: { type: "root", children: [] } },
      kind: input.kind ?? "TASK", status: input.status ?? "TODO", priority: input.priority ?? "NORMAL",
      blocker: input.blocker ?? { blocked: false, reason: null }, labelIds: input.labelIds ?? [],
      reporterId: state.workspace.visitorId, assigneeId: input.assigneeId ?? null, parentId: parent?.id ?? null,
      sprintId, createdAt: now, updatedAt: now, version: 1, deletedAt: null,
    };
    state.issuesById[issue.id] = issue;
    state.nextIssueNumberByProject[project.id] = number + 1;
    if (parent) (state.childOrderByParent[parent.id] ??= []).push(issue.id);
    else {
      const board = state.boardOrderByProject[project.id];
      if (!board) throw new DomainError("VALIDATION", "Board order is missing");
      board[issue.status].push(issue.id);
      planningGroup(state, project.id, sprintId).push(issue.id);
    }
    changed.push({ before: null, after: issue });
  } else if (command.kind === "update") {
    const input = updateIssueSchema.parse(command.input);
    assertContext(input.expectedGeneration);
    const before = liveIssue(state, input.issueId);
    assertContext(input.expectedGeneration, before, input.expectedVersion);
    issue = { ...before };
    if (input.patch.title !== undefined) issue.title = input.patch.title;
    if (input.patch.description !== undefined) issue.description = input.patch.description;
    if (input.patch.kind !== undefined) issue.kind = input.patch.kind;
    if (input.patch.reporterId !== undefined) issue.reporterId = input.patch.reporterId;
    if (input.patch.status !== undefined) issue.status = input.patch.status;
    if (input.patch.priority !== undefined) issue.priority = input.patch.priority;
    if (input.patch.assigneeId !== undefined) issue.assigneeId = input.patch.assigneeId;
    if (input.patch.blocker !== undefined) issue.blocker = input.patch.blocker;
    if (input.patch.parentId !== undefined && input.patch.parentId !== before.parentId) {
      const parent = input.patch.parentId === null ? null : liveIssue(state, input.patch.parentId);
      if (parent && (parent.id === issue.id || parent.parentId !== null || parent.projectId !== issue.projectId || (state.childOrderByParent[issue.id]?.length ?? 0) > 0)) {
        throw new DomainError("VALIDATION", "A child requires a top-level parent in this project and cannot have children");
      }
      const board = state.boardOrderByProject[issue.projectId];
      if (!board) throw new DomainError("VALIDATION", "Board order is missing");
      if (before.parentId === null) {
        board[before.status] = board[before.status].filter((id) => id !== issue.id);
        setPlanningGroup(state, issue.projectId, before.sprintId, planningGroup(state, issue.projectId, before.sprintId).filter((id) => id !== issue.id));
        delete state.childOrderByParent[issue.id];
      } else state.childOrderByParent[before.parentId] = (state.childOrderByParent[before.parentId] ?? []).filter((id) => id !== issue.id);
      issue.parentId = parent?.id ?? null;
      if (parent) {
        issue.sprintId = parent.sprintId;
        (state.childOrderByParent[parent.id] ??= []).push(issue.id);
      } else {
        assertDestinationSprint(state, issue.projectId, issue.sprintId);
        board[issue.status].push(issue.id);
        planningGroup(state, issue.projectId, issue.sprintId).push(issue.id);
      }
    }
    if (issueChanges(before, issue).length) {
      if (issue.status !== before.status && issue.parentId === null && before.parentId === null) {
        const board = state.boardOrderByProject[issue.projectId];
        if (!board) throw new DomainError("VALIDATION", "Board order is missing");
        board[before.status] = board[before.status].filter((id) => id !== issue.id);
        board[issue.status].push(issue.id);
      }
      changed.push({ before, after: issue });
    }
  } else {
    const input = moveIssueSchema.parse(command.input);
    assertContext(input.expectedGeneration);
    const before = liveIssue(state, input.issueId);
    assertContext(input.expectedGeneration, before, input.expectedVersion);
    issue = { ...before };
    if (input.destination.view === "board") {
      if (issue.parentId !== null) throw new DomainError("VALIDATION", "Child issues do not belong to board columns");
      const board = state.boardOrderByProject[issue.projectId];
      if (!board) throw new DomainError("VALIDATION", "Board order is missing");
      const target = board[input.destination.status];
      const ordered = insertAtAnchor(target, issue.id, input.placement);
      orderChanged = issue.status !== input.destination.status || !sameOrder(target, ordered);
      board[before.status] = board[before.status].filter((id) => id !== issue.id);
      board[input.destination.status] = ordered;
      issue.status = input.destination.status;
    } else if (input.destination.view === "planning") {
      if (issue.parentId !== null) throw new DomainError("VALIDATION", "Move a child through its parent planning unit");
      const sprintId = input.destination.sprintId;
      assertDestinationSprint(state, issue.projectId, sprintId);
      const target = planningGroup(state, issue.projectId, sprintId);
      const ordered = insertAtAnchor(target, issue.id, input.placement);
      orderChanged = sprintId !== issue.sprintId || !sameOrder(target, ordered);
      const source = planningGroup(state, issue.projectId, issue.sprintId).filter((id) => id !== issue.id);
      setPlanningGroup(state, issue.projectId, issue.sprintId, source);
      setPlanningGroup(state, issue.projectId, sprintId, ordered);
      issue.sprintId = sprintId;
      if (sprintId !== before.sprintId) for (const childId of state.childOrderByParent[issue.id] ?? []) {
        const child = liveIssue(state, childId);
        changed.push({ before: child, after: { ...child, sprintId } });
      }
    } else {
      if (issue.parentId !== input.destination.parentId) throw new DomainError("VALIDATION", "Child ordering cannot reparent an issue");
      const target = state.childOrderByParent[input.destination.parentId];
      if (!target) throw new DomainError("VALIDATION", "Child order is missing");
      const ordered = insertAtAnchor(target, issue.id, input.placement);
      orderChanged = !sameOrder(target, ordered);
      state.childOrderByParent[input.destination.parentId] = ordered;
    }
    if (issueChanges(before, issue).length) changed.unshift({ before, after: issue });
  }
  if (!changed.length && !orderChanged) {
    const original = snapshot.state.issuesById[issue.id];
    if (!original) throw new DomainError("NOT_FOUND", "Issue does not exist");
    return { snapshot, result: deepFreeze({ issue: original, transactionId: null, generation: snapshot.generation,
      revision: snapshot.revision, changedEntityIds: [], affectedProjectIds: [], generatedEventIds: [], persistenceStatus: "memory" as const }) };
  }
  const transactionId = allocateId();
  const eventIds: Id[] = [];
  for (const change of changed) {
    const after = { ...change.after, updatedAt: now, version: change.before ? change.before.version + 1 : 1 };
    state.issuesById[after.id] = after;
    const changes = change.before ? issueChanges(change.before, after) : issueCreatedChanges(after);
    const event = createIssueActivity({ snapshot: next, eventId: allocateId(), transactionId,
      actorId: state.workspace.visitorId, issue: after,
      kind: command.kind === "create" ? "ISSUE_CREATED" : command.kind === "move" ? "ISSUE_MOVED" : "ISSUE_UPDATED",
      changes, occurredAt: now,
    });
    state.activitiesById[event.id] = event; state.activityOrder.push(event.id); eventIds.push(event.id);
  }
  // Reordering is a real transaction but not a domain discussion event.
  if (orderChanged && !changed.length) state.issuesById[issue.id] = { ...issue, updatedAt: now, version: issue.version + 1 };
  next.revision += 1; next.lastWriterId = context.writerId; next.lastTransactionId = transactionId;
  const published = deepFreeze(validateSnapshot(next));
  const committedIssue = published.state.issuesById[issue.id];
  if (!committedIssue) throw new DomainError("NOT_FOUND", "Committed issue is missing");
  return { snapshot: published, result: deepFreeze({ issue: committedIssue, transactionId,
    generation: published.generation, revision: published.revision,
    changedEntityIds: changed.length ? changed.map((change) => change.after.id) : [issue.id],
    affectedProjectIds: [issue.projectId], generatedEventIds: eventIds, persistenceStatus: "memory" as const }) };
}
