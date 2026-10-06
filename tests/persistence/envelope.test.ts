import { describe, expect, it, vi } from "vitest";
import { createSnapshot } from "../../demo/create-snapshot";
import { compareEnvelopes, createEnvelope, readEnvelope, validateEnvelope } from "../../persistence/envelope";
import { createMigrationRegistry, migrateEnvelope, migrations } from "../../persistence/migrations";

const anchor = "2026-10-05T10:00:00.000Z";

describe("explicit schema migration registry", () => {
  it("ships no invented migrations and passes the current envelope through unchanged", () => {
    expect(migrations.size).toBe(0);
    const current = { schemaVersion: 1 };
    expect(migrateEnvelope(current)).toBe(current);
  });

  it("runs an explicit step from its source version and requires exact advancement", () => {
    const step = vi.fn((_input: unknown) => ({ schemaVersion: 1, migrated: true }));
    expect(migrateEnvelope({ schemaVersion: 0 }, createMigrationRegistry([[0, step]]))).toEqual({ schemaVersion: 1, migrated: true });
    expect(step).toHaveBeenCalledOnce();
    for (const result of [{ schemaVersion: 0 }, { schemaVersion: 2 }, {}]) {
      const registry = createMigrationRegistry([[0, (_input: unknown) => result]]);
      expect(() => migrateEnvelope({ schemaVersion: 0 }, registry)).toThrow();
    }
  });

  it("rejects invalid, duplicate, current and future migration source registrations", () => {
    const step = (input: unknown) => input;
    for (const version of [-1, 0.5, 1, 2, NaN, Infinity]) expect(() => createMigrationRegistry([[version, step]])).toThrow();
    expect(() => createMigrationRegistry([[0, step], [0, step]])).toThrow("duplicate");
  });

  it("rejects missing migration paths, invalid versions and unsupported future versions", () => {
    expect(() => migrateEnvelope({ schemaVersion: 0 })).toThrow("No migration");
    expect(() => migrateEnvelope({ schemaVersion: 2 })).toThrow("future");
    for (const input of [null, [], {}, { schemaVersion: "1" }, { schemaVersion: -1 }, { schemaVersion: Infinity }]) {
      expect(() => migrateEnvelope(input)).toThrow();
    }
  });
});

describe("validated persistence envelope", () => {
  it("roundtrips the existing normalized snapshot and freezes every nested object", () => {
    const snapshot = createSnapshot({ anchor, generation: "seed-generation" });
    const envelope = createEnvelope(snapshot, "tab-a", anchor);
    const parsed = readEnvelope(JSON.stringify(envelope));
    expect(parsed).toEqual(envelope);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.snapshot.state.issuesById)).toBe(true);
    expect(parsed.snapshot).not.toBe(snapshot);
    expect(Object.keys(parsed)).toEqual(["schemaVersion", "snapshotRevision", "updatedAt", "writerId", "snapshot"]);
  });

  it("rejects envelope/snapshot revision mismatches and timestamps before the domain state", () => {
    const snapshot = createSnapshot({ anchor, generation: "seed-generation" });
    const envelope = createEnvelope(snapshot, "tab-a", anchor);
    expect(() => validateEnvelope({ ...envelope, snapshotRevision: 1 })).toThrow("revision");
    expect(() => validateEnvelope({ ...envelope, updatedAt: "2026-10-04T10:00:00.000Z" })).toThrow("timestamp");
    expect(() => readEnvelope(JSON.stringify({ ...envelope, snapshot: { ...snapshot, schemaVersion: 2 } }))).toThrow();
  });

  it("advances only envelope time for repeated/fixed or backwards persistence clocks", () => {
    const snapshot = createSnapshot({ anchor, generation: "seed-generation" });
    const first = createEnvelope(snapshot, "tab-a", anchor);
    const second = createEnvelope(snapshot, "tab-a", "2026-10-04T10:00:00.000Z", first);
    expect(Date.parse(second.updatedAt)).toBe(Date.parse(first.updatedAt) + 1);
    expect(second.snapshot).toEqual(first.snapshot); expect(second.snapshotRevision).toBe(0);
    expect(() => createEnvelope(snapshot, "tab-a", "not-a-date", first)).toThrow();
  });

  it("compares equal revisions by time/writer, and resets by generation timestamps", () => {
    const seed = createSnapshot({ anchor, generation: "first-generation" });
    const first = createEnvelope(seed, "tab-a", anchor);
    const second = createEnvelope(seed, "tab-b", anchor);
    expect(compareEnvelopes(first, first)).toBe(0);
    expect(compareEnvelopes(second, first)).toBe(1); expect(compareEnvelopes(first, second)).toBe(-1);
    const reset = createSnapshot({ anchor, generation: "reset-generation" });
    const newerGeneration = createEnvelope(reset, "tab-a", anchor, second);
    expect(compareEnvelopes(newerGeneration, second)).toBe(1);
    expect(compareEnvelopes(second, newerGeneration)).toBe(-1);
  });
});
