import {
  normalizeText,
  roadmapProgress,
  type CollectionRecord,
  type ObjectType,
  type RoadmapProgress,
  type RoadmapUrgency,
} from "./model";

export type RoadmapStatus = RoadmapProgress["status"];

export interface RoadmapAggregateProgress {
  recordCount: number;
  completedRecordCount: number;
  inProgressRecordCount: number;
  notStartedRecordCount: number;
  targetSealed: number;
  targetOpened: number;
  completedSealed: number;
  completedOpened: number;
  totalSteps: number;
  completedSteps: number;
  remainingSteps: number;
  percent: number;
  status: RoadmapStatus;
}

export interface RoadmapRegion {
  name: string;
  records: readonly CollectionRecord[];
  progress: RoadmapAggregateProgress;
}

export interface RoadmapFilters {
  query?: string;
  type?: ObjectType | "all";
  urgency?: RoadmapUrgency | "all";
  language?: string | "all";
  status?: RoadmapStatus | "all";
}

const urgencyRank: Readonly<Record<RoadmapUrgency, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  opportunistic: 4,
  wait: 5,
  "wait-launch": 6,
  "do-not-buy": 7,
};

const actionableUrgencies: ReadonlySet<RoadmapUrgency> = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "opportunistic",
]);

const spanishCollator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function finiteOrder(record: CollectionRecord): number {
  const order = record.want?.roadmapOrder;
  return Number.isFinite(order) ? order ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
}

function finiteReleaseYear(record: CollectionRecord): number {
  const releaseYear = record.want?.releaseYear;
  return Number.isFinite(releaseYear) ? releaseYear ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
}

function compareRoadmapOrder(left: CollectionRecord, right: CollectionRecord): number {
  return finiteOrder(left) - finiteOrder(right)
    || finiteReleaseYear(left) - finiteReleaseYear(right)
    || spanishCollator.compare(left.catalog.name, right.catalog.name)
    || spanishCollator.compare(left.id, right.id);
}

function normalizedLanguage(record: CollectionRecord): string {
  return normalizeText(roadmapLanguage(record));
}

export function isRoadmapRecord(record: CollectionRecord): boolean {
  return record.want?.wanted === true && record.want.isRoadmap !== false;
}

export function roadmapUrgency(record: CollectionRecord): RoadmapUrgency {
  const explicit = record.want?.urgency;
  if (explicit) return explicit;
  if (record.want?.priority === "high") return "high";
  if (record.want?.priority === "low") return "low";
  return "medium";
}

export function roadmapLanguage(record: CollectionRecord): string {
  return record.want?.goalLanguage?.trim() || record.holding?.language?.trim() || "Sin idioma";
}

export function roadmapRegion(record: CollectionRecord): string {
  return record.want?.segment?.trim()
    || record.want?.tier?.trim()
    || record.catalog.setName?.trim()
    || "Sin región";
}

export function aggregateRoadmapProgress(records: readonly CollectionRecord[]): RoadmapAggregateProgress {
  const roadmapRecords = records.filter(isRoadmapRecord);
  let targetSealed = 0;
  let targetOpened = 0;
  let completedSealed = 0;
  let completedOpened = 0;
  let totalSteps = 0;
  let completedSteps = 0;
  let remainingSteps = 0;
  let completedRecordCount = 0;
  let inProgressRecordCount = 0;
  let notStartedRecordCount = 0;

  for (const record of roadmapRecords) {
    const progress = roadmapProgress(record);
    targetSealed += progress.targetSealed;
    targetOpened += progress.targetOpened;
    completedSealed += Math.min(progress.sealed, progress.targetSealed);
    completedOpened += Math.min(progress.opened, progress.targetOpened);
    totalSteps += progress.totalSteps;
    completedSteps += progress.completedSteps;
    remainingSteps += progress.remainingSteps;
    if (progress.status === "complete") completedRecordCount += 1;
    else if (progress.status === "in-progress") inProgressRecordCount += 1;
    else notStartedRecordCount += 1;
  }

  const status: RoadmapStatus = totalSteps > 0 && remainingSteps === 0
    ? "complete"
    : completedSteps > 0
      ? "in-progress"
      : "not-started";

  return {
    recordCount: roadmapRecords.length,
    completedRecordCount,
    inProgressRecordCount,
    notStartedRecordCount,
    targetSealed,
    targetOpened,
    completedSealed,
    completedOpened,
    totalSteps,
    completedSteps,
    remainingSteps,
    percent: totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100),
    status,
  };
}

