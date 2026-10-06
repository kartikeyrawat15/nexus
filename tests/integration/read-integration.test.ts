import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { BrowserRepository } from "../../repositories/browser-repository";
import { MemoryRepository } from "../../repositories/memory-repository";
import { createSnapshot } from "../../demo/create-snapshot";
import { documentFromParagraphs } from "../../demo/wayline";
import { createEnvelope, STORAGE_KEY } from "../../persistence/envelope";
import { type StorageChange } from "../../persistence/browser-environment";
import { changedQueryKeys, connectQueryBridge } from "../../integration/query-bridge";
import { createRepositoryRuntime, defaultProjectId } from "../../integration/repository-runtime";
import { repositoryQueries } from "../../integration/repository-queries";
import { nexusKeys } from "../../integration/query-keys";
import { commentView, legacyEditorContent, projectIssuesView } from "../../integration/legacy-views";

const anchor = "2026-10-05T10:00:00.000Z";
function repository() {
  let index = 0;
  return new BrowserRepository({ clock: () => anchor, idFactory: () => `integration-${++index}`, writerId: "integration-tab",
    environment: () => ({ storage: null, subscribe: () => () => undefined }) });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("repository runtime lifecycle", () => {
  it("constructs one repository and initializes once across repeated and concurrent mounts", async () => {
    const factory = vi.fn(repository); const runtime = createRepositoryRuntime(factory);
    const initialize = vi.spyOn(runtime.repository, "initialize");
    const first = runtime.initialize(); const replay = runtime.initialize();
    expect(first).toBe(replay); expect(await replay).toBe(await first);
    await runtime.initialize();
    expect(factory).toHaveBeenCalledOnce(); expect(initialize).toHaveBeenCalledOnce();
  });

  it("selects the workspace's deterministic featured project rather than an old singleton ID", () => {
    const seed = createSnapshot({ anchor, generation: "project-selection" });
    expect(defaultProjectId(seed)).toBe("live-tracking");
    seed.state.workspace.featuredProjectId = "carrier-api";
    expect(defaultProjectId(seed)).toBe("carrier-api");
  });

});

describe("isolated legacy read views", () => {
  it("projects the entire project, four statuses, child relationships, users and canonical ranks", () => {
    const seed = createSnapshot({ anchor, generation: "views" });
    const views = projectIssuesView(seed, "live-tracking");
    expect(views).toHaveLength(27);
    expect(new Set(views.map((issue) => issue.status))).toEqual(new Set(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]));
    const parent = views.find((issue) => issue.key === "LT-118");
    const child = views.find((issue) => issue.key === "LT-140");
    expect(parent).toMatchObject({ status: "IN_REVIEW", name: seed.state.issuesById["live-tracking-118"]?.title, sprintIsActive: true, assignee: { id: "maya", name: "Maya Chen" } });
    expect(parent?.children.map((issue) => issue.id)).toEqual(["live-tracking-140"]);
    expect(child).toMatchObject({ type: "SUBTASK", parentId: "live-tracking-118", parent: { id: "live-tracking-118" } });
    expect(child?.parent?.children.map((issue) => issue.id)).toEqual(["live-tracking-140"]);
    expect(() => JSON.stringify(views)).not.toThrow(); // No parent/child cycles in Query cache values.
    expect(views.filter((issue) => issue.status === "IN_PROGRESS" && !issue.parentId).sort((a, b) => a.boardPosition - b.boardPosition).map((issue) => issue.id))
      .toEqual(seed.state.boardOrderByProject["live-tracking"]?.IN_PROGRESS);
    const first = views[0]; if (!first) throw new Error("Missing view");
    first.name = "Edited UI projection";
    expect(seed.state.issuesById[first.id]?.title).not.toBe(first.name);
    expect(views.every((issue) => issue.key.startsWith("LT-"))).toBe(true);
  });

  it("serializes owned rich text into readable existing editor JSON without changing domain content", () => {
    const document = documentFromParagraphs("An acceptance criterion", "A second paragraph");
    const original = JSON.stringify(document);
    const serialized = legacyEditorContent(document);
    const editor: unknown = JSON.parse(serialized);
    expect(editor).toMatchObject({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "An acceptance criterion" }] }, { type: "paragraph" }] } });
    expect(JSON.stringify(document)).toBe(original);
  });

  it("projects comment authors, dates and content from domain reads", async () => {
    const repo = repository(); await repo.initialize();
    const comments = await repo.getComments("live-tracking-118");
    const members = await repo.getProjectMembers("live-tracking");
    expect(comments).toHaveLength(3);
    const first = comments[0]; if (!first) throw new Error("Missing comment");
    const view = commentView(first, members);
    expect(view.author?.id).toBe(first.authorId); expect(view.createdAt).toBeInstanceOf(Date);
    expect(view.content).toContain("root"); expect(view.issueId).toBe("live-tracking-118");
    expect(Object.isFrozen(comments)).toBe(true);
    expect(Object.isFrozen(members)).toBe(true);
  });
});

