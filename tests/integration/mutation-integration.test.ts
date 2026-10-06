import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { createEditor } from "lexical";
import { BrowserRepository } from "../../repositories/browser-repository";
import { type StorageAdapter } from "../../persistence/browser-environment";
import { repositoryMutations } from "../../integration/repository-mutations";
import { repositoryQueries } from "../../integration/repository-queries";
import { dragPlacement } from "../../integration/drag-placement";
import { legacyEditorContent } from "../../integration/legacy-views";
import { editorDocument } from "../../integration/editor-document";
import { demoIdentity } from "../../integration/demo-identity";
import { connectQueryBridge, changedQueryKeys } from "../../integration/query-bridge";
import { nexusKeys } from "../../integration/query-keys";
import { documentFromParagraphs } from "../../demo/wayline";
import { readEnvelope } from "../../persistence/envelope";

const anchor = "2026-10-05T10:00:00.000Z";
const content = (text: string) => legacyEditorContent(documentFromParagraphs(text));
class Storage implements StorageAdapter {
  value: string | null = null; fail = false;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { if (this.fail) throw new Error("Quota exceeded"); this.value = value; }
}
async function setup() {
  const storage = new Storage(); let sequence = 0;
  const repo = new BrowserRepository({ clock: () => anchor, writerId: "mutation-test", idFactory: () => `mutation-${++sequence}`,
    environment: () => ({ storage, subscribe: () => () => undefined }) });
  const snapshot = await repo.initialize();
  return { repo, storage, snapshot, commands: repositoryMutations(repo, "live-tracking") };
}
afterEach(() => vi.unstubAllGlobals());

