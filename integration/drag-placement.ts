import { DomainError, type Placement } from "../domain/types";

/** Translate a drop slot in the rendered list into an ID anchor. Hidden canonical siblings stay untouched. */
export function dragPlacement(visibleIds: readonly string[], movingId: string, destinationIndex: number): Placement {
  const remaining = visibleIds.filter((id) => id !== movingId);
  if (!Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex > remaining.length) {
    throw new DomainError("VALIDATION", "Invalid drag destination");
  }
  const next = remaining[destinationIndex];
  if (next) return { beforeIssueId: next };
  const previous = remaining[destinationIndex - 1];
  return previous ? { afterIssueId: previous } : { at: "end" };
}
