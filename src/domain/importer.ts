import { strFromU8, unzipSync } from "fflate";
import {
  type CollectionRecord,
  type CollectionState,
  createEmptyState,
  isLegacyCardType,
  isObjectType,
  type ObjectType,
  recordRevision,
  stateRevision,
  stableRecordId,
} from "./model";

export interface WorkbookSheet {
  name: string;
  rows: ReadonlyArray<Record<string, unknown>>;
}

export interface WorkbookSource {
  filename: string;
  bytes: Uint8Array;
  sheets: ReadonlyArray<WorkbookSheet>;
}

export interface ImportRowReport {
  sheet: string;
  rowNumber: number;
  outcome: "accepted" | "skipped" | "ambiguous";
  reason: string;
  recordId?: string;
}

export interface ImportProposal {
  recordId: string;
  catalog: CollectionRecord["catalog"];
  holding?: CollectionRecord["holding"];
  want?: CollectionRecord["want"];
  notes?: string;
}

export interface ImportPreview {
  filename: string;
  sourceHashBefore: string;
  sourceHashAfter: string;
  sourceUnchanged: boolean;
  proposals: ImportProposal[];
  rows: ImportRowReport[];
  totals: {
    acceptedRows: number;
    skippedRows: number;
    ambiguousRows: number;
    ownedQuantity: number;
    wantedQuantity: number;
  };
}

export const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const MAX_UNZIPPED_WORKBOOK_BYTES = 80 * 1024 * 1024;

const SHEET_ALIASES: Record<"inventory" | "wants", ReadonlySet<string>> = {
  inventory: new Set(["inventory", "owned", "collection", "holdings"]),
  wants: new Set(["wants", "wanted", "wishlist"]),
};

const COLUMN_ALIASES = {
  name: ["name", "item", "card", "title", "catalogname"],
  type: ["type", "objecttype", "category", "kind"],
  setName: ["set", "setname", "expansion", "series"],
  number: ["number", "cardnumber", "no", "collector number", "collectornumber"],
  quantity: ["quantity", "qty", "count", "amount"],
  status: ["status", "state"],
  condition: ["condition", "quality"],
  language: ["language", "lang"],
  gradingCompany: ["gradingcompany", "grader", "grading", "company"],
  grade: ["grade", "score"],
  priority: ["priority", "wantpriority"],
  notes: ["notes", "note", "comment"],
} as const;

function normalizeHeader(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[\s_-]+/g, "").trim();
}

function sheetKind(sheetName: string): "inventory" | "wants" | undefined {
  const normalized = normalizeHeader(sheetName);
  if (SHEET_ALIASES.inventory.has(normalized)) return "inventory";
  if (SHEET_ALIASES.wants.has(normalized)) return "wants";
  return undefined;
}

function cell(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const keys = Object.keys(row);
  const key = keys.find((candidate) => aliases.includes(normalizeHeader(candidate)));
  return key === undefined ? undefined : row[key];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function parseQuantity(value: unknown): number | undefined {
  const raw = text(value);
  if (raw === "") return 1;
  const quantity = Number(raw.replace(",", "."));
  return Number.isInteger(quantity) && quantity > 0 ? quantity : undefined;
}

function parseType(value: unknown): ObjectType | undefined {
  const raw = normalizeHeader(text(value));
  const aliases: Record<string, ObjectType> = {
    box: "box",
    boosterbox: "box",
    tin: "tin",
    single: "single",
    card: "single",
    graded: "graded-card",
    gradedcard: "graded-card",
    slab: "graded-card",
    accessory: "accessory",
    accessories: "accessory",
    custom: "custom",
  };
  const parsed = aliases[raw] ?? raw;
  return isObjectType(parsed) ? parsed : undefined;
}

function parseStatus(value: unknown, kind: "inventory" | "wants"): "owned" | "opened" | undefined {
  if (kind === "wants") return undefined;
  const raw = normalizeHeader(text(value));
  if (raw === "" || raw === "owned" || raw === "sealed") return "owned";
  if (raw === "opened" || raw === "open") return "opened";
  return undefined;
}

function parsePriority(value: unknown): "low" | "normal" | "high" {
  const raw = normalizeHeader(text(value));
  return raw === "low" || raw === "high" ? raw : "normal";
}

function asWorkbookRows(source: WorkbookSource): ReadonlyArray<WorkbookSheet> {
  return source.sheets;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy as BufferSource);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readWorkbookFile(file: File): Promise<WorkbookSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error("Workbook is larger than the 20 MB local preview limit");
  const lowerName = file.name.toLocaleLowerCase("en-US");
  const sheets = lowerName.endsWith(".csv") || lowerName.endsWith(".tsv")
    ? [parseDelimitedSheet("Inventory", new TextDecoder().decode(bytes), lowerName.endsWith(".tsv") ? "\t" : ",")]
    : parseXlsxSheets(bytes);
  return { filename: file.name, bytes, sheets };
}

