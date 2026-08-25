import {
  recordRevision,
  stateRevision,
  type Acquisition,
  type CatalogIdentity,
  type CollectionRecord,
  type CollectionState,
  type Holding,
  type PriceObservation,
  type Want,
} from "./model";
import { assertExactOwner, type OwnerAccessRequest } from "../privacy/owner";

export const CHANGE_SET_FORMAT = "pokemon-collection-proposed-change-set" as const;
export const CHANGE_SET_SCHEMA_VERSION = 1 as const;
export const CHANGE_SET_JOURNAL_SCHEMA_VERSION = 1 as const;
export const CHANGE_SET_JOURNAL_KEY = "pokemon-collection.change-set-journal.v1";

export const MAX_CHANGE_SET_BYTES = 256 * 1024;
export const MAX_CHANGE_SET_OPERATIONS = 32;
export const MAX_CHANGE_SET_IDEMPOTENCY_KEY_LENGTH = 160;
export const MAX_CHANGE_SET_JOURNAL_ENTRIES = 500;
export const MAX_CHANGE_SET_JOURNAL_BYTES = 2 * 1024 * 1024;
export const MAX_CHANGE_SET_TEXT_LENGTH = 2_000;
export const MAX_CHANGE_SET_QUANTITY = 10_000;
export const MAX_CHANGE_SET_ACQUISITIONS = 100;
export const MAX_CHANGE_SET_PRICE_OBSERVATIONS = 200;

export const CHANGE_SET_OBJECT_TYPES = ["box", "tin", "accessory", "custom"] as const;
export type ChangeSetObjectType = (typeof CHANGE_SET_OBJECT_TYPES)[number];

export type SourceEvidenceKind =
  | "synthetic-fixture"
  | "workbook-preview"
  | "public-catalog-snapshot"
  | "owner-note"
  | "undo";

export interface SourceEvidence {
  kind: SourceEvidenceKind;
  reference: string;
  capturedAt: string;
  sourceUrl?: string;
  snapshotHash?: string;
  note?: string;
}

export interface ChangeSetTarget {
  recordId: string;
  /** Stable external/catalog identity; never a display-name-only target. */
  catalogId: string;
  objectType: ChangeSetObjectType;
  name: string;
  setName?: string;
  number?: string;
}

interface OperationCommon {
  operationId: string;
  target: ChangeSetTarget;
  baseRevision: number;
}

export interface CreateRecordOperation extends OperationCommon {
  kind: "create-record";
  before: null;
  after: CollectionRecord;
}

export interface DeleteRecordOperation extends OperationCommon {
  kind: "delete-record";
  before: CollectionRecord;
  after: null;
}

export interface SetHoldingOperation extends OperationCommon {
  kind: "set-holding";
  before: Holding | null;
  after: Holding | null;
}

export interface SetWantOperation extends OperationCommon {
  kind: "set-want";
  before: Want | null;
  after: Want | null;
}

export interface SetNotesOperation extends OperationCommon {
  kind: "set-notes";
  before: string | null;
  after: string | null;
}

export interface AppendAcquisitionOperation extends OperationCommon {
  kind: "append-acquisition";
  acquisition: Acquisition;
}

export interface AppendPriceObservationOperation extends OperationCommon {
  kind: "append-price-observation";
  observation: PriceObservation;
}

export type ChangeOperation =
  | CreateRecordOperation
  | DeleteRecordOperation
  | SetHoldingOperation
  | SetWantOperation
  | SetNotesOperation
  | AppendAcquisitionOperation
  | AppendPriceObservationOperation;

export interface ChangeSetBase {
  stateRevision: number;
  recordRevision: number;
  record: CollectionRecord | null;
}

export interface ChangeSetExpectedResult {
  stateRevision: number;
  recordRevision: number;
  record: CollectionRecord | null;
}

export interface ChangeSetInverse {
  safe: boolean;
  reason?: string;
  operations: ChangeOperation[];
}

export interface ProposedChangeSet {
  format: typeof CHANGE_SET_FORMAT;
  schemaVersion: typeof CHANGE_SET_SCHEMA_VERSION;
  changeSetId: string;
  ownerUid: string;
  createdAt: string;
  idempotencyKey: string;
  target: ChangeSetTarget;
  base: ChangeSetBase;
  operations: ChangeOperation[];
  expectedResult: ChangeSetExpectedResult;
  sourceEvidence: SourceEvidence;
  inverse: ChangeSetInverse | null;
  /** Detects accidental or in-transit tampering before owner review/application. */
  integrityHash: string;
}

export type ChangeSetStatus =
  | "proposed"
  | "applied"
  | "partially-applied"
  | "rejected"
  | "conflict"
  | "replayed"
  | "undone"
  | "not-undoable";

export type ChangeSetAuditEvent =
  | "proposed"
  | "applied"
  | "rejected"
  | "conflict"
  | "replayed"
  | "undone";

export interface ChangeSetAuditEntry {
  auditId: string;
  changeSetId: string;
  idempotencyKey: string;
  ownerUid: string;
  event: ChangeSetAuditEvent;
  status: ChangeSetStatus;
  occurredAt: string;
  operationIds: string[];
  before: CollectionRecord | null;
  after: CollectionRecord | null;
  undoable: boolean;
  reason?: string;
}

export interface AcceptedChangeSet {
  idempotencyKey: string;
  changeSetId: string;
  integrityHash: string;
  acceptedAt: string;
}

export interface ChangeSetJournal {
  schemaVersion: typeof CHANGE_SET_JOURNAL_SCHEMA_VERSION;
  proposals: ProposedChangeSet[];
  audit: ChangeSetAuditEntry[];
  accepted: AcceptedChangeSet[];
}

export interface ChangeSetOwnerContext extends OwnerAccessRequest {
  /** Explicitly identifies the owner whose private surface is being reviewed. */
  expectedOwnerUid: string;
}

export interface ChangeSetApplyOptions {
  mode?: "atomic" | "partial";
  approvedOperationIds?: readonly string[];
  journal?: ChangeSetJournal;
  now?: string;
}

export interface ChangeSetConflict {
  code: "stale-revision" | "ambiguous-target" | "target-mismatch" | "operation-conflict" | "replay-mismatch";
  message: string;
}

export interface ChangeSetDiff {
  operationId: string;
  kind: ChangeOperation["kind"];
  field: "record" | "holding" | "want" | "notes" | "acquisitions" | "priceObservations";
  before: unknown;
  after: unknown;
  reversible: boolean;
}

export type ChangeSetPreview =
  | {
      status: "ready";
      before: CollectionRecord | null;
      after: CollectionRecord | null;
      diffs: ChangeSetDiff[];
    }
  | {
      status: "conflict";
      conflict: ChangeSetConflict;
    };

export interface ChangeSetApplyResult {
  status: "applied" | "partially-applied" | "replayed" | "conflict";
  state: CollectionState;
  journal: ChangeSetJournal;
  appliedOperationIds: string[];
  auditEntry: ChangeSetAuditEntry;
  conflict?: ChangeSetConflict;
}

export interface ChangeSetUndoResult {
  status: "applied" | "conflict" | "not-undoable";
  state: CollectionState;
  journal: ChangeSetJournal;
  auditEntry?: ChangeSetAuditEntry;
  conflict?: ChangeSetConflict;
  reason?: string;
}

export class ChangeSetValidationError extends Error {
  readonly code = "invalid-change-set";

  constructor(message: string) {
    super(message);
    this.name = "ChangeSetValidationError";
  }
}

export class ChangeSetAuthorizationError extends Error {
  readonly code = "unauthorized-change-set";

  constructor() {
    super("Private change-set access denied");
    this.name = "ChangeSetAuthorizationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  throw new ChangeSetValidationError("Change set contains an unsupported value");
}

function digest(input: string): string {
  const seeds = [2166136261, 2654435761, 2246822519, 3266489917];
  return seeds.map((seed, lane) => {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index) + lane;
      hash = Math.imul(hash, 16777619 + lane * 2) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }).join("");
}

