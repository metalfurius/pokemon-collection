import {
  isNewFlowObjectType,
  type NewFlowObjectType,
  type ObjectType,
} from "./model";

export const CARDMARKET_INDEX_SCHEMA_VERSION = 1 as const;
export const MAX_CARDMARKET_INDEX_ENTRIES = 5_000;
export const MAX_CARDMARKET_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_CARDMARKET_URL_LENGTH = 2_048;
export const CARDMARKET_INDEX_MAX_AGE_DAYS = 45;

const CARDMARKET_HOSTS = new Set(["cardmarket.com", "www.cardmarket.com"]);
const FORBIDDEN_PRODUCT_PATH_PARTS = new Set([
  "offer",
  "offers",
  "seller",
  "sellers",
  "search",
  "single-cards",
  "singles",
  "graded-cards",
  "graded",
  "category",
  "categories",
  "users",
  "user",
  "sell",
]);

export type CardmarketCatalogObjectType = Exclude<ObjectType, "single" | "graded-card">;

export type CardmarketFieldKey = "name" | "category" | "setName" | "language" | "package";

export interface CardmarketFieldState {
  key: CardmarketFieldKey;
  value?: string;
  state: "published" | "inferred" | "missing";
}

export interface CardmarketCatalogEntry {
  idProduct: string;
  name: string;
  objectType: CardmarketCatalogObjectType;
  categorySlug: string;
  prettySlug: string;
  canonicalPath: string;
  variantKey: string;
  setName?: string;
  language?: string;
  package?: string;
  inferredFields?: readonly CardmarketFieldKey[];
}

export interface CardmarketIndexSnapshot {
  createdAt: string;
  sourceLabel: string;
  entries: readonly CardmarketCatalogEntry[];
}

export interface CardmarketCatalogIndex {
  schemaVersion: typeof CARDMARKET_INDEX_SCHEMA_VERSION;
  createdAt: string;
  sourceLabel: string;
  entries: readonly CardmarketCatalogEntry[];
  /** A complete prior snapshot used only when the current snapshot is unusable. */
  lastKnownGood?: CardmarketIndexSnapshot;
}

export type CardmarketIndexUse = "fresh" | "stale" | "last-known-good" | "empty";

export interface UsableCardmarketCatalog {
  snapshot: CardmarketIndexSnapshot;
  use: CardmarketIndexUse;
  ageDays: number;
}

export type CardmarketUrlIssue =
  | "empty"
  | "too-long"
  | "invalid-url"
  | "non-https"
  | "unsupported-host"
  | "seller-or-offer"
  | "not-product"
  | "single-card"
  | "invalid-id-product";

export interface CanonicalCardmarketUrl {
  sourceUrl: string;
  canonicalUrl: string;
  canonicalPath: string;
  idProduct?: string;
  categorySlug?: string;
  prettySlug?: string;
}

