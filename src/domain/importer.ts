import { strFromU8, unzipSync } from "fflate";
import {
  type CollectionRecord,
  type CollectionState,
  createEmptyState,
  holdingWithCounts,
  isLegacyCardType,
  isObjectType,
  type ObjectType,
  openedQuantity,
  recordRevision,
  roadmapProgress,
  sealedQuantity,
  stateRevision,
  stableRecordId,
  totalHoldingQuantity,
} from "./model";
import {
  cardmarketProductUrl,
  resolveCardmarketProductByName,
  type CardmarketCatalogIndex,
} from "./cardmarket";

export interface WorkbookSheet {
  name: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  /** One-based source row containing the headers, when known. */
  headerRowNumber?: number;
  /** One-based source row for every normalized data row, when known. */
  sourceRowNumbers?: readonly number[];
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
    roadmapItems: number;
    completedSteps: number;
    targetSteps: number;
  };
}

export const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const MAX_UNZIPPED_WORKBOOK_BYTES = 80 * 1024 * 1024;

type SheetKind = "inventory" | "wants" | "roadmap-boxes" | "roadmap-tins";

const SHEET_ALIASES: Record<SheetKind, ReadonlySet<string>> = {
  inventory: new Set(["inventory", "owned", "collection", "holdings", "coleccion"]),
  wants: new Set(["wants", "wanted", "wishlist", "quiero", "deseos"]),
  "roadmap-boxes": new Set(["cajasmaster", "cajas", "boxmaster"]),
  "roadmap-tins": new Set(["tinsmaster", "tins", "latasmaster"]),
};

const COLUMN_ALIASES = {
  name: ["name", "item", "card", "title", "catalogname", "caja", "tin/display", "tin", "producto"],
  type: ["type", "objecttype", "category", "kind"],
  setName: ["set", "setname", "expansion", "series"],
  number: ["number", "cardnumber", "no", "collector number", "collectornumber"],
  code: ["code", "codigo"],
  order: ["#", "order", "orden"],
  quantity: ["quantity", "qty", "count", "amount", "unidades totales"],
  status: ["status", "state"],
  condition: ["condition", "quality"],
  language: ["language", "lang", "idioma", "idioma objetivo"],
  gradingCompany: ["gradingcompany", "grader", "grading", "company"],
  grade: ["grade", "score"],
  priority: ["priority", "wantpriority", "urgencia"],
  notes: ["notes", "note", "comment", "nota"],
  year: ["year", "ano"],
  segment: ["segment", "segmento"],
  tier: ["tier"],
  urgency: ["urgency", "urgencia"],
  objective: ["objective", "objetivo"],
  openTarget: ["open target", "want open", "abrir objetivo"],
  opened: ["opened", "owned opened", "abierta?", "abierta"],
  sealed: ["owned sealed", "selladas", "guardadas"],
  have: ["have", "owned?", "tienes?", "tienes"],
  collection: ["collection", "coleccion"],
  action: ["action", "tesis/accion", "tesis / accion", "que haria"],
  priceCeiling: ["price ceiling", "max all-in hoy €", "max all-in hoy", "precio objetivo razonable €", "precio objetivo razonable"],
  priceStatus: ["price status", "estado precio", "estado"],
  priceDate: ["price date", "fecha precio"],
  source: ["source", "fuente", "fuente/verificacion", "fuente / verificacion"],
} as const;

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_.-]+/g, "")
    .trim();
}

function sheetKind(sheetName: string): SheetKind | undefined {
  const normalized = normalizeHeader(sheetName);
  for (const [kind, aliases] of Object.entries(SHEET_ALIASES) as Array<[SheetKind, ReadonlySet<string>]>) {
    if (aliases.has(normalized)) return kind;
  }
  return undefined;
}