describe("UI mutation boundary", () => {
  it("creates via a React Query mutation with owned identity and repository issue numbering, and reloads it", async () => {
    const { repo, storage, snapshot, commands } = await setup();
    const client = new QueryClient();
    const mutation = client.getMutationCache().build(client, { mutationFn: commands.createIssue,
      variables: { name: "Boundary-created issue", type: "BUG", priority: "HIGH", assigneeId: "maya", sprintId: "lt-sprint-12" } });
    const issue = await mutation.execute();
    const nextNumber = snapshot.state.nextIssueNumberByProject["live-tracking"];
    if (nextNumber === undefined) throw new Error("Project counter missing");
    expect(issue.key).toBe(`LT-${nextNumber}`);
    expect(issue.reporterId).toBe(snapshot.state.workspace.visitorId);
    expect((await repo.getIssue(issue.id))).toMatchObject({ kind: "BUG", priority: "HIGH", assigneeId: "maya" });
    const reloaded = new BrowserRepository({ writerId: "reload-test", environment: () => ({ storage, subscribe: () => () => undefined }) });
    await reloaded.initialize(); expect((await reloaded.getIssue(issue.id)).title).toBe("Boundary-created issue");
    expect((await reloaded.getSnapshot()).state.boardOrderByProject["live-tracking"]?.TODO).toContain(issue.id);
    client.clear(); repo.dispose(); reloaded.dispose();
  });

  it("edits title/description/type/status/assignee/reporter/priority/blocker with meaningful domain activity", async () => {
    const { repo, commands } = await setup();
    await commands.updateIssue({ issueId: "live-tracking-118", name: "Reviewed selection", description: content("Verified selection survives refresh"),
      type: "STORY", status: "IN_PROGRESS", assigneeId: "nina", reporterId: "sam", priority: "LOW", blocker: { blocked: true, reason: "Awaiting carrier trace" } });
    const issue = await repo.getIssue("live-tracking-118");
    expect(issue).toMatchObject({ title: "Reviewed selection", kind: "STORY", status: "IN_PROGRESS", assigneeId: "nina", reporterId: "sam", priority: "LOW" });
    expect(issue.description).toEqual(documentFromParagraphs("Verified selection survives refresh"));
    const activity = await repo.getActivity("live-tracking");
    expect(activity.at(-1)?.changes.map((change) => change.field)).toEqual(expect.arrayContaining(["title", "description", "kind", "status", "assigneeId", "reporterId", "priority", "blocker"]));
  });

  it("suppresses no-op events including equal rich text", async () => {
    const { repo, commands } = await setup(); const before = await repo.getSnapshot();
    const issue = await repo.getIssue("live-tracking-118");
    await commands.updateIssue({ issueId: issue.id, name: issue.title, description: legacyEditorContent(issue.description), status: issue.status });
    expect(await repo.getSnapshot()).toBe(before);
  });

  it("rejects invalid blocker, foreign assignees and stale edits without publishing a partial command", async () => {
    const { repo, commands } = await setup(); const before = await repo.getSnapshot();
    await expect(commands.updateIssue({ issueId: "live-tracking-118", blocker: { blocked: true, reason: " " } })).rejects.toBeDefined();
    await expect(commands.updateIssue({ issueId: "live-tracking-118", assigneeId: "missing" })).rejects.toBeDefined();
    await expect(commands.updateIssue({ issueId: "live-tracking-118", expectedVersion: 999, name: "Stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(before);
  });

  it("creates children and detaches/reparents atomically while preserving one-level canonical orders", async () => {
    const { repo, commands } = await setup();
    const child = await commands.createIssue({ name: "Acceptance trace", type: "SUBTASK", parentId: "live-tracking-118" });
    expect(child.sprintId).toBe("lt-sprint-12");
    await commands.updateIssue({ issueId: child.id, parentId: null });
    expect((await repo.getSnapshot()).state.boardOrderByProject["live-tracking"]?.TODO).toContain(child.id);
    await commands.updateIssue({ issueId: child.id, parentId: "live-tracking-130" });
    expect((await repo.getIssue(child.id)).sprintId).toBe("lt-sprint-13");
    await expect(commands.updateIssue({ issueId: "live-tracking-118", parentId: child.id })).rejects.toBeDefined();
  });

  it("moves status using an anchor and persists ordering-only movement without activity noise", async () => {
    const { repo, storage, commands } = await setup();
    await commands.moveIssue({ issueId: "live-tracking-124", destination: { view: "board", status: "IN_PROGRESS" }, placement: { beforeIssueId: "live-tracking-120" } });
    expect((await repo.getIssue("live-tracking-124")).status).toBe("IN_PROGRESS");
    const before = await repo.getSnapshot();
    await commands.moveIssue({ issueId: "live-tracking-124", destination: { view: "board", status: "IN_PROGRESS" }, placement: { afterIssueId: "live-tracking-127" } });
    const after = await repo.getSnapshot(); expect(after.state.activityOrder).toEqual(before.state.activityOrder);
    expect(after.state.boardOrderByProject["live-tracking"]?.IN_PROGRESS.at(-1)).toBe("live-tracking-124");
    expect(readEnvelope(storage.value ?? "").snapshot).toEqual(after);
  });

  it("translates filtered drop slots into stable IDs and preserves hidden canonical neighbors", async () => {
    const { repo, commands } = await setup();
    const before = await repo.getSnapshot();
    const visible = ["live-tracking-120", "live-tracking-127"];
    expect(dragPlacement(visible, "live-tracking-124", 1)).toEqual({ beforeIssueId: "live-tracking-127" });
    await commands.moveIssue({ issueId: "live-tracking-124", destination: { view: "board", status: "IN_PROGRESS" }, placement: dragPlacement(visible, "live-tracking-124", 1) });
    const order = (await repo.getSnapshot()).state.boardOrderByProject["live-tracking"]?.IN_PROGRESS ?? [];
    expect(order.filter((id) => id !== "live-tracking-124")).toEqual(before.state.boardOrderByProject["live-tracking"]?.IN_PROGRESS);
    expect(order[order.indexOf("live-tracking-127") - 1]).toBe("live-tracking-124");
    expect(dragPlacement(visible, "live-tracking-120", 1)).toEqual({ afterIssueId: "live-tracking-127" });
    expect(dragPlacement([], "live-tracking-124", 0)).toEqual({ at: "end" });
    expect(() => dragPlacement(visible, "x", 9)).toThrow();
  });

  it("moves planning families using anchors without turning children into separate planning units", async () => {
    const { repo, commands } = await setup();
    await commands.moveIssue({ issueId: "live-tracking-118", destination: { view: "planning", sprintId: null }, placement: { beforeIssueId: "live-tracking-138" } });
    const snapshot = await repo.getSnapshot();
    expect(snapshot.state.planningOrderByProject["live-tracking"]?.backlog).toEqual(expect.arrayContaining(["live-tracking-118", "live-tracking-138"]));
    expect((await repo.getIssue("live-tracking-140")).sprintId).toBeNull();
    expect(snapshot.state.planningOrderByProject["live-tracking"]?.backlog).not.toContain("live-tracking-140");
  });

  it("deletes/restores only the issue family, preserves later unrelated edits, and never reuses a key", async () => {
    const { repo, commands } = await setup(); const created = await commands.createIssue({ name: "Allocated before deletion" });
    const deleted = await commands.deleteIssue({ issueId: "live-tracking-118" });
    await commands.updateIssue({ issueId: "live-tracking-120", name: "Unrelated later edit" });
    await commands.restoreIssue({ issueId: deleted.id, expectedGeneration: deleted.generation });
    expect((await repo.getIssue("live-tracking-118")).deletedAt).toBeNull(); expect((await repo.getIssue("live-tracking-140")).deletedAt).toBeNull();
    expect((await repo.getIssue("live-tracking-120")).title).toBe("Unrelated later edit");
    await commands.deleteIssue({ issueId: created.id });
    expect((await commands.createIssue({ name: "Allocated after deletion" })).key).not.toBe(created.key);
  });

  it("prevents an old Undo from restoring across reset", async () => {
    const { repo, commands } = await setup(); const deleted = await commands.deleteIssue({ issueId: "live-tracking-118" });
    await repo.resetDemo(); await expect(commands.restoreIssue({ issueId: deleted.id, expectedGeneration: deleted.generation })).rejects.toMatchObject({ code: "STALE_GENERATION" });
  });

  it("creates, edits and deletes owned comments with identity, version checks, tombstones and persistence", async () => {
    const { repo, storage, commands, snapshot } = await setup();
    await commands.addComment({ issueId: "live-tracking-118", content: content("An owned comment") });
    const comment = (await repo.getComments("live-tracking-118")).at(-1); if (!comment) throw new Error("Comment missing");
    expect(comment.authorId).toBe(snapshot.state.workspace.visitorId);
    await commands.updateComment({ issueId: comment.issueId, commentId: comment.id, expectedVersion: comment.version, content: content("An edited comment") });
    expect((await repo.getComments(comment.issueId)).at(-1)?.body).toEqual(documentFromParagraphs("An edited comment"));
    await commands.deleteComment({ issueId: comment.issueId, commentId: comment.id });
    expect((await repo.getComments(comment.issueId)).map((item) => item.id)).not.toContain(comment.id);
    expect(readEnvelope(storage.value ?? "").snapshot.state.commentsById[comment.id]?.deletedAt).toBe(anchor);
    const foreign = (await repo.getComments(comment.issueId))[0]; if (!foreign) throw new Error("Seed comment missing");
    await expect(commands.deleteComment({ issueId: foreign.issueId, commentId: foreign.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("creates/edits/deletes pending sprints and starts with form edits in one transaction", async () => {
    const { repo, commands } = await setup();
    await commands.createSprint(); const sprint = (await repo.getProjectSprints("live-tracking")).at(-1); if (!sprint) throw new Error("Sprint missing");
    await commands.updateSprint({ sprintId: sprint.id, name: "Acceptance sprint", description: "Validate delivery", startDate: anchor, endDate: "2026-10-12T10:00:00.000Z" });
    await commands.deleteSprint({ sprintId: sprint.id });
    await commands.completeSprint({ sprintId: "lt-sprint-12", destinationSprintId: null });
    const before = await repo.getSnapshot();
    await commands.startSprint({ sprintId: "lt-sprint-13", name: "Started acceptance sprint", description: "Ship verified tracking" });
    const after = await repo.getSnapshot(); expect(after.revision).toBe(before.revision + 1);
    expect(after.state.sprintsById["lt-sprint-13"]).toMatchObject({ status: "ACTIVE", name: "Started acceptance sprint" });
  });

  it("failed sprint start does not publish form edits", async () => {
    const { repo, commands } = await setup(); const before = await repo.getSnapshot();
    await expect(commands.startSprint({ sprintId: "lt-sprint-13", name: "Must not leak" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(before);
  });

  it.each([null, "lt-sprint-13"])("completes from the entire canonical dataset atomically into %s", async (destinationSprintId) => {
    const { repo, commands } = await setup(); const before = await repo.getSnapshot();
    const complete = vi.spyOn(repo, "completeSprint");
    await commands.completeSprint({ sprintId: "lt-sprint-12", destinationSprintId });
    const after = await repo.getSnapshot(); expect(complete).toHaveBeenCalledOnce(); expect(after.revision).toBe(before.revision + 1);
    expect(after.state.sprintsById["lt-sprint-12"]?.status).toBe("CLOSED");
    expect(after.state.issuesById["live-tracking-124"]?.sprintId).toBe(destinationSprintId);
    expect(after.state.issuesById["live-tracking-119"]?.sprintId).toBe("lt-sprint-12");
    expect(after.state.issuesById["live-tracking-140"]?.sprintId).toBe(destinationSprintId);
    const historyQuery = repositoryQueries.sprintHistory(repo, "live-tracking");
    expect(historyQuery.queryKey).toEqual([...nexusKeys.sprints("live-tracking"), "history"]);
    expect((await historyQuery.queryFn()).find((sprint) => sprint.id === "lt-sprint-12")).toMatchObject({ name: "Sprint 12", status: "CLOSED" });
    expect((await repositoryQueries.sprints(repo, "live-tracking").queryFn()).map((sprint) => sprint.id)).not.toContain("lt-sprint-12");
  });

  it("refreshes active reads from the subscription and only affected project query keys", async () => {
    const { repo, snapshot, commands } = await setup(); const client = new QueryClient();
    const observer = new QueryObserver(client, repositoryQueries.issues(repo, "live-tracking")); const unsubscribe = observer.subscribe(() => undefined);
    await client.fetchQuery(repositoryQueries.issues(repo, "live-tracking")); const stop = connectQueryBridge(repo, client, snapshot);
    await commands.updateIssue({ issueId: "live-tracking-118", name: "Refreshed by subscription" });
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.find((issue) => issue.id === "live-tracking-118")?.name).toBe("Refreshed by subscription"));
    const keys = changedQueryKeys(snapshot, await repo.getSnapshot());
    expect(keys).toContainEqual(nexusKeys.issues("live-tracking")); expect(keys).not.toContainEqual(nexusKeys.all); expect(keys).not.toContainEqual(nexusKeys.issues("carrier-api"));
    stop(); unsubscribe(); client.clear();
  });

  it("keeps successful mutations available after storage degradation", async () => {
    const { repo, storage, commands } = await setup(); storage.fail = true;
    await commands.updateIssue({ issueId: "live-tracking-118", name: "Still interactive in memory" });
    expect((await repo.getIssue("live-tracking-118")).title).toBe("Still interactive in memory"); expect(repo.getPersistenceState().status).toBe("memory");
  });

  it("keeps all migrated paths independent of Axios/API and uses the seeded visitor", async () => {
    const { repo, commands, snapshot } = await setup(); const fetch = vi.fn(() => { throw new Error("Network forbidden"); }); vi.stubGlobal("fetch", fetch);
    const visitor = snapshot.state.usersById[snapshot.state.workspace.visitorId];
    if (!visitor) throw new Error("Seed visitor missing");
    expect(demoIdentity(visitor)).toMatchObject({ id: "maya", name: "Maya Chen" });
    await commands.createIssue({ name: "Offline creation" }); await commands.addComment({ issueId: "live-tracking-118", content: content("Offline discussion") }); await commands.createSprint();
    expect(fetch).not.toHaveBeenCalled();
    for (const file of ["hooks/query-hooks/use-sprints.ts", "hooks/query-hooks/use-issue-details.ts", "hooks/query-hooks/use-issues/use-post-issue.ts", "hooks/query-hooks/use-issues/use-update-issue.ts", "hooks/query-hooks/use-issues/use-delete-issue.ts", "integration/repository-mutations.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/axios|@\/utils\/api|setQueryData|invalidateQueries/);
    }
    expect(readFileSync("context/demo-user.ts", "utf8")).toContain("workspace.data?.visitorId");
    expect(readFileSync("app/layout.tsx", "utf8")).not.toMatch(/AuthModal|TransitionalAuth|ClerkProvider/);
    repo.dispose();
  });

  it("round-trips supported editor content and rejects unsupported blocks without a command", () => {
    const document = documentFromParagraphs("Supported description"); expect(editorDocument(legacyEditorContent(document))).toEqual(document);
    expect(() => editorDocument(JSON.stringify({ root: { type: "root", children: [{ type: "table", children: [] }] } }))).toThrow("Unsupported editor content");
  });

  it("opens a newly created issue's empty description in Lexical and preserves empty no-op semantics", async () => {
    const { repo, commands } = await setup();
    const created = await commands.createIssue({ name: "Empty description regression" });
    const issue = await repo.getIssue(created.id);
    const serialized = legacyEditorContent(issue.description);
    const editor = createEditor({ namespace: "empty-description-regression", onError: (error) => { throw error; } });
    const editorState = editor.parseEditorState(serialized);
    expect(editorState.isEmpty()).toBe(false);
    expect(() => editor.setEditorState(editorState)).not.toThrow();
    expect(editorDocument(serialized)).toEqual(issue.description);
    const before = await repo.getSnapshot();
    await commands.updateIssue({ issueId: issue.id, description: serialized });
    expect(await repo.getSnapshot()).toBe(before);
    repo.dispose();
  });
});
