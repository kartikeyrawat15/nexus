import { describe, expect, it } from "vitest";
import { documentFromParagraphs } from "../../demo/wayline";
import { validateSnapshot } from "../../domain/invariants";
import { type ImmutableSnapshot, type RichTextDocument } from "../../domain/types";
import { type MutationResult, type RepositoryOptions } from "../../repositories/contracts";
import { MemoryRepository } from "../../repositories/memory-repository";

const anchor = "2026-10-05T10:00:00.000Z";
const parentId = "live-tracking-118";
const childId = "live-tracking-140";
const sprintId = "lt-sprint-12";
const pendingId = "lt-sprint-13";
async function setup(options: RepositoryOptions = {}) {
  let index = 0;
  const repo = new MemoryRepository({ clock: () => anchor, idFactory: () => `lifecycle-${++index}`, ...options });
  const snapshot = await repo.initialize();
  return { repo, snapshot, expectedGeneration: snapshot.generation };
}
function getIssue(snapshot: ImmutableSnapshot, id: string): ImmutableSnapshot["state"]["issuesById"][string] {
  const issue = snapshot.state.issuesById[id];
  if (!issue) throw new Error(`Missing issue ${id}`);
  return issue;
}
function changedId(result: MutationResult): string {
  const id = result.changedEntityIds[0];
  if (!id) throw new Error("Expected one changed entity");
  return id;
}
function kinds(snapshot: ImmutableSnapshot, result: MutationResult) {
  return result.generatedEventIds.map((id) => snapshot.state.activitiesById[id]?.kind);
}
function sprintVersion(snapshot: ImmutableSnapshot, id: string): number {
  const sprint = snapshot.state.sprintsById[id];
  if (!sprint) throw new Error(`Missing sprint ${id}`);
  return sprint.version;
}

