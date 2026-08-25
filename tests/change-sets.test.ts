import { describe, expect, it } from "vitest";
import {
  ChangeSetAuthorizationError,
  ChangeSetValidationError,
  appendPriceObservationOperation,
  appendAcquisitionOperation,
  applyProposedChangeSet,
  changeSetIntegrityHash,
  createEmptyChangeSetJournal,
  createProposedChangeSet,
  createRecordOperation,
  createChangeSetJournalStore,
  makeChangeSetTarget,
  previewProposedChangeSet,
  proposeChangeSet,
  setHoldingOperation,
  setNotesOperation,
  setWantOperation,
  targetFromRecord,
  undoAppliedChangeSet,
  type ChangeSetOwnerContext,
  type ProposedChangeSet,
} from "../src/domain/change-sets";
import { createBackup, parseBackup, serializeBackup } from "../src/domain/backup";
import { createEmptyState, type CollectionRecord } from "../src/domain/model";

const OWNER: ChangeSetOwnerContext = { authenticatedUid: "synthetic-owner", expectedOwnerUid: "synthetic-owner" };

function tinRecord(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: "record_sunlit_tin",
    catalog: { catalogId: "synthetic-catalog-sunlit-tin", objectType: "tin", name: "Sunlit Tin", setName: "Field Notes" },
    holding: { quantity: 1, status: "owned" },
    want: { wanted: true, priority: "normal" },
    notes: "Synthetic note",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stateWith(record = tinRecord()) {
  return { ...createEmptyState("2026-01-01T00:00:00.000Z"), records: [record] };
}

function evidence() {
  return { kind: "synthetic-fixture" as const, reference: "synthetic-change-set-fixture", capturedAt: "2026-01-02T00:00:00.000Z" };
}

describe("owner-reviewed change sets", () => {
  it("creates an exact-target diff, applies selectively, rejects replay duplication, and safely undoes reversible fields", () => {
    const state = stateWith();
    const record = state.records[0]!;
    const target = targetFromRecord(record);
    const changeSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [
        setHoldingOperation(target, 0, record.holding ?? null, { quantity: 2, status: "owned" }, "holding-1"),
        setWantOperation(target, 0, record.want ?? null, { wanted: false, priority: "normal" }, "want-1"),
        setNotesOperation(target, 0, record.notes ?? null, "Reviewed synthetic note", "notes-1"),
      ],
      idempotencyKey: "synthetic-change-001",
      sourceEvidence: evidence(),
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const proposed = proposeChangeSet(createEmptyChangeSetJournal(), changeSet, OWNER, "2026-01-02T00:00:00.000Z");
    expect(previewProposedChangeSet(state, changeSet, OWNER)).toMatchObject({ status: "ready", diffs: [{ field: "holding" }, { field: "want" }, { field: "notes" }] });

    const partial = applyProposedChangeSet(state, changeSet, OWNER, {
      journal: proposed,
      mode: "partial",
      approvedOperationIds: ["holding-1", "notes-1"],
      now: "2026-01-03T00:00:00.000Z",
    });
    expect(partial.status).toBe("partially-applied");
    expect(partial.state.records[0]?.holding?.quantity).toBe(2);
    expect(partial.state.records[0]?.want?.wanted).toBe(true);
    expect(partial.state.records[0]?.notes).toBe("Reviewed synthetic note");
    expect(partial.auditEntry.undoable).toBe(true);
    expect(() => applyProposedChangeSet(state, changeSet, OWNER, { mode: "atomic", approvedOperationIds: ["holding-1"] })).toThrow(/Atomic/);

    const replay = applyProposedChangeSet(partial.state, changeSet, OWNER, { journal: partial.journal, now: "2026-01-04T00:00:00.000Z" });
    expect(replay.status).toBe("replayed");
    expect(replay.state).toEqual(partial.state);
    const changedAfterPartial = { ...partial.state, records: [{ ...partial.state.records[0]!, notes: "changed after review" }] };
    expect(undoAppliedChangeSet(changedAfterPartial, partial.journal, changeSet.changeSetId, OWNER).status).toBe("conflict");

    const undone = undoAppliedChangeSet(partial.state, partial.journal, changeSet.changeSetId, OWNER, "2026-01-05T00:00:00.000Z");
    expect(undone.status).toBe("applied");
    expect(undone.state.records[0]?.holding?.quantity).toBe(1);
    expect(undone.state.records[0]?.notes).toBe("Synthetic note");
    expect(undone.state.records[0]?.want?.wanted).toBe(true);
  });

  it("returns explicit stale, ambiguous, cross-owner, tamper, unknown-field, and unsupported conflicts without mutation", () => {
    const state = stateWith();
    const record = state.records[0]!;
    const target = targetFromRecord(record);
    const changeSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [setHoldingOperation(target, 0, record.holding ?? null, { quantity: 3, status: "owned" })],
      idempotencyKey: "synthetic-change-002",
      sourceEvidence: evidence(),
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const stale = applyProposedChangeSet({ ...state, revision: 1 }, changeSet, OWNER, { now: "2026-01-03T00:00:00.000Z" });
    expect(stale.status).toBe("conflict");
    expect(stale.conflict?.code).toBe("stale-revision");
    expect(stale.state).toEqual({ ...state, revision: 1 });

    const ambiguous = applyProposedChangeSet({ ...state, records: [record, { ...record, id: record.id }] }, changeSet, OWNER);
    expect(ambiguous.conflict?.code).toBe("ambiguous-target");

    expect(() => applyProposedChangeSet(state, changeSet, { authenticatedUid: "other-owner", expectedOwnerUid: "synthetic-owner" })).toThrow(ChangeSetAuthorizationError);
    expect(() => previewProposedChangeSet(state, { ...changeSet, integrityHash: "tampered" }, OWNER)).toThrow(ChangeSetValidationError);
    expect(() => previewProposedChangeSet(state, { ...changeSet, unexpected: true } as typeof changeSet, OWNER)).toThrow(/unknown field/);

    const single = { ...record, catalog: { ...record.catalog, objectType: "single" as const } };
    expect(() => targetFromRecord(single)).toThrow(/sealed or non-single/);
  });

  it("keeps price evidence append-only, complete, and explicitly unvalued when evidence is insufficient", () => {
    const state = stateWith();
    const record = state.records[0]!;
    const target = targetFromRecord(record);
    const observation = {
      observationId: "observation-synthetic-1",
      observedAt: "2026-01-02T00:00:00.000Z",
      amountMinor: null,
      currency: "EUR",
      sourceLabel: "Synthetic public guide snapshot",
      sourceUrl: "https://example.invalid/synthetic-guide",
      sourceSnapshotDate: "2026-01-01T00:00:00.000Z",
      language: "EN",
      edition: "Field Notes",
      packaging: "Sealed tin",
      condition: "Sealed",
      sealedState: "sealed" as const,
      priceKind: "price-guide" as const,
      shippingTreatment: "unknown" as const,
      sampleSize: 0,
      sampleDescription: "No comparable public samples",
      confidence: "low" as const,
      valuationStatus: "unvalued" as const,
    };
    expect(() => createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [appendPriceObservationOperation(target, 0, observation)],
      idempotencyKey: "synthetic-price-001",
      sourceEvidence: evidence(),
    })).toThrow(/sampleSize/);

    const validObservation = { ...observation, sampleSize: 1 };
    const changeSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [appendPriceObservationOperation(target, 0, validObservation)],
      idempotencyKey: "synthetic-price-002",
      sourceEvidence: evidence(),
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const applied = applyProposedChangeSet(state, changeSet, OWNER, { now: "2026-01-03T00:00:00.000Z" });
    expect(applied.status).toBe("applied");
    expect(applied.auditEntry.undoable).toBe(false);
    expect(applied.state.records[0]?.priceObservations?.[0]).toMatchObject({ valuationStatus: "unvalued", amountMinor: null });
    const undo = undoAppliedChangeSet(applied.state, applied.journal, changeSet.changeSetId, OWNER);
    expect(undo.status).toBe("not-undoable");
  });

  it("fails closed for oversized text and unsupported future schemas", () => {
    const state = stateWith();
    const record = state.records[0]!;
    const target = targetFromRecord(record);
    expect(() => createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [setNotesOperation(target, 0, record.notes ?? null, "x".repeat(2_001))],
      idempotencyKey: "synthetic-oversize-001",
      sourceEvidence: evidence(),
    })).toThrow();
    const future = { ...createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [setHoldingOperation(target, 0, record.holding ?? null, { quantity: 2, status: "owned" })],
      idempotencyKey: "synthetic-future-001",
      sourceEvidence: evidence(),
    }), schemaVersion: 99 } as unknown as ProposedChangeSet;
    expect(() => previewProposedChangeSet(state, future, OWNER)).toThrow(/Unsupported/);
  });

  it("supports safe create undo, append-only acquisitions, valued observations, journal persistence, and legacy backup restore", () => {
    const empty = createEmptyState("2026-01-01T00:00:00.000Z");
    const target = makeChangeSetTarget({ recordId: "record_dawn_box", catalogId: "catalog-dawn-box", objectType: "box", name: "Dawn Box" });
    const createdRecord: CollectionRecord = {
      id: target.recordId,
      catalog: { catalogId: target.catalogId, objectType: target.objectType, name: target.name },
      holding: { quantity: 1, status: "owned", acquiredAt: "2026-01-01T00:00:00.000Z" },
      want: { wanted: false, priority: "normal" },
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      revision: 0,
    };
    const createSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: empty,
      target,
      operations: [createRecordOperation(target, 0, createdRecord)],
      idempotencyKey: "synthetic-create-001",
      sourceEvidence: evidence(),
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const created = applyProposedChangeSet(empty, createSet, OWNER, { now: "2026-01-03T00:00:00.000Z" });
    expect(created.status).toBe("applied");
    expect(created.state.records[0]?.revision).toBe(1);
    const createdUndo = undoAppliedChangeSet(created.state, created.journal, createSet.changeSetId, OWNER, "2026-01-04T00:00:00.000Z");
    expect(createdUndo.status).toBe("applied");
    expect(createdUndo.state.records).toHaveLength(0);

    const state = stateWith();
    const record = state.records[0]!;
    const stateTarget = targetFromRecord(record);
    const acquisitionSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target: stateTarget,
      operations: [appendAcquisitionOperation(stateTarget, 0, { acquisitionId: "acq-synthetic-1", acquiredAt: "2026-01-02T00:00:00.000Z", quantity: 1, channel: "manual", note: "Synthetic fact" })],
      idempotencyKey: "synthetic-acquisition-001",
      sourceEvidence: evidence(),
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const acquisition = applyProposedChangeSet(state, acquisitionSet, OWNER);
    expect(acquisition.status).toBe("applied");
    expect(acquisition.auditEntry.undoable).toBe(false);
    expect(undoAppliedChangeSet(acquisition.state, acquisition.journal, acquisitionSet.changeSetId, OWNER).status).toBe("not-undoable");

    const valuedObservation = {
      observationId: "observation-valued-1",
      observedAt: "2026-01-02T00:00:00.000Z",
      amountMinor: 2500,
      currency: "EUR",
      sourceLabel: "Synthetic guide",
      sourceUrl: "https://example.invalid/guide",
      sourceSnapshotDate: "2026-01-01T00:00:00.000Z",
      language: "EN",
      edition: "Field Notes",
      packaging: "Sealed tin",
      condition: "Sealed",
      sealedState: "sealed" as const,
      priceKind: "price-guide" as const,
      shippingTreatment: "included" as const,
      sampleSize: 2,
      sampleDescription: "Two synthetic guide observations",
      confidence: "medium" as const,
      valuationStatus: "valued" as const,
    };
    const priceSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target: stateTarget,
      operations: [appendPriceObservationOperation(stateTarget, 0, valuedObservation)],
      idempotencyKey: "synthetic-price-valued-001",
      sourceEvidence: { kind: "public-catalog-snapshot", reference: "synthetic-public-guide", capturedAt: "2026-01-02T00:00:00.000Z", sourceUrl: "https://example.invalid/guide" },
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(applyProposedChangeSet(state, priceSet, OWNER).state.records[0]?.priceObservations?.[0]?.amountMinor).toBe(2500);
    expect(() => createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target: stateTarget,
      operations: [appendPriceObservationOperation(stateTarget, 0, { ...valuedObservation, sampleSize: 1, sourceUrl: "ftp://example.invalid/guide" })],
      idempotencyKey: "synthetic-price-bad-url",
      sourceEvidence: evidence(),
    })).toThrow(/HTTP/);
    expect(() => createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target: stateTarget,
      operations: [appendPriceObservationOperation(stateTarget, 0, { ...valuedObservation, sampleSize: 1 })],
      idempotencyKey: "synthetic-price-public-evidence-missing-url",
      sourceEvidence: { kind: "public-catalog-snapshot", reference: "missing-url", capturedAt: "2026-01-02T00:00:00.000Z" },
    })).toThrow(/sourceUrl/);

    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key) { return values.get(key) ?? null; },
      key(index) { return [...values.keys()][index] ?? null; },
      removeItem(key) { values.delete(key); },
      setItem(key, value) { values.set(key, value); },
    };
    const journalStore = createChangeSetJournalStore(storage);
    journalStore.save(created.journal);
    expect(journalStore.load()).toEqual(created.journal);
    values.set("pokemon-collection.change-set-journal.v1", "{\"unexpected\":true}");
    expect(journalStore.load().proposals).toHaveLength(0);
    journalStore.clear();
    const backup = createBackup(created.state, "2026-01-05T00:00:00.000Z", created.journal);
    expect(parseBackup(serializeBackup(backup)).changeSetJournal).toEqual(created.journal);
    const legacy = { ...backup, state: { schemaVersion: 1 as const, records: [], updatedAt: "2026-01-01T00:00:00.000Z" }, changeSetJournal: undefined };
    expect(parseBackup(JSON.stringify(legacy)).state.revision).toBeUndefined();
    expect(() => parseBackup(JSON.stringify({ ...legacy, state: null }))).toThrow(/state is invalid/);
    expect(() => makeChangeSetTarget({ recordId: "single", catalogId: "single", objectType: "single", name: "Raw single" })).toThrow(/sealed or non-single/);
  });

  it("covers exact-target conflict branches and rejects invalid approval selections or replay mismatches", () => {
    const state = stateWith();
    const record = state.records[0]!;
    const target = targetFromRecord(record);
    const changeSet = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [setHoldingOperation(target, 0, record.holding ?? null, { quantity: 2, status: "owned" })],
      idempotencyKey: "synthetic-conflict-001",
      sourceEvidence: evidence(),
    });
    const mismatchTarget = { ...target, name: "Different synthetic target" };
    const mismatchBaseRecord = { ...record, catalog: { ...record.catalog, name: mismatchTarget.name } };
    const mismatchExpectedRecord = changeSet.expectedResult.record ? { ...changeSet.expectedResult.record, catalog: { ...changeSet.expectedResult.record.catalog, name: mismatchTarget.name } } : null;
    const mismatch = { ...changeSet, target: mismatchTarget, base: { ...changeSet.base, record: mismatchBaseRecord }, expectedResult: { ...changeSet.expectedResult, record: mismatchExpectedRecord }, operations: changeSet.operations.map((operation) => ({ ...operation, target: mismatchTarget })), integrityHash: "" };
    mismatch.integrityHash = changeSetIntegrityHash(mismatch);
    expect(applyProposedChangeSet(state, mismatch, OWNER).conflict?.code).toBe("target-mismatch");

    const changedRecordState = { ...state, records: [{ ...record, notes: "changed outside review" }] };
    expect(applyProposedChangeSet(changedRecordState, changeSet, OWNER).conflict?.code).toBe("stale-revision");
    const missingState = { ...state, records: [], revision: 0 };
    expect(applyProposedChangeSet(missingState, changeSet, OWNER).conflict?.code).toBe("stale-revision");
    const accepted = applyProposedChangeSet(state, changeSet, OWNER);
    const differentPayload = createProposedChangeSet({
      ownerUid: OWNER.expectedOwnerUid,
      current: state,
      target,
      operations: [setHoldingOperation(target, 0, record.holding ?? null, { quantity: 4, status: "owned" })],
      idempotencyKey: changeSet.idempotencyKey,
      sourceEvidence: evidence(),
    });
    expect(applyProposedChangeSet(accepted.state, differentPayload, OWNER, { journal: accepted.journal }).conflict?.code).toBe("replay-mismatch");
    expect(() => applyProposedChangeSet(state, changeSet, OWNER, { mode: "atomic", approvedOperationIds: [] })).toThrow(/selection/);
    expect(() => applyProposedChangeSet(state, changeSet, OWNER, { mode: "partial", approvedOperationIds: ["unknown"] })).toThrow(/selection/);
    expect(() => undoAppliedChangeSet(state, createEmptyChangeSetJournal(), "missing-change-set", OWNER)).toThrow(/not found/);
    const proposedOnly = proposeChangeSet(createEmptyChangeSetJournal(), changeSet, OWNER);
    expect(undoAppliedChangeSet(state, proposedOnly, changeSet.changeSetId, OWNER).status).toBe("not-undoable");
  });
});