export interface CardmarketResolution {
  status: "invalid" | "zero" | "exact" | "single" | "multiple";
  message: string;
  sourceUrl: string;
  canonicalUrl?: string;
  canonicalPath?: string;
  idProduct?: string;
  categorySlug?: string;
  prettySlug?: string;
  candidates: readonly CardmarketCatalogEntry[];
  catalog: UsableCardmarketCatalog;
  issue?: CardmarketUrlIssue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeIdProduct(value: string): string {
  return value.trim();
}

function isValidIdProduct(value: string): boolean {
  return /^\d{1,12}$/.test(value);
}

export function cardmarketProductUrl(idProduct: string): string {
  const normalized = normalizeIdProduct(idProduct);
  if (!isValidIdProduct(normalized)) throw new Error("Cardmarket idProduct is invalid");
  return `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${normalized}`;
}

function isValidCatalogObjectType(value: unknown): value is CardmarketCatalogObjectType {
  return typeof value === "string" && isNewFlowObjectType(value as ObjectType);
}

function validFieldKey(value: unknown): value is CardmarketFieldKey {
  return value === "name" || value === "category" || value === "setName" || value === "language" || value === "package";
}

function validateEntry(value: unknown, path: string): CardmarketCatalogEntry {
  if (!isRecord(value)) throw new Error(`${path} is not an object`);
  const idProduct = typeof value.idProduct === "string" ? normalizeIdProduct(value.idProduct) : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const categorySlug = typeof value.categorySlug === "string" ? normalizeSlug(value.categorySlug) : "";
  const prettySlug = typeof value.prettySlug === "string" ? normalizeSlug(value.prettySlug) : "";
  const canonicalPath = typeof value.canonicalPath === "string" ? value.canonicalPath.trim() : "";
  const variantKey = typeof value.variantKey === "string" ? value.variantKey.trim() : "";
  if (!isValidIdProduct(idProduct)) throw new Error(`${path}.idProduct is invalid`);
  if (name === "" || name.length > 240) throw new Error(`${path}.name is invalid`);
  if (!isValidCatalogObjectType(value.objectType)) throw new Error(`${path}.objectType is not a non-single type`);
  if (categorySlug === "" || prettySlug === "" || variantKey === "") throw new Error(`${path} is missing normalized identity fields`);
  if (canonicalPath !== "/en/Pokemon/Products" && !/^\/en\/Pokemon\/Products\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(canonicalPath)) {
    throw new Error(`${path}.canonicalPath is invalid`);
  }
  if (value.setName !== undefined && (typeof value.setName !== "string" || value.setName.trim().length > 240)) throw new Error(`${path}.setName is invalid`);
  if (value.language !== undefined && (typeof value.language !== "string" || value.language.trim().length > 40)) throw new Error(`${path}.language is invalid`);
  if (value.package !== undefined && (typeof value.package !== "string" || value.package.trim().length > 120)) throw new Error(`${path}.package is invalid`);
  if (value.inferredFields !== undefined && (!Array.isArray(value.inferredFields) || !value.inferredFields.every(validFieldKey))) throw new Error(`${path}.inferredFields is invalid`);
  return {
    idProduct,
    name,
    objectType: value.objectType,
    categorySlug,
    prettySlug,
    canonicalPath,
    variantKey,
    ...(value.setName ? { setName: String(value.setName).trim() } : {}),
    ...(value.language ? { language: String(value.language).trim() } : {}),
    ...(value.package ? { package: String(value.package).trim() } : {}),
    ...(Array.isArray(value.inferredFields) && value.inferredFields.length ? { inferredFields: [...value.inferredFields] as CardmarketFieldKey[] } : {}),
  };
}

function validateSnapshot(value: unknown, path: string): CardmarketIndexSnapshot {
  if (!isRecord(value) || !isIsoDate(value.createdAt) || typeof value.sourceLabel !== "string" || value.sourceLabel.trim() === "" || !Array.isArray(value.entries)) {
    throw new Error(`${path} is invalid`);
  }
  if (value.entries.length > MAX_CARDMARKET_INDEX_ENTRIES) throw new Error(`${path}.entries exceeds the bounded catalog limit`);
  const entries = value.entries.map((entry, index) => validateEntry(entry, `${path}.entries[${index}]`));
  const ids = new Set(entries.map((entry) => entry.idProduct));
  if (ids.size !== entries.length) throw new Error(`${path}.entries contains duplicate idProduct values`);
  return { createdAt: value.createdAt, sourceLabel: value.sourceLabel.trim(), entries };
}

export function validateCardmarketIndex(value: unknown): CardmarketCatalogIndex {
  if (!isRecord(value) || value.schemaVersion !== CARDMARKET_INDEX_SCHEMA_VERSION || !isIsoDate(value.createdAt) || typeof value.sourceLabel !== "string" || !Array.isArray(value.entries)) {
    throw new Error("Cardmarket catalog index has an unsupported schema");
  }
  const current = validateSnapshot({ createdAt: value.createdAt, sourceLabel: value.sourceLabel, entries: value.entries }, "index");
  const lastKnownGood = value.lastKnownGood === undefined ? undefined : validateSnapshot(value.lastKnownGood, "index.lastKnownGood");
  const candidate: CardmarketCatalogIndex = {
    schemaVersion: CARDMARKET_INDEX_SCHEMA_VERSION,
    createdAt: current.createdAt,
    sourceLabel: current.sourceLabel,
    entries: current.entries,
    ...(lastKnownGood ? { lastKnownGood } : {}),
  };
  const encodedBytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
  if (encodedBytes > MAX_CARDMARKET_INDEX_BYTES) throw new Error("Cardmarket catalog index exceeds the 2 MB limit");
  return candidate;
}

export function createCardmarketIndex(
  entries: readonly CardmarketCatalogEntry[],
  createdAt: string,
  sourceLabel = "Cardmarket published non-single catalog",
  lastKnownGood?: CardmarketIndexSnapshot,
): CardmarketCatalogIndex {
  return validateCardmarketIndex({
    schemaVersion: CARDMARKET_INDEX_SCHEMA_VERSION,
    createdAt,
    sourceLabel,
    entries,
    ...(lastKnownGood ? { lastKnownGood } : {}),
  });
}

export function serializeCardmarketIndex(index: CardmarketCatalogIndex): string {
  return JSON.stringify(validateCardmarketIndex(index));
}

export function parseCardmarketIndex(serialized: string): CardmarketCatalogIndex {
  try {
    return validateCardmarketIndex(JSON.parse(serialized) as unknown);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Cardmarket catalog index is invalid");
  }
}

function ageInDays(createdAt: string, now: string): number {
  return Math.max(0, (Date.parse(now) - Date.parse(createdAt)) / 86_400_000);
}

export function usableCardmarketCatalog(index: CardmarketCatalogIndex, now = new Date().toISOString()): UsableCardmarketCatalog {
  let current: CardmarketIndexSnapshot | undefined;
  try {
    current = validateSnapshot({ createdAt: index.createdAt, sourceLabel: index.sourceLabel, entries: index.entries }, "index");
  } catch {
    current = undefined;
  }
  if (current && current.entries.length > 0) {
    const ageDays = ageInDays(current.createdAt, now);
    return { snapshot: current, ageDays, use: ageDays > CARDMARKET_INDEX_MAX_AGE_DAYS ? "stale" : "fresh" };
  }
  if (index.lastKnownGood) {
    const fallback = validateSnapshot(index.lastKnownGood, "index.lastKnownGood");
    return { snapshot: fallback, ageDays: ageInDays(fallback.createdAt, now), use: "last-known-good" };
  }
  const empty: CardmarketIndexSnapshot = {
    createdAt: index.createdAt,
    sourceLabel: index.sourceLabel,
    entries: [],
  };
  return { snapshot: empty, ageDays: ageInDays(empty.createdAt, now), use: "empty" };
}

function pathIssue(parts: readonly string[]): CardmarketUrlIssue | undefined {
  const normalized = parts.map(normalizeSlug);
  if (normalized.some((part) => FORBIDDEN_PRODUCT_PATH_PARTS.has(part))) {
    if (normalized.some((part) => ["offer", "offers", "seller", "sellers", "users", "user", "sell"].includes(part))) return "seller-or-offer";
    if (normalized.some((part) => ["single-cards", "singles", "graded-cards", "graded"].includes(part))) return "single-card";
    return "not-product";
  }
  return undefined;
}

export function canonicalizeCardmarketUrl(input: string): CanonicalCardmarketUrl | { issue: CardmarketUrlIssue; sourceUrl: string } {
  const sourceUrl = input.trim();
  if (sourceUrl === "") return { issue: "empty", sourceUrl };
  if (sourceUrl.length > MAX_CARDMARKET_URL_LENGTH) return { issue: "too-long", sourceUrl };
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return { issue: "invalid-url", sourceUrl };
  }
  if (url.protocol !== "https:") return { issue: "non-https", sourceUrl };
  if (!CARDMARKET_HOSTS.has(url.hostname.toLocaleLowerCase("en-US")) || url.username || url.password || url.port) return { issue: "unsupported-host", sourceUrl };
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return { issue: "invalid-url", sourceUrl };
  }
  const pokemonIndex = parts.findIndex((part) => normalizeSlug(part) === "pokemon");
  if (pokemonIndex < 0 || normalizeSlug(parts[pokemonIndex + 1] ?? "") !== "products") return { issue: "not-product", sourceUrl };
  const afterProducts = parts.slice(pokemonIndex + 2);
  const issue = pathIssue(afterProducts);
  if (issue) return { issue, sourceUrl };
  let idProduct: string | undefined;
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLocaleLowerCase("en-US") !== "idproduct") continue;
    const normalized = normalizeIdProduct(value);
    if (!isValidIdProduct(normalized)) return { issue: "invalid-id-product", sourceUrl };
    if (idProduct !== undefined && idProduct !== normalized) return { issue: "invalid-id-product", sourceUrl };
    idProduct = normalized;
  }

  if (afterProducts.length === 0) {
    if (!idProduct) return { issue: "not-product", sourceUrl };
    return {
      sourceUrl,
      canonicalPath: "/en/Pokemon/Products",
      canonicalUrl: cardmarketProductUrl(idProduct),
      idProduct,
    };
  }
  if (afterProducts.length !== 2) return { issue: "not-product", sourceUrl };
  const categorySlug = normalizeSlug(afterProducts[0] ?? "");
  const prettySlug = normalizeSlug(afterProducts[1] ?? "");
  if (categorySlug === "" || prettySlug === "") return { issue: "not-product", sourceUrl };
  const canonicalPath = `/en/Pokemon/Products/${categorySlug}/${prettySlug}`;
  return {
    sourceUrl,
    canonicalPath,
    canonicalUrl: idProduct ? cardmarketProductUrl(idProduct) : `https://www.cardmarket.com${canonicalPath}`,
    ...(idProduct ? { idProduct } : {}),
    categorySlug,
    prettySlug,
  };
}

