import { z } from "zod";
import { deepFreeze, validateSnapshot } from "../domain/invariants";
import { idSchema, snapshotSchema, timestampSchema } from "../domain/schema";
import { type Id, type ImmutableSnapshot, type ISODateTime } from "../domain/types";
import { migrateEnvelope, type MigrationRegistry } from "./migrations";

export const STORAGE_KEY = "nexus:demo:v1";
export interface StoredEnvelope {
  readonly schemaVersion: 1;
  readonly snapshotRevision: number;
  readonly updatedAt: ISODateTime;
  readonly writerId: Id;
  readonly snapshot: ImmutableSnapshot;
}
const envelopeSchema = z.object({ schemaVersion: z.literal(1), snapshotRevision: z.number().int().nonnegative().safe(),
  updatedAt: timestampSchema, writerId: idSchema, snapshot: snapshotSchema }).strict();

export function validateEnvelope(input: unknown): StoredEnvelope {
  const envelope = envelopeSchema.parse(input);
  const snapshot = validateSnapshot(envelope.snapshot);
  if (envelope.snapshotRevision !== snapshot.revision) throw new Error("Envelope revision differs from snapshot revision");
  const times = [snapshot.scenarioAnchor, ...Object.values(snapshot.state.issuesById).map((entity) => entity.updatedAt),
    ...Object.values(snapshot.state.commentsById).map((entity) => entity.updatedAt),
    ...Object.values(snapshot.state.sprintsById).map((entity) => entity.updatedAt),
    ...Object.values(snapshot.state.activitiesById).map((event) => event.occurredAt)];
  if (Date.parse(envelope.updatedAt) < Math.max(...times.map(Date.parse))) throw new Error("Envelope timestamp predates its snapshot");
  return deepFreeze({ ...envelope, snapshot });
}

export function readEnvelope(raw: string, registry?: MigrationRegistry): StoredEnvelope {
  const parsed: unknown = JSON.parse(raw);
  return validateEnvelope(migrateEnvelope(parsed, registry));
}

/** A reset starts a new generation at revision zero. Its timestamp orders generations. */
export function compareEnvelopes(a: StoredEnvelope, b: StoredEnvelope): number {
  if (a.snapshot.generation === b.snapshot.generation && a.snapshotRevision !== b.snapshotRevision) {
    return a.snapshotRevision > b.snapshotRevision ? 1 : -1;
  }
  const timeDifference = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (timeDifference) return timeDifference > 0 ? 1 : -1;
  if (a.writerId !== b.writerId) return a.writerId > b.writerId ? 1 : -1;
  if (a.snapshot.generation !== b.snapshot.generation) return a.snapshot.generation > b.snapshot.generation ? 1 : -1;
  return 0;
}

export function createEnvelope(snapshot: ImmutableSnapshot, writerId: Id, now: ISODateTime, previous?: StoredEnvelope | null): StoredEnvelope {
  timestampSchema.parse(now);
  // Persistence metadata advances even with a fixed injected clock; domain dates stay untouched.
  const updatedAt = new Date(Math.max(Date.parse(now), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  return validateEnvelope({ schemaVersion: 1, snapshotRevision: snapshot.revision, updatedAt, writerId, snapshot });
}
