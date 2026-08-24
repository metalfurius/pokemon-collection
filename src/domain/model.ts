export const SCHEMA_VERSION = 1 as const;

export const OBJECT_TYPES = [
  "box",
  "tin",
  "single",
  "graded-card",
  "accessory",
  "custom",
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const HOLDING_STATUSES = ["owned", "opened"] as const;
export type HoldingStatus = (typeof HOLDING_STATUSES)[number];

export const WANT_PRIORITIES = ["low", "normal", "high"] as const;
export type WantPriority = (typeof WANT_PRIORITIES)[number];

export interface CatalogIdentity {
  catalogId: string;
  objectType: ObjectType;
  name: string;
  setName?: string;
  number?: string;
}

export interface Holding {
  quantity: number;
  status: HoldingStatus;
  condition?: string;
  language?: string;
  gradingCompany?: string;
  grade?: number;
  acquiredAt?: string;
}

export interface Want {
  wanted: boolean;
  priority: WantPriority;
}

export interface Acquisition {
  acquisitionId: string;
  acquiredAt: string;
  quantity: number;
  channel: "manual" | "import" | "restore";
  note?: string;
}

export interface PriceObservation {
  observationId: string;
  observedAt: string;
  amountMinor: number;
  currency: string;
  sourceLabel: string;
}

export interface CollectionRecord {
  id: string;
  catalog: CatalogIdentity;
  holding?: Holding;
  want?: Want;
  acquisitions?: readonly Acquisition[];
  notes?: string;
  priceObservations?: readonly PriceObservation[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionState {
  schemaVersion: typeof SCHEMA_VERSION;
  records: CollectionRecord[];
  updatedAt: string;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

export function makeCatalogKey(identity: {
  objectType: ObjectType;
  name: string;
  setName?: string;
  number?: string;
}): string {
  return [
    identity.objectType,
    normalizeText(identity.name),
    normalizeText(identity.setName ?? ""),
    normalizeText(identity.number ?? ""),
  ].join("|");
}

export function stableRecordId(identity: {
  objectType: ObjectType;
  name: string;
  setName?: string;
  number?: string;
}): string {
  const input = makeCatalogKey(identity);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `record_${(hash >>> 0).toString(36)}`;
}

export function createEmptyState(now = new Date().toISOString()): CollectionState {
  return { schemaVersion: SCHEMA_VERSION, records: [], updatedAt: now };
}

export function isObjectType(value: unknown): value is ObjectType {
  return typeof value === "string" && (OBJECT_TYPES as readonly string[]).includes(value);
}
