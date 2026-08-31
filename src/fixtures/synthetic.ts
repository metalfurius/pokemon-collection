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
      id: stableRecordId({ objectType: "box", name: "Aurora Archive Box", setName: "Ruta inicial" }),
      catalog: { catalogId: "synthetic-aurora-box", objectType: "box", name: "Aurora Archive Box", setName: "Ruta inicial" },
      holding: { quantity: 2, status: "owned", sealedQuantity: 1, openedQuantity: 1, language: "JP" },
      want: { wanted: true, priority: "high", quantity: 2, targetSealedQuantity: 1, targetOpenedQuantity: 1, openGoalMode: "required", urgency: "critical", goalLanguage: "JP", segment: "Ruta inicial", tier: "S", roadmapOrder: 1, priceCeilingMinor: 8200, currency: "EUR", actionNote: "Conservar una copia y completar la apertura", isRoadmap: true },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "box", name: "Ember Summit Box", setName: "Ruta inicial" }),
      catalog: { catalogId: "synthetic-ember-box", objectType: "box", name: "Ember Summit Box", setName: "Ruta inicial" },
      holding: { quantity: 2, status: "owned", sealedQuantity: 2, openedQuantity: 0, language: "JP" },
      want: { wanted: true, priority: "high", quantity: 2, targetSealedQuantity: 1, targetOpenedQuantity: 1, openGoalMode: "required", urgency: "high", goalLanguage: "JP", segment: "Ruta inicial", tier: "A", roadmapOrder: 2, actionNote: "Ya puedes abrir una sellada sin comprar", isRoadmap: true },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "box", name: "Moonlit Signal Box", setName: "Horizonte" }),
      catalog: { catalogId: "synthetic-moonlit-box", objectType: "box", name: "Moonlit Signal Box", setName: "Horizonte" },
      holding: { quantity: 1, status: "opened", sealedQuantity: 0, openedQuantity: 1, language: "KR" },
      want: { wanted: true, priority: "normal", quantity: 2, targetSealedQuantity: 1, targetOpenedQuantity: 1, openGoalMode: "required", urgency: "medium", goalLanguage: "KR", segment: "Horizonte", roadmapOrder: 3, priceCeilingMinor: 5450, currency: "EUR", actionNote: "Buscar una copia limpia para guardar", isRoadmap: true },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "box", name: "Jade Lantern Box", setName: "Horizonte" }),
      catalog: { catalogId: "synthetic-jade-box", objectType: "box", name: "Jade Lantern Box", setName: "Horizonte" },
      want: { wanted: true, priority: "normal", quantity: 2, targetSealedQuantity: 1, targetOpenedQuantity: 1, openGoalMode: "optional", urgency: "opportunistic", goalLanguage: "S-CN", segment: "Horizonte", tier: "Bonus", roadmapOrder: 4, actionNote: "La apertura es un hito bonus", isRoadmap: true },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "tin", name: "Sunlit Travel Tin", setName: "Archivo de latas" }),
      catalog: { catalogId: "synthetic-sunlit-tin", objectType: "tin", name: "Sunlit Travel Tin", setName: "Archivo de latas" },
      holding: { quantity: 1, status: "owned", sealedQuantity: 1, openedQuantity: 0, language: "EN" },
      want: { wanted: true, priority: "low", quantity: 1, targetSealedQuantity: 1, targetOpenedQuantity: 0, openGoalMode: "none", urgency: "low", goalLanguage: "EN", segment: "Archivo de latas", roadmapOrder: 5, isRoadmap: true },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "tin", name: "Quiet Summit Tin", setName: "Archivo de latas" }),
      catalog: { catalogId: "synthetic-quiet-tin", objectType: "tin", name: "Quiet Summit Tin", setName: "Archivo de latas" },
      want: { wanted: true, priority: "low", quantity: 1, targetSealedQuantity: 1, targetOpenedQuantity: 0, openGoalMode: "none", urgency: "wait", goalLanguage: "EN", segment: "Archivo de latas", roadmapOrder: 6, actionNote: "Esperar una mejor ventana de precio", isRoadmap: true },
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
        { Type: "single", Name: "Silver Meadow", Set: "Meadow Signals", Number: "02", Quantity: 2, Status: "Owned" },
        { Type: "graded-card", Name: "Silver Meadow", Set: "Meadow Signals", Number: "02", Quantity: 1, Status: "Owned", Grade: 9 },
        { Type: "box", Name: "Dawn Box", Set: "Field Notes", Quantity: 1, Status: "Sealed" },
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
