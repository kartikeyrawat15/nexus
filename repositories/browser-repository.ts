/* eslint-disable @typescript-eslint/require-await -- Storage and domain transitions are synchronous; the inherited public API remains async. */
import { deepFreeze } from "../domain/invariants";
import { idSchema } from "../domain/schema";
import { type ImmutableSnapshot } from "../domain/types";
import { browserEnvironment, type BrowserEnvironment } from "../persistence/browser-environment";
import { compareEnvelopes, createEnvelope, readEnvelope, STORAGE_KEY, type StoredEnvelope } from "../persistence/envelope";
import { type MigrationRegistry } from "../persistence/migrations";
import { type FoundationCommand } from "./apply-command";
import { type LifecycleCommand } from "./apply-lifecycle-command";
import { type IssueMutationResult, type MutationResult, type RepositoryOptions } from "./contracts";
import { MemoryRepository } from "./memory-repository";

export interface PersistenceDiagnostic { readonly code: string; readonly message: string; readonly rawLength?: number }
export interface PersistenceState {
  readonly status: "memory" | "persisted";
  readonly warning: string | null;
  readonly diagnostics: readonly PersistenceDiagnostic[];
}
export interface BrowserRepositoryOptions extends Omit<RepositoryOptions, "initialSnapshot"> {
  environment?: () => BrowserEnvironment;
  migrations?: MigrationRegistry;
}

/** Browser I/O wraps the memory adapter's existing atomic command boundary. */
export class BrowserRepository extends MemoryRepository {
  private readonly resolveEnvironment: () => BrowserEnvironment;
  private readonly registry?: MigrationRegistry;
  private readonly explicitWriter: boolean;
  private environment: BrowserEnvironment | null = null;
  private envelope: StoredEnvelope | null = null;
  private latestObservedTime = 0;
  private syncWarning: string | null = null;
  private ready = false;
  private disposed = false;
  private stopEvents: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private persistence: PersistenceState = deepFreeze({ status: "memory", warning: null, diagnostics: [] });

  constructor(options: BrowserRepositoryOptions = {}) {
    super(options);
    this.explicitWriter = options.writerId !== undefined;
    this.resolveEnvironment = options.environment ?? browserEnvironment;
    this.registry = options.migrations;
  }

  getPersistenceState(): PersistenceState { return this.persistence; }