function catalogStatusLabel(use: CardmarketIndexUse): string {
  if (use === "fresh") return "Índice fresco";
  if (use === "stale") return "Índice antiguo";
  if (use === "last-known-good") return "Último índice válido";
  return "Índice vacío";
}

export function describeCardmarketEntry(entry: CardmarketCatalogEntry): readonly CardmarketFieldState[] {
  const inferred = new Set(entry.inferredFields ?? []);
  const field = (key: CardmarketFieldKey, value: string | undefined): CardmarketFieldState => ({
    key,
    ...(value ? { value } : {}),
    state: value ? inferred.has(key) ? "inferred" : "published" : "missing",
  });
  return [
    field("name", entry.name),
    field("category", entry.categorySlug),
    field("setName", entry.setName),
    field("language", entry.language),
    field("package", entry.package),
  ];
}

export function resolveCardmarketProduct(
  sourceUrl: string,
  index: CardmarketCatalogIndex,
  now = new Date().toISOString(),
): CardmarketResolution {
  const catalog = usableCardmarketCatalog(index, now);
  const parsed = canonicalizeCardmarketUrl(sourceUrl);
  if ("issue" in parsed) {
    return {
      status: "invalid",
      message: issueMessage(parsed.issue),
      sourceUrl: parsed.sourceUrl,
      candidates: [],
      catalog,
      issue: parsed.issue,
    };
  }
  const { entries } = catalog.snapshot;
  const exact = parsed.idProduct ? entries.find((entry) => entry.idProduct === parsed.idProduct) : undefined;
  const candidates = exact
    ? [exact]
    : entries.filter((entry) => entry.categorySlug === parsed.categorySlug && entry.prettySlug === parsed.prettySlug);
  const status = exact ? "exact" : candidates.length === 0 ? "zero" : candidates.length === 1 ? "single" : "multiple";
  const resolvedEntry = candidates.length === 1 ? candidates[0] : undefined;
  const message = exact
    ? "Producto identificado por idProduct."
    : candidates.length === 0
      ? "No hay coincidencias en el índice local."
      : candidates.length === 1
        ? "Producto identificado por categoría y enlace."
        : "Hay varias variantes; elige una antes de continuar.";
  return {
    status,
    message: `${message} ${catalogStatusLabel(catalog.use)} (${catalog.snapshot.createdAt.slice(0, 10)}).`,
    sourceUrl: parsed.sourceUrl,
    canonicalUrl: resolvedEntry ? cardmarketProductUrl(resolvedEntry.idProduct) : parsed.canonicalUrl,
    canonicalPath: resolvedEntry ? "/en/Pokemon/Products" : parsed.canonicalPath,
    ...(resolvedEntry ? { idProduct: resolvedEntry.idProduct } : parsed.idProduct ? { idProduct: parsed.idProduct } : {}),
    ...(parsed.categorySlug ? { categorySlug: parsed.categorySlug } : {}),
    ...(parsed.prettySlug ? { prettySlug: parsed.prettySlug } : {}),
    candidates,
    catalog,
  };
}

