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

export const NEW_FLOW_OBJECT_TYPES = ["box", "tin", "accessory", "custom"] as const;
export type NewFlowObjectType = (typeof NEW_FLOW_OBJECT_TYPES)[number];

export const LEGACY_CARD_OBJECT_TYPES = ["single", "graded-card"] as const;

export const HOLDING_STATUSES = ["owned", "opened"] as const;
export type HoldingStatus = (typeof HOLDING_STATUSES)[number];

export const WANT_PRIORITIES = ["low", "normal", "high"] as const;
export type WantPriority = (typeof WANT_PRIORITIES)[number];

export const ROADMAP_URGENCIES = [
  "critical",
  "high",
  "medium",
  "low",
  "opportunistic",
  "wait",
  "wait-launch",
  "do-not-buy",
] as const;
export type RoadmapUrgency = (typeof ROADMAP_URGENCIES)[number];

export interface CatalogIdentity {
  catalogId: string;
  objectType: ObjectType;
  name: string;
  setName?: string;
  number?: string;
  /** Optional public marketplace identity. Older records deliberately omit it. */
  source?: "cardmarket";
  idProduct?: string;
  categorySlug?: string;
  prettySlug?: string;
  variantKey?: string;
  sourceUrl?: string;
}

export interface Holding {
  quantity: number;
  status: HoldingStatus;
  /** Explicit split for products where sealed and opened copies coexist. */
  sealedQuantity?: number;
  /** Explicit split for products where sealed and opened copies coexist. */
  openedQuantity?: number;
  condition?: string;
  language?: string;
  gradingCompany?: string;
  grade?: number;
  acquiredAt?: string;
}

export interface Want {
  wanted: boolean;
  priority: WantPriority;
  /** Legacy aggregate target. New roadmap records use the explicit targets below. */
  quantity?: number;
  targetSealedQuantity?: number;
  targetOpenedQuantity?: number;
  openGoalMode?: "required" | "optional" | "none";
  urgency?: RoadmapUrgency;
  goalLanguage?: string;
  tier?: string;
  segment?: string;
  releaseYear?: number;
  roadmapOrder?: number;
  priceCeilingMinor?: number;
  currency?: string;
  priceStatus?: string;
  priceObservedAt?: string;
  actionNote?: string;
  isRoadmap?: boolean;
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
  amountMinor: number | null;
  currency: string;
  sourceLabel: string;
  /** Required for new proposed observations; optional for legacy v1 backups. */
  sourceUrl?: string;
  sourceSnapshotDate?: string;
  language?: string;
  edition?: string;
  packaging?: string;
  condition?: string;
  sealedState?: "sealed" | "opened" | "unknown";
  priceKind?: "price-guide" | "observed-sale" | "listing" | "estimate";
  shippingTreatment?: "included" | "excluded" | "unknown" | "not-applicable";
  sampleSize?: number;
  sampleDescription?: string;
  confidence?: "high" | "medium" | "low";
  valuationStatus?: "valued" | "unvalued";
}

export interface CollectionRecord {
  id: string;
  catalog: CatalogIdentity;
  holding?: Holding;
  want?: Want;
  acquisitions?: readonly Acquisition[];
  notes?: string;
  priceObservations?: readonly PriceObservation[];
  /** Future-safe audit hints for local intake; unknown fields remain exportable. */
  intakeRefs?: readonly string[];
  createdAt: string;
  updatedAt: string;
  /** Additive optimistic-concurrency revision. Legacy records default to zero. */
  revision?: number;
}