function integrityPayload(changeSet: ProposedChangeSet): Omit<ProposedChangeSet, "integrityHash"> {
  const { integrityHash: _integrityHash, ...payload } = changeSet;
  return payload;
}

export function changeSetIntegrityHash(changeSet: ProposedChangeSet): string {
  return digest(canonicalize(integrityPayload(changeSet)));
}

export function isChangeSetObjectType(value: unknown): value is ChangeSetObjectType {
  return typeof value === "string" && (CHANGE_SET_OBJECT_TYPES as readonly string[]).includes(value);
}

export function isReversibleOperation(operation: ChangeOperation): boolean {
  return operation.kind === "create-record" || operation.kind === "set-holding" || operation.kind === "set-want" || operation.kind === "set-notes";
}

export function targetFromRecord(record: CollectionRecord): ChangeSetTarget {
  if (!isChangeSetObjectType(record.catalog.objectType)) {
    throw new ChangeSetValidationError("Only sealed or non-single records may be changed by this workflow");
  }
  return {
    recordId: record.id,
    catalogId: record.catalog.catalogId,
    objectType: record.catalog.objectType,
    name: record.catalog.name,
    ...(record.catalog.setName ? { setName: record.catalog.setName } : {}),
    ...(record.catalog.number ? { number: record.catalog.number } : {}),
  };
}

export function makeChangeSetTarget(identity: CatalogIdentity & { recordId: string }): ChangeSetTarget {
  if (!isChangeSetObjectType(identity.objectType)) {
    throw new ChangeSetValidationError("Only sealed or non-single records may be changed by this workflow");
  }
  return {
    recordId: identity.recordId,
    catalogId: identity.catalogId,
    objectType: identity.objectType,
    name: identity.name,
    ...(identity.setName ? { setName: identity.setName } : {}),
    ...(identity.number ? { number: identity.number } : {}),
  };
}

export function createEmptyChangeSetJournal(): ChangeSetJournal {
  return { schemaVersion: CHANGE_SET_JOURNAL_SCHEMA_VERSION, proposals: [], audit: [], accepted: [] };
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ChangeSetValidationError(`${path} contains unknown field ${unknown[0]}`);
}

function assertString(value: unknown, path: string, maxLength = MAX_CHANGE_SET_TEXT_LENGTH): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new ChangeSetValidationError(`${path} must be a non-empty bounded string`);
  }
}

function assertOptionalString(value: unknown, path: string, maxLength = MAX_CHANGE_SET_TEXT_LENGTH): void {
  if (value !== undefined) assertString(value, path, maxLength);
}

function assertInteger(value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ChangeSetValidationError(`${path} must be a bounded integer`);
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertString(value, path, 80);
  if (Number.isNaN(Date.parse(value))) throw new ChangeSetValidationError(`${path} must be an ISO timestamp`);
}

