import {
  holdingWithCounts,
  openedQuantity,
  sealedQuantity,
  stableCardmarketRecordId,
  type CollectionRecord,
  type CollectionState,
  type HoldingStatus,
  type WantPriority,
} from "./model";
import type { CardmarketCatalogEntry } from "./cardmarket";

export type IntakeDestination = "collection" | "wants";

export interface CardmarketIntakeDraft {
  entry: CardmarketCatalogEntry;
  canonicalUrl: string;
  destination: IntakeDestination;
  quantity: number;
  holdingStatus: HoldingStatus;
  priority: WantPriority;
  notes?: string;
}

function normalizedNotes(value: string | undefined): string | undefined {
  const notes = value?.trim();
  return notes === "" ? undefined : notes;
}

function intakeRef(draft: CardmarketIntakeDraft): string {
  return [
    draft.destination,
    draft.entry.idProduct,
    draft.quantity,
    draft.holdingStatus,
    draft.priority,
    normalizedNotes(draft.notes) ?? "",
  ].join("|");
}

function catalogForEntry(entry: CardmarketCatalogEntry, canonicalUrl: string): CollectionRecord["catalog"] {
  return {
    catalogId: `cardmarket:${entry.idProduct}`,
    objectType: entry.objectType,
    name: entry.name,
    ...(entry.setName ? { setName: entry.setName } : {}),
    source: "cardmarket",
    idProduct: entry.idProduct,
    categorySlug: entry.categorySlug,
    prettySlug: entry.prettySlug,
    variantKey: entry.variantKey,
    sourceUrl: canonicalUrl,
  };
}

function existingCardmarketRecord(state: CollectionState, idProduct: string): CollectionRecord | undefined {
  return state.records.find((record) => record.catalog.source === "cardmarket" && record.catalog.idProduct === idProduct);
}

export function applyCardmarketIntake(
  current: CollectionState,
  draft: CardmarketIntakeDraft,
  now = new Date().toISOString(),
): CollectionState {
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1) throw new Error("Quantity must be a positive whole number");
  const ref = intakeRef(draft);
  const existing = existingCardmarketRecord(current, draft.entry.idProduct);
  if (existing?.catalog.variantKey && existing.catalog.variantKey !== draft.entry.variantKey) {
    throw new Error("This idProduct already has a different packaging or language variant");
  }
  if (existing?.intakeRefs?.includes(ref)) return current;
  const catalog = catalogForEntry(draft.entry, draft.canonicalUrl);
  const notes = normalizedNotes(draft.notes);
  if (existing) {
    const next: CollectionRecord = {
      ...existing,
      catalog: { ...existing.catalog, ...catalog },
      notes: notes ?? existing.notes,
      intakeRefs: [...(existing.intakeRefs ?? []), ref].slice(-24),
      updatedAt: now,
      ...(draft.destination === "collection"
        ? {
            holding: holdingWithCounts(existing.holding,
              sealedQuantity(existing.holding) + (draft.holdingStatus === "owned" ? draft.quantity : 0),
              openedQuantity(existing.holding) + (draft.holdingStatus === "opened" ? draft.quantity : 0)),
          }
        : {
            want: {
              ...(existing.want ?? { wanted: true, priority: draft.priority }),
              wanted: true,
              priority: draft.priority,
              quantity: draft.quantity,
              targetSealedQuantity: draft.quantity,
              targetOpenedQuantity: 0,
              openGoalMode: "none",
              isRoadmap: true,
            },
          }),
    };
    return {
      ...current,
      records: current.records.map((record) => record.id === existing.id ? next : record),
      updatedAt: now,
    };
  }

  const record: CollectionRecord = {
    id: stableCardmarketRecordId(draft.entry.idProduct),
    catalog,
    ...(draft.destination === "collection"
      ? { holding: holdingWithCounts({ quantity: draft.quantity, status: draft.holdingStatus }, draft.holdingStatus === "owned" ? draft.quantity : 0, draft.holdingStatus === "opened" ? draft.quantity : 0) }
      : { want: { wanted: true, priority: draft.priority, quantity: draft.quantity, targetSealedQuantity: draft.quantity, targetOpenedQuantity: 0, openGoalMode: "none", isRoadmap: true } }),
    ...(notes ? { notes } : {}),
    intakeRefs: [ref],
    createdAt: now,
    updatedAt: now,
  };
  return { ...current, records: [record, ...current.records], updatedAt: now };
}

export function findCardmarketRecord(state: CollectionState, idProduct: string): CollectionRecord | undefined {
  return existingCardmarketRecord(state, idProduct);
}
