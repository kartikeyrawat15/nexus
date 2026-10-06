import { DomainError, type Id, type Placement } from "./types";

/** Anchors refer to canonical IDs, never indices in a filtered projection. */
export function insertAtAnchor(ids: readonly Id[], issueId: Id, placement: Placement): Id[] {
  const result = ids.filter((id) => id !== issueId);
  if ("at" in placement) return [...result, issueId];
  const anchor = "beforeIssueId" in placement ? placement.beforeIssueId : placement.afterIssueId;
  if (anchor === issueId) throw new DomainError("VALIDATION", "An issue cannot anchor itself");
  const index = result.indexOf(anchor);
  if (index < 0) throw new DomainError("CONFLICT", "The destination anchor is no longer in this group");
  result.splice(index + ("afterIssueId" in placement ? 1 : 0), 0, issueId);
  return result;
}

export function sameOrder(left: readonly Id[], right: readonly Id[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
