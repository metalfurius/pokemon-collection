import {
  type CollectionState,
  type CollectionRecord,
  stableRecordId,
} from "../domain/model";
import { createWorkbookSourceFromRows, type WorkbookSource } from "../domain/importer";

const SYNTHETIC_NOW = "2026-01-15T12:00:00.000Z";

export function syntheticState(): CollectionState {
  const records: CollectionRecord[] = [
    {
      id: stableRecordId({ objectType: "single", name: "Amber Finch", setName: "Meadow Signals", number: "01" }),
      catalog: { catalogId: "synthetic-amber-finch", objectType: "single", name: "Amber Finch", setName: "Meadow Signals", number: "01" },
      holding: { quantity: 2, status: "owned", condition: "Near mint", language: "EN" },
      want: { wanted: false, priority: "normal" },
      createdAt: SYNTHETIC_NOW,
      updatedAt: SYNTHETIC_NOW,
    },
    {
      id: stableRecordId({ objectType: "graded-card", name: "Cloud Harbor", setName: "Skyline Archive", number: "14" }),
      catalog: { catalogId: "synthetic-cloud-harbor", objectType: "graded-card", name: "Cloud Harbor", setName: "Skyline Archive", number: "14" },
      holding: { quantity: 1, status: "owned", gradingCompany: "Synthetic Grading", grade: 9 },
      want: { wanted: false, priority: "normal" },
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

export function syntheticWorkbook(): WorkbookSource {
  return createWorkbookSourceFromRows([
    {
      name: "Inventory",
      rows: [
        { Type: "single", Name: "Silver Meadow", Set: "Meadow Signals", Number: "02", Quantity: 2, Status: "Owned" },
        { Type: "graded-card", Name: "Silver Meadow", Set: "Meadow Signals", Number: "02", Quantity: 1, Status: "Owned", Grade: 9 },
        { Type: "unknown", Name: "Needs Review", Quantity: 1 },
      ],
    },
    {
      name: "Wants",
      rows: [{ Name: "Quiet Summit", Set: "Skyline Archive", Number: "33", Priority: "High" }],
    },
    {
      name: "Unrelated Sheet",
      rows: [{ Name: "Ignored Synthetic Row", Quantity: 1 }],
    },
  ], "synthetic-workbook.xlsx");
}
