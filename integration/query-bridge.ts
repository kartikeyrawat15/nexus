import { type QueryClient, type QueryKey } from "@tanstack/react-query";
import { type ImmutableSnapshot } from "../domain/types";
import { type BrowserRepository } from "../repositories/browser-repository";
import { nexusKeys } from "./query-keys";

const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

export function changedQueryKeys(before: ImmutableSnapshot, after: ImmutableSnapshot): QueryKey[] {
  if (before.generation !== after.generation) return [nexusKeys.all];
  if (before.revision === after.revision && before.lastTransactionId === after.lastTransactionId) return [];
  const keys: QueryKey[] = [];
  const a = before.state; const b = after.state;
  if (differs(a.workspace, b.workspace)) keys.push(nexusKeys.workspace());
  if (differs(a.projectsById, b.projectsById)) keys.push(nexusKeys.projects());
  for (const id of Object.keys(b.projectsById)) {
    if (differs(a.projectsById[id], b.projectsById[id])) keys.push(nexusKeys.project(id));
    const members = (state: ImmutableSnapshot["state"]) => state.projectsById[id]?.memberIds.map((memberId) => state.usersById[memberId]);
    const membersChanged = differs(members(a), members(b));
    if (membersChanged) keys.push(nexusKeys.members(id));
    const issues = (state: ImmutableSnapshot["state"]) => Object.values(state.issuesById).filter((issue) => issue.projectId === id);
    const sprints = (state: ImmutableSnapshot["state"]) => Object.values(state.sprintsById).filter((sprint) => sprint.projectId === id);
    const issuesChanged = differs(issues(a), issues(b)) || differs(a.boardOrderByProject[id], b.boardOrderByProject[id]) || differs(a.planningOrderByProject[id], b.planningOrderByProject[id]) ||
      issues(b).some((issue) => differs(a.childOrderByParent[issue.id], b.childOrderByParent[issue.id]));
    const sprintsChanged = differs(sprints(a), sprints(b));
    if (sprintsChanged) keys.push(nexusKeys.sprints(id));
    if (issuesChanged || sprintsChanged || membersChanged) keys.push(nexusKeys.issues(id), ["nexus", "issue", id]);
    const comments = (state: ImmutableSnapshot["state"]) => Object.values(state.commentsById).filter((comment) => state.issuesById[comment.issueId]?.projectId === id);
    if (differs(comments(a), comments(b)) || membersChanged || issuesChanged) keys.push(["nexus", "comments", id]);
    const activity = (state: ImmutableSnapshot["state"]) => Object.values(state.activitiesById).filter((event) => event.projectId === id);
    if (differs(activity(a), activity(b))) keys.push(nexusKeys.activity(id));
  }
  return keys;
}

/** Subscription owns no canonical React state; cleanup also cancels queued async work. */
export function connectQueryBridge(repository: BrowserRepository, client: QueryClient, initial: ImmutableSnapshot): () => void {
  let previous = initial; let stopped = false;
  const unsubscribe = repository.subscribe(() => {
    void repository.getSnapshot().then(async (snapshot) => {
      if (stopped) return;
      const keys = changedQueryKeys(previous, snapshot); previous = snapshot;
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
    }).catch(() => undefined);
  });
  return () => { stopped = true; unsubscribe(); };
}
