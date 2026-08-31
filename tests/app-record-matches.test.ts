import { describe, expect, it } from "vitest";
import type { CollectionRecord } from "../src/domain/model";
import { recordMatches, reversibleHideOperations, type ListFilterState } from "../src/ui/app";

const mixedRecord: CollectionRecord = {
  id: "mixed",
  catalog: { catalogId: "mixed", objectType: "box", name: "Mixed collection box" },
  holding: { quantity: 1, status: "opened", sealedQuantity: 0, openedQuantity: 1 },
  want: {
    wanted: true,
    priority: "high",
    targetSealedQuantity: 2,
    targetOpenedQuantity: 1,
    openGoalMode: "required",
    urgency: "high",
    goalLanguage: "JP",
    isRoadmap: true,
  },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function filters(overrides: Partial<ListFilterState>): ListFilterState {
  return {
    view: "collection",
    query: "",
    type: "all",
    status: "all",
    urgency: "all",
    language: "all",
    roadmapStatus: "all",
    ...overrides,
  };
}

describe("view-specific collection filters", () => {
  it("ignores hidden roadmap filters in Colección", () => {
    expect(recordMatches(mixedRecord, filters({
      view: "collection",
      urgency: "do-not-buy",
      language: "English",
      roadmapStatus: "complete",
    }))).toBe(true);
    expect(recordMatches(mixedRecord, filters({ view: "collection", status: "owned" }))).toBe(false);
    expect(recordMatches(mixedRecord, filters({ view: "collection", status: "opened" }))).toBe(true);
  });

  it("ignores the hidden holding filter in Quiero", () => {
    expect(recordMatches(mixedRecord, filters({
      view: "wants",
      status: "owned",
      urgency: "high",
      language: "JP",
      roadmapStatus: "in-progress",
    }))).toBe(true);
    expect(recordMatches(mixedRecord, filters({ view: "wants", urgency: "low" }))).toBe(false);
  });

  it("hides a record with reversible field updates rather than a forbidden delete", () => {
    const operations = reversibleHideOperations(mixedRecord);
    expect(operations.map(({ kind }) => kind)).toEqual(["set-holding", "set-want"]);
    expect(operations).not.toContainEqual(expect.objectContaining({ kind: "delete-record" }));
  });
});