function cell(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const keys = Object.keys(row);
  const normalizedAliases = aliases.map(normalizeHeader);
  const key = keys.find((candidate) => normalizedAliases.includes(normalizeHeader(candidate)));
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

function parseNonNegativeQuantity(value: unknown, fallback = 0): number | undefined {
  const raw = text(value);
  if (raw === "") return fallback;
  const quantity = Number(raw.replace(",", "."));
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : undefined;
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

function parseStatus(value: unknown, kind: SheetKind): "owned" | "opened" | undefined {
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

function parseYes(value: unknown): boolean {
  const raw = normalizeHeader(text(value));
  return ["si", "yes", "true", "1", "x"].includes(raw) || raw.startsWith("si(") || raw.startsWith("yes(");
}

function parseUrgency(value: unknown): NonNullable<CollectionRecord["want"]>["urgency"] {
  const raw = normalizeHeader(text(value));
  if (raw.includes("nocomprar") || raw.includes("donotbuy")) return "do-not-buy";
  if (raw.includes("esperarlanzamiento") || raw.includes("waitlaunch")) return "wait-launch";
  if (raw.includes("esperar") || raw === "wait") return "wait";
  if (raw.includes("oportun") || raw.includes("opportun")) return "opportunistic";
  if (raw.includes("muyalta") || raw.includes("critica") || raw.includes("critical")) return "critical";
  if (raw.includes("alta") || raw === "high") return "high";
  if (raw.includes("baja") || raw === "low") return "low";
  return "medium";
}

function priorityForUrgency(urgency: NonNullable<CollectionRecord["want"]>["urgency"]): "low" | "normal" | "high" {
  return urgency === "critical" || urgency === "high" ? "high" : ["low", "wait", "wait-launch", "do-not-buy"].includes(urgency ?? "") ? "low" : "normal";
}

function parseYear(value: unknown): number | undefined {
  const year = Number(text(value));
  return Number.isInteger(year) && year >= 1996 && year <= 2200 ? year : undefined;
}

function parseMoneyMinor(value: unknown): number | undefined {
  const raw = text(value).replace(/\s/g, "").replace(/€/g, "");
  if (raw === "") return undefined;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : undefined;
}

function parsePriceDate(value: unknown): string | undefined {
  const raw = text(value);
  if (raw === "") return undefined;
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? raw.slice(0, 80) : parsed.toISOString().slice(0, 10);
}

function parseCardmarketIdentity(value: unknown): Partial<CollectionRecord["catalog"]> {
  const raw = text(value);
  if (raw === "") return {};
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/(^|\.)cardmarket\.com$/i.test(url.hostname)) return {};
    url.username = "";
    url.password = "";
    url.hash = "";
    const parts = url.pathname.split("/").filter(Boolean);
    const productsIndex = parts.findIndex((part) => part.toLocaleLowerCase("en-US") === "products");
    const idProduct = url.searchParams.get("idProduct") ?? undefined;
    const productPath = productsIndex >= 0 ? parts.slice(productsIndex + 1) : [];
    const forbiddenSegments = new Set(["users", "offers", "expansions", "search"]);
    const hasStableId = productsIndex >= 0 && idProduct !== undefined && /^\d+$/.test(idProduct);
    const hasProductPath = productPath.length === 2 && !productPath.some((part) => forbiddenSegments.has(part.toLocaleLowerCase("en-US")));
    if (!hasStableId && !hasProductPath) return {};
    const prettySlug = hasProductPath ? productPath.at(-1) : undefined;
    const categorySlug = hasProductPath ? productPath.at(-2) : undefined;
    const sourceUrl = hasStableId
      ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${encodeURIComponent(idProduct)}`
      : url.toString();
    return {
      source: "cardmarket",
      sourceUrl,
      idProduct: hasStableId ? idProduct : undefined,
      prettySlug,
      categorySlug,
    };
  } catch {
    return {};
  }
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
    const values = rows.map((row, rowIndex) => {
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
      return { sourceRowNumber: Number(row.getAttribute("r")) || rowIndex + 1, entries };
    });
    const normalizedSheetName = normalizeHeader(name);
    const headerIndex = values.findIndex((row, index) => {
      if (index > 14) return false;
      const headings = new Set(row.entries.map(([, value]) => normalizeHeader(value)));
      if (normalizedSheetName === "cajasmaster") return headings.has("caja") && headings.has("unidadestotales");
      if (normalizedSheetName === "tinsmaster") return headings.has("tin/display") && headings.has("tienes?");
      return index === 0;
    });
    const safeHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
    const headers = values[safeHeaderIndex]?.entries ?? [];
    const headerMap = new Map(headers.map(([index, header]) => [index, header || `Column ${index}`]));
    const dataRows = values.slice(safeHeaderIndex + 1);
    sheets.push({
      name,
      headerRowNumber: values[safeHeaderIndex]?.sourceRowNumber ?? safeHeaderIndex + 1,
      sourceRowNumbers: dataRows.map((row) => row.sourceRowNumber),
      rows: dataRows.map((row) => Object.fromEntries(row.entries.map(([index, value]) => [headerMap.get(index) ?? `Column ${index}`, value]))),
    });
  }
  return sheets;
}

export async function previewWorkbook(source: WorkbookSource, cardmarketIndex?: CardmarketCatalogIndex): Promise<ImportPreview> {
  const sourceHashBefore = await sha256Hex(source.bytes);
  const rows: ImportRowReport[] = [];
  const proposalMap = new Map<string, ImportProposal>();

  for (const sheet of asWorkbookRows(source)) {
    const kind = sheetKind(sheet.name);
    sheet.rows.forEach((row, index) => {
      const rowNumber = sheet.sourceRowNumbers?.[index] ?? (sheet.headerRowNumber ?? 1) + index + 1;
      if (!Object.values(row).some((value) => text(value) !== "")) return;
      if (kind === undefined) {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "skipped", reason: "Sheet name is not recognized" });
        return;
      }

      const name = text(cell(row, COLUMN_ALIASES.name));
      if (name === "") {
        rows.push({ sheet: sheet.name, rowNumber, outcome: "ambiguous", reason: "Missing catalog name" });
        return;
      }

      if (kind === "roadmap-boxes" || kind === "roadmap-tins") {
        const order = parseNonNegativeQuantity(cell(row, COLUMN_ALIASES.order), index + 1) ?? index + 1;
        const releaseYear = parseYear(cell(row, COLUMN_ALIASES.year));
        const urgency = parseUrgency(cell(row, COLUMN_ALIASES.urgency));
        const goalLanguage = text(cell(row, COLUMN_ALIASES.language)) || undefined;
        const sourceIdentity = parseCardmarketIdentity(cell(row, COLUMN_ALIASES.source));
        const priceCeilingMinor = parseMoneyMinor(cell(row, COLUMN_ALIASES.priceCeiling));
        const priceStatus = text(cell(row, COLUMN_ALIASES.priceStatus)) || undefined;
        const priceObservedAt = parsePriceDate(cell(row, COLUMN_ALIASES.priceDate));
        const actionNote = text(cell(row, COLUMN_ALIASES.action)) || undefined;
        const sourceNote = text(cell(row, COLUMN_ALIASES.collection));

        if (kind === "roadmap-boxes") {
          const segment = text(cell(row, COLUMN_ALIASES.segment)) || (releaseYear ? `Cajas ${releaseYear}` : "Cajas");
          const tier = text(cell(row, COLUMN_ALIASES.tier)) || undefined;
          const code = text(cell(row, COLUMN_ALIASES.code)) || `${goalLanguage ?? "UND"}-${order}`;
          const rawOpenTarget = normalizeHeader(text(cell(row, COLUMN_ALIASES.openTarget)));
          const objective = normalizeHeader(text(cell(row, COLUMN_ALIASES.objective)));
          const openGoalMode = rawOpenTarget.includes("opcional") || rawOpenTarget.includes("optional")
            ? "optional" as const
            : parseYes(cell(row, COLUMN_ALIASES.openTarget)) || objective.includes("abierta") || objective.includes("opened")
              ? "required" as const
              : "none" as const;
          const targetSealedQuantity = 1;
          const targetOpenedQuantity = openGoalMode === "none" ? 0 : 1;
          const total = parseNonNegativeQuantity(cell(row, COLUMN_ALIASES.quantity));
          if (total === undefined) {
            rows.push({ sheet: sheet.name, rowNumber, outcome: "ambiguous", reason: "Unidades totales must be a non-negative whole number" });
            return;
          }
          const actualOpened = parseYes(cell(row, COLUMN_ALIASES.opened)) ? Math.min(1, total) : 0;
          const actualSealed = Math.max(0, total - actualOpened);
          const catalogSeed = { objectType: "box" as const, name, setName: segment, number: code };
          const recordId = stableRecordId(catalogSeed);
          proposalMap.set(recordId, {
            recordId,
            catalog: { catalogId: recordId, ...catalogSeed, ...sourceIdentity },
            holding: holdingWithCounts(goalLanguage ? { quantity: 1, status: "owned", language: goalLanguage } : undefined, actualSealed, actualOpened),
            want: {
              wanted: true,
              priority: priorityForUrgency(urgency),
              quantity: targetSealedQuantity + targetOpenedQuantity,
              targetSealedQuantity,
              targetOpenedQuantity,
              openGoalMode,
              urgency,
              goalLanguage,
              tier,
              segment,
              releaseYear,
              roadmapOrder: order,
              priceCeilingMinor,
              currency: priceCeilingMinor === undefined ? undefined : "EUR",
              priceStatus,
              priceObservedAt,
              actionNote,
              isRoadmap: true,
            },
            notes: sourceNote ? `Colección: ${sourceNote}` : undefined,
          });
          rows.push({ sheet: sheet.name, rowNumber, outcome: "accepted", reason: "Roadmap box: separate keep/open goals and holdings", recordId });
          return;
        }

        const objectType: ObjectType = "tin";
        const theme = text(cell(row, ["tema / pokemon", "tema", "pokemon"]));
        const segment = releaseYear ? `Tins y displays · ${releaseYear}` : "Tins y displays";
        const number = String(order);
        const actualSealed = parseYes(cell(row, COLUMN_ALIASES.have)) ? 1 : 0;
        const catalogSeed = { objectType, name, setName: theme || segment, number };
        const recordId = stableRecordId(catalogSeed);
        proposalMap.set(recordId, {
          recordId,
          catalog: { catalogId: recordId, ...catalogSeed, ...sourceIdentity },
          holding: holdingWithCounts(goalLanguage ? { quantity: 1, status: "owned", language: goalLanguage } : undefined, actualSealed, 0),
          want: {
            wanted: true,
            priority: priorityForUrgency(urgency),
            quantity: 1,
            targetSealedQuantity: 1,
            targetOpenedQuantity: 0,
            openGoalMode: "none",
            urgency,
            goalLanguage,
            segment,
            releaseYear,
            roadmapOrder: order,
            priceCeilingMinor,
            currency: priceCeilingMinor === undefined ? undefined : "EUR",
            priceStatus,
            priceObservedAt,
            actionNote,
            isRoadmap: true,
          },
          notes: text(cell(row, COLUMN_ALIASES.notes)) || sourceNote || undefined,
        });
        rows.push({ sheet: sheet.name, rowNumber, outcome: "accepted", reason: "Roadmap tin/display: one target per artwork", recordId });
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
        ? holdingWithCounts({
            ...(existing?.holding ?? { quantity: 1, status: status ?? "owned" }),
            condition: text(cell(row, COLUMN_ALIASES.condition)) || existing?.holding?.condition,
            language: text(cell(row, COLUMN_ALIASES.language)) || existing?.holding?.language,
            gradingCompany: text(cell(row, COLUMN_ALIASES.gradingCompany)) || existing?.holding?.gradingCompany,
            grade: Number(text(cell(row, COLUMN_ALIASES.grade))) || existing?.holding?.grade,
          },
          sealedQuantity(existing?.holding) + (status === "owned" ? quantity : 0),
          openedQuantity(existing?.holding) + (status === "opened" ? quantity : 0))
        : existing?.holding;
      const want = kind === "wants"
        ? { wanted: true, priority: parsePriority(cell(row, COLUMN_ALIASES.priority)), quantity, targetSealedQuantity: quantity, targetOpenedQuantity: 0, openGoalMode: "none" as const }
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
  const proposals = [...proposalMap.values()].map((proposal) => {
    if (!cardmarketIndex || proposal.catalog.idProduct) return proposal;
    const match = resolveCardmarketProductByName(proposal.catalog.name, proposal.catalog.objectType, cardmarketIndex);
    if (!match) return proposal;
    return {
      ...proposal,
      catalog: {
        ...proposal.catalog,
        source: "cardmarket" as const,
        sourceUrl: cardmarketProductUrl(match.idProduct),
        idProduct: match.idProduct,
        categorySlug: match.categorySlug,
        prettySlug: match.prettySlug,
        variantKey: match.variantKey,
      },
    };
  });
  const proposedRecords = proposals.map((proposal) => ({
    id: proposal.recordId,
    catalog: proposal.catalog,
    holding: proposal.holding,
    want: proposal.want,
    notes: proposal.notes,
    createdAt: "",
    updatedAt: "",
  } satisfies CollectionRecord));
  const roadmapRecords = proposedRecords.filter((record) => record.want?.isRoadmap);
  const roadmapTotals = roadmapRecords.map(roadmapProgress);
  return {
    filename: source.filename,
    sourceHashBefore,
    sourceHashAfter,
    sourceUnchanged: sourceHashBefore === sourceHashAfter,
    proposals,
    rows,
    totals: {
      acceptedRows,
      skippedRows,
      ambiguousRows,
      ownedQuantity: [...proposalMap.values()].reduce((sum, proposal) => sum + totalHoldingQuantity(proposal.holding), 0),
      wantedQuantity: [...proposalMap.values()].filter((proposal) => proposal.want?.wanted).length,
      roadmapItems: roadmapRecords.length,
      completedSteps: roadmapTotals.reduce((sum, progress) => sum + progress.completedSteps, 0),
      targetSteps: roadmapTotals.reduce((sum, progress) => sum + progress.totalSteps, 0),
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