/**
 * Resolves an imported product label without fuzzy matching or private aliases.
 * A normalized published name is authoritative only when it is unique for the
 * requested type. Box labels may omit the generic trailing "Booster Box" when
 * the remaining label is descriptive and still identifies exactly one entry.
 */
export function resolveCardmarketProductByName(
  name: string,
  objectType: ObjectType,
  index: CardmarketCatalogIndex,
): CardmarketCatalogEntry | undefined {
  const normalizedName = normalizeSlug(name);
  if (normalizedName === "") return undefined;
  const candidates = usableCardmarketCatalog(index).snapshot.entries
    .filter((entry) => entry.objectType === objectType);
  const exact = candidates.filter((entry) => normalizeSlug(entry.name) === normalizedName);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;

  if (objectType !== "box" || normalizedName.endsWith("-booster-box")) return undefined;
  const tokens = normalizedName.split("-").filter(Boolean);
  if (tokens.length < 2 || tokens.join("").length < 4) return undefined;
  const publishedName = `${normalizedName}-booster-box`;
  const suffixMatches = candidates.filter((entry) => normalizeSlug(entry.name) === publishedName);
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function issueMessage(issue: CardmarketUrlIssue): string {
  switch (issue) {
    case "empty": return "Pega un enlace de producto.";
    case "too-long": return "El enlace supera el límite seguro de 2.048 caracteres.";
    case "invalid-url": return "El texto no es un enlace válido.";
    case "non-https": return "Solo se admiten enlaces HTTPS.";
    case "unsupported-host": return "El enlace debe pertenecer a Cardmarket y no incluir credenciales.";
    case "seller-or-offer": return "Los enlaces de vendedor u oferta no son productos identificables.";
    case "single-card": return "Las cartas individuales y graduadas quedan fuera de los nuevos flujos.";
    case "invalid-id-product": return "El idProduct del enlace no es válido.";
    case "not-product": return "Pega un enlace de producto Pokémon no-single, no una búsqueda o lista.";
  }
}

export function cardmarketEntryAsNewFlowType(entry: CardmarketCatalogEntry): NewFlowObjectType {
  return entry.objectType;
}
