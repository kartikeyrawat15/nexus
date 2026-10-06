import { describe, expect, it } from "vitest";
import { insertAtAnchor, sameOrder } from "../../domain/ordering";

describe("canonical anchor ordering", () => {
  it("inserts against visible anchor IDs while preserving hidden relative order", () => {
    const canonical = Object.freeze(["A", "hidden-B", "C", "hidden-D", "E"]);
    expect(insertAtAnchor(canonical, "E", { beforeIssueId: "C" })).toEqual(["A", "hidden-B", "E", "C", "hidden-D"]);
    expect(insertAtAnchor(canonical, "A", { afterIssueId: "C" })).toEqual(["hidden-B", "C", "A", "hidden-D", "E"]);
    expect(canonical).toEqual(["A", "hidden-B", "C", "hidden-D", "E"]);
  });

  it("inserts an incoming item into a different group without losing any member", () => {
    expect(insertAtAnchor(["hidden", "anchor", "tail"], "incoming", { beforeIssueId: "anchor" })).toEqual(["hidden", "incoming", "anchor", "tail"]);
  });

  it("defines explicit end placement for an empty visible result or empty destination", () => {
    expect(insertAtAnchor(["hidden-A", "hidden-B"], "incoming", { at: "end" })).toEqual(["hidden-A", "hidden-B", "incoming"]);
    expect(insertAtAnchor([], "incoming", { at: "end" })).toEqual(["incoming"]);
  });

  it("removes the moving ID before locating anchors and recognizes unchanged order", () => {
    expect(insertAtAnchor(["A", "B", "C"], "A", { afterIssueId: "C" })).toEqual(["B", "C", "A"]);
    expect(sameOrder(["A", "B", "C"], insertAtAnchor(["A", "B", "C"], "B", { beforeIssueId: "C" }))).toBe(true);
    expect(sameOrder(["A", "B"], ["B", "A"])).toBe(false);
  });

  it("rejects a missing or self anchor instead of converting an invalid index", () => {
    expect(() => insertAtAnchor(["A", "B"], "A", { beforeIssueId: "gone" })).toThrow("anchor");
    expect(() => insertAtAnchor(["A", "B"], "A", { afterIssueId: "A" })).toThrow("itself");
  });

  it("preserves every non-moving ID across all anchor positions", () => {
    const ids = ["A", "B", "C", "D", "E"];
    for (const moving of ids) for (const anchor of ids.filter((id) => id !== moving)) {
      for (const placement of [{ beforeIssueId: anchor }, { afterIssueId: anchor }]) {
        const result = insertAtAnchor(ids, moving, placement);
        expect(new Set(result)).toEqual(new Set(ids));
        expect(result).toHaveLength(ids.length);
        expect(result.filter((id) => id !== moving)).toEqual(ids.filter((id) => id !== moving));
      }
    }
  });
});
