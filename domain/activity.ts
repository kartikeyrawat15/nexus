import { type ActivityChange, type ActivityEvent, type ActivityKind, type Id, type ImmutableSnapshot, type Issue, type ISODateTime } from "./types";

export function issueChanges(before: Readonly<Issue>, after: Readonly<Issue>): ActivityChange[] {
  const changes: ActivityChange[] = [];
  if (before.title !== after.title) changes.push({ field: "title", before: before.title, after: after.title });
  if (JSON.stringify(before.description) !== JSON.stringify(after.description)) changes.push({ field: "description", before: before.description, after: after.description });
  if (before.kind !== after.kind) changes.push({ field: "kind", before: before.kind, after: after.kind });
  if (before.reporterId !== after.reporterId) changes.push({ field: "reporterId", before: before.reporterId, after: after.reporterId });
  if (before.status !== after.status) changes.push({ field: "status", before: before.status, after: after.status });
  if (before.priority !== after.priority) changes.push({ field: "priority", before: before.priority, after: after.priority });
  if (before.assigneeId !== after.assigneeId) changes.push({ field: "assigneeId", before: before.assigneeId, after: after.assigneeId });
  if (before.sprintId !== after.sprintId) changes.push({ field: "sprintId", before: before.sprintId, after: after.sprintId });
  if (before.parentId !== after.parentId) changes.push({ field: "parentId", before: before.parentId, after: after.parentId });
  if (before.deletedAt !== after.deletedAt) changes.push({ field: "deletedAt", before: before.deletedAt, after: after.deletedAt });
  if (before.blocker.blocked !== after.blocker.blocked || before.blocker.reason !== after.blocker.reason) {
    changes.push({ field: "blocker", before: { ...before.blocker }, after: { ...after.blocker } });
  }
  return changes;
}

export function issueCreatedChanges(issue: Readonly<Issue>): ActivityChange[] {
  const changes: ActivityChange[] = [
    { field: "title", before: null, after: issue.title },
    { field: "status", before: null, after: issue.status },
    { field: "priority", before: null, after: issue.priority },
  ];
  if (issue.assigneeId !== null) changes.push({ field: "assigneeId", before: null, after: issue.assigneeId });
  if (issue.sprintId !== null) changes.push({ field: "sprintId", before: null, after: issue.sprintId });
  if (issue.blocker.blocked) changes.push({ field: "blocker", before: { blocked: false, reason: null }, after: { ...issue.blocker } });
  return changes;
}

export function createIssueActivity(input: {
  snapshot: ImmutableSnapshot; eventId: Id; transactionId: Id; actorId: Id;
  issue: Readonly<Issue>; kind: ActivityKind; changes: ActivityChange[]; occurredAt: ISODateTime;
}): ActivityEvent {
  return {
    id: input.eventId, transactionId: input.transactionId,
    sequence: input.snapshot.state.activityOrder.length + 1,
    actorId: input.actorId, projectId: input.issue.projectId, issueId: input.issue.id,
    sprintId: input.issue.sprintId, commentId: null, kind: input.kind,
    changes: input.changes, occurredAt: input.occurredAt,
  };
}
