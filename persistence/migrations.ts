export const CURRENT_SCHEMA_VERSION = 1;
export type Migration = (envelope: unknown) => unknown;
export type MigrationRegistry = ReadonlyMap<number, Migration>;

/** Keys name the source version; each pure step must advance exactly one version. */
export function createMigrationRegistry(entries: readonly (readonly [number, Migration])[] = []): MigrationRegistry {
  const registry = new Map<number, Migration>();
  for (const [version, migrate] of entries) {
    if (!Number.isSafeInteger(version) || version < 0 || version >= CURRENT_SCHEMA_VERSION || registry.has(version)) {
      throw new Error("Invalid or duplicate migration source version");
    }
    registry.set(version, migrate);
  }
  return registry;
}

// v1 is the first shipped format. No historical migrations are assumed.
export const migrations = createMigrationRegistry();

function versionOf(value: unknown): number {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) ||
    typeof value.schemaVersion !== "number" || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0) {
    throw new Error("Stored envelope has no valid schema version");
  }
  return value.schemaVersion;
}

export function migrateEnvelope(input: unknown, registry: MigrationRegistry = migrations): unknown {
  let value = input;
  let version = versionOf(value);
  if (version > CURRENT_SCHEMA_VERSION) throw new Error(`Unsupported future schema version ${version}`);
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = registry.get(version);
    if (!step) throw new Error(`No migration registered for schema version ${version}`);
    value = step(value);
    if (versionOf(value) !== version + 1) throw new Error("Migration must advance exactly one schema version");
    version += 1;
  }
  return value;
}
