import { describe, expect, it } from "vitest";
import {
  aggregateRoadmapProgress,
  availableRoadmapLanguages,
  filterRoadmapRecords,
  groupRoadmapByRegion,
  nextRoadmapMission,
  roadmapLanguage,
  roadmapRegion,
  roadmapUrgency,
} from "../src/domain/roadmap";
import { roadmapProgress, type CollectionRecord, type ObjectType, type Want } from "../src/domain/model";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

function record(
  id: string,
  options: {
    name?: string;
    type?: ObjectType;
    setName?: string;
    holding?: CollectionRecord["holding"];
    want?: Want;
    notes?: string;
  } = {},
): CollectionRecord {
  return {
    id,
    catalog: {
      catalogId: id,
      objectType: options.type ?? "box",
      name: options.name ?? id,
      ...(options.setName ? { setName: options.setName } : {}),
    },
    ...(options.holding ? { holding: options.holding } : {}),
    ...(options.want ? { want: options.want } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function want(overrides: Partial<Want> = {}): Want {
  return { wanted: true, priority: "normal", isRoadmap: true, ...overrides };
}

describe("roadmap progress selectors", () => {
  it("aggregates independent sealed/opened targets and never counts surplus above the goal", () => {
    const records = [
      record("partial", {
        holding: { quantity: 1, status: "owned", sealedQuantity: 1, openedQuantity: 0 },
        want: want({ targetSealedQuantity: 1, targetOpenedQuantity: 1 }),
      }),
      record("complete-with-surplus", {
        holding: { quantity: 3, status: "owned", sealedQuantity: 3, openedQuantity: 0 },
        want: want({ targetSealedQuantity: 1, targetOpenedQuantity: 0 }),
      }),
      record("excluded", { want: want({ targetSealedQuantity: 99, isRoadmap: false }) }),
      record("holding-only", { holding: { quantity: 8, status: "owned" } }),
    ];

    expect(aggregateRoadmapProgress(records)).toEqual({
      recordCount: 2,
      completedRecordCount: 1,
      inProgressRecordCount: 1,
      notStartedRecordCount: 0,
      targetSealed: 2,
      targetOpened: 1,
      completedSealed: 2,
      completedOpened: 0,
      totalSteps: 3,
      completedSteps: 2,
      remainingSteps: 1,
      percent: 67,
      status: "in-progress",
    });
  });

  it("returns a stable empty aggregate", () => {
    expect(aggregateRoadmapProgress([])).toMatchObject({
      recordCount: 0,
      totalSteps: 0,
      completedSteps: 0,
      remainingSteps: 0,
      percent: 0,
      status: "not-started",
    });
  });

  it("uses roadmapProgress to keep legacy aggregate holdings and wants compatible", () => {
    const legacy = record("legacy", {
      holding: { quantity: 2, status: "owned" },
      want: { wanted: true, priority: "high", quantity: 2 },
    });

    expect(roadmapProgress(legacy)).toMatchObject({
      sealed: 2,
      opened: 0,
      targetSealed: 2,
      targetOpened: 0,
      completedSteps: 2,
      percent: 100,
      status: "complete",
    });
    expect(aggregateRoadmapProgress([legacy])).toMatchObject({
      recordCount: 1,
      completedRecordCount: 1,
      percent: 100,
    });
  });

  it("keeps optional open targets visible without adding them to required aggregate completion", () => {
    const optionalOpen = record("optional-open", {
      holding: { quantity: 0, status: "owned", sealedQuantity: 0, openedQuantity: 0 },
      want: want({
        targetSealedQuantity: 1,
        targetOpenedQuantity: 1,
        openGoalMode: "optional",
      }),
    });

    expect(roadmapProgress(optionalOpen)).toMatchObject({
      targetSealed: 1,
      targetOpened: 1,
      totalSteps: 1,
      remainingSteps: 1,
    });
    expect(aggregateRoadmapProgress([optionalOpen])).toMatchObject({
      targetSealed: 1,
      targetOpened: 1,
      totalSteps: 1,
      completedSteps: 0,
      remainingSteps: 1,
      percent: 0,
    });
  });
});

describe("roadmap grouping and mission choice", () => {
  it("groups by segment with useful fallbacks and orders regions and records by route order", () => {
    const records = [
      record("future", { name: "Future", setName: "Set C", want: want({ segment: "Futuro", roadmapOrder: 40 }) }),
      record("route-2", { name: "Route two", want: want({ segment: "Ruta actual", roadmapOrder: 20 }) }),
      record("route-1", { name: "Route one", want: want({ segment: "Ruta actual", roadmapOrder: 10 }) }),
      record("tier", { name: "Tier fallback", want: want({ tier: "Archivo", roadmapOrder: 30 }) }),
      record("set", { name: "Set fallback", setName: "Clásicos", want: want({ roadmapOrder: 35 }) }),
    ];

    const groups = groupRoadmapByRegion(records);
    expect(groups.map((group) => group.name)).toEqual(["Ruta actual", "Archivo", "Clásicos", "Futuro"]);
    expect(groups[0]?.records.map(({ id }) => id)).toEqual(["route-1", "route-2"]);
    expect(groups[0]?.progress.recordCount).toBe(2);
    expect(roadmapRegion(records[3]!)).toBe("Archivo");
  });

  it("selects the next incomplete mission by urgency and then roadmap order", () => {
    const records = [
      record("complete-critical", {
        holding: { quantity: 1, status: "owned" },
        want: want({ urgency: "critical", targetSealedQuantity: 1, roadmapOrder: 1 }),
      }),
      record("high-later", { want: want({ urgency: "high", roadmapOrder: 30 }) }),
      record("high-earlier", { want: want({ urgency: "high", roadmapOrder: 20 }) }),
      record("critical", { want: want({ urgency: "critical", roadmapOrder: 100 }) }),
    ];

    expect(nextRoadmapMission(records)?.id).toBe("critical");
    expect(nextRoadmapMission(records.filter(({ id }) => id !== "critical"))?.id).toBe("high-earlier");
    expect(nextRoadmapMission([records[0]!])).toBeUndefined();
  });

  it("maps legacy priorities to roadmap urgency", () => {
    expect(roadmapUrgency(record("high", { want: { wanted: true, priority: "high" } }))).toBe("high");
    expect(roadmapUrgency(record("normal", { want: { wanted: true, priority: "normal" } }))).toBe("medium");
    expect(roadmapUrgency(record("low", { want: { wanted: true, priority: "low" } }))).toBe("low");
  });

  it("does not recommend held or explicitly forbidden purchases as the next mission", () => {
    const records = [
      record("wait", { want: want({ urgency: "wait", roadmapOrder: 1 }) }),
      record("wait-launch", { want: want({ urgency: "wait-launch", roadmapOrder: 2 }) }),
      record("do-not-buy", { want: want({ urgency: "do-not-buy", roadmapOrder: 3 }) }),
      record("opportunity", { want: want({ urgency: "opportunistic", roadmapOrder: 99 }) }),
    ];

    expect(nextRoadmapMission(records)?.id).toBe("opportunity");
    expect(nextRoadmapMission(records.slice(0, 3))).toBeUndefined();
  });
});

describe("roadmap languages and filters", () => {
  const records = [
    record("jp-progress", {
      name: "Mega Dream ex",
      type: "box",
      setName: "High Class",
      holding: { quantity: 1, status: "opened", openedQuantity: 1, sealedQuantity: 0, language: "EN" },
      want: want({ targetOpenedQuantity: 1, targetSealedQuantity: 1, urgency: "critical", goalLanguage: "JP", segment: "Ahora", roadmapOrder: 1, actionNote: "Guardar una copia" }),
      notes: "Precio objetivo",
    }),
    record("jp-not-started", {
      name: "Inferno X",
      type: "box",
      want: want({ targetOpenedQuantity: 1, urgency: "high", goalLanguage: " jp ", segment: "Ahora", roadmapOrder: 2 }),
    }),
    record("es-complete", {
      name: "Caja 151",
      type: "box",
      holding: { quantity: 1, status: "owned", sealedQuantity: 1, openedQuantity: 0 },
      want: want({ targetSealedQuantity: 1, urgency: "medium", goalLanguage: "ES", segment: "Después" }),
    }),
    record("holding-language", {
      name: "Travel Tin",
      type: "tin",
      holding: { quantity: 0, status: "owned", language: "EN" },
      want: want({ targetSealedQuantity: 1, urgency: "low", segment: "Después" }),
    }),
    record("excluded", { want: want({ goalLanguage: "DE", isRoadmap: false }) }),
    record("wait-filter", { want: want({ urgency: "wait", goalLanguage: "FR" }) }),
  ];

  it("deduplicates languages case-insensitively and falls back to the holding language", () => {
    expect(availableRoadmapLanguages(records)).toEqual(["EN", "ES", "FR", "JP"]);
    expect(roadmapLanguage(records[3]!)).toBe("EN");
  });

  it("combines query, type, urgency, language, and status filters", () => {
    expect(filterRoadmapRecords(records, {
      query: "mega dream high class guardar",
      type: "box",
      urgency: "critical",
      language: "jp",
      status: "in-progress",
    }).map(({ id }) => id)).toEqual(["jp-progress"]);
  });

  it("filters every roadmap status and preserves input order for all filters", () => {
    expect(filterRoadmapRecords(records, { status: "not-started" }).map(({ id }) => id))
      .toEqual(["jp-not-started", "holding-language", "wait-filter"]);
    expect(filterRoadmapRecords(records, { status: "in-progress" }).map(({ id }) => id))
      .toEqual(["jp-progress"]);
    expect(filterRoadmapRecords(records, { status: "complete" }).map(({ id }) => id))
      .toEqual(["es-complete"]);
    expect(filterRoadmapRecords(records, { type: "all", urgency: "all", language: "all", status: "all" }).map(({ id }) => id))
      .toEqual(["jp-progress", "jp-not-started", "es-complete", "holding-language", "wait-filter"]);
  });

  it("filters the extended urgency contract", () => {
    expect(filterRoadmapRecords(records, { urgency: "wait" }).map(({ id }) => id)).toEqual(["wait-filter"]);
    expect(filterRoadmapRecords(records, { urgency: "do-not-buy" })).toEqual([]);
  });

  it("searches roadmap metadata and excludes records explicitly outside the map", () => {
    expect(filterRoadmapRecords(records, { query: "precio objetivo" }).map(({ id }) => id)).toEqual(["jp-progress"]);
    expect(filterRoadmapRecords(records, { query: "2026" })).toEqual([]);
    expect(filterRoadmapRecords(records, { query: "excluded" })).toEqual([]);
  });
});