export interface CollectionState {
  schemaVersion: typeof SCHEMA_VERSION;
  records: CollectionRecord[];
  updatedAt: string;
  /** Additive optimistic-concurrency revision. Legacy states default to zero. */
  revision?: number;
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

export function stableCardmarketRecordId(idProduct: string): string {
  const input = `cardmarket|${normalizeText(idProduct)}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `record_cm_${(hash >>> 0).toString(36)}`;
}

export function createEmptyState(now = new Date().toISOString()): CollectionState {
  return { schemaVersion: SCHEMA_VERSION, records: [], updatedAt: now, revision: 0 };
}

export function stateRevision(state: CollectionState): number {
  return Number.isInteger(state.revision) && (state.revision ?? 0) >= 0 ? state.revision ?? 0 : 0;
}

export function recordRevision(record: CollectionRecord | null | undefined): number {
  return record && Number.isInteger(record.revision) && (record.revision ?? 0) >= 0 ? record.revision ?? 0 : 0;
}

export function isObjectType(value: unknown): value is ObjectType {
  return typeof value === "string" && (OBJECT_TYPES as readonly string[]).includes(value);
}

export function isLegacyCardType(value: ObjectType): value is (typeof LEGACY_CARD_OBJECT_TYPES)[number] {
  return (LEGACY_CARD_OBJECT_TYPES as readonly string[]).includes(value);
}

export function isNewFlowObjectType(value: ObjectType): value is NewFlowObjectType {
  return (NEW_FLOW_OBJECT_TYPES as readonly string[]).includes(value);
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value : undefined;
}

export function sealedQuantity(holding: Holding | null | undefined): number {
  if (!holding) return 0;
  const explicit = nonNegativeInteger(holding.sealedQuantity);
  if (explicit !== undefined) return explicit;
  return holding.status === "owned" ? holding.quantity : 0;
}

export function openedQuantity(holding: Holding | null | undefined): number {
  if (!holding) return 0;
  const explicit = nonNegativeInteger(holding.openedQuantity);
  if (explicit !== undefined) return explicit;
  return holding.status === "opened" ? holding.quantity : 0;
}

export function totalHoldingQuantity(holding: Holding | null | undefined): number {
  return sealedQuantity(holding) + openedQuantity(holding);
}

export function holdingWithCounts(
  previous: Holding | null | undefined,
  sealed: number,
  opened: number,
): Holding | undefined {
  const safeSealed = Math.max(0, Math.trunc(sealed));
  const safeOpened = Math.max(0, Math.trunc(opened));
  const quantity = safeSealed + safeOpened;
  if (quantity === 0) return undefined;
  return {
    ...previous,
    quantity,
    status: safeSealed === 0 ? "opened" : "owned",
    sealedQuantity: safeSealed,
    openedQuantity: safeOpened,
  };
}

export function targetSealedQuantity(want: Want | null | undefined): number {
  if (!want?.wanted) return 0;
  return nonNegativeInteger(want.targetSealedQuantity) ?? nonNegativeInteger(want.quantity) ?? 1;
}

export function targetOpenedQuantity(want: Want | null | undefined): number {
  if (!want?.wanted) return 0;
  return nonNegativeInteger(want.targetOpenedQuantity) ?? 0;
}

export interface RoadmapProgress {
  sealed: number;
  opened: number;
  targetSealed: number;
  targetOpened: number;
  completedSteps: number;
  totalSteps: number;
  remainingSteps: number;
  percent: number;
  status: "complete" | "in-progress" | "not-started";
}

export function roadmapProgress(record: CollectionRecord): RoadmapProgress {
  const sealed = sealedQuantity(record.holding);
  const opened = openedQuantity(record.holding);
  const targetSealed = targetSealedQuantity(record.want);
  const targetOpened = targetOpenedQuantity(record.want);
  const requiredOpened = record.want?.openGoalMode === "optional" ? 0 : targetOpened;
  const totalSteps = targetSealed + requiredOpened;
  const completedSteps = Math.min(sealed, targetSealed) + Math.min(opened, requiredOpened);
  const remainingSteps = Math.max(0, totalSteps - completedSteps);
  return {
    sealed,
    opened,
    targetSealed,
    targetOpened,
    completedSteps,
    totalSteps,
    remainingSteps,
    percent: totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100),
    status: totalSteps > 0 && remainingSteps === 0 ? "complete" : completedSteps > 0 ? "in-progress" : "not-started",
  };
}
