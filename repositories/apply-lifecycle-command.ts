import { z } from "zod";
import { issueChanges } from "../domain/activity";
import { deepFreeze, validateSnapshot } from "../domain/invariants";
import { insertAtAnchor } from "../domain/ordering";
import { commentBodySchema, idSchema, snapshotSchema, timestampSchema, titleSchema } from "../domain/schema";
import { DomainError, type ActivityChange, type ActivityKind, type Entity, type Id, type ImmutableSnapshot,
  type Issue, type OrderNeighbors, type Snapshot, type Sprint } from "../domain/types";
import { type CommandContext } from "./apply-command";
import { type LifecycleOperation, type MutationResult, type OperationInput } from "./contracts";

export type LifecycleCommand = { [K in LifecycleOperation]: { kind: K; input: OperationInput<K> } }[LifecycleOperation];
const contextSchema = { expectedGeneration: idSchema, expectedVersion: z.number().int().positive().safe().optional() };
const issueInput = z.object({ ...contextSchema, issueId: idSchema }).strict();
const requiredVersion = z.number().int().positive().safe();
const sprintInput = z.object({ ...contextSchema, expectedVersion: requiredVersion, sprintId: idSchema }).strict();
const commentInput = z.object({ ...contextSchema, expectedVersion: requiredVersion, commentId: idSchema }).strict();

/** Neighbors are canonical IDs: beforeId precedes the record, afterId follows it. */
function neighbors(ids: Id[], id: Id): OrderNeighbors {
  const index = ids.indexOf(id);
  return { beforeId: index > 0 ? ids[index - 1] ?? null : null, afterId: index >= 0 ? ids[index + 1] ?? null : null };
}
function restoreOrder(ids: Id[], id: Id, position: OrderNeighbors): Id[] {
  return insertAtAnchor(ids, id, position.afterId && ids.includes(position.afterId)
    ? { beforeIssueId: position.afterId } : position.beforeId && ids.includes(position.beforeId)
      ? { afterIssueId: position.beforeId } : { at: "end" });
}

