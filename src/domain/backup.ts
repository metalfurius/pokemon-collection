import {
  createEmptyState,
  SCHEMA_VERSION,
  type CollectionState,
  type CollectionRecord,
} from "./model";

export const BACKUP_FORMAT = "pokemon-collection-backup" as const;
export const LOCAL_STATE_KEY = "pokemon-collection.local-state.v1";

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  source: "local-device";
  state: CollectionState;
}

export function createBackup(state: CollectionState, exportedAt = new Date().toISOString()): BackupEnvelope {
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, source: "local-device", state };
}

export function serializeBackup(backup: BackupEnvelope): string {
  return JSON.stringify(backup, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCollectionRecord(value: unknown): value is CollectionRecord {
  return isRecord(value)
    && typeof value.id === "string"
    && isRecord(value.catalog)
    && typeof value.catalog.catalogId === "string"
    && typeof value.catalog.name === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

export function parseBackup(serialized: string): BackupEnvelope {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || parsed.schemaVersion !== SCHEMA_VERSION || parsed.source !== "local-device") {
    throw new Error("Unsupported backup format or schema version");
  }
  if (!isRecord(parsed.state) || parsed.state.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.state.records)) {
    throw new Error("Backup state is invalid");
  }
  if (!parsed.state.records.every(isCollectionRecord)) throw new Error("Backup contains an invalid record");
  return parsed as unknown as BackupEnvelope;
}

export function createLocalStateStore(storage: Storage): {
  load(): CollectionState;
  save(state: CollectionState): void;
  clear(): void;
} {
  return {
    load() {
      const serialized = storage.getItem(LOCAL_STATE_KEY);
      if (serialized === null) return createEmptyState();
      try {
        return parseBackup(serialized).state;
      } catch {
        storage.removeItem(LOCAL_STATE_KEY);
        return createEmptyState();
      }
    },
    save(state) {
      storage.setItem(LOCAL_STATE_KEY, serializeBackup(createBackup(state)));
    },
    clear() {
      storage.removeItem(LOCAL_STATE_KEY);
    },
  };
}
