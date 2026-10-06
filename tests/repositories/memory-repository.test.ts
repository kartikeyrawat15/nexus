import { describe, expect, it } from "vitest";
import { createSnapshot } from "../../demo/create-snapshot";
import { documentFromParagraphs } from "../../demo/wayline";
import { validateSnapshot } from "../../domain/invariants";
import { updateIssueSchema } from "../../domain/schema";
import { ISSUE_STATUSES, type ImmutableSnapshot } from "../../domain/types";
import { type RepositoryOptions } from "../../repositories/contracts";
import { MemoryRepository } from "../../repositories/memory-repository";

const anchor = "2026-10-05T10:00:00.000Z";
function repository(options: RepositoryOptions = {}) {
  let sequence = 0;
  return new MemoryRepository({ clock: () => anchor, idFactory: () => `test-id-${++sequence}`, ...options });
}
async function setup(options: RepositoryOptions = {}) {
  const repo = repository(options);
  const snapshot = await repo.initialize();
  return { repo, snapshot, generation: snapshot.generation };
}
function issue(snapshot: ImmutableSnapshot, id = "live-tracking-118") {
  const result = snapshot.state.issuesById[id];
  if (!result) throw new Error(`Missing fixture ${id}`);
  return result;
}

describe("async memory repository lifecycle", () => {
  it("requires initialization, initializes once and returns project-scoped immutable reads", async () => {
    const repo = repository();
    await expect(repo.getSnapshot()).rejects.toMatchObject({ code: "NOT_INITIALIZED" });
    const [first, second] = await Promise.all([repo.initialize(), repo.initialize()]);
    expect(second).toBe(first);
    expect(await repo.getSnapshot()).toBe(first);
    expect(await repo.getProjects()).toHaveLength(3);
    expect((await repo.getProject("carrier-api")).keyPrefix).toBe("API");
    expect(await repo.getIssues("live-tracking")).toHaveLength(27);
    expect((await repo.getIssues("carrier-api")).every((item) => item.projectId === "carrier-api")).toBe(true);
    await expect(repo.getProject("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.getIssues("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(Object.isFrozen(await repo.getProjects())).toBe(true);
    expect(Object.isFrozen(first.state.issuesById)).toBe(true);
    expect(Object.isFrozen(issue(first).description.root.children)).toBe(true);
    expect(Reflect.set(issue(first), "title", "External overwrite")).toBe(false);
  });

  it("does not share state with another visitor repository or retain caller-owned input", async () => {
    const { repo, generation } = await setup();
    const other = await setup();
    const description = documentFromParagraphs("A new investigation criterion.");
    const input = { expectedGeneration: generation, projectId: "live-tracking", title: "Keep route context", description, labelIds: ["experience"] };
    const created = await repo.createIssue(input);
    input.title = "Changed input"; input.labelIds.push("reliability"); description.root.children.length = 0;
    expect(created.issue.title).toBe("Keep route context");
    expect(created.issue.labelIds).toEqual(["experience"]);
    expect(created.issue.description.root.children).toHaveLength(1);
    expect(await other.repo.getSnapshot()).toBe(other.snapshot);
    expect(Object.values((await other.repo.getSnapshot()).state.issuesById)).toHaveLength(48);
  });

  it("preserves old snapshots and projections when committing updates", async () => {
    const { repo, snapshot, generation } = await setup();
    const oldIssues = await repo.getIssues("live-tracking");
    const before = issue(snapshot);
    const result = await repo.updateIssue({ expectedGeneration: generation, issueId: before.id, expectedVersion: before.version, patch: { title: "Keep shipment selection stable" } });
    const after = await repo.getSnapshot();
    expect(after).not.toBe(snapshot);
    expect(before.title).toBe("Preserve selected shipment when live updates reorder table");
    expect(oldIssues.find((item) => item.id === before.id)?.title).toBe(before.title);
    expect(result.issue.title).toBe("Keep shipment selection stable");
    expect(result.issue.version).toBe(before.version + 1);
    expect(after.revision).toBe(snapshot.revision + 1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issue)).toBe(true);
  });
});

describe("issue creation and validation", () => {
  it.each(ISSUE_STATUSES)("supports %s and places top-level work into both canonical orders", async (status) => {
    const { repo, generation } = await setup();
    const result = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", title: "  Explain carrier updates  ", status });
    const snapshot = await repo.getSnapshot();
    expect(result.issue).toMatchObject({ key: "LT-145", number: 145, title: "Explain carrier updates", status, reporterId: "maya", priority: "NORMAL", assigneeId: null });
    expect(snapshot.state.boardOrderByProject["live-tracking"]?.[status]).toContain(result.issue.id);
    expect(snapshot.state.planningOrderByProject["live-tracking"]?.backlog).toContain(result.issue.id);
    expect(result.generatedEventIds).toHaveLength(1);
    expect(snapshot.state.activitiesById[result.generatedEventIds[0] ?? ""]?.kind).toBe("ISSUE_CREATED");
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("allocates project-local counters and serializes simultaneous creation", async () => {
    const { repo, generation } = await setup();
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) => repo.createIssue({ expectedGeneration: generation, projectId: "carrier-api", title: `Document partner retry boundary ${index + 1}` })));
    expect(created.map((result) => result.issue.key)).toEqual(Array.from({ length: 8 }, (_, index) => `API-${54 + index}`));
    expect(new Set(created.map((result) => result.issue.id)).size).toBe(8);
    const lt = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", title: "Retain map context" });
    const ops = await repo.createIssue({ expectedGeneration: generation, projectId: "operations-console", title: "Retain the exception context" });
    expect([lt.issue.key, ops.issue.key]).toEqual(["LT-145", "OPS-40"]);
    expect((await repo.getSnapshot()).revision).toBe(10);
  });

  it("never reuses a deleted or previously allocated high-water number", async () => {
    const fixture = createSnapshot({ anchor, generation: "loaded-generation" });
    const deleted = fixture.state.issuesById["live-tracking-144"];
    if (!deleted) throw new Error("Missing highest-number fixture");
    deleted.deletedAt = anchor;
    fixture.state.childOrderByParent["live-tracking-127"] = [];
    fixture.state.deletionRecordsById["deletion-144"] = { id: "deletion-144", issueIds: [deleted.id], deletedAt: anchor };
    const { repo, generation } = await setup({ initialSnapshot: fixture });
    expect(await repo.getIssues("live-tracking")).toHaveLength(26);
    expect((await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", title: "Check a new carrier location" })).issue.key).toBe("LT-145");
    // Even if old tombstones were compacted externally, the stored counter remains authoritative.
    delete fixture.state.issuesById[deleted.id]; delete fixture.state.deletionRecordsById["deletion-144"];
    fixture.state.nextIssueNumberByProject["live-tracking"] = 900;
    const loaded = await setup({ initialSnapshot: fixture });
    expect((await loaded.repo.createIssue({ expectedGeneration: loaded.generation, projectId: "live-tracking", title: "Check a later allocation" })).issue.key).toBe("LT-900");
    fixture.state.nextIssueNumberByProject["live-tracking"] = 143;
    expect(() => repository({ initialSnapshot: fixture })).toThrow("counter");
  });

  it("rejects invalid titles, blockers, assignees, labels and projects atomically", async () => {
    const { repo, snapshot, generation } = await setup();
    const base = { expectedGeneration: generation, projectId: "carrier-api", title: "Validate receipt identity" };
    await expect(repo.createIssue({ ...base, title: "   " })).rejects.toThrow();
    await expect(repo.createIssue({ ...base, blocker: { blocked: true, reason: "  " } })).rejects.toThrow();
    await expect(repo.createIssue({ ...base, assigneeId: "nina" })).rejects.toThrow("Assignee");
    await expect(repo.createIssue({ ...base, assigneeId: "unknown-user" })).rejects.toThrow("Assignee");
    await expect(repo.createIssue({ ...base, projectId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.createIssue({ ...base, labelIds: ["experience", "experience"] })).rejects.toThrow("duplicates");
    expect(await repo.getSnapshot()).toBe(snapshot);
    expect((await repo.createIssue(base)).issue.key).toBe("API-54");
  });

  it("creates a one-level child with inherited membership and rejects invalid parents", async () => {
    const { repo, generation } = await setup();
    const created = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", parentId: "live-tracking-118", title: "Check the focused shipment after refresh", assigneeId: "sam" });
    const snapshot = await repo.getSnapshot();
    expect(created.issue.parentId).toBe("live-tracking-118");
    expect(created.issue.sprintId).toBe("lt-sprint-12");
    expect(snapshot.state.childOrderByParent["live-tracking-118"]).toContain(created.issue.id);
    expect(Object.values(snapshot.state.boardOrderByProject["live-tracking"] ?? {}).flat()).not.toContain(created.issue.id);
    await expect(repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", parentId: created.issue.id, title: "Nested child" })).rejects.toThrow("top-level");
    await expect(repo.createIssue({ expectedGeneration: generation, projectId: "carrier-api", parentId: "live-tracking-118", title: "Foreign child" })).rejects.toThrow("project");
    await expect(repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", parentId: "live-tracking-118", sprintId: null, title: "Unlinked child" })).rejects.toThrow("inherit");
    await expect(repo.createIssue({ expectedGeneration: generation, projectId: "operations-console", sprintId: "ops-sprint-3", title: "Closed sprint work" })).rejects.toThrow("open");
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("records initial sprint, assignment and blocker values in creation activity", async () => {
    const { repo, generation } = await setup();
    const result = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", title: "Confirm carrier replay identity",
      sprintId: "lt-sprint-12", assigneeId: "omar", blocker: { blocked: true, reason: "Waiting for the replay contract" } });
    const event = (await repo.getSnapshot()).state.activitiesById[result.generatedEventIds[0] ?? ""];
    expect(event?.changes).toContainEqual({ field: "sprintId", before: null, after: "lt-sprint-12" });
    expect(event?.changes).toContainEqual({ field: "assigneeId", before: null, after: "omar" });
    expect(event?.changes).toContainEqual({ field: "blocker", before: { blocked: false, reason: null }, after: { blocked: true, reason: "Waiting for the replay contract" } });
  });
});

describe("updates, activity and canonical movement", () => {
  it("records typed before/after changes under one transaction with the local actor", async () => {
    const { repo, snapshot, generation } = await setup();
    const before = issue(snapshot);
    const result = await repo.updateIssue({ expectedGeneration: generation, issueId: before.id, patch: {
      title: "Keep the current shipment selected", priority: "LOW", assigneeId: "sam", blocker: { blocked: true, reason: "  Waiting for a replay  " },
    } });
    const event = (await repo.getSnapshot()).state.activitiesById[result.generatedEventIds[0] ?? ""];
    expect(event).toMatchObject({ actorId: "maya", issueId: before.id, projectId: before.projectId, kind: "ISSUE_UPDATED", transactionId: result.transactionId, occurredAt: anchor });
    expect(event?.changes).toEqual([
      { field: "title", before: before.title, after: "Keep the current shipment selected" },
      { field: "priority", before: "HIGH", after: "LOW" },
      { field: "assigneeId", before: "maya", after: "sam" },
      { field: "blocker", before: { blocked: false, reason: null }, after: { blocked: true, reason: "Waiting for a replay" } },
    ]);
    const cleared = await repo.updateIssue({ expectedGeneration: generation, issueId: before.id, patch: { assigneeId: null, blocker: { blocked: false, reason: null } } });
    expect(cleared.issue.assigneeId).toBeNull(); expect(cleared.issue.blocker).toEqual({ blocked: false, reason: null });
  });

  it("suppresses activity, revision and ID allocation for normalized no-op updates", async () => {
    const { repo, snapshot, generation } = await setup();
    const before = issue(snapshot);
    const result = await repo.updateIssue({ expectedGeneration: generation, issueId: before.id, patch: {
      title: `  ${before.title}  `, status: before.status, priority: before.priority, assigneeId: before.assigneeId, blocker: { blocked: false, reason: null },
    } });
    expect(await repo.getSnapshot()).toBe(snapshot);
    expect(result).toMatchObject({ transactionId: null, revision: 0, generatedEventIds: [], changedEntityIds: [] });
    expect((await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", title: "The next allocation" })).issue.id).toBe("test-id-2");
    expect(updateIssueSchema.safeParse({ expectedGeneration: generation, issueId: before.id, patch: { projectId: "carrier-api" } }).success).toBe(false);
  });

  it("moves a filtered board item by anchor and produces no ordering-only activity", async () => {
    const { repo, snapshot, generation } = await setup();
    expect(snapshot.state.boardOrderByProject["live-tracking"]?.IN_PROGRESS).toEqual(["live-tracking-120", "live-tracking-121", "live-tracking-126", "live-tracking-127"]);
    // LT-121 is hidden by a filter; the UI sends LT-126 as the stable anchor.
    const result = await repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-127", destination: { view: "board", status: "IN_PROGRESS" }, placement: { beforeIssueId: "live-tracking-126" } });
    const moved = await repo.getSnapshot();
    expect(moved.state.boardOrderByProject["live-tracking"]?.IN_PROGRESS).toEqual(["live-tracking-120", "live-tracking-121", "live-tracking-127", "live-tracking-126"]);
    expect(moved.state.planningOrderByProject).toEqual(snapshot.state.planningOrderByProject);
    expect(moved.state.activityOrder).toEqual(snapshot.state.activityOrder);
    expect(result.generatedEventIds).toEqual([]);
    expect(moved.revision).toBe(1);
    const repeated = await repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-127", destination: { view: "board", status: "IN_PROGRESS" }, placement: { beforeIssueId: "live-tracking-126" } });
    expect(repeated.transactionId).toBeNull(); expect(await repo.getSnapshot()).toBe(moved);
  });

  it("moves between statuses once, preserves sprint order and records status change", async () => {
    const { repo, snapshot, generation } = await setup();
    const result = await repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-127", destination: { view: "board", status: "IN_REVIEW" }, placement: { beforeIssueId: "live-tracking-123" } });
    const moved = await repo.getSnapshot();
    expect(moved.state.boardOrderByProject["live-tracking"]?.IN_PROGRESS).not.toContain("live-tracking-127");
    expect(moved.state.boardOrderByProject["live-tracking"]?.IN_REVIEW).toEqual(["live-tracking-118", "live-tracking-127", "live-tracking-123"]);
    expect(moved.state.planningOrderByProject).toEqual(snapshot.state.planningOrderByProject);
    expect(issue(moved, "live-tracking-144").status).toBe("TODO");
    expect(moved.state.activitiesById[result.generatedEventIds[0] ?? ""]?.changes).toEqual([{ field: "status", before: "IN_PROGRESS", after: "IN_REVIEW" }]);
    await repo.updateIssue({ expectedGeneration: generation, issueId: "live-tracking-127", patch: { status: "DONE" } });
    expect((await repo.getSnapshot()).state.boardOrderByProject["live-tracking"]?.DONE.at(-1)).toBe("live-tracking-127");
  });

  it("moves a planning family atomically and preserves independent board and child orders", async () => {
    const { repo, snapshot, generation } = await setup();
    const result = await repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-118", destination: { view: "planning", sprintId: "lt-sprint-13" }, placement: { beforeIssueId: "live-tracking-132" } });
    const moved = await repo.getSnapshot();
    expect(issue(moved).sprintId).toBe("lt-sprint-13");
    expect(issue(moved, "live-tracking-140").sprintId).toBe("lt-sprint-13");
    expect(moved.state.planningOrderByProject["live-tracking"]?.sprints["lt-sprint-12"]).not.toContain("live-tracking-118");
    expect(moved.state.planningOrderByProject["live-tracking"]?.sprints["lt-sprint-13"]).toEqual(["live-tracking-130", "live-tracking-131", "live-tracking-118", "live-tracking-132", "live-tracking-133", "live-tracking-134", "live-tracking-135"]);
    expect(moved.state.boardOrderByProject).toEqual(snapshot.state.boardOrderByProject);
    expect(moved.state.childOrderByParent).toEqual(snapshot.state.childOrderByParent);
    expect(result.changedEntityIds).toEqual(["live-tracking-118", "live-tracking-140"]);
    expect(result.generatedEventIds).toHaveLength(2);
    expect(new Set(result.generatedEventIds.map((id) => moved.state.activitiesById[id]?.transactionId))).toEqual(new Set([result.transactionId]));
    expect(moved.revision).toBe(1);
    await repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-118", destination: { view: "planning", sprintId: null }, placement: { at: "end" } });
    expect(issue(await repo.getSnapshot(), "live-tracking-140").sprintId).toBeNull();
  });

  it("rejects stale versions, invalid destinations, missing anchors and out-of-scope child moves", async () => {
    const { repo, snapshot, generation } = await setup();
    await expect(repo.updateIssue({ expectedGeneration: generation, issueId: "live-tracking-118", expectedVersion: 999, patch: { priority: "LOW" } })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.updateIssue({ expectedGeneration: generation, issueId: "live-tracking-118", patch: { assigneeId: "elena" } })).rejects.toThrow("Assignee");
    await expect(repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-118", destination: { view: "planning", sprintId: "api-sprint-8" }, placement: { at: "end" } })).rejects.toThrow("project");
    await expect(repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-118", destination: { view: "board", status: "TODO" }, placement: { beforeIssueId: "live-tracking-123" } })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-140", destination: { view: "board", status: "TODO" }, placement: { at: "end" } })).rejects.toThrow("Child");
    await expect(repo.moveIssue({ expectedGeneration: generation, issueId: "live-tracking-140", destination: { view: "children", parentId: "live-tracking-121" }, placement: { at: "end" } })).rejects.toThrow("reparent");
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("reorders siblings without adding discussion activity or changing board/planning membership", async () => {
    const { repo, generation } = await setup();
    const first = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", parentId: "live-tracking-118", title: "Check selection after a reconnect" });
    const second = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", parentId: "live-tracking-118", title: "Check selection outside the viewport" });
    const before = await repo.getSnapshot();
    const result = await repo.moveIssue({ expectedGeneration: generation, issueId: second.issue.id,
      destination: { view: "children", parentId: "live-tracking-118" }, placement: { beforeIssueId: "live-tracking-140" } });
    const after = await repo.getSnapshot();
    expect(after.state.childOrderByParent["live-tracking-118"]).toEqual([second.issue.id, "live-tracking-140", first.issue.id]);
    expect(after.state.boardOrderByProject).toEqual(before.state.boardOrderByProject);
    expect(after.state.planningOrderByProject).toEqual(before.state.planningOrderByProject);
    expect(after.state.activityOrder).toEqual(before.state.activityOrder);
    expect(result.generatedEventIds).toEqual([]);
  });
});

describe("reset and deterministic inputs", () => {
  it("restores the entire seed at the injected time, changes generation and rejects old commands", async () => {
    let now = anchor;
    const { repo, snapshot, generation } = await setup({ clock: () => now });
    const created = await repo.createIssue({ expectedGeneration: generation, projectId: "live-tracking", title: "Visitor-created work" });
    await repo.updateIssue({ expectedGeneration: generation, issueId: "live-tracking-118", patch: { priority: "LOW" } });
    now = "2026-10-12T10:00:00.000Z";
    const reset = await repo.resetDemo();
    expect(reset.generation).not.toBe(generation);
    expect(reset).toEqual(createSnapshot({ anchor: now, generation: reset.generation }));
    expect(reset.revision).toBe(0);
    expect(issue(reset).priority).toBe("HIGH");
    expect(Object.values(reset.state.issuesById)).toHaveLength(48);
    expect(snapshot.scenarioAnchor).toBe(anchor);
    await expect(repo.updateIssue({ expectedGeneration: generation, issueId: "live-tracking-118", patch: { title: "Old draft" } })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    await expect(repo.updateIssue({ expectedGeneration: generation, issueId: created.issue.id, patch: { title: "Old visitor draft" } })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    expect(await repo.getSnapshot()).toBe(reset);
  });

  it("replays deterministically with identical injected clocks and ID streams", async () => {
    const first = await setup(); const second = await setup();
    expect(first.snapshot).toEqual(second.snapshot);
    for (const current of [first, second]) {
      await current.repo.createIssue({ expectedGeneration: current.generation, projectId: "carrier-api", title: "Explain the retry boundary" });
      await current.repo.moveIssue({ expectedGeneration: current.generation, issueId: "live-tracking-127", destination: { view: "board", status: "DONE" }, placement: { at: "end" } });
    }
    expect(await first.repo.getSnapshot()).toEqual(await second.repo.getSnapshot());
    expect(await first.repo.resetDemo()).toEqual(await second.repo.resetDemo());
  });

  it("does not reuse any earlier generation even with a cycling injected ID stream", async () => {
    const ids = ["first-generation", "second-generation", "first-generation"];
    let index = 0;
    const { repo } = await setup({ idFactory: () => ids[index++] ?? "unexpected" });
    const reset = await repo.resetDemo();
    expect(reset.generation).toBe("second-generation");
    await expect(repo.resetDemo()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(reset);
  });

  it("rejects duplicate IDs and a backwards mutation clock without publishing partial state", async () => {
    let now = anchor;
    const { repo, snapshot, generation } = await setup({ clock: () => now });
    now = "2026-10-01T10:00:00.000Z";
    await expect(repo.updateIssue({ expectedGeneration: generation, issueId: "live-tracking-118", patch: { title: "Backdated edit" } })).rejects.toThrow("backwards");
    expect(await repo.getSnapshot()).toBe(snapshot);
    const duplicate = await setup({ idFactory: () => "reused-id" });
    await expect(duplicate.repo.createIssue({ expectedGeneration: duplicate.generation, projectId: "live-tracking", title: "Duplicate ID" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await duplicate.repo.getSnapshot()).toBe(duplicate.snapshot);
    await expect(duplicate.repo.resetDemo()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