describe("primary reads require no network or backend", () => {
  it("fetches project, projects, members, issues, sprints, details and comments entirely from the repository", async () => {
    const network = vi.fn(() => { throw new Error("Network is unavailable"); }); vi.stubGlobal("fetch", network);
    const repo = repository(); await repo.initialize();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect((await client.fetchQuery(repositoryQueries.workspace(repo))).name).toContain("Wayline");
    expect(await client.fetchQuery(repositoryQueries.projects(repo))).toHaveLength(3);
    expect((await client.fetchQuery(repositoryQueries.project(repo, "live-tracking"))).name).toBe("Live tracking");
    expect(await client.fetchQuery(repositoryQueries.members(repo, "live-tracking"))).toHaveLength(5);
    expect(await client.fetchQuery(repositoryQueries.issues(repo, "live-tracking"))).toHaveLength(27);
    expect(await client.fetchQuery(repositoryQueries.sprints(repo, "live-tracking"))).toHaveLength(2);
    expect((await client.fetchQuery(repositoryQueries.issue(repo, "live-tracking", "live-tracking-118")))?.key).toBe("LT-118");
    expect(await client.fetchQuery(repositoryQueries.comments(repo, "live-tracking", "live-tracking-118"))).toHaveLength(3);
    expect(network).not.toHaveBeenCalled(); client.clear(); repo.dispose();
  });

  it("exposes live, scoped domain reads and rejects missing/deleted records", async () => {
    const repo = repository(); const snapshot = await repo.initialize();
    expect((await repo.getIssue("carrier-api-42")).projectId).toBe("carrier-api");
    expect((await repo.getProjectMembers("carrier-api")).every((member) => member.workspaceId === snapshot.state.workspace.id)).toBe(true);
    expect((await repo.getProjectSprints("operations-console")).map((sprint) => sprint.status)).toEqual(["CLOSED"]);
    expect((await repo.getActivity("carrier-api")).every((event) => event.projectId === "carrier-api")).toBe(true);
    await repo.deleteIssue({ expectedGeneration: snapshot.generation, issueId: "live-tracking-118" });
    await expect(repo.getIssue("live-tracking-118")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.getComments("live-tracking-118")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.getProjectMembers("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.getProjectSprints("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.getActivity("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("React Query bridge", () => {
  it("invalidates only affected project reads and refetches an active observer", async () => {
    const repo = repository(); const initial = await repo.initialize();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = repositoryQueries.issues(repo, "live-tracking");
    const observer = new QueryObserver(client, query); const stopObserver = observer.subscribe(() => undefined);
    await client.fetchQuery(query);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const stopBridge = connectQueryBridge(repo, client, initial);
    await repo.updateIssue({ expectedGeneration: initial.generation, issueId: "live-tracking-118", patch: { title: "Query refetched this shipment" } });
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.find((issue) => issue.key === "LT-118")?.name).toBe("Query refetched this shipment"));
    const keys = invalidate.mock.calls.map(([argument]) => {
      const filters: unknown = argument;
      return filters && typeof filters === "object" && "queryKey" in filters ? filters.queryKey : filters;
    });
    expect(keys).toContainEqual(nexusKeys.issues("live-tracking"));
    expect(keys).not.toContainEqual(nexusKeys.members("live-tracking"));
    expect(keys).not.toContainEqual(nexusKeys.sprints("carrier-api"));
    expect(keys).not.toContainEqual(nexusKeys.all);
    stopBridge(); stopObserver(); client.clear();
  });

  it("cleans up queued notifications and supports Strict Mode subscribe/cleanup/replay", async () => {
    const repo = repository(); const initial = await repo.initialize();
    const client = new QueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries");
    const stopFirst = connectQueryBridge(repo, client, initial); stopFirst();
    const stopReplay = connectQueryBridge(repo, client, initial);
    await repo.updateIssue({ expectedGeneration: initial.generation, issueId: "live-tracking-118", patch: { priority: "LOW" } });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    stopReplay(); invalidate.mockClear();
    await repo.updateIssue({ expectedGeneration: initial.generation, issueId: "live-tracking-118", patch: { priority: "HIGH" } });
    expect(invalidate).not.toHaveBeenCalled();
    const stopQueued = connectQueryBridge(repo, client, await repo.getSnapshot());
    const mutation = repo.updateIssue({ expectedGeneration: initial.generation, issueId: "live-tracking-118", patch: { priority: "NORMAL" } });
    stopQueued(); await mutation; await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled(); client.clear();
  });

  it("handles external snapshots and reset without adding domain transactions", async () => {
    let handler: ((event: StorageChange) => void) | undefined; let index = 0;
    const repo = new BrowserRepository({ clock: () => anchor, idFactory: () => `bridge-${++index}`, writerId: "local-tab",
      environment: () => ({ storage: null, subscribe: (listener) => { handler = listener; return () => { handler = undefined; }; } }) });
    const initial = await repo.initialize(); const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries"); const stop = connectQueryBridge(repo, client, initial);
    const remote = new MemoryRepository({ clock: () => anchor, idFactory: () => `remote-${++index}`, writerId: "remote-tab", initialSnapshot: initial });
    await remote.initialize();
    await remote.updateIssue({ expectedGeneration: initial.generation, issueId: "carrier-api-42", patch: { priority: "LOW" } });
    const snapshot = await remote.getSnapshot();
    handler?.({ key: STORAGE_KEY, newValue: JSON.stringify(createEnvelope(snapshot, "remote-tab", anchor)) });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: nexusKeys.issues("carrier-api") }));
    expect(await repo.getSnapshot()).toEqual(snapshot);
    invalidate.mockClear(); await repo.resetDemo();
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: nexusKeys.all }));
    stop(); repo.dispose(); client.clear();
  });

  it("ignores persistence-only notifications and no-op changes, and scopes comment-only refresh", async () => {
    const repo = repository(); const initial = await repo.initialize();
    const noOp = await repo.updateIssue({ expectedGeneration: initial.generation, issueId: "live-tracking-118", patch: { priority: "HIGH" } });
    expect(noOp.transactionId).toBeNull();
    expect(changedQueryKeys(initial, await repo.getSnapshot())).toEqual([]);
    await repo.createComment({ expectedGeneration: initial.generation, issueId: "live-tracking-118", body: documentFromParagraphs("Refresh discussion only") });
    const keys = changedQueryKeys(initial, await repo.getSnapshot());
    expect(keys).toContainEqual(["nexus", "comments", "live-tracking"]);
    expect(keys).toContainEqual(nexusKeys.activity("live-tracking"));
    expect(keys).not.toContainEqual(nexusKeys.issues("live-tracking"));
    expect(keys).not.toContainEqual(nexusKeys.projects());
  });
});
