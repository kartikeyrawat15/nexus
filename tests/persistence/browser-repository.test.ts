import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshot } from "../../demo/create-snapshot";
import { documentFromParagraphs } from "../../demo/wayline";
import { type ImmutableSnapshot } from "../../domain/types";
import { type BrowserEnvironment, type StorageAdapter, type StorageChange } from "../../persistence/browser-environment";
import { createEnvelope, readEnvelope, STORAGE_KEY, type StoredEnvelope } from "../../persistence/envelope";
import { createMigrationRegistry, migrations } from "../../persistence/migrations";
import { BrowserRepository, type BrowserRepositoryOptions } from "../../repositories/browser-repository";
import { MemoryRepository } from "../../repositories/memory-repository";

const anchor = "2026-10-05T10:00:00.000Z";
const issueId = "live-tracking-118";

class FakeStorage implements StorageAdapter {
  value: string | null = null;
  reads = 0;
  writes = 0;
  readError: Error | null = null;
  writeError: Error | null = null;
  getItem(key: string): string | null {
    expect(key).toBe(STORAGE_KEY); this.reads += 1;
    if (this.readError) throw this.readError;
    return this.value;
  }
  setItem(key: string, value: string): void {
    expect(key).toBe(STORAGE_KEY); this.writes += 1;
    if (this.writeError) throw this.writeError;
    this.value = value;
  }
  envelope(): StoredEnvelope {
    if (this.value === null) throw new Error("Storage is empty");
    return readEnvelope(this.value);
  }
}
class FakeEnvironment implements BrowserEnvironment {
  readonly listeners = new Set<(event: StorageChange) => void>();
  constructor(readonly storage: FakeStorage | null) {}
  subscribe(listener: (event: StorageChange) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  emit(value: string | null, key: string | null = STORAGE_KEY): void {
    for (const listener of this.listeners) listener({ key, newValue: value });
  }
}
function make(storage: FakeStorage | null = new FakeStorage(), options: BrowserRepositoryOptions = {}) {
  const env = new FakeEnvironment(storage);
  let sequence = 0;
  const writerId = options.writerId ?? "tab-a";
  const repo = new BrowserRepository({ clock: () => anchor, writerId, idFactory: () => `${writerId}-id-${++sequence}`,
    environment: () => env, ...options });
  return { repo, env, storage };
}
async function setup(storage = new FakeStorage(), options: BrowserRepositoryOptions = {}) {
  const result = make(storage, options);
  const snapshot = await result.repo.initialize();
  return { ...result, storage, snapshot, expectedGeneration: snapshot.generation };
}
async function external(snapshot: ImmutableSnapshot, options: { title?: string; writerId?: string; now?: string } = {}) {
  let sequence = 0;
  const writerId = options.writerId ?? "tab-b";
  const now = options.now ?? "2026-10-05T11:00:00.000Z";
  const memory = new MemoryRepository({ initialSnapshot: snapshot, clock: () => now, writerId, idFactory: () => `${writerId}-event-${++sequence}` });
  await memory.initialize();
  await memory.updateIssue({ expectedGeneration: snapshot.generation, issueId, patch: { title: options.title ?? "External shipment fix" } });
  return createEnvelope(await memory.getSnapshot(), writerId, now);
}
function raw(envelope: StoredEnvelope): string { return JSON.stringify(envelope); }
function firstId(ids: readonly string[]): string {
  const id = ids[0]; if (!id) throw new Error("Expected entity ID"); return id;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("browser initialization and immutable persistence", () => {
  it("seeds empty storage once, rebases dates, and persists a validated v1 envelope", async () => {
    const { repo, storage, env } = make(new FakeStorage(), { clock: () => "2026-10-12T10:00:00.000Z" });
    const [first, second] = await Promise.all([repo.initialize(), repo.initialize()]);
    if (!storage) throw new Error("Missing storage");
    expect(first).toBe(second);
    expect(first).toEqual(createSnapshot({ anchor: "2026-10-12T10:00:00.000Z", generation: first.generation }));
    expect(storage.reads).toBe(1); expect(storage.writes).toBe(1);
    expect(env.listeners.size).toBe(1);
    expect(storage.envelope()).toMatchObject({ schemaVersion: 1, snapshotRevision: 0, writerId: "tab-a", updatedAt: "2026-10-12T10:00:00.000Z", snapshot: first });
    expect(repo.getPersistenceState()).toEqual({ status: "persisted", warning: null, diagnostics: [] });
    expect(Object.isFrozen(first.state.issuesById)).toBe(true);
    expect(Object.isFrozen(repo.getPersistenceState())).toBe(true);
  });

  it("refreshes from storage without rebasing dates or losing mutations, tombstones and Undo metadata", async () => {
    const { repo, storage, expectedGeneration } = await setup();
    const created = await repo.createIssue({ expectedGeneration, projectId: "live-tracking", title: "Visitor work" });
    await repo.deleteIssue({ expectedGeneration, issueId, children: "delete" });
    const saved = await repo.getSnapshot(); repo.dispose();
    const refreshed = make(storage, { writerId: "tab-refresh", clock: () => "2026-11-05T10:00:00.000Z" });
    const loaded = await refreshed.repo.initialize();
    expect(loaded).toEqual(saved);
    expect(loaded.scenarioAnchor).toBe(anchor);
    expect(loaded.state.issuesById[created.issue.id]?.key).toBe("LT-145");
    await refreshed.repo.restoreIssue({ expectedGeneration, issueId });
    const restored = await refreshed.repo.getSnapshot();
    expect(restored.state.issuesById[issueId]?.deletedAt).toBeNull();
    expect(restored.state.issuesById["live-tracking-140"]?.parentId).toBe(issueId);
    expect(storage.envelope().snapshot).toEqual(restored);
    expect((await refreshed.repo.createIssue({ expectedGeneration, projectId: "live-tracking", title: "After refresh" })).issue.key).toBe("LT-146");
  });

  it("reads cached immutable state without any storage access", async () => {
    const { repo, storage, snapshot } = await setup();
    const reads = storage.reads; const writes = storage.writes;
    storage.readError = new Error("Reads should not touch storage");
    for (let index = 0; index < 5; index += 1) {
      expect(await repo.getSnapshot()).toBe(snapshot);
      expect(await repo.getProjects()).toHaveLength(3);
      expect((await repo.getProject("live-tracking")).keyPrefix).toBe("LT");
      expect(await repo.getIssues("live-tracking")).toHaveLength(27);
    }
    expect(storage.reads).toBe(reads); expect(storage.writes).toBe(writes);
  });

  it("persists every command family through the existing memory transaction boundary", async () => {
    const { repo, storage, expectedGeneration } = await setup();
    async function verify(operation: () => Promise<unknown>) {
      const writes = storage.writes; const before = await repo.getSnapshot();
      await operation(); const after = await repo.getSnapshot();
      expect(storage.writes).toBe(writes + 1);
      expect(storage.envelope().snapshot).toEqual(after);
      expect(after.revision).toBe(before.revision + 1);
    }
    const issue = await repo.createIssue({ expectedGeneration, projectId: "live-tracking", title: "Persist all commands" });
    expect(issue.persistenceStatus).toBe("persisted");
    await verify(() => repo.updateIssue({ expectedGeneration, issueId: issue.issue.id, patch: { status: "IN_PROGRESS" } }));
    await verify(() => repo.moveIssue({ expectedGeneration, issueId: issue.issue.id, destination: { view: "planning", sprintId: "lt-sprint-13" }, placement: { at: "end" } }));
    await verify(() => repo.deleteIssue({ expectedGeneration, issueId: issue.issue.id }));
    await verify(() => repo.restoreIssue({ expectedGeneration, issueId: issue.issue.id }));
    const comment = await repo.createComment({ expectedGeneration, issueId: issue.issue.id, body: documentFromParagraphs("Persist discussion") });
    const commentId = firstId(comment.changedEntityIds);
    expect(comment.persistenceStatus).toBe("persisted");
    expect(storage.envelope().snapshot).toEqual(await repo.getSnapshot());
    await verify(() => repo.updateComment({ expectedGeneration, commentId, expectedVersion: 1, body: documentFromParagraphs("Updated discussion") }));
    await verify(() => repo.deleteComment({ expectedGeneration, commentId, expectedVersion: 2 }));
    const sprint = await repo.createSprint({ expectedGeneration, projectId: "operations-console", name: "Persistence sprint", goal: "Complete work" });
    const sprintId = firstId(sprint.changedEntityIds);
    expect(storage.envelope().snapshot).toEqual(await repo.getSnapshot());
    await verify(() => repo.updateSprint({ expectedGeneration, sprintId, expectedVersion: 1, goal: "Updated goal" }));
    await verify(() => repo.startSprint({ expectedGeneration, sprintId, expectedVersion: 2 }));
    await verify(() => repo.completeSprint({ expectedGeneration, sprintId, expectedVersion: 3, destinationSprintId: null }));
    await verify(async () => repo.deletePendingSprint({ expectedGeneration, sprintId: "lt-sprint-13", expectedVersion: (await repo.getSnapshot()).state.sprintsById["lt-sprint-13"]?.version ?? 0 }));
  });

  it("does not write, notify or advance revision/activity for a no-op or rejected domain operation", async () => {
    const { repo, snapshot, storage, expectedGeneration } = await setup();
    const notify = vi.fn(); repo.subscribe(notify);
    const writes = storage.writes;
    const result = await repo.updateIssue({ expectedGeneration, issueId, patch: { title: snapshot.state.issuesById[issueId]?.title } });
    expect(result).toMatchObject({ transactionId: null, persistenceStatus: "persisted", revision: 0, generatedEventIds: [] });
    await expect(repo.updateIssue({ expectedGeneration, issueId, expectedVersion: 999, patch: { priority: "LOW" } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repo.getSnapshot()).toBe(snapshot); expect(storage.writes).toBe(writes);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("safe initialization recovery", () => {
  it.each(["{broken JSON", "null", "[]", '{"schemaVersion":2}', '{"schemaVersion":0}', '{"schemaVersion":"1"}'])("recovers incompatible or corrupt storage: %s", async (value) => {
    const storage = new FakeStorage(); storage.value = value;
    const { repo, snapshot } = await setup(storage);
    expect(snapshot).toEqual(createSnapshot({ anchor, generation: snapshot.generation }));
    expect(storage.envelope().snapshot).toEqual(snapshot);
    expect(repo.getPersistenceState().status).toBe("persisted");
    expect(repo.getPersistenceState().diagnostics).toEqual([expect.objectContaining({ code: "INVALID_STORED_ENVELOPE", rawLength: value.length })]);
  });

  it.each(["counter", "shape", "envelopeRevision", "envelopeTime", "envelopeWriter"])("recovers invalid %s data with diagnostic context", async (failure) => {
    const snapshot = createSnapshot({ anchor, generation: "loaded-generation" });
    const envelope = { schemaVersion: 1, snapshotRevision: 0, writerId: "tab-old", updatedAt: anchor, snapshot };
    if (failure === "counter") snapshot.state.nextIssueNumberByProject["live-tracking"] = 1;
    if (failure === "shape") delete snapshot.state.issuesById[issueId];
    if (failure === "envelopeRevision") envelope.snapshotRevision = 999;
    if (failure === "envelopeTime") envelope.updatedAt = "2026-01-01T00:00:00.000Z";
    if (failure === "envelopeWriter") envelope.writerId = "__proto__";
    const storage = new FakeStorage(); storage.value = JSON.stringify(envelope);
    const result = await setup(storage);
    expect(result.snapshot.generation).not.toBe("loaded-generation");
    expect(Object.values(result.snapshot.state.issuesById)).toHaveLength(48);
    expect(result.repo.getPersistenceState().diagnostics[0]?.message.length).toBeGreaterThan(0);
    expect(storage.envelope().snapshot).toEqual(result.snapshot);
  });

  it("supports an explicitly supplied migration and rewrites the validated current envelope", async () => {
    expect(migrations.size).toBe(0);
    const snapshot = createSnapshot({ anchor, generation: "migrated-generation" });
    const current = createEnvelope(snapshot, "old-tab", anchor);
    const migrate = vi.fn((_value: unknown) => current);
    const registry = createMigrationRegistry([[0, migrate]]);
    const storage = new FakeStorage(); storage.value = JSON.stringify({ schemaVersion: 0 });
    const { repo } = await setup(storage, { migrations: registry });
    expect(migrate).toHaveBeenCalledOnce();
    expect(await repo.getSnapshot()).toEqual(snapshot);
    expect(storage.envelope().schemaVersion).toBe(1);
    expect(repo.getPersistenceState().diagnostics).toEqual([]);
  });

  it("recovers if a registered migration throws or produces an invalid current snapshot", async () => {
    for (const migrate of [(_value: unknown): unknown => { throw new Error("Migration failed"); }, (_value: unknown): unknown => ({ schemaVersion: 1 })]) {
      const storage = new FakeStorage(); storage.value = '{"schemaVersion":0}';
      const result = await setup(storage, { migrations: createMigrationRegistry([[0, migrate]]) });
      expect(Object.values(result.snapshot.state.issuesById)).toHaveLength(48);
      expect(result.repo.getPersistenceState().diagnostics[0]?.code).toBe("INVALID_STORED_ENVELOPE");
      expect(storage.envelope().snapshot).toEqual(result.snapshot);
    }
  });
});

describe("storage failure and continued memory functionality", () => {
  it("works without browser storage and exposes an immutable warning API", async () => {
    const { repo } = make(null);
    const snapshot = await repo.initialize();
    const result = await repo.createIssue({ expectedGeneration: snapshot.generation, projectId: "live-tracking", title: "Memory fallback work" });
    expect(result.persistenceStatus).toBe("memory");
    await repo.deleteIssue({ expectedGeneration: snapshot.generation, issueId: result.issue.id });
    await repo.restoreIssue({ expectedGeneration: snapshot.generation, issueId: result.issue.id });
    const after = await repo.getSnapshot();
    expect(after.state.issuesById[result.issue.id]?.deletedAt).toBeNull();
    expect(after.revision).toBe(3);
    expect(repo.getPersistenceState().status).toBe("memory");
    expect(typeof repo.getPersistenceState().warning).toBe("string");
    expect(Object.isFrozen(repo.getPersistenceState().diagnostics)).toBe(true);
    expect((await repo.resetDemo()).revision).toBe(0);
  });

  it("handles a throwing browser resolver or restricted storage reads without crashing", async () => {
    const unavailable = make(null, { environment: () => { throw new Error("SecurityError"); } });
    const first = await unavailable.repo.initialize();
    expect(unavailable.repo.getPersistenceState().diagnostics[0]?.code).toBe("BROWSER_UNAVAILABLE");
    await expect(unavailable.repo.updateIssue({ expectedGeneration: first.generation, issueId, patch: { priority: "LOW" } })).resolves.toMatchObject({ persistenceStatus: "memory" });
    const storage = new FakeStorage(); storage.readError = new Error("Privacy restrictions"); storage.writeError = new Error("Privacy restrictions");
    const result = await setup(storage);
    expect(result.repo.getPersistenceState().diagnostics.map((diagnostic) => diagnostic.code)).toContain("STORAGE_READ_FAILED");
    await expect(result.repo.createComment({ expectedGeneration: result.expectedGeneration, issueId, body: documentFromParagraphs("Unsaved discussion") })).resolves.toMatchObject({ persistenceStatus: "memory" });
  });

  it("keeps committed activity/revision after quota failure and can save later", async () => {
    const { repo, storage, snapshot, expectedGeneration } = await setup();
    const saved = storage.value;
    const notify = vi.fn(); repo.subscribe(notify);
    storage.writeError = new Error("QuotaExceededError");
    const result = await repo.updateIssue({ expectedGeneration, issueId, patch: { title: "Unsaved but usable work" } });
    const after = await repo.getSnapshot();
    expect(after.revision).toBe(snapshot.revision + 1);
    expect(result.persistenceStatus).toBe("memory");
    expect(after.state.activityOrder).toHaveLength(snapshot.state.activityOrder.length + 1);
    expect(after.state.issuesById[issueId]?.title).toBe("Unsaved but usable work");
    expect(storage.value).toBe(saved); expect(notify).toHaveBeenCalledOnce();
    expect(repo.getPersistenceState().diagnostics.at(-1)?.message).toContain("QuotaExceededError");
    storage.writeError = null;
    // A no-op can retry persistence without adding a domain transaction or activity.
    const retried = await repo.updateIssue({ expectedGeneration, issueId, patch: { title: "Unsaved but usable work" } });
    expect(retried).toMatchObject({ transactionId: null, persistenceStatus: "persisted", revision: after.revision });
    expect(await repo.getSnapshot()).toBe(after);
    expect(storage.envelope().snapshot).toEqual(after);
    expect(repo.getPersistenceState().warning).toBeNull(); expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not let stale external events erase unsaved memory commits", async () => {
    const { repo, storage, snapshot, env, expectedGeneration } = await setup();
    storage.writeError = new Error("Quota");
    await repo.updateIssue({ expectedGeneration, issueId, patch: { priority: "LOW" } });
    const local = await repo.getSnapshot();
    env.emit(raw(createEnvelope(snapshot, "tab-old", "2026-10-06T10:00:00.000Z")));
    expect(await repo.getSnapshot()).toBe(local);
    expect(repo.getPersistenceState().status).toBe("memory");
  });

  it("notifies a storage status change even when the subsequent domain command is rejected", async () => {
    const { repo, storage, expectedGeneration } = await setup();
    const notify = vi.fn(); repo.subscribe(notify);
    storage.readError = new Error("Read restriction");
    await expect(repo.updateIssue({ expectedGeneration, issueId, expectedVersion: 999, patch: { priority: "LOW" } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.getPersistenceState().status).toBe("memory"); expect(notify).toHaveBeenCalledOnce();
  });
});

describe("cross-tab synchronization", () => {
  it("accepts newer external state without a write, fake activity or revision increment", async () => {
    const { repo, env, storage, snapshot } = await setup();
    const incoming = await external(snapshot);
    const writes = storage.writes; const notify = vi.fn(); repo.subscribe(notify);
    env.emit(raw(incoming));
    const after = await repo.getSnapshot();
    expect(after).toEqual(incoming.snapshot);
    expect(after.revision).toBe(incoming.snapshotRevision);
    expect(after.state.activityOrder).toEqual(incoming.snapshot.state.activityOrder);
    expect(storage.writes).toBe(writes); expect(notify).toHaveBeenCalledOnce();
    expect(Object.isFrozen(after.state.issuesById[issueId])).toBe(true);
    env.emit(raw(incoming)); expect(notify).toHaveBeenCalledOnce();
  });

  it("ignores its own writer's events, including unexpectedly higher revisions", async () => {
    const { repo, env, snapshot, storage } = await setup();
    const incoming = await external(snapshot, { writerId: "tab-a" });
    const writes = storage.writes;
    env.emit(raw(incoming));
    expect(await repo.getSnapshot()).toBe(snapshot); expect(storage.writes).toBe(writes);
  });

  it("rejects lower same-generation revision even if its timestamp is later", async () => {
    const { repo, env, snapshot } = await setup();
    const newer = await external(snapshot); env.emit(raw(newer));
    const adopted = await repo.getSnapshot();
    env.emit(raw(createEnvelope(snapshot, "tab-stale", "2026-10-10T10:00:00.000Z")));
    expect(await repo.getSnapshot()).toBe(adopted);
  });

  it("resolves equal-revision conflicts by timestamp and then writer ID deterministically", async () => {
    const { repo, env, snapshot } = await setup();
    const first = await external(snapshot, { title: "B shipment edit", writerId: "tab-b" });
    const tied = await external(snapshot, { title: "C shipment edit", writerId: "tab-c" });
    env.emit(raw(first)); env.emit(raw(tied));
    expect((await repo.getSnapshot()).state.issuesById[issueId]?.title).toBe("C shipment edit");
    const adopted = await repo.getSnapshot(); env.emit(raw(first));
    expect(await repo.getSnapshot()).toBe(adopted);
    const later = await external(snapshot, { title: "Later edit", writerId: "tab-b", now: "2026-10-05T12:00:00.000Z" });
    env.emit(raw(later));
    expect((await repo.getSnapshot()).state.issuesById[issueId]?.title).toBe("Later edit");
  });

  it("ignores invalid/unrelated/removal events and retains bounded diagnostics", async () => {
    const { repo, env, snapshot, storage } = await setup();
    const notify = vi.fn(); repo.subscribe(notify);
    env.emit("{broken", "another-key"); env.emit(null); env.emit(null, null);
    expect(notify).not.toHaveBeenCalled();
    for (let index = 0; index < 12; index += 1) env.emit("{broken");
    expect(await repo.getSnapshot()).toBe(snapshot);
    expect(repo.getPersistenceState().diagnostics).toHaveLength(10);
    expect(repo.getPersistenceState().diagnostics.at(-1)?.code).toBe("INVALID_EXTERNAL_ENVELOPE");
    expect(storage.writes).toBe(1); expect(notify).toHaveBeenCalledTimes(12);
    env.emit('{"schemaVersion":2}');
    expect(await repo.getSnapshot()).toBe(snapshot);
  });

  it("checks stored newer state before a mutation if its storage event was missed", async () => {
    const { repo, snapshot, storage, expectedGeneration } = await setup();
    const incoming = await external(snapshot, { now: anchor });
    storage.value = raw(incoming); // The storage event is deliberately not delivered.
    await repo.updateIssue({ expectedGeneration, issueId: "carrier-api-42", patch: { priority: "LOW" } });
    const after = await repo.getSnapshot();
    expect(after.state.issuesById[issueId]?.title).toBe("External shipment fix");
    expect(after.state.issuesById["carrier-api-42"]?.priority).toBe("LOW");
    expect(after.revision).toBe(2); expect(storage.envelope().snapshot).toEqual(after);
  });

  it("adopts a missed external reset before rejecting an old generation's command", async () => {
    const { repo, storage, expectedGeneration } = await setup();
    const second = await setup(storage, { writerId: "tab-b" });
    const reset = await second.repo.resetDemo();
    const writes = storage.writes;
    await expect(repo.updateIssue({ expectedGeneration, issueId, patch: { title: "Old generation draft" } })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    expect(await repo.getSnapshot()).toEqual(reset);
    expect(storage.writes).toBe(writes);
  });
});

describe("reset, subscriptions and browser safety", () => {
  it("persists deterministic reset state and synchronizes a new generation at revision zero", async () => {
    let now = anchor;
    const { repo, storage, expectedGeneration } = await setup(new FakeStorage(), { clock: () => now });
    const second = await setup(storage, { writerId: "tab-b", clock: () => now });
    await repo.createIssue({ expectedGeneration, projectId: "live-tracking", title: "Work before reset" });
    second.env.emit(storage.value);
    const before = await second.repo.getSnapshot();
    now = "2026-10-12T10:00:00.000Z";
    const reset = await repo.resetDemo();
    expect(reset.generation).not.toBe(expectedGeneration); expect(reset.revision).toBe(0);
    expect(reset).toEqual(createSnapshot({ anchor: now, generation: reset.generation }));
    expect(storage.envelope().snapshot).toEqual(reset);
    second.env.emit(storage.value);
    expect(await second.repo.getSnapshot()).toEqual(reset);
    expect(reset.state.nextIssueNumberByProject).toEqual({ "live-tracking": 145, "carrier-api": 54, "operations-console": 40 });
    expect(Object.values(reset.state.commentsById)).toHaveLength(30);
    expect(Object.values(reset.state.issuesById)).toHaveLength(48);
    await expect(second.repo.updateIssue({ expectedGeneration: before.generation, issueId, patch: { title: "Old draft" } })).rejects.toMatchObject({ code: "STALE_GENERATION" });
  });

  it("orders reset after prior writes with a fixed clock and rejects delayed pre-reset events", async () => {
    const { repo, storage, expectedGeneration } = await setup();
    const second = await setup(storage, { writerId: "tab-b" });
    await repo.updateIssue({ expectedGeneration, issueId, patch: { priority: "LOW" } });
    const old = storage.envelope(); second.env.emit(raw(old));
    const reset = await repo.resetDemo(); const envelope = storage.envelope();
    expect(Date.parse(envelope.updatedAt)).toBeGreaterThan(Date.parse(old.updatedAt));
    expect(envelope.snapshotRevision).toBe(0);
    second.env.emit(raw(envelope)); const adopted = await second.repo.getSnapshot();
    second.env.emit(raw(old));
    expect(await second.repo.getSnapshot()).toBe(adopted); expect(adopted).toEqual(reset);
  });

  it("keeps reset metadata newer than all observed writes despite differing tab clocks", async () => {
    const { repo, env, storage, snapshot } = await setup();
    const laterMetadata = createEnvelope(snapshot, "tab-b", "2026-10-10T10:00:00.000Z");
    env.emit(raw(laterMetadata));
    const changed = await external(snapshot, { now: anchor });
    env.emit(raw(changed)); // Higher domain revision wins even with an earlier clock.
    await repo.resetDemo();
    expect(Date.parse(storage.envelope().updatedAt)).toBeGreaterThan(Date.parse(laterMetadata.updatedAt));
  });

  it("replays reset deterministically with injected IDs and time", async () => {
    const a = await setup(); const b = await setup();
    for (const { repo, expectedGeneration } of [a, b]) await repo.createIssue({ expectedGeneration, projectId: "carrier-api", title: "Deterministic edit" });
    expect(await a.repo.resetDemo()).toEqual(await b.repo.resetDemo());
    expect(a.storage.value).toBe(b.storage.value);
  });

  it("notifies initialization, local commits, external adoption, reset and persistence changes", async () => {
    const { repo, storage, env } = make();
    if (!storage) throw new Error("Missing storage");
    const listener = vi.fn(); const unsubscribe = repo.subscribe(listener);
    const initial = await repo.initialize(); expect(listener).toHaveBeenCalledOnce();
    await repo.updateIssue({ expectedGeneration: initial.generation, issueId, patch: { priority: "LOW" } });
    expect(listener).toHaveBeenCalledTimes(2);
    env.emit(raw(await external(await repo.getSnapshot(), { now: anchor })));
    expect(listener).toHaveBeenCalledTimes(3);
    await repo.resetDemo(); expect(listener).toHaveBeenCalledTimes(4);
    const snapshot = await repo.getSnapshot(); storage.writeError = new Error("Quota");
    await repo.createIssue({ expectedGeneration: snapshot.generation, projectId: "live-tracking", title: "Unsaved" });
    expect(listener).toHaveBeenCalledTimes(5);
    unsubscribe(); await repo.resetDemo(); expect(listener).toHaveBeenCalledTimes(5);
    repo.dispose(); expect(env.listeners.size).toBe(0);
  });

  it("isolates throwing subscribers and releases the external event listener on disposal", async () => {
    const { repo, env, expectedGeneration } = await setup();
    repo.subscribe(() => { throw new Error("Consumer bug"); });
    const listener = vi.fn(); repo.subscribe(listener);
    await expect(repo.updateIssue({ expectedGeneration, issueId, patch: { priority: "LOW" } })).resolves.toMatchObject({ persistenceStatus: "persisted" });
    expect(listener).toHaveBeenCalledOnce(); expect(repo.getPersistenceState().diagnostics.at(-1)?.code).toBe("SUBSCRIBER_FAILED");
    const before = await repo.getSnapshot(); repo.dispose(); repo.dispose();
    env.emit(raw(await external(before, { now: anchor })));
    expect(await repo.getSnapshot()).toBe(before); expect(env.listeners.size).toBe(0);
  });

  it("never accesses browser APIs at module import or construction", async () => {
    const getter = vi.fn(() => { throw new Error("Browser access during evaluation"); });
    vi.stubGlobal("window", Object.defineProperty({}, "localStorage", { get: getter }));
    vi.resetModules();
    const { BrowserRepository: ImportedRepository } = await import("../../repositories/browser-repository");
    const repo = new ImportedRepository({ writerId: "ssr-tab", clock: () => anchor, idFactory: () => "ssr-generation" });
    expect(getter).not.toHaveBeenCalled();
    const snapshot = await repo.initialize();
    expect(getter).toHaveBeenCalledOnce();
    expect(snapshot.revision).toBe(0); expect(repo.getPersistenceState().status).toBe("memory");
  });

  it("uses native storage events lazily, filters storage areas, and detaches on dispose", async () => {
    const storage = new FakeStorage();
    let handler: ((event: StorageEvent) => void) | null = null;
    const add = vi.fn((_type: string, listener: (event: StorageEvent) => void) => { handler = listener; });
    const remove = vi.fn();
    const getter = vi.fn(() => storage);
    vi.stubGlobal("window", Object.defineProperty({ addEventListener: add, removeEventListener: remove }, "localStorage", { get: getter }));
    const repo = new BrowserRepository({ writerId: "native-tab", clock: () => anchor, idFactory: () => "native-generation" });
    expect(getter).not.toHaveBeenCalled();
    const snapshot = await repo.initialize();
    expect(getter).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledOnce();
    const incoming = await external(snapshot);
    // The handler is installed synchronously by initialize; capture it with the registered call.
    const listener = add.mock.calls[0]?.[1];
    if (!listener || !handler) throw new Error("Native event handler was not installed");
    listener({ storageArea: {}, key: STORAGE_KEY, newValue: raw(incoming) } as StorageEvent);
    expect(await repo.getSnapshot()).toBe(snapshot);
    listener({ storageArea: storage, key: STORAGE_KEY, newValue: raw(incoming) } as unknown as StorageEvent);
    expect(await repo.getSnapshot()).toEqual(incoming.snapshot);
    repo.dispose(); expect(remove).toHaveBeenCalledWith("storage", listener);
  });

  it("keeps writes usable and exposes a warning if storage event registration fails", async () => {
    const storage = new FakeStorage();
    const { repo } = make(storage, { environment: () => ({ storage, subscribe: () => { throw new Error("Events restricted"); } }) });
    const snapshot = await repo.initialize();
    expect(repo.getPersistenceState().status).toBe("persisted");
    expect(repo.getPersistenceState().warning).toContain("synchronization");
    await repo.updateIssue({ expectedGeneration: snapshot.generation, issueId, patch: { priority: "LOW" } });
    expect(storage.envelope().snapshot).toEqual(await repo.getSnapshot());
    expect(repo.getPersistenceState().diagnostics.at(-1)?.code).toBe("EVENT_SUBSCRIBE_FAILED");
  });

  it("initializes safely in Node without window and gives each default browser writer a unique ID", async () => {
    vi.stubGlobal("window", undefined);
    let index = 0;
    const options = { clock: () => anchor, idFactory: () => `ssr-${++index}` };
    const a = new BrowserRepository(options); const b = new BrowserRepository(options);
    const first = await a.initialize(); const second = await b.initialize();
    expect(first.generation).not.toBe(second.generation);
    expect(a.getPersistenceState().status).toBe("memory");
    const storage = new FakeStorage(); const env = new FakeEnvironment(storage);
    const c = new BrowserRepository({ ...options, environment: () => env });
    const d = new BrowserRepository({ ...options, environment: () => env });
    await c.initialize(); const writerC = storage.envelope().writerId;
    await d.initialize(); expect(storage.envelope().writerId).not.toBe(writerC);
  });
});