/** All lifecycle commands validate a private clone and publish once, including sprint rollover. */
export function applyLifecycleCommand(snapshot: ImmutableSnapshot, command: LifecycleCommand, context: CommandContext):
  { snapshot: ImmutableSnapshot; result: MutationResult } {
  const next = snapshotSchema.parse(snapshot);
  const state = next.state;
  const now = timestampSchema.parse(context.now);
  idSchema.parse(context.writerId);
  const base = z.object(contextSchema).passthrough().parse(command.input);
  if (base.expectedGeneration !== snapshot.generation) throw new DomainError("STALE_GENERATION", "This operation belongs to a previous demo generation");
  const entities = [...Object.values(state.issuesById), ...Object.values(state.commentsById), ...Object.values(state.sprintsById)];
  const lastEvent = state.activitiesById[state.activityOrder.at(-1) ?? ""];
  if (Date.parse(now) < Math.max(Date.parse(snapshot.scenarioAnchor), ...entities.map((entity) => Date.parse(entity.updatedAt)), lastEvent ? Date.parse(lastEvent.occurredAt) : 0)) {
    throw new DomainError("VALIDATION", "Mutation clock cannot move backwards");
  }
  const usedIds = new Set([snapshot.generation, state.workspace.id, ...Object.keys(state.usersById), ...Object.keys(state.projectsById),
    ...entities.map((entity) => entity.id), ...Object.keys(state.deletionRecordsById), ...Object.keys(state.activitiesById),
    ...Object.values(state.activitiesById).map((event) => event.transactionId), ...(snapshot.lastTransactionId ? [snapshot.lastTransactionId] : [])]);
  const allocate = () => {
    const id = idSchema.parse(context.idFactory());
    if (usedIds.has(id)) throw new DomainError("CONFLICT", "ID factory produced an existing identifier");
    usedIds.add(id); return id;
  };
  const checkVersion = (entity: Entity) => {
    if (base.expectedVersion !== undefined && base.expectedVersion !== entity.version) throw new DomainError("CONFLICT", "Entity changed since it was read");
  };
  const liveIssue = (id: Id): Issue => {
    const issue = state.issuesById[id];
    if (!issue || issue.deletedAt) throw new DomainError("NOT_FOUND", "Issue does not exist");
    return issue;
  };
  const liveSprint = (id: Id): Sprint => {
    const sprint = state.sprintsById[id];
    if (!sprint || sprint.deletedAt) throw new DomainError("NOT_FOUND", "Sprint does not exist");
    return sprint;
  };
  const group = (projectId: Id, sprintId: Id | null): Id[] => {
    const planning = state.planningOrderByProject[projectId];
    const ids = sprintId === null ? planning?.backlog : planning?.sprints[sprintId];
    if (!ids) throw new DomainError("VALIDATION", "Planning group does not exist");
    return ids;
  };
  const setGroup = (projectId: Id, sprintId: Id | null, ids: Id[]) => {
    const planning = state.planningOrderByProject[projectId];
    if (!planning) throw new DomainError("VALIDATION", "Project planning does not exist");
    if (sprintId === null) planning.backlog = ids; else planning.sprints[sprintId] = ids;
  };
  const changed = new Set<Id>();
  const projects = new Set<Id>();
  const pendingEvents: { kind: ActivityKind; projectId: Id; issueId: Id | null; sprintId: Id | null; commentId: Id | null; changes: ActivityChange[] }[] = [];
  const event = (kind: ActivityKind, projectId: Id, changes: ActivityChange[], issueId: Id | null = null,
    sprintId: Id | null = null, commentId: Id | null = null) => {
    pendingEvents.push({ kind, projectId, changes, issueId, sprintId, commentId }); projects.add(projectId);
  };
  const touch = <T extends Entity>(entity: T): T => {
    changed.add(entity.id); return { ...entity, version: entity.version + 1, updatedAt: now };
  };
  const saveIssue = (before: Issue, after: Issue, kind: ActivityKind) => {
    state.issuesById[after.id] = touch(after);
    event(kind, after.projectId, issueChanges(before, after), after.id, after.sprintId);
  };
  const removeOrders = (issue: Issue) => {
    if (issue.parentId) state.childOrderByParent[issue.parentId] = (state.childOrderByParent[issue.parentId] ?? []).filter((id) => id !== issue.id);
    else {
      const board = state.boardOrderByProject[issue.projectId];
      if (board) board[issue.status] = board[issue.status].filter((id) => id !== issue.id);
      setGroup(issue.projectId, issue.sprintId, group(issue.projectId, issue.sprintId).filter((id) => id !== issue.id));
    }
  };
  const appendTop = (issue: Issue) => {
    state.boardOrderByProject[issue.projectId]?.[issue.status].push(issue.id);
    group(issue.projectId, issue.sprintId).push(issue.id);
  };
  const moveFamily = (parent: Issue, destination: Id | null) => {
    for (const id of [parent.id, ...(state.childOrderByParent[parent.id] ?? [])]) {
      const before = liveIssue(id);
      saveIssue(before, { ...before, sprintId: destination }, "ISSUE_MOVED");
    }
  };

  if (command.kind === "deleteIssue") {
    const input = issueInput.extend({ children: z.enum(["keep", "delete"]).default("keep") }).parse(command.input);
    const root = liveIssue(input.issueId); checkVersion(root);
    const childIds = [...(state.childOrderByParent[root.id] ?? [])];
    const ids = input.children === "delete" ? [root.id, ...childIds] : [root.id];
    const record: Snapshot["state"]["deletionRecordsById"][string] = {
      id: allocate(), issueIds: ids, deletedAt: now, placements: {}, detachedChildIds: input.children === "keep" ? childIds : [],
    };
    for (const id of ids) {
      const issue = liveIssue(id);
      if (record.placements) record.placements[id] = { parentId: issue.parentId,
        board: neighbors(state.boardOrderByProject[issue.projectId]?.[issue.status] ?? [], id),
        planning: neighbors(group(issue.projectId, issue.sprintId), id),
        children: neighbors(issue.parentId ? state.childOrderByParent[issue.parentId] ?? [] : [], id) };
    }
    for (const id of ids) {
      const before = liveIssue(id); removeOrders(before);
      saveIssue(before, { ...before, deletedAt: now }, "ISSUE_DELETED");
    }
    if (root.parentId === null) state.childOrderByParent[root.id] = [];
    if (input.children === "keep") for (const id of childIds) {
      const before = liveIssue(id); const after = { ...before, parentId: null };
      appendTop(after); saveIssue(before, after, "ISSUE_UPDATED");
    }
    state.deletionRecordsById[record.id] = record;
  } else if (command.kind === "restoreIssue") {
    const input = issueInput.parse(command.input);
    const record = Object.values(state.deletionRecordsById).find((item) => item.issueIds.includes(input.issueId));
    if (!record?.placements) throw new DomainError("NOT_FOUND", "Issue has no restorable deletion record");
    for (const id of record.issueIds) {
      const before = state.issuesById[id];
      const placement: NonNullable<Snapshot["state"]["deletionRecordsById"][string]["placements"]>[string] | undefined = record.placements[id];
      if (!before?.deletedAt || !placement) throw new DomainError("CONFLICT", "Deletion record is incomplete");
      const parent: Issue | null | undefined = placement.parentId ? state.issuesById[placement.parentId] : null;
      const parentSprint: Sprint | null | undefined = parent?.sprintId ? state.sprintsById[parent.sprintId] : null;
      // Undo cannot add work beneath a family whose sprint closed after the deletion.
      const parentId = parent && !parent.deletedAt && (!parentSprint || (!parentSprint.deletedAt && parentSprint.status !== "CLOSED")) ? parent.id : null;
      const oldSprint = before.sprintId ? state.sprintsById[before.sprintId] : null;
      const sprintId = parentId && parent ? parent.sprintId : oldSprint && !oldSprint.deletedAt && oldSprint.status !== "CLOSED" ? oldSprint.id : null;
      const after = { ...before, deletedAt: null, parentId, sprintId };
      if (parentId) state.childOrderByParent[parentId] = restoreOrder(state.childOrderByParent[parentId] ?? [], id, placement.children);
      else {
        const board = state.boardOrderByProject[after.projectId];
        if (board) board[after.status] = restoreOrder(board[after.status], id, placement.board);
        setGroup(after.projectId, sprintId, restoreOrder(group(after.projectId, sprintId), id, placement.planning));
      }
      saveIssue(before, after, "ISSUE_RESTORED");
    }
    const root = state.issuesById[record.issueIds[0] ?? ""];
    if (root) for (const id of record.detachedChildIds ?? []) {
      const child = state.issuesById[id];
      // Preserve edits and later planning moves. Only undo the relationship we detached.
      if (!child || child.deletedAt || child.parentId !== null || child.sprintId !== root.sprintId) continue;
      removeOrders(child);
      (state.childOrderByParent[root.id] ??= []).push(id);
      saveIssue(child, { ...child, parentId: root.id }, "ISSUE_RESTORED");
    }
    delete state.deletionRecordsById[record.id];
  } else if (command.kind === "createComment") {
    const input = issueInput.extend({ body: commentBodySchema }).parse(command.input);
    const issue = liveIssue(input.issueId);
    const authorId = state.workspace.visitorId;
    if (state.usersById[authorId]?.workspaceId !== state.workspace.id) throw new DomainError("VALIDATION", "Comment author is not a workspace user");
    const comment = { id: allocate(), issueId: issue.id, authorId, body: input.body, createdAt: now, updatedAt: now,
      version: 1, editedAt: null, deletedAt: null };
    state.commentsById[comment.id] = comment; changed.add(comment.id);
    event("COMMENT_CREATED", issue.projectId, [{ field: "commentBody", before: null, after: input.body }], issue.id, issue.sprintId, comment.id);
  } else if (command.kind === "updateComment" || command.kind === "deleteComment") {
    const input = (command.kind === "updateComment" ? commentInput.extend({ body: commentBodySchema }) : commentInput).parse(command.input);
    const before = state.commentsById[input.commentId];
    if (!before || before.deletedAt) throw new DomainError("NOT_FOUND", "Comment does not exist");
    checkVersion(before); const issue = liveIssue(before.issueId);
    if (command.kind === "deleteComment") {
      state.commentsById[before.id] = touch({ ...before, deletedAt: now });
      event("COMMENT_DELETED", issue.projectId, [{ field: "deletedAt", before: null, after: now }], issue.id, issue.sprintId, before.id);
    } else {
      const body = commentBodySchema.parse(command.input.body);
      if (JSON.stringify(body) !== JSON.stringify(before.body)) {
        state.commentsById[before.id] = touch({ ...before, body, editedAt: now });
        event("COMMENT_UPDATED", issue.projectId, [{ field: "commentBody", before: before.body, after: body }], issue.id, issue.sprintId, before.id);
      }
    }
  } else if (command.kind === "createSprint") {
    const input = z.object({ expectedGeneration: idSchema, projectId: idSchema, name: titleSchema, goal: z.string().trim().min(1).max(2000) }).strict().parse(command.input);
    if (!state.projectsById[input.projectId]) throw new DomainError("NOT_FOUND", "Project does not exist");
    const sprint: Sprint = { id: allocate(), projectId: input.projectId, name: input.name, goal: input.goal, status: "PENDING",
      startsAt: null, endsAt: null, startedAt: null, completedAt: null, deletedAt: null, createdAt: now, updatedAt: now, version: 1 };
    state.sprintsById[sprint.id] = sprint; setGroup(sprint.projectId, sprint.id, []); changed.add(sprint.id);
    event("SPRINT_CREATED", sprint.projectId, [{ field: "sprintName", before: null, after: sprint.name }, { field: "sprintGoal", before: null, after: sprint.goal }], null, sprint.id);
  } else {
    const input = command.kind === "updateSprint" || command.kind === "startSprint" ? sprintInput.extend({ name: titleSchema.optional(), goal: z.string().trim().min(1).max(2000).optional(),
      startsAt: timestampSchema.nullable().optional(), endsAt: timestampSchema.nullable().optional() }).parse(command.input)
      : command.kind === "completeSprint" ? sprintInput.extend({ destinationSprintId: idSchema.nullable() }).parse(command.input)
        : sprintInput.parse(command.input);
    const before = liveSprint(input.sprintId); checkVersion(before);
    if (command.kind === "updateSprint") {
      if (before.status === "CLOSED") throw new DomainError("CONFLICT", "Closed sprint cannot be edited");
      const patch = command.input;
      const after = { ...before, name: patch.name === undefined ? before.name : titleSchema.parse(patch.name),
        goal: patch.goal === undefined ? before.goal : z.string().trim().min(1).max(2000).parse(patch.goal),
        startsAt: patch.startsAt === undefined ? before.startsAt : patch.startsAt,
        endsAt: patch.endsAt === undefined ? before.endsAt : patch.endsAt };
      const changes: ActivityChange[] = [];
      if (after.name !== before.name) changes.push({ field: "sprintName", before: before.name, after: after.name });
      if (after.goal !== before.goal) changes.push({ field: "sprintGoal", before: before.goal, after: after.goal });
      for (const field of ["startsAt", "endsAt"] as const) if (after[field] !== before[field]) changes.push({ field, before: before[field], after: after[field] });
      if (changes.length) { state.sprintsById[before.id] = touch(after); event("SPRINT_UPDATED", before.projectId, changes, null, before.id); }
    } else if (command.kind === "startSprint") {
      if (before.status !== "PENDING") throw new DomainError("CONFLICT", "Only pending sprints can start");
      if (Object.values(state.sprintsById).some((sprint) => sprint.projectId === before.projectId && sprint.status === "ACTIVE")) {
        throw new DomainError("CONFLICT", "Project already has an active sprint");
      }
      const patch = command.input;
      const after = { ...before, status: "ACTIVE" as const, startedAt: now,
        name: patch.name === undefined ? before.name : titleSchema.parse(patch.name),
        goal: patch.goal === undefined ? before.goal : z.string().trim().min(1).max(2000).parse(patch.goal),
        startsAt: patch.startsAt === undefined ? before.startsAt : timestampSchema.nullable().parse(patch.startsAt),
        endsAt: patch.endsAt === undefined ? before.endsAt : timestampSchema.nullable().parse(patch.endsAt) };
      const changes: ActivityChange[] = [{ field: "sprintStatus", before: "PENDING", after: "ACTIVE" }];
      if (after.name !== before.name) changes.push({ field: "sprintName", before: before.name, after: after.name });
      if (after.goal !== before.goal) changes.push({ field: "sprintGoal", before: before.goal, after: after.goal });
      for (const field of ["startsAt", "endsAt"] as const) if (after[field] !== before[field]) changes.push({ field, before: before[field], after: after[field] });
      state.sprintsById[before.id] = touch(after);
      event("SPRINT_STARTED", before.projectId, changes, null, before.id);
    } else {
      const completing = command.kind === "completeSprint";
      if (before.status !== (completing ? "ACTIVE" : "PENDING")) throw new DomainError("CONFLICT", completing ? "Only active sprints can complete" : "Only pending sprints can be deleted");
      const destinationId = completing && command.kind === "completeSprint" ? command.input.destinationSprintId : null;
      if (destinationId !== null) {
        const target = liveSprint(destinationId);
        if (target.projectId !== before.projectId || target.status !== "PENDING") throw new DomainError("VALIDATION", "Completion destination must be a pending sprint in this project");
      }
      const source = [...group(before.projectId, before.id)];
      const moving = source.filter((id) => {
        const parent = liveIssue(id);
        return !completing || [parent.id, ...(state.childOrderByParent[parent.id] ?? [])].some((memberId) => liveIssue(memberId).status !== "DONE");
      });
      for (const id of moving) moveFamily(liveIssue(id), destinationId);
      setGroup(before.projectId, before.id, source.filter((id) => !moving.includes(id)));
      group(before.projectId, destinationId).push(...moving);
      state.sprintsById[before.id] = touch(completing ? { ...before, status: "CLOSED", completedAt: now } : { ...before, deletedAt: now });
      event(completing ? "SPRINT_COMPLETED" : "SPRINT_DELETED", before.projectId,
        completing ? [{ field: "sprintStatus", before: "ACTIVE", after: "CLOSED" }] : [{ field: "deletedAt", before: null, after: now }], null, before.id);
    }
  }
  if (!changed.size) return { snapshot, result: deepFreeze({ transactionId: null, generation: snapshot.generation, revision: snapshot.revision,
    changedEntityIds: [], affectedProjectIds: [], generatedEventIds: [], persistenceStatus: "memory" as const }) };
  const transactionId = allocate(); const eventIds: Id[] = [];
  for (const pending of pendingEvents) {
    const id = allocate(); state.activitiesById[id] = { ...pending, id, transactionId, sequence: state.activityOrder.length + 1,
      actorId: state.workspace.visitorId, occurredAt: now }; state.activityOrder.push(id); eventIds.push(id);
  }
  next.revision += 1; next.lastWriterId = context.writerId; next.lastTransactionId = transactionId;
  return { snapshot: deepFreeze(validateSnapshot(next)), result: deepFreeze({ transactionId, generation: next.generation, revision: next.revision,
    changedEntityIds: [...changed], affectedProjectIds: [...projects], generatedEventIds: eventIds, persistenceStatus: "memory" as const }) };
}