  subscribe(listener: () => void): () => void {
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.disposed = true; this.listeners.clear();
    try { this.stopEvents?.(); } catch (error) { this.diagnostic("EVENT_UNSUBSCRIBE_FAILED", error); }
    this.stopEvents = null;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch (error) { this.diagnostic("SUBSCRIBER_FAILED", error); }
    }
  }

  private diagnostic(code: string, error: unknown, rawLength?: number): void {
    const message = error instanceof Error ? error.message : "Unknown persistence failure";
    this.persistence = deepFreeze({ ...this.persistence,
      diagnostics: [...this.persistence.diagnostics.slice(-9), { code, message, ...(rawLength === undefined ? {} : { rawLength }) }] });
  }

  private memoryFallback(code: string, error: unknown): void {
    this.diagnostic(code, error);
    this.persistence = deepFreeze({ ...this.persistence, status: "memory", warning: "Changes are available in memory but could not be saved in this browser." });
  }

  private parse(raw: string, code: string): StoredEnvelope | null {
    try { return readEnvelope(raw, this.registry); }
    catch (error) { this.diagnostic(code, error, raw.length); return null; }
  }

  private stored(): StoredEnvelope | null {
    if (!this.environment?.storage) return null;
    let raw: string | null;
    try { raw = this.environment.storage.getItem(STORAGE_KEY); }
    catch (error) { this.memoryFallback("STORAGE_READ_FAILED", error); return null; }
    return raw === null ? null : this.parse(raw, "INVALID_STORED_ENVELOPE");
  }

  async initialize(): Promise<ImmutableSnapshot> {
    if (this.ready) return this.read();
    if (!this.explicitWriter) this.writerId = idSchema.parse(this.idFactory());
    try { this.environment = this.resolveEnvironment(); }
    catch (error) { this.memoryFallback("BROWSER_UNAVAILABLE", error); }
    const stored = this.stored();
    if (stored) { this.adoptSnapshot(stored.snapshot); this.rememberEnvelope(stored); }
    const snapshot = this.initializeState();
    this.ready = true;
    if (!this.disposed && this.environment) {
      try { this.stopEvents = this.environment.subscribe((event) => {
        if (this.disposed) return;
        if (event.key !== STORAGE_KEY || event.newValue === null) return;
        const incoming = this.parse(event.newValue, "INVALID_EXTERNAL_ENVELOPE");
        if (!incoming) { this.notify(); return; }
        this.acceptExternal(incoming);
      }); }
      catch (error) {
        this.syncWarning = "Changes are saved, but synchronization with other tabs is unavailable.";
        this.diagnostic("EVENT_SUBSCRIBE_FAILED", error);
      }
    }
    this.persist(); this.notify();
    return snapshot;
  }

  private acceptExternal(incoming: StoredEnvelope): void {
    const current = this.read();
    if (incoming.snapshot.generation === current.generation && incoming.snapshotRevision < current.revision) return;
    if (incoming.writerId === this.writerId || (this.envelope && compareEnvelopes(incoming, this.envelope) <= 0)) return;
    this.adoptSnapshot(incoming.snapshot); this.rememberEnvelope(incoming);
    this.persistence = deepFreeze({ ...this.persistence, status: "persisted", warning: this.syncWarning });
    this.notify(); // Adoption never writes back, preventing storage-event loops.
  }

  private rememberEnvelope(envelope: StoredEnvelope): void {
    this.envelope = envelope;
    this.latestObservedTime = Math.max(this.latestObservedTime, Date.parse(envelope.updatedAt));
  }

  private beforeMutation(): void {
    this.read(); // Preserve explicit initialization and the existing domain error contract.
    const previousStatus = this.persistence;
    const stored = this.stored();
    // A tab may miss an event. Check before writing, rather than reparsing storage on reads.
    if (stored) this.acceptExternal(stored);
    else if (previousStatus !== this.persistence) this.notify();
  }

  private persist(): void {
    try {
      const clock = this.clock();
      const envelope = createEnvelope(this.read(), this.writerId, clock, this.envelope
        ? { ...this.envelope, updatedAt: new Date(this.latestObservedTime).toISOString() } : null);
      // Keep the local envelope even on quota failure so stale events cannot undo unsaved edits.
      this.rememberEnvelope(envelope);
      if (!this.environment?.storage) {
        this.memoryFallback("STORAGE_UNAVAILABLE", new Error("Browser storage is unavailable")); return;
      }
      this.environment.storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      this.persistence = deepFreeze({ ...this.persistence, status: "persisted", warning: this.syncWarning });
    } catch (error) { this.memoryFallback("STORAGE_WRITE_FAILED", error); }
  }

  protected commit(command: FoundationCommand): IssueMutationResult {
    this.beforeMutation();
    const previousStatus = this.persistence;
    const result = super.commit(command);
    if (result.transactionId || this.persistence.status === "memory") this.persist();
    const published = deepFreeze({ ...result, persistenceStatus: this.persistence.status });
    if (result.transactionId || previousStatus !== this.persistence) this.notify();
    return published;
  }

  protected commitLifecycle(command: LifecycleCommand): MutationResult {
    this.beforeMutation();
    const previousStatus = this.persistence;
    const result = super.commitLifecycle(command);
    if (result.transactionId || this.persistence.status === "memory") this.persist();
    const published = deepFreeze({ ...result, persistenceStatus: this.persistence.status });
    if (result.transactionId || previousStatus !== this.persistence) this.notify();
    return published;
  }

  protected resetState(): ImmutableSnapshot {
    this.beforeMutation();
    const snapshot = super.resetState();
    this.persist(); this.notify(); return snapshot;
  }
}