function parseDelimitedSheet(name: string, source: string, delimiter: string): WorkbookSheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') { value += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === delimiter) { row.push(value); value = ""; continue; }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cellValue) => cellValue.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    value += character;
  }
  if (value !== "" || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift() ?? [];
  return { name, rows: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, values[index] ?? ""])) ) };
}

function resolveWorkbookRelationshipTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/");
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith("//")) {
    throw new Error("Workbook sheet relationship target is external");
  }

  const packageTarget = normalized.replace(/^\/+/, "");
  const segments: string[] = packageTarget.startsWith("xl/") ? [] : ["xl"];
  for (const segment of packageTarget.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) throw new Error("Workbook sheet relationship target escapes the package root");
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments[0] !== "xl" || segments.length < 2) throw new Error("Workbook sheet relationship target is invalid");
  return segments.join("/");
}

function parseXlsxSheets(bytes: Uint8Array): WorkbookSheet[] {
  const archive = unzipSync(bytes);
  const unzippedBytes = Object.values(archive).reduce((total, content) => total + content.byteLength, 0);
  if (unzippedBytes > MAX_UNZIPPED_WORKBOOK_BYTES) throw new Error("Expanded workbook exceeds the local preview limit");
  const xml = (path: string): XMLDocument => {
    const content = archive[path];
    if (!content) throw new Error(`Workbook is missing ${path}`);
    const document = new DOMParser().parseFromString(strFromU8(content), "application/xml");
    if (document.getElementsByTagName("parsererror").length > 0) throw new Error(`Workbook XML is malformed: ${path}`);
    return document;
  };
  const sharedStrings = archive["xl/sharedStrings.xml"]
    ? Array.from(new DOMParser().parseFromString(strFromU8(archive["xl/sharedStrings.xml"]), "application/xml").getElementsByTagNameNS("*", "si"), (item) => item.textContent ?? "")
    : [];
  const relationships = xml("xl/_rels/workbook.xml.rels");
  const relationshipTargets = new Map<string, string>();
  for (const relationship of Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    const targetMode = relationship.getAttribute("TargetMode");
    if (id && target && targetMode !== "External") relationshipTargets.set(id, target);
  }
  const workbook = xml("xl/workbook.xml");
  const sheets: WorkbookSheet[] = [];
  for (const sheet of Array.from(workbook.getElementsByTagNameNS("*", "sheet"))) {
    const name = sheet.getAttribute("name") ?? "Unnamed sheet";
    const relationshipId = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? sheet.getAttribute("r:id");
    const target = relationshipId ? relationshipTargets.get(relationshipId) : undefined;
    if (!target) continue;
    const sheetPath = resolveWorkbookRelationshipTarget(target);
    const document = xml(sheetPath);
    const rows = Array.from(document.getElementsByTagNameNS("*", "row"));
    const values = rows.map((row) => {
      const cells = Array.from(row.getElementsByTagNameNS("*", "c"));
      const entries: Array<[number, string]> = [];
      for (const cellElement of cells) {
        const reference = cellElement.getAttribute("r") ?? "A1";
        const column = reference.replace(/\d+/g, "");
        const columnIndex = [...column].reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0);
        const type = cellElement.getAttribute("t");
        const valueElement = cellElement.getElementsByTagNameNS("*", "v")[0];
        const inlineElement = cellElement.getElementsByTagNameNS("*", "t")[0];
        const raw = valueElement?.textContent ?? inlineElement?.textContent ?? "";
        const parsed = type === "s" ? (sharedStrings[Number(raw)] ?? "") : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
        entries.push([columnIndex, parsed]);
      }
      return entries;
    });
    const headers = values.shift() ?? [];
    const headerMap = new Map(headers.map(([index, header]) => [index, header || `Column ${index}`]));
    sheets.push({ name, rows: values.map((row) => Object.fromEntries(row.map(([index, value]) => [headerMap.get(index) ?? `Column ${index}`, value]))) });
  }
  return sheets;
}

