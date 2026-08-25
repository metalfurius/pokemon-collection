import {
  type CollectionState,
  type CollectionRecord,
  stableRecordId,
} from "../domain/model";
import { createCardmarketIndex, type CardmarketCatalogIndex } from "../domain/cardmarket";
import { createWorkbookSourceFromRows, type WorkbookSource } from "../domain/importer";

const SYNTHETIC_NOW = "2026-01-15T12:00:00.000Z";

export function syntheticState(): CollectionState {
  const records: CollectionRecord[] = [
    {
      id: stableRecordId({ objectType: "box", name: "Synthetic Collection Box", setName: "Test Signals" }),
      catalog: { catalogId: "synthetic-collection-box", objectType: "box", name: "Synthetic Collection Box", setName: "Test Signals" },
      holding: { quantity: 2, status: "owned" },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "tin", name: "Sunlit Tin", setName: "Field Notes" }),
      catalog: { catalogId: "synthetic-sunlit-tin", objectType: "tin", name: "Sunlit Tin", setName: "Field Notes" },
      want: { wanted: true, priority: "high" },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
  ];
  return { schemaVersion: 1, records, updatedAt: SYNTHETIC_NOW };
}

export function syntheticCardmarketIndex(): CardmarketCatalogIndex {
  return createCardmarketIndex([
    {
      idProduct: "900001",
      name: "Synthetic Collection Box",
      objectType: "box",
      categorySlug: "booster-boxes",
      prettySlug: "synthetic-collection-box",
      canonicalPath: "/en/Pokemon/Products/Booster-Boxes/Synthetic-Collection-Box",
      variantKey: "synthetic-collection-box|en|sealed",
      setName: "Test Signals",
      package: "Sealed box",
      inferredFields: ["setName"],
    },
    {
      idProduct: "900002",
      name: "Synthetic Collection Box — variante ES",
      objectType: "box",
      categorySlug: "booster-boxes",
      prettySlug: "synthetic-collection-box",
      canonicalPath: "/en/Pokemon/Products/Booster-Boxes/Synthetic-Collection-Box",
      variantKey: "synthetic-collection-box|es|sealed",
      setName: "Test Signals",
      language: "ES",
      package: "Sealed box",
      inferredFields: ["package"],
    },
    {
      idProduct: "900003",
      name: "Synthetic Travel Tin",
      objectType: "tin",
      categorySlug: "tins",
      prettySlug: "synthetic-travel-tin",
      canonicalPath: "/en/Pokemon/Products/Tins/Synthetic-Travel-Tin",
      variantKey: "synthetic-travel-tin|en|sealed",
      package: "Sealed tin",
    },
  ], SYNTHETIC_NOW, "Synthetic-only catalog for local tests");
}

export function syntheticWorkbook(): WorkbookSource {
  return createWorkbookSourceFromRows([
    {
      name: "Inventory",
      rows: [
        { Type: "box", Name: "Silver Meadow Collection Box", Set: "Meadow Signals", Quantity: 2, Status: "Owned" },
        { Type: "tin", Name: "Silver Meadow Travel Tin", Set: "Meadow Signals", Quantity: 1, Status: "Owned" },
        { Type: "single", Name: "Historical single remains exportable", Quantity: 1, Status: "Owned" },
        { Type: "unknown", Name: "Needs Review", Quantity: 1 },
      ],
    },
    {
      name: "Wants",
      rows: [{ Type: "tin", Name: "Quiet Summit Travel Tin", Set: "Skyline Archive", Quantity: 1, Priority: "High" }],
    },
    {
      name: "Unrelated Sheet",
      rows: [{ Name: "Ignored Synthetic Row", Quantity: 1 }],
    },
  ], "synthetic-workbook.xlsx");
}