function assertUrl(value: unknown, path: string): asserts value is string {
  assertString(value, path, 500);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChangeSetValidationError(`${path} must be an absolute public URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ChangeSetValidationError(`${path} must use HTTP(S)`);
}

function sameTarget(left: ChangeSetTarget, right: ChangeSetTarget): boolean {
  return canonicalize(left) === canonicalize(right);
}

function targetMatchesRecord(target: ChangeSetTarget, record: CollectionRecord): boolean {
  return target.recordId === record.id
    && target.catalogId === record.catalog.catalogId
    && target.objectType === record.catalog.objectType
    && target.name === record.catalog.name
    && (target.setName ?? undefined) === (record.catalog.setName ?? undefined)
    && (target.number ?? undefined) === (record.catalog.number ?? undefined);
}

function comparableRecord(record: CollectionRecord | null): unknown {
  if (record === null) return null;
  const copy = clone(record) as unknown as Record<string, unknown>;
  delete copy.updatedAt;
  return copy;
}

function recordsEqual(left: CollectionRecord | null, right: CollectionRecord | null, ignoreUpdatedAt = false): boolean {
  return canonicalize(ignoreUpdatedAt ? comparableRecord(left) : left) === canonicalize(ignoreUpdatedAt ? comparableRecord(right) : right);
}

function validateTarget(value: unknown, path: string): asserts value is ChangeSetTarget {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["recordId", "catalogId", "objectType", "name", "setName", "number"], path);
  assertString(value.recordId, `${path}.recordId`, 160);
  assertString(value.catalogId, `${path}.catalogId`, 240);
  if (!isChangeSetObjectType(value.objectType)) throw new ChangeSetValidationError(`${path}.objectType is unsupported`);
  assertString(value.name, `${path}.name`, 200);
  assertOptionalString(value.setName, `${path}.setName`, 200);
  assertOptionalString(value.number, `${path}.number`, 80);
}

function validateCatalog(value: unknown, path: string): asserts value is CollectionRecord["catalog"] {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["catalogId", "objectType", "name", "setName", "number"], path);
  assertString(value.catalogId, `${path}.catalogId`, 240);
  if (!isChangeSetObjectType(value.objectType)) throw new ChangeSetValidationError(`${path}.objectType is unsupported`);
  assertString(value.name, `${path}.name`, 200);
  assertOptionalString(value.setName, `${path}.setName`, 200);
  assertOptionalString(value.number, `${path}.number`, 80);
}

function validateHolding(value: unknown, path: string): asserts value is Holding {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["quantity", "status", "condition", "language", "gradingCompany", "grade", "acquiredAt"], path);
  assertInteger(value.quantity, `${path}.quantity`, 1, MAX_CHANGE_SET_QUANTITY);
  if (value.status !== "owned" && value.status !== "opened") throw new ChangeSetValidationError(`${path}.status is unsupported`);
  assertOptionalString(value.condition, `${path}.condition`, 120);
  assertOptionalString(value.language, `${path}.language`, 40);
  assertOptionalString(value.gradingCompany, `${path}.gradingCompany`, 120);
  if (value.grade !== undefined && (typeof value.grade !== "number" || value.grade < 0 || value.grade > 10)) {
    throw new ChangeSetValidationError(`${path}.grade is invalid`);
  }
  if (value.acquiredAt !== undefined) assertTimestamp(value.acquiredAt, `${path}.acquiredAt`);
}

function validateWant(value: unknown, path: string): asserts value is Want {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["wanted", "priority"], path);
  if (typeof value.wanted !== "boolean") throw new ChangeSetValidationError(`${path}.wanted is invalid`);
  if (value.priority !== "low" && value.priority !== "normal" && value.priority !== "high") throw new ChangeSetValidationError(`${path}.priority is invalid`);
}

function validateAcquisition(value: unknown, path: string): asserts value is Acquisition {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["acquisitionId", "acquiredAt", "quantity", "channel", "note"], path);
  assertString(value.acquisitionId, `${path}.acquisitionId`, 160);
  assertTimestamp(value.acquiredAt, `${path}.acquiredAt`);
  assertInteger(value.quantity, `${path}.quantity`, 1, MAX_CHANGE_SET_QUANTITY);
  if (value.channel !== "manual" && value.channel !== "import" && value.channel !== "restore") throw new ChangeSetValidationError(`${path}.channel is invalid`);
  assertOptionalString(value.note, `${path}.note`, MAX_CHANGE_SET_TEXT_LENGTH);
}

function validatePriceObservation(value: unknown, path: string, requireEvidence: boolean): asserts value is PriceObservation {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, [
    "observationId", "observedAt", "amountMinor", "currency", "sourceLabel", "sourceUrl", "sourceSnapshotDate", "language",
    "edition", "packaging", "condition", "sealedState", "priceKind", "shippingTreatment", "sampleSize", "sampleDescription",
    "confidence", "valuationStatus",
  ], path);
  assertString(value.observationId, `${path}.observationId`, 160);
  assertTimestamp(value.observedAt, `${path}.observedAt`);
  const amountMinor = value.amountMinor;
  if (amountMinor !== null && (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor < 0)) throw new ChangeSetValidationError(`${path}.amountMinor is invalid`);
  assertString(value.currency, `${path}.currency`, 3);
  if (!/^[A-Z]{3}$/.test(value.currency)) throw new ChangeSetValidationError(`${path}.currency must be an ISO 4217 code`);
  assertString(value.sourceLabel, `${path}.sourceLabel`, 160);
  assertOptionalString(value.sourceUrl, `${path}.sourceUrl`, 500);
  assertOptionalString(value.sourceSnapshotDate, `${path}.sourceSnapshotDate`, 40);
  assertOptionalString(value.language, `${path}.language`, 40);
  assertOptionalString(value.edition, `${path}.edition`, 160);
  assertOptionalString(value.packaging, `${path}.packaging`, 160);
  assertOptionalString(value.condition, `${path}.condition`, 160);
  if (value.sealedState !== undefined && value.sealedState !== "sealed" && value.sealedState !== "opened" && value.sealedState !== "unknown") throw new ChangeSetValidationError(`${path}.sealedState is invalid`);
  if (value.priceKind !== undefined && value.priceKind !== "price-guide" && value.priceKind !== "observed-sale" && value.priceKind !== "listing" && value.priceKind !== "estimate") throw new ChangeSetValidationError(`${path}.priceKind is invalid`);
  if (value.shippingTreatment !== undefined && value.shippingTreatment !== "included" && value.shippingTreatment !== "excluded" && value.shippingTreatment !== "unknown" && value.shippingTreatment !== "not-applicable") throw new ChangeSetValidationError(`${path}.shippingTreatment is invalid`);
  if (value.sampleSize !== undefined) assertInteger(value.sampleSize, `${path}.sampleSize`, 1, 10_000);
  assertOptionalString(value.sampleDescription, `${path}.sampleDescription`, 500);
  if (value.confidence !== undefined && value.confidence !== "high" && value.confidence !== "medium" && value.confidence !== "low") throw new ChangeSetValidationError(`${path}.confidence is invalid`);
  if (value.valuationStatus !== undefined && value.valuationStatus !== "valued" && value.valuationStatus !== "unvalued") throw new ChangeSetValidationError(`${path}.valuationStatus is invalid`);

  if (requireEvidence) {
    assertUrl(value.sourceUrl, `${path}.sourceUrl`);
    assertTimestamp(value.sourceSnapshotDate, `${path}.sourceSnapshotDate`);
    assertString(value.language, `${path}.language`, 40);
    assertString(value.edition, `${path}.edition`, 160);
    assertString(value.packaging, `${path}.packaging`, 160);
    if (value.sealedState !== "sealed") throw new ChangeSetValidationError(`${path}.sealedState must be sealed for this surface`);
    if (value.priceKind === undefined) throw new ChangeSetValidationError(`${path}.priceKind is required`);
    if (value.shippingTreatment === undefined) throw new ChangeSetValidationError(`${path}.shippingTreatment is required`);
    assertInteger(value.sampleSize, `${path}.sampleSize`, 1, 10_000);
    assertString(value.sampleDescription, `${path}.sampleDescription`, 500);
    if (value.confidence === undefined) throw new ChangeSetValidationError(`${path}.confidence is required`);
    if (value.valuationStatus === undefined) throw new ChangeSetValidationError(`${path}.valuationStatus is required`);
    if (value.valuationStatus === "valued" && value.amountMinor === null) throw new ChangeSetValidationError(`${path} valued observations need an amount`);
    if (value.valuationStatus === "unvalued" && value.amountMinor !== null) throw new ChangeSetValidationError(`${path} unvalued observations cannot carry an amount`);
  }
}

function validateStoredRecord(value: unknown, path: string): asserts value is CollectionRecord {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["id", "catalog", "holding", "want", "acquisitions", "notes", "priceObservations", "createdAt", "updatedAt", "revision"], path);
  assertString(value.id, `${path}.id`, 160);
  validateCatalog(value.catalog, `${path}.catalog`);
  if (value.holding !== undefined && value.holding !== null) validateHolding(value.holding, `${path}.holding`);
  if (value.want !== undefined && value.want !== null) validateWant(value.want, `${path}.want`);
  if (value.acquisitions !== undefined) {
    if (!Array.isArray(value.acquisitions) || value.acquisitions.length > MAX_CHANGE_SET_ACQUISITIONS) throw new ChangeSetValidationError(`${path}.acquisitions is oversized`);
    value.acquisitions.forEach((item, index) => validateAcquisition(item, `${path}.acquisitions[${index}]`));
  }
  if (value.notes !== undefined && value.notes !== null) assertString(value.notes, `${path}.notes`, MAX_CHANGE_SET_TEXT_LENGTH);
  if (value.priceObservations !== undefined) {
    if (!Array.isArray(value.priceObservations) || value.priceObservations.length > MAX_CHANGE_SET_PRICE_OBSERVATIONS) throw new ChangeSetValidationError(`${path}.priceObservations is oversized`);
    value.priceObservations.forEach((item, index) => validatePriceObservation(item, `${path}.priceObservations[${index}]`, false));
  }
  assertTimestamp(value.createdAt, `${path}.createdAt`);
  assertTimestamp(value.updatedAt, `${path}.updatedAt`);
  if (value.revision !== undefined) assertInteger(value.revision, `${path}.revision`, 0, Number.MAX_SAFE_INTEGER);
}

function validateSourceEvidence(value: unknown, path: string): asserts value is SourceEvidence {
  if (!isRecord(value)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(value, ["kind", "reference", "capturedAt", "sourceUrl", "snapshotHash", "note"], path);
  if (value.kind !== "synthetic-fixture" && value.kind !== "workbook-preview" && value.kind !== "public-catalog-snapshot" && value.kind !== "owner-note" && value.kind !== "undo") throw new ChangeSetValidationError(`${path}.kind is invalid`);
  assertString(value.reference, `${path}.reference`, 300);
  assertTimestamp(value.capturedAt, `${path}.capturedAt`);
  if (value.sourceUrl !== undefined) assertUrl(value.sourceUrl, `${path}.sourceUrl`);
  assertOptionalString(value.snapshotHash, `${path}.snapshotHash`, 200);
  assertOptionalString(value.note, `${path}.note`, 1_000);
  if (value.kind === "public-catalog-snapshot" && value.sourceUrl === undefined) throw new ChangeSetValidationError(`${path}.sourceUrl is required for a public snapshot`);
}

function validateOperation(operation: unknown, path: string): asserts operation is ChangeOperation {
  if (!isRecord(operation)) throw new ChangeSetValidationError(`${path} is invalid`);
  assertKeys(operation, ["kind", "operationId", "target", "baseRevision", "before", "after", "acquisition", "observation"], path);
  assertString(operation.operationId, `${path}.operationId`, 160);
  validateTarget(operation.target, `${path}.target`);
  assertInteger(operation.baseRevision, `${path}.baseRevision`, 0, Number.MAX_SAFE_INTEGER);
  switch (operation.kind) {
    case "create-record":
      if (operation.before !== null) throw new ChangeSetValidationError(`${path}.before must be null for create`);
      validateStoredRecord(operation.after, `${path}.after`);
      break;
    case "delete-record":
      validateStoredRecord(operation.before, `${path}.before`);
      if (operation.after !== null) throw new ChangeSetValidationError(`${path}.after must be null for delete`);
      break;
    case "set-holding":
      if (operation.before !== null) validateHolding(operation.before, `${path}.before`);
      if (operation.after !== null) validateHolding(operation.after, `${path}.after`);
      break;
    case "set-want":
      if (operation.before !== null) validateWant(operation.before, `${path}.before`);
      if (operation.after !== null) validateWant(operation.after, `${path}.after`);
      break;
    case "set-notes":
      if (operation.before !== null) assertString(operation.before, `${path}.before`, MAX_CHANGE_SET_TEXT_LENGTH);
      if (operation.after !== null) assertString(operation.after, `${path}.after`, MAX_CHANGE_SET_TEXT_LENGTH);
      break;
    case "append-acquisition":
      validateAcquisition(operation.acquisition, `${path}.acquisition`);
      break;
    case "append-price-observation":
      validatePriceObservation(operation.observation, `${path}.observation`, true);
      break;
    default:
      throw new ChangeSetValidationError(`${path}.kind is unsupported`);
  }
}

function assertExpectedRecordTarget(target: ChangeSetTarget, record: CollectionRecord | null, path: string): void {
  if (record === null) return;
  if (!targetMatchesRecord(target, record)) throw new ChangeSetValidationError(`${path} does not match the exact target identity`);
}

function assertOperationShape(changeSet: ProposedChangeSet): void {
  const ids = new Set<string>();
  const fields = new Set<string>();
  for (const operation of changeSet.operations) {
    if (ids.has(operation.operationId)) throw new ChangeSetValidationError("Change set contains duplicate operation IDs");
    ids.add(operation.operationId);
    if (!sameTarget(operation.target, changeSet.target)) throw new ChangeSetValidationError("Every operation must target the exact change-set identity");
    if (operation.baseRevision !== changeSet.base.recordRevision) throw new ChangeSetValidationError("Operation base revision does not match the change-set base");
    const field = operation.kind === "create-record" || operation.kind === "delete-record" ? "record" : operation.kind.replace("set-", "").replace("append-", "");
    if (operation.kind === "set-holding" || operation.kind === "set-want" || operation.kind === "set-notes" || operation.kind === "create-record" || operation.kind === "delete-record") {
      if (fields.has(field)) throw new ChangeSetValidationError(`Change set contains duplicate ${field} operations`);
      fields.add(field);
    }
    validateOperation(operation, `operations.${operation.operationId}`);
  }
  if (changeSet.operations.some((operation) => operation.kind === "create-record") && (changeSet.base.record !== null || changeSet.operations.length !== 1)) {
    throw new ChangeSetValidationError("Create-record changes must target a missing record and stand alone");
  }
  if (changeSet.operations.some((operation) => operation.kind === "delete-record") && changeSet.sourceEvidence.kind !== "undo") {
    throw new ChangeSetValidationError("Delete-record is reserved for safe undo operations");
  }
  if (changeSet.base.record === null && !changeSet.operations.some((operation) => operation.kind === "create-record")) {
    throw new ChangeSetValidationError("A missing base record can only be created");
  }
}

function applyOperation(record: CollectionRecord | null, operation: ChangeOperation): CollectionRecord | null {
  switch (operation.kind) {
    case "create-record":
      if (record !== null) throw new ChangeSetValidationError("Create operation found an existing target");
      return clone(operation.after);
    case "delete-record":
      if (record === null || !recordsEqual(record, operation.before)) throw new ChangeSetValidationError("Delete operation base does not match the target record");
      return null;
    case "set-holding":
      if (record === null || canonicalize(record.holding ?? null) !== canonicalize(operation.before)) throw new ChangeSetValidationError("Holding operation base is stale");
      return { ...clone(record), holding: operation.after === null ? undefined : clone(operation.after) };
    case "set-want":
      if (record === null || canonicalize(record.want ?? null) !== canonicalize(operation.before)) throw new ChangeSetValidationError("Want operation base is stale");
      return { ...clone(record), want: operation.after === null ? undefined : clone(operation.after) };
    case "set-notes":
      if (record === null || (record.notes ?? null) !== operation.before) throw new ChangeSetValidationError("Notes operation base is stale");
      return { ...clone(record), notes: operation.after === null ? undefined : operation.after };
    case "append-acquisition": {
      if (record === null) throw new ChangeSetValidationError("Acquisition operation requires an existing target");
      const acquisitions = [...(record.acquisitions ?? [])];
      if (acquisitions.some((item) => item.acquisitionId === operation.acquisition.acquisitionId)) throw new ChangeSetValidationError("Acquisition ID already exists");
      if (acquisitions.length >= MAX_CHANGE_SET_ACQUISITIONS) throw new ChangeSetValidationError("Acquisition history is full");
      return { ...clone(record), acquisitions: [...acquisitions, clone(operation.acquisition)] };
    }
    case "append-price-observation": {
      if (record === null) throw new ChangeSetValidationError("Price observation requires an existing target");
      const observations = [...(record.priceObservations ?? [])];
      if (observations.some((item) => item.observationId === operation.observation.observationId)) throw new ChangeSetValidationError("Price observation ID already exists");
      if (observations.length >= MAX_CHANGE_SET_PRICE_OBSERVATIONS) throw new ChangeSetValidationError("Price observation history is full");
      return { ...clone(record), priceObservations: [...observations, clone(operation.observation)] };
    }
  }
}

function applyOperations(record: CollectionRecord | null, operations: readonly ChangeOperation[]): CollectionRecord | null {
  return operations.reduce<CollectionRecord | null>((current, operation) => applyOperation(current, operation), clone(record));
}

function expectedRecordFor(record: CollectionRecord | null, revision: number): CollectionRecord | null {
  return record === null ? null : { ...record, revision, updatedAt: record.updatedAt };
}

function buildInverse(operations: readonly ChangeOperation[], expectedRevision: number): ChangeSetInverse {
  if (!operations.every(isReversibleOperation)) {
    return { safe: false, reason: "Acquisition and price-observation facts are append-only and are not automatically undone.", operations: [] };
  }
  const inverseOperations = [...operations].reverse().map((operation, index): ChangeOperation => {
    const base = { operationId: `inverse_${operation.operationId}_${index + 1}`, target: clone(operation.target), baseRevision: expectedRevision };
    switch (operation.kind) {
      case "create-record":
        return { ...base, kind: "delete-record", before: clone(operation.after), after: null };
      case "set-holding":
        return { ...base, kind: "set-holding", before: clone(operation.after), after: clone(operation.before) };
      case "set-want":
        return { ...base, kind: "set-want", before: clone(operation.after), after: clone(operation.before) };
      case "set-notes":
        return { ...base, kind: "set-notes", before: operation.after, after: operation.before };
      default:
        throw new ChangeSetValidationError("Unexpected non-reversible operation");
    }
  });
  return { safe: true, operations: inverseOperations };
}

export function validateProposedChangeSet(changeSet: unknown): asserts changeSet is ProposedChangeSet {
  if (!isRecord(changeSet)) throw new ChangeSetValidationError("Change set must be an object");
  const serialized = JSON.stringify(changeSet);
  if (serialized === undefined) throw new ChangeSetValidationError("Change set cannot be serialized");
  if (new TextEncoder().encode(serialized).byteLength > MAX_CHANGE_SET_BYTES) throw new ChangeSetValidationError("Change set exceeds the size limit");
  assertKeys(changeSet, ["format", "schemaVersion", "changeSetId", "ownerUid", "createdAt", "idempotencyKey", "target", "base", "operations", "expectedResult", "sourceEvidence", "inverse", "integrityHash"], "changeSet");
  if (changeSet.format !== CHANGE_SET_FORMAT || changeSet.schemaVersion !== CHANGE_SET_SCHEMA_VERSION) throw new ChangeSetValidationError("Unsupported change-set format or schema version");
  assertString(changeSet.changeSetId, "changeSet.changeSetId", 160);
  assertString(changeSet.ownerUid, "changeSet.ownerUid", 200);
  assertTimestamp(changeSet.createdAt, "changeSet.createdAt");
  assertString(changeSet.idempotencyKey, "changeSet.idempotencyKey", MAX_CHANGE_SET_IDEMPOTENCY_KEY_LENGTH);
  if (/\s/.test(changeSet.idempotencyKey)) throw new ChangeSetValidationError("Change-set idempotency keys cannot contain whitespace");
  validateTarget(changeSet.target, "changeSet.target");
  if (!isRecord(changeSet.base)) throw new ChangeSetValidationError("changeSet.base is invalid");
  assertKeys(changeSet.base, ["stateRevision", "recordRevision", "record"], "changeSet.base");
  assertInteger(changeSet.base.stateRevision, "changeSet.base.stateRevision");
  assertInteger(changeSet.base.recordRevision, "changeSet.base.recordRevision");
  if (changeSet.base.record !== null) {
    validateStoredRecord(changeSet.base.record, "changeSet.base.record");
    assertExpectedRecordTarget(changeSet.target, changeSet.base.record, "changeSet.base.record");
    if (recordRevision(changeSet.base.record) !== changeSet.base.recordRevision) throw new ChangeSetValidationError("Base record revision is inconsistent");
  } else if (changeSet.base.recordRevision !== 0) {
    throw new ChangeSetValidationError("A missing base record must have revision zero");
  }
  if (!Array.isArray(changeSet.operations) || changeSet.operations.length === 0 || changeSet.operations.length > MAX_CHANGE_SET_OPERATIONS) throw new ChangeSetValidationError("Change set operations are empty or oversized");
  if (!isRecord(changeSet.expectedResult)) throw new ChangeSetValidationError("changeSet.expectedResult is invalid");
  assertKeys(changeSet.expectedResult, ["stateRevision", "recordRevision", "record"], "changeSet.expectedResult");
  assertInteger(changeSet.expectedResult.stateRevision, "changeSet.expectedResult.stateRevision");
  assertInteger(changeSet.expectedResult.recordRevision, "changeSet.expectedResult.recordRevision");
  if (changeSet.expectedResult.record !== null) {
    validateStoredRecord(changeSet.expectedResult.record, "changeSet.expectedResult.record");
    assertExpectedRecordTarget(changeSet.target, changeSet.expectedResult.record, "changeSet.expectedResult.record");
    if (recordRevision(changeSet.expectedResult.record) !== changeSet.expectedResult.recordRevision) throw new ChangeSetValidationError("Expected record revision is inconsistent");
  } else if (changeSet.expectedResult.recordRevision !== 0) {
    throw new ChangeSetValidationError("A deleted expected record must have revision zero");
  }
  if (changeSet.expectedResult.stateRevision !== changeSet.base.stateRevision + 1) throw new ChangeSetValidationError("Expected state revision is inconsistent");
  validateSourceEvidence(changeSet.sourceEvidence, "changeSet.sourceEvidence");
  if (changeSet.inverse !== null) {
    if (!isRecord(changeSet.inverse)) throw new ChangeSetValidationError("changeSet.inverse is invalid");
    assertKeys(changeSet.inverse, ["safe", "reason", "operations"], "changeSet.inverse");
    if (typeof changeSet.inverse.safe !== "boolean") throw new ChangeSetValidationError("changeSet.inverse.safe is invalid");
    assertOptionalString(changeSet.inverse.reason, "changeSet.inverse.reason", 500);
    if (!Array.isArray(changeSet.inverse.operations) || changeSet.inverse.operations.length > MAX_CHANGE_SET_OPERATIONS) throw new ChangeSetValidationError("changeSet.inverse.operations is invalid");
    changeSet.inverse.operations.forEach((operation, index) => validateOperation(operation, `changeSet.inverse.operations[${index}]`));
  }
  assertString(changeSet.integrityHash, "changeSet.integrityHash", 128);
  if (changeSet.integrityHash !== changeSetIntegrityHash(changeSet as unknown as ProposedChangeSet)) throw new ChangeSetValidationError("Change set integrity check failed");
  assertOperationShape(changeSet as unknown as ProposedChangeSet);
  const computed = applyOperations(changeSet.base.record, changeSet.operations);
  const expectedRevision = computed === null ? 0 : changeSet.base.recordRevision + 1;
  const expected = expectedRecordFor(computed, expectedRevision);
  if (!recordsEqual(expected, changeSet.expectedResult.record, true)) throw new ChangeSetValidationError("Expected result does not match the declared operations");
  if (changeSet.inverse !== null && (changeSet.inverse as unknown as ChangeSetInverse).safe && (changeSet.inverse as unknown as ChangeSetInverse).operations.length !== changeSet.operations.length) throw new ChangeSetValidationError("Safe inverses must cover every operation");
}

export type ChangeOperationInput =
  | Omit<CreateRecordOperation, "target" | "baseRevision">
  | Omit<DeleteRecordOperation, "target" | "baseRevision">
  | Omit<SetHoldingOperation, "target" | "baseRevision">
  | Omit<SetWantOperation, "target" | "baseRevision">
  | Omit<SetNotesOperation, "target" | "baseRevision">
  | Omit<AppendAcquisitionOperation, "target" | "baseRevision">
  | Omit<AppendPriceObservationOperation, "target" | "baseRevision">;

export function createChangeSetTargetOperation(
  target: ChangeSetTarget,
  baseRevision: number,
  operation: ChangeOperationInput,
): ChangeOperation {
  return { ...clone(operation), target: clone(target), baseRevision } as ChangeOperation;
}

export function createProposedChangeSet(input: {
  ownerUid: string;
  current: CollectionState;
  target: ChangeSetTarget;
  operations: readonly ChangeOperation[];
  idempotencyKey: string;
  sourceEvidence: SourceEvidence;
  createdAt?: string;
  changeSetId?: string;
}): ProposedChangeSet {
  const now = input.createdAt ?? new Date().toISOString();
  const currentRecords = input.current.records.filter((record) => record.id === input.target.recordId);
  if (currentRecords.length > 1) throw new ChangeSetValidationError("Target identity is ambiguous");
  const currentRecord = currentRecords[0] ?? null;
  if (currentRecord !== null && !targetMatchesRecord(input.target, currentRecord)) throw new ChangeSetValidationError("Target identity does not match the current record");
  if (currentRecord === null && input.current.records.some((record) => record.catalog.catalogId === input.target.catalogId)) throw new ChangeSetValidationError("Catalog identity is ambiguous");
  const baseRevision = recordRevision(currentRecord);
  const preparedOperations = input.operations.map((operation) => ({ ...clone(operation), target: clone(input.target), baseRevision }) as ChangeOperation);
  const computed = applyOperations(currentRecord, preparedOperations);
  const expectedRevision = computed === null ? 0 : baseRevision + 1;
  const expectedRecord = computed === null ? null : { ...computed, revision: expectedRevision, updatedAt: now };
  const changeSetWithoutIntegrity: Omit<ProposedChangeSet, "integrityHash"> = {
    format: CHANGE_SET_FORMAT,
    schemaVersion: CHANGE_SET_SCHEMA_VERSION,
    changeSetId: input.changeSetId ?? `changeset_${digest(`${input.ownerUid}|${input.idempotencyKey}|${now}`).slice(0, 20)}`,
    ownerUid: input.ownerUid,
    createdAt: now,
    idempotencyKey: input.idempotencyKey,
    target: clone(input.target),
    base: { stateRevision: stateRevision(input.current), recordRevision: baseRevision, record: clone(currentRecord) },
    operations: preparedOperations,
    expectedResult: { stateRevision: stateRevision(input.current) + 1, recordRevision: expectedRevision, record: expectedRecord },
    sourceEvidence: clone(input.sourceEvidence),
    inverse: null,
  };
  const inverse = buildInverse(preparedOperations, expectedRevision);
  const changeSet: ProposedChangeSet = { ...changeSetWithoutIntegrity, inverse, integrityHash: "" };
  changeSet.integrityHash = changeSetIntegrityHash(changeSet);
  validateProposedChangeSet(changeSet);
  return changeSet;
}

export function setHoldingOperation(target: ChangeSetTarget, baseRevision: number, before: Holding | null, after: Holding | null, operationId = "holding"): SetHoldingOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "set-holding", operationId, before, after }) as SetHoldingOperation;
}

export function setWantOperation(target: ChangeSetTarget, baseRevision: number, before: Want | null, after: Want | null, operationId = "want"): SetWantOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "set-want", operationId, before, after }) as SetWantOperation;
}

export function setNotesOperation(target: ChangeSetTarget, baseRevision: number, before: string | null, after: string | null, operationId = "notes"): SetNotesOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "set-notes", operationId, before, after }) as SetNotesOperation;
}

export function appendAcquisitionOperation(target: ChangeSetTarget, baseRevision: number, acquisition: Acquisition, operationId = "acquisition"): AppendAcquisitionOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "append-acquisition", operationId, acquisition }) as AppendAcquisitionOperation;
}

export function appendPriceObservationOperation(target: ChangeSetTarget, baseRevision: number, observation: PriceObservation, operationId = "price-observation"): AppendPriceObservationOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "append-price-observation", operationId, observation }) as AppendPriceObservationOperation;
}

export function createRecordOperation(target: ChangeSetTarget, baseRevision: number, record: CollectionRecord, operationId = "create-record"): CreateRecordOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "create-record", operationId, before: null, after: record }) as CreateRecordOperation;
}

export function deleteRecordOperation(target: ChangeSetTarget, baseRevision: number, record: CollectionRecord, operationId = "delete-record"): DeleteRecordOperation {
  return createChangeSetTargetOperation(target, baseRevision, { kind: "delete-record", operationId, before: record, after: null }) as DeleteRecordOperation;
}

function conflict(code: ChangeSetConflict["code"], message: string): ChangeSetConflict {
  return { code, message };
}

function assertOwner(context: ChangeSetOwnerContext, ownerUid: string): void {
  try {
    assertExactOwner({ authenticatedUid: context.authenticatedUid, expectedOwnerUid: context.expectedOwnerUid });
  } catch {
    throw new ChangeSetAuthorizationError();
  }
  if (ownerUid !== context.expectedOwnerUid) throw new ChangeSetAuthorizationError();
}

function resolveCurrentTarget(state: CollectionState, changeSet: ProposedChangeSet): { record: CollectionRecord | null; conflict?: ChangeSetConflict } {
  const byId = state.records.filter((record) => record.id === changeSet.target.recordId);
  if (byId.length > 1) return { record: null, conflict: conflict("ambiguous-target", "More than one record has the exact target ID") };
  const byCatalog = state.records.filter((record) => record.catalog.catalogId === changeSet.target.catalogId);
  if (byId.length === 0 && byCatalog.length > 0) return { record: null, conflict: conflict("ambiguous-target", "Catalog identity resolves to another record") };
  const record = byId[0] ?? null;
  if (record !== null && !targetMatchesRecord(changeSet.target, record)) return { record: null, conflict: conflict("target-mismatch", "The exact target identity no longer matches") };
  if (stateRevision(state) !== changeSet.base.stateRevision) return { record, conflict: conflict("stale-revision", "The collection changed after this proposal was prepared") };
  if (record === null && changeSet.base.record !== null) return { record, conflict: conflict("stale-revision", "The proposed base record no longer exists") };
  if (record !== null && changeSet.base.record === null) return { record, conflict: conflict("stale-revision", "The proposed new record already exists") };
  if (recordRevision(record) !== changeSet.base.recordRevision) return { record, conflict: conflict("stale-revision", "The target record revision is stale") };
  if (!recordsEqual(record, changeSet.base.record)) return { record, conflict: conflict("stale-revision", "The target record no longer matches its reviewed base") };
  return { record };
}

function diffForOperation(operation: ChangeOperation): ChangeSetDiff {
  switch (operation.kind) {
    case "create-record": return { operationId: operation.operationId, kind: operation.kind, field: "record", before: null, after: operation.after, reversible: true };
    case "delete-record": return { operationId: operation.operationId, kind: operation.kind, field: "record", before: operation.before, after: null, reversible: true };
    case "set-holding": return { operationId: operation.operationId, kind: operation.kind, field: "holding", before: operation.before, after: operation.after, reversible: true };
    case "set-want": return { operationId: operation.operationId, kind: operation.kind, field: "want", before: operation.before, after: operation.after, reversible: true };
    case "set-notes": return { operationId: operation.operationId, kind: operation.kind, field: "notes", before: operation.before, after: operation.after, reversible: true };
    case "append-acquisition": return { operationId: operation.operationId, kind: operation.kind, field: "acquisitions", before: null, after: operation.acquisition, reversible: false };
    case "append-price-observation": return { operationId: operation.operationId, kind: operation.kind, field: "priceObservations", before: null, after: operation.observation, reversible: false };
  }
}

export function previewProposedChangeSet(state: CollectionState, changeSet: ProposedChangeSet, context: ChangeSetOwnerContext): ChangeSetPreview {
  assertOwner(context, changeSet.ownerUid);
  validateProposedChangeSet(changeSet);
  const current = resolveCurrentTarget(state, changeSet);
  if (current.conflict) return { status: "conflict", conflict: current.conflict };
  try {
    const after = applyOperations(current.record, changeSet.operations);
    return { status: "ready", before: current.record, after, diffs: changeSet.operations.map(diffForOperation) };
  } catch (error) {
    return { status: "conflict", conflict: conflict("operation-conflict", error instanceof Error ? error.message : "Operation base is stale") };
  }
}

function addAudit(journal: ChangeSetJournal, entry: Omit<ChangeSetAuditEntry, "auditId">): { journal: ChangeSetJournal; auditEntry: ChangeSetAuditEntry } {
  if (journal.audit.length >= MAX_CHANGE_SET_JOURNAL_ENTRIES) throw new ChangeSetValidationError("Change-set audit history is full");
  const auditEntry: ChangeSetAuditEntry = { ...clone(entry), auditId: `audit_${digest(`${entry.changeSetId}|${entry.occurredAt}|${journal.audit.length}`).slice(0, 20)}` };
  return { journal: { ...journal, audit: [...journal.audit, auditEntry] }, auditEntry };
}

function ensureProposal(journal: ChangeSetJournal, changeSet: ProposedChangeSet, now: string): ChangeSetJournal {
  if (journal.proposals.some((proposal) => proposal.changeSetId === changeSet.changeSetId)) return journal;
  if (journal.proposals.length >= MAX_CHANGE_SET_JOURNAL_ENTRIES) throw new ChangeSetValidationError("Change-set proposal history is full");
  const withProposal = { ...journal, proposals: [...journal.proposals, clone(changeSet)] };
  return addAudit(withProposal, {
    changeSetId: changeSet.changeSetId,
    idempotencyKey: changeSet.idempotencyKey,
    ownerUid: changeSet.ownerUid,
    event: "proposed",
    status: "proposed",
    occurredAt: now,
    operationIds: changeSet.operations.map((operation) => operation.operationId),
    before: clone(changeSet.base.record),
    after: clone(changeSet.expectedResult.record),
    undoable: changeSet.inverse?.safe ?? false,
  }).journal;
}

export function validateChangeSetJournal(journal: unknown): asserts journal is ChangeSetJournal {
  if (!isRecord(journal)) throw new ChangeSetValidationError("Change-set journal is invalid");
  const serialized = JSON.stringify(journal);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_CHANGE_SET_JOURNAL_BYTES) throw new ChangeSetValidationError("Change-set journal exceeds the size limit");
  assertKeys(journal, ["schemaVersion", "proposals", "audit", "accepted"], "journal");
  if (journal.schemaVersion !== CHANGE_SET_JOURNAL_SCHEMA_VERSION) throw new ChangeSetValidationError("Unsupported change-set journal schema version");
  if (!Array.isArray(journal.proposals) || journal.proposals.length > MAX_CHANGE_SET_JOURNAL_ENTRIES) throw new ChangeSetValidationError("Journal proposals are invalid or oversized");
  journal.proposals.forEach((proposal) => validateProposedChangeSet(proposal));
  if (!Array.isArray(journal.audit) || journal.audit.length > MAX_CHANGE_SET_JOURNAL_ENTRIES) throw new ChangeSetValidationError("Journal audit is invalid or oversized");
  journal.audit.forEach((entry, index) => {
    if (!isRecord(entry)) throw new ChangeSetValidationError(`journal.audit[${index}] is invalid`);
    assertKeys(entry, ["auditId", "changeSetId", "idempotencyKey", "ownerUid", "event", "status", "occurredAt", "operationIds", "before", "after", "undoable", "reason"], `journal.audit[${index}]`);
    assertString(entry.auditId, `journal.audit[${index}].auditId`, 160);
    assertString(entry.changeSetId, `journal.audit[${index}].changeSetId`, 160);
    assertString(entry.idempotencyKey, `journal.audit[${index}].idempotencyKey`, MAX_CHANGE_SET_IDEMPOTENCY_KEY_LENGTH);
    assertString(entry.ownerUid, `journal.audit[${index}].ownerUid`, 200);
    if (entry.event !== "proposed" && entry.event !== "applied" && entry.event !== "rejected" && entry.event !== "conflict" && entry.event !== "replayed" && entry.event !== "undone") throw new ChangeSetValidationError(`journal.audit[${index}].event is invalid`);
    if (entry.status !== "proposed" && entry.status !== "applied" && entry.status !== "partially-applied" && entry.status !== "rejected" && entry.status !== "conflict" && entry.status !== "replayed" && entry.status !== "undone" && entry.status !== "not-undoable") throw new ChangeSetValidationError(`journal.audit[${index}].status is invalid`);
    assertTimestamp(entry.occurredAt, `journal.audit[${index}].occurredAt`);
    if (!Array.isArray(entry.operationIds) || entry.operationIds.length > MAX_CHANGE_SET_OPERATIONS) throw new ChangeSetValidationError(`journal.audit[${index}].operationIds is invalid`);
    entry.operationIds.forEach((operationId, operationIndex) => assertString(operationId, `journal.audit[${index}].operationIds[${operationIndex}]`, 160));
    if (entry.before !== null) validateStoredRecord(entry.before, `journal.audit[${index}].before`);
    if (entry.after !== null) validateStoredRecord(entry.after, `journal.audit[${index}].after`);
    if (typeof entry.undoable !== "boolean") throw new ChangeSetValidationError(`journal.audit[${index}].undoable is invalid`);
    assertOptionalString(entry.reason, `journal.audit[${index}].reason`, 500);
  });
  if (!Array.isArray(journal.accepted) || journal.accepted.length > MAX_CHANGE_SET_JOURNAL_ENTRIES) throw new ChangeSetValidationError("Journal accepted entries are invalid or oversized");
  journal.accepted.forEach((entry, index) => {
    if (!isRecord(entry)) throw new ChangeSetValidationError(`journal.accepted[${index}] is invalid`);
    assertKeys(entry, ["idempotencyKey", "changeSetId", "integrityHash", "acceptedAt"], `journal.accepted[${index}]`);
    assertString(entry.idempotencyKey, `journal.accepted[${index}].idempotencyKey`, MAX_CHANGE_SET_IDEMPOTENCY_KEY_LENGTH);
    assertString(entry.changeSetId, `journal.accepted[${index}].changeSetId`, 160);
    assertString(entry.integrityHash, `journal.accepted[${index}].integrityHash`, 128);
    assertTimestamp(entry.acceptedAt, `journal.accepted[${index}].acceptedAt`);
  });
}

export function proposeChangeSet(journal: ChangeSetJournal, changeSet: ProposedChangeSet, context: ChangeSetOwnerContext, now = new Date().toISOString()): ChangeSetJournal {
  assertOwner(context, changeSet.ownerUid);
  validateProposedChangeSet(changeSet);
  const existing = journal.proposals.find((proposal) => proposal.idempotencyKey === changeSet.idempotencyKey);
  if (existing) {
    if (existing.integrityHash !== changeSet.integrityHash) throw new ChangeSetValidationError("Idempotency key is already bound to another change set");
    return journal;
  }
  return ensureProposal(journal, changeSet, now);
}

function conflictResult(state: CollectionState, journal: ChangeSetJournal, changeSet: ProposedChangeSet, context: ChangeSetOwnerContext, found: ChangeSetConflict, now: string, status: "conflict" = "conflict"): ChangeSetApplyResult {
  const withProposal = ensureProposal(journal, changeSet, now);
  const added = addAudit(withProposal, {
    changeSetId: changeSet.changeSetId,
    idempotencyKey: changeSet.idempotencyKey,
    ownerUid: context.expectedOwnerUid,
    event: "conflict",
    status,
    occurredAt: now,
    operationIds: [],
    before: clone(changeSet.base.record),
    after: clone(changeSet.expectedResult.record),
    undoable: false,
    reason: found.message,
  });
  return { status: "conflict", state, journal: added.journal, appliedOperationIds: [], auditEntry: added.auditEntry, conflict: found };
}

export function applyProposedChangeSet(state: CollectionState, changeSet: ProposedChangeSet, context: ChangeSetOwnerContext, options: ChangeSetApplyOptions = {}): ChangeSetApplyResult {
  assertOwner(context, changeSet.ownerUid);
  validateProposedChangeSet(changeSet);
  const now = options.now ?? new Date().toISOString();
  const journal = options.journal ?? createEmptyChangeSetJournal();
  const accepted = journal.accepted.find((entry) => entry.idempotencyKey === changeSet.idempotencyKey);
  if (accepted) {
    if (accepted.integrityHash !== changeSet.integrityHash || accepted.changeSetId !== changeSet.changeSetId) {
      return conflictResult(state, journal, changeSet, context, conflict("replay-mismatch", "Idempotency key is bound to a different accepted change set"), now);
    }
    const withProposal = ensureProposal(journal, changeSet, now);
    const added = addAudit(withProposal, {
      changeSetId: changeSet.changeSetId,
      idempotencyKey: changeSet.idempotencyKey,
      ownerUid: context.expectedOwnerUid,
      event: "replayed",
      status: "replayed",
      occurredAt: now,
      operationIds: changeSet.operations.map((operation) => operation.operationId),
      before: clone(changeSet.base.record),
      after: clone(changeSet.expectedResult.record),
      undoable: false,
      reason: "The idempotency key was already accepted; no mutation was performed.",
    });
    return { status: "replayed", state, journal: added.journal, appliedOperationIds: [], auditEntry: added.auditEntry };
  }
  const resolved = resolveCurrentTarget(state, changeSet);
  if (resolved.conflict) return conflictResult(state, journal, changeSet, context, resolved.conflict, now);
  const mode = options.mode ?? "atomic";
  const approved = options.approvedOperationIds === undefined
    ? changeSet.operations.map((operation) => operation.operationId)
    : [...options.approvedOperationIds];
  const operationIds = new Set(changeSet.operations.map((operation) => operation.operationId));
  if (approved.length === 0 || approved.some((operationId) => !operationIds.has(operationId)) || new Set(approved).size !== approved.length) {
    throw new ChangeSetValidationError("Approved operation selection is invalid");
  }
  if (mode === "atomic" && approved.length !== changeSet.operations.length) throw new ChangeSetValidationError("Atomic approval must select every operation");
  const selected = changeSet.operations.filter((operation) => approved.includes(operation.operationId));
  try {
    const computed = applyOperations(resolved.record, selected);
    const expected = applyOperations(changeSet.base.record, selected);
    const expectedRevision = expected === null ? 0 : changeSet.base.recordRevision + 1;
    const computedWithRevision = computed === null ? null : { ...computed, revision: expectedRevision, updatedAt: now };
    const expectedWithRevision = expected === null ? null : { ...expected, revision: expectedRevision, updatedAt: now };
    if (!recordsEqual(computedWithRevision, expectedWithRevision, true)) return conflictResult(state, journal, changeSet, context, conflict("operation-conflict", "Approved operations no longer match their reviewed before values"), now);
    if (mode === "atomic" && !recordsEqual(expectedWithRevision, changeSet.expectedResult.record, true)) throw new ChangeSetValidationError("Atomic result differs from the declared expected result");
    const nextRecords = state.records.filter((record) => record.id !== changeSet.target.recordId);
    if (computedWithRevision !== null) nextRecords.push(computedWithRevision);
    const nextState: CollectionState = { ...state, records: nextRecords, revision: stateRevision(state) + 1, updatedAt: now };
    const withProposal = ensureProposal(journal, changeSet, now);
    const status = approved.length === changeSet.operations.length ? "applied" : "partially-applied";
    const added = addAudit(withProposal, {
      changeSetId: changeSet.changeSetId,
      idempotencyKey: changeSet.idempotencyKey,
      ownerUid: context.expectedOwnerUid,
      event: "applied",
      status,
      occurredAt: now,
      operationIds: approved,
      before: clone(resolved.record),
      after: clone(computedWithRevision),
      undoable: selected.every(isReversibleOperation),
      reason: mode === "partial" && approved.length !== changeSet.operations.length ? "Selective approval applied explicitly." : undefined,
    });
    const nextJournal: ChangeSetJournal = {
      ...added.journal,
      accepted: [...added.journal.accepted, { idempotencyKey: changeSet.idempotencyKey, changeSetId: changeSet.changeSetId, integrityHash: changeSet.integrityHash, acceptedAt: now }],
    };
    return { status, state: nextState, journal: nextJournal, appliedOperationIds: approved, auditEntry: added.auditEntry };
  } catch (error) {
    if (error instanceof ChangeSetValidationError) return conflictResult(state, journal, changeSet, context, conflict("operation-conflict", error.message), now);
    throw error;
  }
}

export function rejectProposedChangeSet(journal: ChangeSetJournal, changeSet: ProposedChangeSet, context: ChangeSetOwnerContext, now = new Date().toISOString()): ChangeSetJournal {
  assertOwner(context, changeSet.ownerUid);
  validateProposedChangeSet(changeSet);
  const withProposal = ensureProposal(journal, changeSet, now);
  return addAudit(withProposal, {
    changeSetId: changeSet.changeSetId,
    idempotencyKey: changeSet.idempotencyKey,
    ownerUid: context.expectedOwnerUid,
    event: "rejected",
    status: "rejected",
    occurredAt: now,
    operationIds: [],
    before: clone(changeSet.base.record),
    after: clone(changeSet.expectedResult.record),
    undoable: false,
    reason: "Owner rejected the proposed change set.",
  }).journal;
}

function inverseOperationForCurrent(operation: ChangeOperation, current: CollectionRecord | null, baseRevision: number, index: number): ChangeOperation {
  const target = clone(operation.target);
  const common = { operationId: `undo_${operation.operationId}_${index + 1}`, target, baseRevision };
  switch (operation.kind) {
    case "create-record":
      if (current === null) throw new ChangeSetValidationError("Undo target is missing");
      return { ...common, kind: "delete-record", before: clone(current), after: null };
    case "set-holding":
      if (current === null) throw new ChangeSetValidationError("Undo target is missing");
      return { ...common, kind: "set-holding", before: clone(current.holding ?? null), after: clone(operation.before) };
    case "set-want":
      if (current === null) throw new ChangeSetValidationError("Undo target is missing");
      return { ...common, kind: "set-want", before: clone(current.want ?? null), after: clone(operation.before) };
    case "set-notes":
      if (current === null) throw new ChangeSetValidationError("Undo target is missing");
      return { ...common, kind: "set-notes", before: current.notes ?? null, after: operation.before };
    default:
      throw new ChangeSetValidationError("This operation has no safe inverse");
  }
}

export function undoAppliedChangeSet(state: CollectionState, journal: ChangeSetJournal, changeSetId: string, context: ChangeSetOwnerContext, now = new Date().toISOString()): ChangeSetUndoResult {
  const proposal = journal.proposals.find((candidate) => candidate.changeSetId === changeSetId);
  if (proposal === undefined) throw new ChangeSetValidationError("Proposed change set was not found");
  assertOwner(context, proposal.ownerUid);
  validateProposedChangeSet(proposal);
  const applied = [...journal.audit].reverse().find((entry) => entry.changeSetId === changeSetId && entry.event === "applied");
  if (applied === undefined) return { status: "not-undoable", state, journal, reason: "Only an accepted change set can be undone." };
  if (!applied.undoable) return { status: "not-undoable", state, journal, reason: "This change set contains append-only acquisition or price evidence." };
  const currentMatches = state.records.filter((record) => record.id === proposal.target.recordId);
  if (currentMatches.length > 1) {
    return { status: "conflict", state, journal, conflict: conflict("ambiguous-target", "The undo target is ambiguous.") };
  }
  const currentRecord = currentMatches[0] ?? null;
  if (currentRecord !== null && !targetMatchesRecord(proposal.target, currentRecord)) {
    return { status: "conflict", state, journal, conflict: conflict("target-mismatch", "The undo target identity changed.") };
  }
  if (currentRecord === null && applied.after !== null) {
    return { status: "conflict", state, journal, conflict: conflict("stale-revision", "The target changed before undo could be applied.") };
  }
  if (!recordsEqual(currentRecord, applied.after, true)) {
    return { status: "conflict", state, journal, conflict: conflict("stale-revision", "The target changed after the approved set; undo was not applied.") };
  }
  const appliedIds = new Set(applied.operationIds);
  const inverseOperations = proposal.operations
    .filter((operation) => appliedIds.has(operation.operationId))
    .reverse()
    .map((operation, index) => inverseOperationForCurrent(operation, currentRecord, recordRevision(currentRecord), index));
  const inverseSet = createProposedChangeSet({
    ownerUid: proposal.ownerUid,
    current: state,
    target: proposal.target,
    operations: inverseOperations,
    idempotencyKey: `undo-${proposal.changeSetId}-${applied.auditId}`,
    sourceEvidence: { kind: "undo", reference: proposal.changeSetId, capturedAt: now, note: "Safe inverse generated from the owner-approved audit entry." },
    createdAt: now,
    changeSetId: `${proposal.changeSetId}-undo-${applied.auditId}`,
  });
  const proposedJournal = proposeChangeSet(journal, inverseSet, context, now);
  const result = applyProposedChangeSet(state, inverseSet, context, { journal: proposedJournal, now });
  if (result.status === "conflict") return { status: "conflict", state, journal: result.journal, conflict: result.conflict };
  const undoneAudit = addAudit(result.journal, {
    changeSetId: proposal.changeSetId,
    idempotencyKey: proposal.idempotencyKey,
    ownerUid: proposal.ownerUid,
    event: "undone",
    status: "undone",
    occurredAt: now,
    operationIds: applied.operationIds,
    before: clone(applied.after),
    after: clone(result.state.records.find((record) => record.id === proposal.target.recordId) ?? null),
    undoable: false,
    reason: `Safe inverse ${inverseSet.changeSetId} applied.`,
  });
  return { status: "applied", state: result.state, journal: undoneAudit.journal, auditEntry: undoneAudit.auditEntry };
}

export function createChangeSetJournalStore(storage: Storage): {
  load(): ChangeSetJournal;
  save(journal: ChangeSetJournal): void;
  clear(): void;
} {
  return {
    load() {
      const serialized = storage.getItem(CHANGE_SET_JOURNAL_KEY);
      if (serialized === null) return createEmptyChangeSetJournal();
      try {
        const parsed: unknown = JSON.parse(serialized);
        validateChangeSetJournal(parsed);
        return parsed;
      } catch {
        storage.removeItem(CHANGE_SET_JOURNAL_KEY);
        return createEmptyChangeSetJournal();
      }
    },
    save(journal) {
      validateChangeSetJournal(journal);
      storage.setItem(CHANGE_SET_JOURNAL_KEY, JSON.stringify(journal));
    },
    clear() {
      storage.removeItem(CHANGE_SET_JOURNAL_KEY);
    },
  };
}
