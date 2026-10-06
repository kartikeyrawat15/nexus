import { type ImmutableSnapshot, type IssueStatus } from "../domain/types";

/** Render order always begins with canonical IDs, never entity-map insertion order. */
export function boardIssues(
  snapshot: ImmutableSnapshot,
  projectId: string,
  status: IssueStatus,
  sprintId?: string | null
) {
  return (
    snapshot.state.boardOrderByProject[projectId]?.[status] ?? []
  ).flatMap((id) => {
    const issue = snapshot.state.issuesById[id];
    return issue &&
      !issue.deletedAt &&
      !issue.parentId &&
      (sprintId === undefined || issue.sprintId === sprintId)
      ? [issue]
      : [];
  });
}

/** Completion moves entire families if any live member remains unfinished. */
export function sprintCompletionSummary(
  snapshot: ImmutableSnapshot,
  sprintId: string
) {
  const sprint = snapshot.state.sprintsById[sprintId];
  const ids = sprint
    ? snapshot.state.planningOrderByProject[sprint.projectId]?.sprints[
        sprintId
      ] ?? []
    : [];
  let completed = 0;
  let carryForward = 0;
  let childCount = 0;
  for (const id of ids) {
    const issue = snapshot.state.issuesById[id];
    if (!issue || issue.deletedAt) continue;
    const children = (snapshot.state.childOrderByParent[id] ?? []).flatMap(
      (childId) => {
        const child = snapshot.state.issuesById[childId];
        return child && !child.deletedAt ? [child] : [];
      }
    );
    childCount += children.length;
    if ([issue, ...children].every((member) => member.status === "DONE"))
      completed++;
    else carryForward++;
  }
  return {
    completed,
    carryForward,
    childCount,
    total: completed + carryForward,
  };
}
