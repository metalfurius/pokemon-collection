import { readFile, writeFile } from "node:fs/promises";

const MAX_ENTRIES = 5_000;
const MAX_BYTES = 2 * 1024 * 1024;
const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/build-cardmarket-index.mjs <published-export.json> <derived-index.json>");
  process.exit(1);
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The published catalog input must be a JSON object");
if (typeof input.createdAt !== "string" || Number.isNaN(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO date");
if (typeof input.sourceLabel !== "string" || input.sourceLabel.trim() === "") throw new Error("sourceLabel is required");
if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) throw new Error(`entries must contain at most ${MAX_ENTRIES} products`);

const entries = input.entries.map((entry, index) => {
  if (!entry || typeof entry !== "object") throw new Error(`entries[${index}] is invalid`);
  const idProduct = String(entry.idProduct ?? "").trim();
  const objectType = String(entry.objectType ?? "");
  const categorySlug = String(entry.categorySlug ?? "").trim().toLowerCase();
  const prettySlug = String(entry.prettySlug ?? "").trim().toLowerCase();
  const canonicalPath = String(entry.canonicalPath ?? "").trim();
  const variantKey = String(entry.variantKey ?? "").trim();
  if (!/^\d{1,12}$/.test(idProduct)) throw new Error(`entries[${index}].idProduct must be numeric`);
  if (["single", "graded-card"].includes(objectType)) throw new Error(`entries[${index}] cannot be a single-card type`);
  if (!categorySlug || !prettySlug || !variantKey || !/^\/en\/Pokemon\/Products\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(canonicalPath)) throw new Error(`entries[${index}] is missing a normalized non-single identity`);
  return {
    idProduct,
    name: String(entry.name ?? "").trim(),
    objectType,
    categorySlug: categorySlug.replace(/[^a-z0-9-]/g, "-"),
    prettySlug: prettySlug.replace(/[^a-z0-9-]/g, "-"),
    canonicalPath,
    variantKey,
    ...(entry.setName ? { setName: String(entry.setName).trim() } : {}),
    ...(entry.language ? { language: String(entry.language).trim() } : {}),
    ...(entry.package ? { package: String(entry.package).trim() } : {}),
    ...(Array.isArray(entry.inferredFields) ? { inferredFields: entry.inferredFields } : {}),
  };
});
if (new Set(entries.map((entry) => entry.idProduct)).size !== entries.length) throw new Error("idProduct values must be unique; packaging and language variants must remain separate");

const derived = {
  schemaVersion: 1,
  createdAt: input.createdAt,
  sourceLabel: input.sourceLabel.trim(),
  entries,
  ...(input.lastKnownGood ? { lastKnownGood: input.lastKnownGood } : {}),
};
const serialized = `${JSON.stringify(derived)}\n`;
if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) throw new Error("The derived catalog exceeds the 2 MB bound");
await writeFile(outputPath, serialized, "utf8");
console.log(`Wrote ${entries.length} bounded Cardmarket catalog identities to ${outputPath}`);
