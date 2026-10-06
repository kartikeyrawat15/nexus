import { describe, expect, it } from "vitest";
import { createSnapshot } from "../../demo/create-snapshot";
import {
  boardIssues,
  sprintCompletionSummary,
} from "../../integration/workbench-selectors";
import { MemoryRepository } from "../../repositories/memory-repository";
import { dragPlacement } from "../../integration/drag-placement";

const seed = () =>
  createSnapshot({
    anchor: "2026-10-05T10:00:00.000Z",
    generation: "workbench-test",
  });
describe("workbench projections", () => {
  it("reads the flagship board from canonical order with real sprint scope", () => {
    const snapshot = seed();
    expect(
      boardIssues(snapshot, "live-tracking", "TODO", "lt-sprint-12").map(
        (i) => i.key
      )
    ).toEqual(["LT-124", "LT-128"]);
    expect(boardIssues(snapshot, "live-tracking", "TODO", null)).toHaveLength(
      4
    );
    expect(
      boardIssues(snapshot, "live-tracking", "TODO").length
    ).toBeGreaterThan(4);
  });
  it("excludes child work from board cards without losing family completion semantics", () => {
    const snapshot = seed();
    expect(
      boardIssues(snapshot, "live-tracking", "DONE").every(
        (i) => i.parentId === null
      )
    ).toBe(true);
    const summary = sprintCompletionSummary(snapshot, "lt-sprint-12");
    expect(summary).toMatchObject({ completed: 4, carryForward: 8, total: 12 });
    expect(summary.childCount).toBeGreaterThan(0);
  });
  it("carries a done parent forward when a child is unfinished", () => {
    const snapshot = seed();
    const parent = snapshot.state.issuesById["live-tracking-118"];
    const child = snapshot.state.issuesById["live-tracking-140"];
    if (!parent || !child) throw new Error("Missing family");
    parent.status = "DONE";
    child.status = "IN_PROGRESS";
    expect(sprintCompletionSummary(snapshot, "lt-sprint-12").carryForward).toBe(
      8
    );
  });
  it("keeps hidden canonical siblings in place when moving a filtered card", async () => {
    const repository = new MemoryRepository({ initialSnapshot: seed() });
    const before = await repository.initialize();
    const visible = boardIssues(
      before,
      "live-tracking",
      "IN_PROGRESS",
      "lt-sprint-12"
    ).filter((i) => i.assigneeId === "nina");
    await repository.moveIssue({
      expectedGeneration: before.generation,
      issueId: "live-tracking-124",
      destination: { view: "board", status: "IN_PROGRESS" },
      placement: dragPlacement(
        visible.map((i) => i.id),
        "live-tracking-124",
        1
      ),
    });
    const keys = boardIssues(
      await repository.getSnapshot(),
      "live-tracking",
      "IN_PROGRESS",
      "lt-sprint-12"
    ).map((i) => i.key);
    expect(keys).toEqual(["LT-120", "LT-121", "LT-124", "LT-126", "LT-127"]);
  });
  it("does not derive sprint completion counts from a filtered board", () => {
    const snapshot = seed();
    expect(
      boardIssues(
        snapshot,
        "live-tracking",
        "IN_PROGRESS",
        "lt-sprint-12"
      ).filter((i) => i.assigneeId === "maya")
    ).toHaveLength(1);
    expect(sprintCompletionSummary(snapshot, "lt-sprint-12").total).toBe(12);
    expect(sprintCompletionSummary(snapshot, "missing").total).toBe(0);
  });
});