describe("targeted issue deletion and Undo", () => {
  it("tombstones an issue, preserves discussion and numbers, and removes active orders", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    const id = "live-tracking-139";
    const result = await repo.deleteIssue({ expectedGeneration, issueId: id });
    const after = await repo.getSnapshot();
    expect(getIssue(after, id)).toMatchObject({ deletedAt: anchor, version: getIssue(snapshot, id).version + 1 });
    expect(Object.values(after.state.boardOrderByProject["live-tracking"] ?? {}).flat()).not.toContain(id);
    expect(after.state.planningOrderByProject["live-tracking"]?.backlog).not.toContain(id);
    expect(after.state.commentsById).toEqual(snapshot.state.commentsById);
    expect(after.state.activityOrder.slice(0, snapshot.state.activityOrder.length)).toEqual(snapshot.state.activityOrder);
    expect(kinds(after, result)).toEqual(["ISSUE_DELETED"]);
    expect(getIssue(snapshot, id).deletedAt).toBeNull();
    expect(Object.isFrozen(after.state.deletionRecordsById)).toBe(true);
    expect((await repo.createIssue({ expectedGeneration, projectId: "live-tracking", title: "Next allocation" })).issue.key).toBe("LT-145");
    await expect(repo.updateIssue({ expectedGeneration, issueId: id, patch: { title: "Deleted edit" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("detaches children by default and restores their relationship without losing later edits", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await repo.deleteIssue({ expectedGeneration, issueId: parentId });
    let after = await repo.getSnapshot();
    expect(getIssue(after, childId)).toMatchObject({ parentId: null, deletedAt: null, sprintId });
    expect(after.state.childOrderByParent[parentId]).toEqual([]);
    expect(after.state.boardOrderByProject["live-tracking"]?.DONE).toContain(childId);
    expect(after.state.planningOrderByProject["live-tracking"]?.sprints[sprintId]).toContain(childId);
    await repo.updateIssue({ expectedGeneration, issueId: childId, patch: { title: "Child edit after deletion", priority: "URGENT" } });
    await repo.updateIssue({ expectedGeneration, issueId: "carrier-api-42", patch: { title: "Unrelated partner fix" } });
    const beforeRestore = await repo.getSnapshot();
    const result = await repo.restoreIssue({ expectedGeneration, issueId: parentId });
    after = await repo.getSnapshot();
    expect(getIssue(after, parentId).deletedAt).toBeNull();
    expect(getIssue(after, childId)).toMatchObject({ parentId, title: "Child edit after deletion", priority: "URGENT", sprintId });
    expect(getIssue(after, "carrier-api-42")).toEqual(getIssue(beforeRestore, "carrier-api-42"));
    expect(after.state.boardOrderByProject).toEqual(snapshot.state.boardOrderByProject);
    expect(after.state.planningOrderByProject).toEqual(snapshot.state.planningOrderByProject);
    expect(after.state.childOrderByParent).toEqual(snapshot.state.childOrderByParent);
    expect(after.revision).toBe(beforeRestore.revision + 1);
    expect(kinds(after, result)).toEqual(["ISSUE_RESTORED", "ISSUE_RESTORED"]);
    expect(after.state.deletionRecordsById).toEqual({});
    expect(() => validateSnapshot(after)).not.toThrow();
  });

  it("supports explicit whole-family tombstones and one targeted family restoration", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    const result = await repo.deleteIssue({ expectedGeneration, issueId: parentId, children: "delete" });
    const deleted = await repo.getSnapshot();
    expect(result.changedEntityIds).toEqual([parentId, childId]);
    expect(getIssue(deleted, childId)).toMatchObject({ parentId, deletedAt: anchor });
    expect(kinds(deleted, result)).toEqual(["ISSUE_DELETED", "ISSUE_DELETED"]);
    const restored = await repo.restoreIssue({ expectedGeneration, issueId: childId });
    const after = await repo.getSnapshot();
    expect(restored.changedEntityIds).toEqual([parentId, childId]);
    expect(after.state.childOrderByParent).toEqual(snapshot.state.childOrderByParent);
    expect(after.state.planningOrderByProject).toEqual(snapshot.state.planningOrderByProject);
    expect(after.revision).toBe(2);
  });

  it("restores an independently deleted child and inherits the parent's later sprint", async () => {
    const { repo, expectedGeneration } = await setup();
    await repo.deleteIssue({ expectedGeneration, issueId: childId });
    await repo.moveIssue({ expectedGeneration, issueId: parentId, destination: { view: "planning", sprintId: pendingId }, placement: { at: "end" } });
    await repo.restoreIssue({ expectedGeneration, issueId: childId });
    const after = await repo.getSnapshot();
    expect(getIssue(after, childId)).toMatchObject({ parentId, sprintId: pendingId, deletedAt: null });
    expect(after.state.childOrderByParent[parentId]).toEqual([childId]);
    expect(() => validateSnapshot(after)).not.toThrow();
  });

  it("preserves later planning moves of detached children during Undo", async () => {
    const { repo, expectedGeneration } = await setup();
    await repo.deleteIssue({ expectedGeneration, issueId: parentId });
    await repo.moveIssue({ expectedGeneration, issueId: childId, destination: { view: "planning", sprintId: pendingId }, placement: { at: "end" } });
    const before = await repo.getSnapshot();
    await repo.restoreIssue({ expectedGeneration, issueId: parentId });
    const after = await repo.getSnapshot();
    expect(getIssue(after, childId)).toEqual(getIssue(before, childId));
    expect(getIssue(after, childId).parentId).toBeNull();
    expect(after.state.planningOrderByProject["live-tracking"]?.sprints[pendingId]).toContain(childId);
  });

  it("restores a child as backlog work if its former parent's sprint has closed", async () => {
    const { repo, expectedGeneration } = await setup();
    const unfinishedChild = "live-tracking-144"; const doneParent = "live-tracking-127";
    await repo.deleteIssue({ expectedGeneration, issueId: unfinishedChild });
    await repo.updateIssue({ expectedGeneration, issueId: doneParent, patch: { status: "DONE" } });
    await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(await repo.getSnapshot(), sprintId), destinationSprintId: null });
    const before = await repo.getSnapshot();
    await repo.restoreIssue({ expectedGeneration, issueId: unfinishedChild });
    const after = await repo.getSnapshot();
    expect(getIssue(after, unfinishedChild)).toMatchObject({ parentId: null, sprintId: null, status: "TODO", deletedAt: null });
    expect(getIssue(after, doneParent)).toEqual(getIssue(before, doneParent));
    expect(after.state.planningOrderByProject["live-tracking"]?.backlog).toContain(unfinishedChild);
    expect(() => validateSnapshot(after)).not.toThrow();
  });

  it("restores a child independently when its former parent remains deleted", async () => {
    const { repo, expectedGeneration } = await setup();
    await repo.deleteIssue({ expectedGeneration, issueId: childId });
    await repo.deleteIssue({ expectedGeneration, issueId: parentId });
    await repo.restoreIssue({ expectedGeneration, issueId: childId });
    const after = await repo.getSnapshot();
    expect(getIssue(after, childId)).toMatchObject({ parentId: null, deletedAt: null });
    expect(getIssue(after, parentId).deletedAt).toBe(anchor);
    expect(after.state.childOrderByParent[parentId]).toEqual([]);
    expect(() => validateSnapshot(after)).not.toThrow();
  });

  it("uses surviving canonical anchors while preserving later insertions and orders", async () => {
    const { repo, expectedGeneration } = await setup();
    const id = "live-tracking-137";
    await repo.deleteIssue({ expectedGeneration, issueId: id });
    await repo.deleteIssue({ expectedGeneration, issueId: "live-tracking-136" });
    const created = await repo.createIssue({ expectedGeneration, projectId: "live-tracking", title: "Inserted after deletion" });
    await repo.moveIssue({ expectedGeneration, issueId: created.issue.id, destination: { view: "planning", sprintId: null }, placement: { beforeIssueId: "live-tracking-138" } });
    await repo.restoreIssue({ expectedGeneration, issueId: id });
    const after = await repo.getSnapshot();
    expect(after.state.planningOrderByProject["live-tracking"]?.backlog).toEqual([created.issue.id, id, "live-tracking-138", "live-tracking-139"]);
    expect(getIssue(after, "live-tracking-136").deletedAt).toBe(anchor);
  });

  it("restores into backlog when the former sprint was closed or deleted", async () => {
    const { repo, expectedGeneration } = await setup();
    await repo.deleteIssue({ expectedGeneration, issueId: parentId, children: "delete" });
    await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(await repo.getSnapshot(), sprintId), destinationSprintId: null });
    await repo.restoreIssue({ expectedGeneration, issueId: parentId });
    const after = await repo.getSnapshot();
    expect(getIssue(after, parentId).sprintId).toBeNull();
    expect(getIssue(after, childId)).toMatchObject({ parentId, sprintId: null });
    expect(after.state.planningOrderByProject["live-tracking"]?.backlog).toContain(parentId);
  });

  it("rejects stale, missing, repeated and invalid deletion/restoration without publication", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.deleteIssue({ expectedGeneration, issueId: parentId, expectedVersion: 999 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.deleteIssue({ expectedGeneration: "old", issueId: parentId })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    await expect(repo.deleteIssue({ expectedGeneration, issueId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.restoreIssue({ expectedGeneration, issueId: parentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getSnapshot()).toBe(snapshot);
    await repo.deleteIssue({ expectedGeneration, issueId: parentId });
    const deleted = await repo.getSnapshot();
    await expect(repo.deleteIssue({ expectedGeneration, issueId: parentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getSnapshot()).toBe(deleted);
    await repo.restoreIssue({ expectedGeneration, issueId: parentId });
    const restored = await repo.getSnapshot();
    await expect(repo.restoreIssue({ expectedGeneration, issueId: parentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getSnapshot()).toBe(restored);
  });
});

describe("application-owned comment discussion", () => {
  it("creates, edits and soft-deletes a comment with immutable, coherent history", async () => {
    let now = anchor;
    const { repo, snapshot, expectedGeneration } = await setup({ clock: () => now });
    const body = documentFromParagraphs("Explain the carrier boundary");
    const created = await repo.createComment({ expectedGeneration, issueId: parentId, body });
    const commentId = changedId(created);
    const afterCreate = await repo.getSnapshot();
    expect(afterCreate.state.commentsById[commentId]).toMatchObject({ authorId: "maya", issueId: parentId, version: 1, createdAt: now, editedAt: null, deletedAt: null });
    body.root.children.length = 0;
    expect(afterCreate.state.commentsById[commentId]?.body.root.children).toHaveLength(1);
    now = "2026-10-05T11:00:00.000Z";
    const editedBody = documentFromParagraphs("Clarify the final carrier boundary");
    const edited = await repo.updateComment({ expectedGeneration, commentId, expectedVersion: 1, body: editedBody });
    const afterEdit = await repo.getSnapshot();
    expect(afterEdit.state.commentsById[commentId]).toMatchObject({ version: 2, editedAt: now, updatedAt: now, body: editedBody });
    now = "2026-10-05T12:00:00.000Z";
    const deleted = await repo.deleteComment({ expectedGeneration, commentId, expectedVersion: 2 });
    const afterDelete = await repo.getSnapshot();
    expect(afterDelete.state.commentsById[commentId]).toMatchObject({ version: 3, deletedAt: now, updatedAt: now, body: editedBody });
    expect(kinds(afterDelete, created)).toEqual(["COMMENT_CREATED"]);
    expect(kinds(afterDelete, edited)).toEqual(["COMMENT_UPDATED"]);
    expect(kinds(afterDelete, deleted)).toEqual(["COMMENT_DELETED"]);
    expect(snapshot.state.commentsById[commentId]).toBeUndefined();
    expect(afterCreate.state.commentsById[commentId]?.version).toBe(1);
    expect(afterEdit.state.commentsById[commentId]?.deletedAt).toBeNull();
    expect(Object.isFrozen(afterDelete.state.commentsById[commentId]?.body.root.children)).toBe(true);
    expect(() => validateSnapshot(afterDelete)).not.toThrow();
    const contradictory = validateSnapshot(afterDelete);
    const comment = contradictory.state.commentsById[commentId];
    if (!comment) throw new Error("Missing comment");
    comment.body = documentFromParagraphs("Contradicts history");
    expect(() => validateSnapshot(contradictory)).toThrow("history");
  });

  it("suppresses equal-body comment updates without allocating IDs", async () => {
    const { repo, expectedGeneration } = await setup();
    const body = documentFromParagraphs("Stable body");
    const created = await repo.createComment({ expectedGeneration, issueId: parentId, body });
    const before = await repo.getSnapshot();
    const noOp = await repo.updateComment({ expectedGeneration, commentId: changedId(created), expectedVersion: 1, body: structuredClone(body) });
    expect(await repo.getSnapshot()).toBe(before);
    expect(noOp).toMatchObject({ transactionId: null, generatedEventIds: [], changedEntityIds: [], revision: before.revision });
    const next = await repo.createComment({ expectedGeneration, issueId: parentId, body });
    expect(changedId(next)).toBe("lifecycle-5");
  });

  it.each([documentFromParagraphs("   \n "), { format: "nexus-rich-text", version: 1, root: { type: "root", children: [] } } satisfies RichTextDocument])("rejects empty rich-text bodies atomically", async (body) => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.createComment({ expectedGeneration, issueId: parentId, body })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("rejects missing/deleted issues, stale edits, unsafe rich text and invalid authors", async () => {
    const { repo, expectedGeneration } = await setup();
    const body = documentFromParagraphs("Valid comment");
    const created = await repo.createComment({ expectedGeneration, issueId: parentId, body });
    const commentId = changedId(created);
    const before = await repo.getSnapshot();
    await expect(repo.updateComment({ expectedGeneration, commentId, expectedVersion: 99, body })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.deleteComment({ expectedGeneration, commentId, expectedVersion: 99 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.createComment({ expectedGeneration, issueId: "missing", body })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.updateComment({ expectedGeneration, commentId, expectedVersion: 1, body: documentFromParagraphs(" ") })).rejects.toMatchObject({ code: "VALIDATION" });
    const unsafe: RichTextDocument = { format: "nexus-rich-text", version: 1, root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "javascript:alert(1)", children: [{ type: "text", text: "bad", marks: [] }] }] }] } };
    await expect(repo.createComment({ expectedGeneration, issueId: parentId, body: unsafe })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await repo.getSnapshot()).toBe(before);
    const invalid = validateSnapshot(before);
    const comment = invalid.state.commentsById[commentId];
    if (!comment) throw new Error("Missing comment");
    comment.authorId = "missing-user";
    expect(() => validateSnapshot(invalid)).toThrow("author");
    await repo.deleteIssue({ expectedGeneration, issueId: parentId });
    const deleted = await repo.getSnapshot();
    await expect(repo.createComment({ expectedGeneration, issueId: parentId, body })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.updateComment({ expectedGeneration, commentId, expectedVersion: 1, body })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.deleteComment({ expectedGeneration, commentId, expectedVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getSnapshot()).toBe(deleted);
    await repo.restoreIssue({ expectedGeneration, issueId: parentId });
    await repo.deleteComment({ expectedGeneration, commentId, expectedVersion: 1 });
    const removed = await repo.getSnapshot();
    await expect(repo.deleteComment({ expectedGeneration, commentId, expectedVersion: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.updateComment({ expectedGeneration, commentId, expectedVersion: 2, body })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getSnapshot()).toBe(removed);
  });
});

describe("sprint lifecycle", () => {
  it("creates and edits a pending sprint, validates dates, and suppresses no-op edits", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    const created = await repo.createSprint({ expectedGeneration, projectId: "live-tracking", name: "  Sprint 14  ", goal: " Stabilize tracking " });
    const id = changedId(created);
    const first = await repo.getSnapshot();
    expect(first.state.sprintsById[id]).toMatchObject({ name: "Sprint 14", goal: "Stabilize tracking", status: "PENDING", startedAt: null, completedAt: null });
    expect(first.state.planningOrderByProject["live-tracking"]?.sprints[id]).toEqual([]);
    expect(kinds(first, created)).toEqual(["SPRINT_CREATED"]);
    const edited = await repo.updateSprint({ expectedGeneration, sprintId: id, expectedVersion: 1, name: "Sprint fourteen", goal: "Reliable feed", startsAt: anchor, endsAt: "2026-10-19T10:00:00.000Z" });
    const after = await repo.getSnapshot();
    expect(after.state.sprintsById[id]).toMatchObject({ name: "Sprint fourteen", goal: "Reliable feed", startsAt: anchor, version: 2 });
    expect(kinds(after, edited)).toEqual(["SPRINT_UPDATED"]);
    const noOp = await repo.updateSprint({ expectedGeneration, sprintId: id, expectedVersion: 2, name: " Sprint fourteen ", goal: "Reliable feed" });
    expect(noOp.transactionId).toBeNull(); expect(await repo.getSnapshot()).toBe(after);
    await expect(repo.updateSprint({ expectedGeneration, sprintId: id, expectedVersion: 2, endsAt: "2026-10-04T10:00:00.000Z" })).rejects.toThrow("dates");
    await expect(repo.updateSprint({ expectedGeneration, sprintId: id, expectedVersion: 1, goal: "Stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(after);
    expect(snapshot.state.sprintsById[id]).toBeUndefined();
    expect(Object.isFrozen(after.state.sprintsById[id])).toBe(true);
  });

  it("deletes pending sprints by returning complete families to backlog in canonical order", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    const projectId = "carrier-api"; const id = "api-sprint-8";
    const original = snapshot.state.planningOrderByProject[projectId];
    if (!original) throw new Error("Missing planning");
    const result = await repo.deletePendingSprint({ expectedGeneration, sprintId: id, expectedVersion: sprintVersion(snapshot, id) });
    const after = await repo.getSnapshot();
    expect(after.state.sprintsById[id]).toMatchObject({ status: "PENDING", deletedAt: anchor });
    expect(after.state.planningOrderByProject[projectId]?.backlog).toEqual([...original.backlog, ...original.sprints[id] ?? []]);
    expect(after.state.planningOrderByProject[projectId]?.sprints[id]).toEqual([]);
    expect(getIssue(after, "carrier-api-53")).toMatchObject({ parentId: "carrier-api-49", sprintId: null });
    expect(after.state.boardOrderByProject).toEqual(snapshot.state.boardOrderByProject);
    expect(kinds(after, result).at(-1)).toBe("SPRINT_DELETED");
    expect(after.revision).toBe(1);
    expect(() => validateSnapshot(after)).not.toThrow();
    await expect(repo.createIssue({ expectedGeneration, projectId, sprintId: id, title: "Deleted sprint work" })).rejects.toThrow("open");
    await expect(repo.startSprint({ expectedGeneration, sprintId: id, expectedVersion: sprintVersion(after, id) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["lt-sprint-12", "ops-sprint-3"])("rejects deletion of %s without mutation", async (id) => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.deletePendingSprint({ expectedGeneration, sprintId: id, expectedVersion: sprintVersion(snapshot, id) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("starts a pending sprint while other projects remain active and enforces project uniqueness", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.startSprint({ expectedGeneration, sprintId: pendingId, expectedVersion: sprintVersion(snapshot, pendingId) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(snapshot);
    const created = await repo.createSprint({ expectedGeneration, projectId: "operations-console", name: "Operations 4", goal: "Triage quickly" });
    const id = changedId(created);
    const started = await repo.startSprint({ expectedGeneration, sprintId: id, expectedVersion: 1 });
    const after = await repo.getSnapshot();
    expect(after.state.sprintsById[id]).toMatchObject({ status: "ACTIVE", startedAt: anchor, completedAt: null, version: 2 });
    expect(Object.values(after.state.sprintsById).filter((sprint) => sprint.status === "ACTIVE")).toHaveLength(3);
    expect(kinds(after, started)).toEqual(["SPRINT_STARTED"]);
    await expect(repo.startSprint({ expectedGeneration, sprintId: id, expectedVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(after);
  });

  it("validates sprint input, prevents closed edits and new closed work", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.createSprint({ expectedGeneration, projectId: "missing", name: "Sprint", goal: "Goal" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.createSprint({ expectedGeneration, projectId: "live-tracking", name: " ", goal: "Goal" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(repo.createSprint({ expectedGeneration, projectId: "live-tracking", name: "Sprint", goal: " " })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(repo.updateSprint({ expectedGeneration, sprintId: "ops-sprint-3", expectedVersion: sprintVersion(snapshot, "ops-sprint-3"), name: "Closed edit" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.moveIssue({ expectedGeneration, issueId: "operations-console-31", destination: { view: "planning", sprintId: "ops-sprint-3" }, placement: { at: "end" } })).rejects.toThrow("open");
    await expect(repo.createIssue({ expectedGeneration, projectId: "operations-console", parentId: "operations-console-36", title: "New child in closed work" })).rejects.toThrow("open");
    expect(await repo.getSnapshot()).toBe(snapshot);
  });
});

describe("atomic canonical sprint completion", () => {
  it.each([pendingId, null])("keeps complete families and rolls all unfinished work into %s in one transaction", async (destinationSprintId) => {
    const { repo, expectedGeneration } = await setup();
    // A DONE parent with an unfinished child must roll over, regardless of any UI filter.
    await repo.updateIssue({ expectedGeneration, issueId: "live-tracking-127", patch: { status: "DONE" } });
    const before = await repo.getSnapshot();
    const source = before.state.planningOrderByProject["live-tracking"]?.sprints[sprintId];
    if (!source) throw new Error("Missing source order");
    const completeIds = ["live-tracking-119", "live-tracking-122", "live-tracking-125", "live-tracking-129"];
    const moving = source.filter((id) => !completeIds.includes(id));
    const existingDestination = destinationSprintId === null ? before.state.planningOrderByProject["live-tracking"]?.backlog : before.state.planningOrderByProject["live-tracking"]?.sprints[destinationSprintId];
    const expectedMovedEntities = moving.flatMap((id) => [id, ...before.state.childOrderByParent[id] ?? []]);
    const result = await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(before, sprintId), destinationSprintId });
    const after = await repo.getSnapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(result.changedEntityIds).toEqual([...expectedMovedEntities, sprintId]);
    expect(after.lastTransactionId).toBe(result.transactionId);
    expect(result.generatedEventIds).toHaveLength(expectedMovedEntities.length + 1);
    expect(new Set(result.generatedEventIds.map((id) => after.state.activitiesById[id]?.transactionId))).toEqual(new Set([result.transactionId]));
    expect(kinds(after, result)).toEqual([...expectedMovedEntities.map(() => "ISSUE_MOVED"), "SPRINT_COMPLETED"]);
    expect(after.state.sprintsById[sprintId]).toMatchObject({ status: "CLOSED", completedAt: anchor, version: sprintVersion(before, sprintId) + 1 });
    expect(after.state.sprintsById[pendingId]?.status).toBe("PENDING");
    expect(after.state.sprintsById["api-sprint-7"]?.status).toBe("ACTIVE");
    expect(after.state.planningOrderByProject["live-tracking"]?.sprints[sprintId]).toEqual(completeIds);
    const target = destinationSprintId === null ? after.state.planningOrderByProject["live-tracking"]?.backlog : after.state.planningOrderByProject["live-tracking"]?.sprints[destinationSprintId];
    expect(target).toEqual([...existingDestination ?? [], ...moving]);
    for (const id of expectedMovedEntities) expect(getIssue(after, id).sprintId).toBe(destinationSprintId);
    for (const id of completeIds) expect(getIssue(after, id)).toEqual(getIssue(before, id));
    for (const issue of Object.values(before.state.issuesById)) {
      expect(getIssue(after, issue.id).status).toBe(issue.status);
      expect(getIssue(after, issue.id).parentId).toBe(issue.parentId);
    }
    expect(getIssue(after, "live-tracking-127")).toMatchObject({ status: "DONE", sprintId: destinationSprintId });
    expect(getIssue(after, "live-tracking-144")).toMatchObject({ status: "TODO", sprintId: destinationSprintId, parentId: "live-tracking-127" });
    // These unassigned/blocked families could be invisible to the current UI filter.
    expect(getIssue(after, "live-tracking-124").sprintId).toBe(destinationSprintId);
    expect(getIssue(after, "live-tracking-142").sprintId).toBe(destinationSprintId);
    expect(after.state.boardOrderByProject).toEqual(before.state.boardOrderByProject);
    expect(after.state.childOrderByParent).toEqual(before.state.childOrderByParent);
    expect(before.state.sprintsById[sprintId]?.status).toBe("ACTIVE");
    expect(() => validateSnapshot(after)).not.toThrow();
  });

  it("keeps a fully DONE parent/child family in the closed sprint", async () => {
    const { repo, expectedGeneration } = await setup();
    await repo.updateIssue({ expectedGeneration, issueId: parentId, patch: { status: "DONE" } });
    const before = await repo.getSnapshot();
    await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(before, sprintId), destinationSprintId: null });
    const after = await repo.getSnapshot();
    expect(getIssue(after, parentId)).toEqual(getIssue(before, parentId));
    expect(getIssue(after, childId)).toEqual(getIssue(before, childId));
    expect(after.state.planningOrderByProject["live-tracking"]?.sprints[sprintId]?.[0]).toBe(parentId);
  });

  it("preserves user-reordered canonical families and sibling order during completion", async () => {
    const { repo, expectedGeneration } = await setup();
    const extraChild = await repo.createIssue({ expectedGeneration, projectId: "live-tracking", parentId, title: "Second child still unfinished" });
    await repo.moveIssue({ expectedGeneration, issueId: parentId, destination: { view: "planning", sprintId }, placement: { afterIssueId: "live-tracking-127" } });
    await repo.moveIssue({ expectedGeneration, issueId: extraChild.issue.id, destination: { view: "children", parentId }, placement: { beforeIssueId: childId } });
    const before = await repo.getSnapshot();
    const source = before.state.planningOrderByProject["live-tracking"]?.sprints[sprintId];
    const target = before.state.planningOrderByProject["live-tracking"]?.sprints[pendingId];
    if (!source || !target) throw new Error("Missing planning orders");
    const moving = source.filter((id) => !["live-tracking-119", "live-tracking-122", "live-tracking-125", "live-tracking-129"].includes(id));
    await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(before, sprintId), destinationSprintId: pendingId });
    const after = await repo.getSnapshot();
    expect(after.state.planningOrderByProject["live-tracking"]?.sprints[pendingId]).toEqual([...target, ...moving]);
    expect(after.state.childOrderByParent[parentId]).toEqual([extraChild.issue.id, childId]);
    expect(getIssue(after, extraChild.issue.id)).toMatchObject({ parentId, sprintId: pendingId, status: "TODO" });
    expect(after.state.childOrderByParent).toEqual(before.state.childOrderByParent);
  });

  it("closes an empty active sprint with exactly one lifecycle event and one revision", async () => {
    const { repo, expectedGeneration } = await setup();
    const created = await repo.createSprint({ expectedGeneration, projectId: "operations-console", name: "Empty sprint", goal: "Verify lifecycle" });
    const id = changedId(created);
    await repo.startSprint({ expectedGeneration, sprintId: id, expectedVersion: 1 });
    const before = await repo.getSnapshot();
    const completed = await repo.completeSprint({ expectedGeneration, sprintId: id, expectedVersion: 2, destinationSprintId: null });
    const after = await repo.getSnapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(completed.changedEntityIds).toEqual([id]);
    expect(kinds(after, completed)).toEqual(["SPRINT_COMPLETED"]);
    expect(after.state.issuesById).toEqual(before.state.issuesById);
  });

  it.each(["missing", "api-sprint-8", "lt-sprint-12", "ops-sprint-3"])("rejects invalid destination %s with no partial rollover", async (destinationSprintId) => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(snapshot, sprintId), destinationSprintId })).rejects.toThrow();
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("rejects nonactive/stale completion and a deleted target without partial publication", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    await expect(repo.completeSprint({ expectedGeneration, sprintId: pendingId, expectedVersion: sprintVersion(snapshot, pendingId), destinationSprintId: null })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.completeSprint({ expectedGeneration, sprintId: "ops-sprint-3", expectedVersion: sprintVersion(snapshot, "ops-sprint-3"), destinationSprintId: null })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: 999, destinationSprintId: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(snapshot);
    await repo.deletePendingSprint({ expectedGeneration, sprintId: pendingId, expectedVersion: sprintVersion(snapshot, pendingId) });
    const before = await repo.getSnapshot();
    await expect(repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(before, sprintId), destinationSprintId: pendingId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getSnapshot()).toBe(before);
  });

  it("retains deleted family tombstones while rolling live work and permits targeted later Undo", async () => {
    const { repo, expectedGeneration } = await setup();
    await repo.deleteIssue({ expectedGeneration, issueId: parentId, children: "delete" });
    const before = await repo.getSnapshot();
    await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(before, sprintId), destinationSprintId: pendingId });
    const after = await repo.getSnapshot();
    expect(getIssue(after, parentId)).toEqual(getIssue(before, parentId));
    expect(getIssue(after, childId)).toEqual(getIssue(before, childId));
    expect(after.state.deletionRecordsById).toEqual(before.state.deletionRecordsById);
    expect(after.state.commentsById).toEqual(before.state.commentsById);
    await repo.restoreIssue({ expectedGeneration, issueId: parentId });
    const restored = await repo.getSnapshot();
    expect(getIssue(restored, parentId)).toMatchObject({ deletedAt: null, sprintId: null });
    expect(getIssue(restored, childId)).toMatchObject({ deletedAt: null, parentId, sprintId: null });
    expect(restored.state.planningOrderByProject["live-tracking"]?.sprints[pendingId]).toEqual(after.state.planningOrderByProject["live-tracking"]?.sprints[pendingId]);
  });

  it("serializes concurrent completions so only one commit can close a sprint", async () => {
    const { repo, snapshot, expectedGeneration } = await setup();
    const input = { expectedGeneration, sprintId, expectedVersion: sprintVersion(snapshot, sprintId), destinationSprintId: null };
    const results = await Promise.allSettled([repo.completeSprint(input), repo.completeSprint(input)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((await repo.getSnapshot()).revision).toBe(1);
  });
});

describe("lifecycle transaction integrity", () => {
  it("resets deterministically after every new operation and rejects stale generations", async () => {
    const first = await setup(); const second = await setup();
    for (const { repo, expectedGeneration } of [first, second]) {
      await repo.deleteIssue({ expectedGeneration, issueId: parentId });
      await repo.restoreIssue({ expectedGeneration, issueId: parentId });
      await repo.createComment({ expectedGeneration, issueId: parentId, body: documentFromParagraphs("Deterministic discussion") });
      await repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(await repo.getSnapshot(), sprintId), destinationSprintId: pendingId });
    }
    expect(await first.repo.getSnapshot()).toEqual(await second.repo.getSnapshot());
    const reset = await first.repo.resetDemo();
    expect(reset).toEqual(await second.repo.resetDemo());
    expect(reset.state).toEqual(first.snapshot.state);
    expect(reset.revision).toBe(0);
    await expect(first.repo.createComment({ expectedGeneration: first.expectedGeneration, issueId: parentId, body: documentFromParagraphs("Old discussion") })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    expect(await first.repo.getSnapshot()).toBe(reset);
  });

  it("publishes nothing if late event ID allocation fails during family completion", async () => {
    let index = 0;
    const { repo, snapshot, expectedGeneration } = await setup({ idFactory: () => ++index <= 3 ? `collision-${index}` : "collision-3" });
    await expect(repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: sprintVersion(snapshot, sprintId), destinationSprintId: pendingId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("rejects backwards clocks across comments, sprints and issue commands", async () => {
    let now = anchor;
    const { repo, expectedGeneration } = await setup({ clock: () => now });
    now = "2026-10-06T10:00:00.000Z";
    await repo.createComment({ expectedGeneration, issueId: parentId, body: documentFromParagraphs("Later discussion") });
    const before = await repo.getSnapshot();
    now = anchor;
    await expect(repo.createSprint({ expectedGeneration, projectId: "live-tracking", name: "Backdated", goal: "Invalid time" })).rejects.toThrow("backwards");
    await expect(repo.deleteIssue({ expectedGeneration, issueId: parentId })).rejects.toThrow("backwards");
    await expect(repo.updateIssue({ expectedGeneration, issueId: parentId, patch: { title: "Backdated" } })).rejects.toThrow("backwards");
    expect(await repo.getSnapshot()).toBe(before);
  });
});