export async function previewWorkbook(source: WorkbookSource): Promise<ImportPreview> {
  const sourceHashBefore = await sha256Hex(source.bytes);
  const rows: ImportRowReport[] = [];
  const proposalMap = new Map<string, ImportProposal>();

  for (const sheet of asWorkbookRows(source)) {
    const kind = sheetKind(sheet.name);
    sheet.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      if (kind === undefined) {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "skipped", reason: "Sheet name is not recognized" });
        return;
      }

      const name = text(cell(row, COLUMN_ALIASES.name));
      if (name === "") {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "ambiguous", reason: "Missing catalog name" });
        return;
      }

      const objectType = parseType(cell(row, COLUMN_ALIASES.type));
      if (objectType === undefined) {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "ambiguous", reason: "Missing or unsupported object type; choose a non-single product type" });
        return;
      }
      if (isLegacyCardType(objectType)) {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "skipped", reason: "Individual and graded cards are not accepted by new imports; existing records remain restorable" });
        return;
      }

      const quantity = parseQuantity(cell(row, COLUMN_ALIASES.quantity));
      if (quantity === undefined) {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "skipped", reason: "Quantity must be a positive whole number" });
        return;
      }

      const status = parseStatus(cell(row, COLUMN_ALIASES.status), kind);
      if (kind === "inventory" && status === undefined) {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "ambiguous", reason: "Unsupported holding status" });
        return;
      }

      const setName = text(cell(row, COLUMN_ALIASES.setName)) || undefined;
      const number = text(cell(row, COLUMN_ALIASES.number)) || undefined;
      const recordId = stableRecordId({ objectType, name, setName, number });
      const existing = proposalMap.get(recordId);
      const holding = kind === "inventory"
        ? {
            quantity: (existing?.holding?.quantity ?? 0) + quantity,
            status: status ?? "owned",
            condition: text(cell(row, COLUMN_ALIASES.condition)) || undefined,
            language: text(cell(row, COLUMN_ALIASES.language)) || undefined,
            gradingCompany: text(cell(row, COLUMN_ALIASES.gradingCompany)) || undefined,
            grade: Number(text(cell(row, COLUMN_ALIASES.grade))) || undefined,
          }
        : existing?.holding;
      const want = kind === "wants"
        ? { wanted: true, priority: parsePriority(cell(row, COLUMN_ALIASES.priority)) }
        : existing?.want;
      proposalMap.set(recordId, {
        recordId,
        catalog: { catalogId: recordId, objectType, name, setName, number },
        holding,
        want,
        notes: text(cell(row, COLUMN_ALIASES.notes)) || existing?.notes,
      });
      rows.push({ sheet: sheet.name, rowNumber, outcome: "accepted", reason: "Normalized into import proposal", recordId });
    });
  }

  const sourceHashAfter = await sha256Hex(source.bytes);
  const acceptedRows = rows.filter((row) => row.outcome === "accepted").length;
  const skippedRows = rows.filter((row) => row.outcome === "skipped").length;
  const ambiguousRows = rows.filter((row) => row.outcome === "ambiguous").length;
  return {
    filename: source.filename,
    sourceHashBefore,
    sourceHashAfter,
    sourceUnchanged: sourceHashBefore === sourceHashAfter,
    proposals: [...proposalMap.values()],
    rows,
    totals: {
      acceptedRows,
      skippedRows,
      ambiguousRows,
      ownedQuantity: [...proposalMap.values()].reduce((sum, proposal) => sum + (proposal.holding?.quantity ?? 0), 0),
      wantedQuantity: [...proposalMap.values()].filter((proposal) => proposal.want?.wanted).length,
    },
  };
}

export function applyImport(
  current: CollectionState,
  preview: ImportPreview,
  now = new Date().toISOString(),
): CollectionState {
  if (!preview.sourceUnchanged) throw new Error("Source workbook changed during preview");
  const byId = new Map(current.records.map((record) => [record.id, record]));
  for (const proposal of preview.proposals) {
    const existing = byId.get(proposal.recordId);
    if (existing === undefined) {
      byId.set(proposal.recordId, {
        id: proposal.recordId,
        catalog: proposal.catalog,
        holding: proposal.holding,
        want: proposal.want,
        notes: proposal.notes,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      });
      continue;
    }
    byId.set(proposal.recordId, {
      ...existing,
      catalog: proposal.catalog,
      holding: proposal.holding ?? existing.holding,
      want: proposal.want ?? existing.want,
      notes: proposal.notes ?? existing.notes,
      updatedAt: now,
      revision: recordRevision(existing) + 1,
    });
  }
  return { ...current, schemaVersion: 1, records: [...byId.values()], revision: stateRevision(current) + 1, updatedAt: now };
}

export function emptyWorkbookSource(filename = "synthetic-workbook.xlsx"): WorkbookSource {
  return { filename, bytes: new TextEncoder().encode("synthetic-only-workbook"), sheets: [] };
}

export function createWorkbookSourceFromRows(
  sheets: ReadonlyArray<WorkbookSheet>,
  filename = "synthetic-workbook.xlsx",
): WorkbookSource {
  const serialized = JSON.stringify(sheets);
  return { filename, bytes: new TextEncoder().encode(serialized), sheets };
}

export function createEmptyImportState(): CollectionState {
  return createEmptyState();
}