export function groupRoadmapByRegion(records: readonly CollectionRecord[]): readonly RoadmapRegion[] {
  const groups = new Map<string, CollectionRecord[]>();
  for (const record of records) {
    if (!isRoadmapRecord(record)) continue;
    const region = roadmapRegion(record);
    const group = groups.get(region) ?? [];
    group.push(record);
    groups.set(region, group);
  }

  return [...groups.entries()]
    .map(([name, groupedRecords]) => {
      const ordered = [...groupedRecords].sort(compareRoadmapOrder);
      return { name, records: ordered, progress: aggregateRoadmapProgress(ordered) };
    })
    .sort((left, right) => compareRoadmapOrder(left.records[0]!, right.records[0]!));
}

export function nextRoadmapMission(records: readonly CollectionRecord[]): CollectionRecord | undefined {
  return records
    .filter((record) => isRoadmapRecord(record)
      && actionableUrgencies.has(roadmapUrgency(record))
      && roadmapProgress(record).status !== "complete")
    .sort((left, right) => urgencyRank[roadmapUrgency(left)] - urgencyRank[roadmapUrgency(right)]
      || compareRoadmapOrder(left, right))[0];
}

/**
 * Resolves the single chapter shown by the atlas.
 *
 * An explicit region is sticky while it remains visible. When filtering removes
 * it, the first remaining chapter is selected so an unrelated later mission
 * cannot make the map jump unexpectedly. With no explicit selection, the
 * chapter containing the next actionable mission is the useful default.
 */
export function selectActiveRoadmapRegion(
  records: readonly CollectionRecord[],
  activeRegion?: string,
): RoadmapRegion | undefined {
  const regions = groupRoadmapByRegion(records);
  if (regions.length === 0) return undefined;

  if (activeRegion !== undefined) {
    return regions.find((region) => region.name === activeRegion) ?? regions[0];
  }

  const nextMission = nextRoadmapMission(records);
  if (!nextMission) return regions[0];
  const nextRegion = roadmapRegion(nextMission);
  return regions.find((region) => region.name === nextRegion) ?? regions[0];
}

/** Selects a roadmap record without allowing a non-roadmap item into atlas UI. */
export function selectRoadmapRecord(
  records: readonly CollectionRecord[],
  selectedRecordId?: string,
): CollectionRecord | undefined {
  if (selectedRecordId === undefined) return undefined;
  return records.find((record) => record.id === selectedRecordId && isRoadmapRecord(record));
}

export function availableRoadmapLanguages(records: readonly CollectionRecord[]): readonly string[] {
  const labels = new Map<string, string>();
  for (const record of records) {
    if (!isRoadmapRecord(record)) continue;
    const language = roadmapLanguage(record);
    const normalized = normalizeText(language);
    if (!labels.has(normalized)) labels.set(normalized, language);
  }
  return [...labels.values()].sort(spanishCollator.compare);
}

export function filterRoadmapRecords(
  records: readonly CollectionRecord[],
  filters: Readonly<RoadmapFilters> = {},
): readonly CollectionRecord[] {
  const query = normalizeText(filters.query ?? "");
  const queryTokens = query.split(" ").filter(Boolean);
  const language = normalizeText(filters.language ?? "all");

  return records.filter((record) => {
    if (!isRoadmapRecord(record)) return false;
    if (filters.type && filters.type !== "all" && record.catalog.objectType !== filters.type) return false;
    if (filters.urgency && filters.urgency !== "all" && roadmapUrgency(record) !== filters.urgency) return false;
    if (language !== "all" && normalizedLanguage(record) !== language) return false;
    if (filters.status && filters.status !== "all" && roadmapProgress(record).status !== filters.status) return false;
    if (query === "") return true;
    const haystack = [
      record.catalog.name,
      record.catalog.setName,
      record.catalog.number,
      record.catalog.idProduct,
      record.notes,
      record.want?.tier,
      record.want?.segment,
      record.want?.goalLanguage,
      record.want?.releaseYear?.toString(),
      record.want?.actionNote,
    ].filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .map(normalizeText)
      .join(" ");
    return queryTokens.every((token) => haystack.includes(token));
  });
}
