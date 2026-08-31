import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CARDMARKET_INDEX_BYTES,
  cardmarketProductUrl,
  createCardmarketIndex,
  resolveCardmarketProduct,
  resolveCardmarketProductByName,
  serializeCardmarketIndex,
  type CardmarketCatalogEntry,
} from "../src/domain/cardmarket";
import {
  CARDMARKET_OFFICIAL_CATALOG_CREATED_AT,
  CARDMARKET_OFFICIAL_CATALOG_SHA256,
  CARDMARKET_OFFICIAL_CATALOG_URL,
  officialCardmarketIndex,
} from "../src/data/cardmarket-index.generated";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("official Cardmarket production index", () => {
  it("loads the bounded public Display and Tins snapshot with traceable provenance", () => {
    expect(CARDMARKET_OFFICIAL_CATALOG_URL).toBe(
      "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json",
    );
    expect(CARDMARKET_OFFICIAL_CATALOG_CREATED_AT).toBe(officialCardmarketIndex.createdAt);
    expect(Number.isFinite(Date.parse(CARDMARKET_OFFICIAL_CATALOG_CREATED_AT))).toBe(true);
    expect(CARDMARKET_OFFICIAL_CATALOG_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(officialCardmarketIndex.sourceLabel).toBe("Cardmarket official Pokémon Displays and Tins catalog");
    expect(officialCardmarketIndex.entries).toHaveLength(1_187);
    expect(officialCardmarketIndex.entries.filter(({ objectType }) => objectType === "box")).toHaveLength(617);
    expect(officialCardmarketIndex.entries.filter(({ objectType }) => objectType === "tin")).toHaveLength(570);
    expect(Buffer.byteLength(serializeCardmarketIndex(officialCardmarketIndex), "utf8")).toBeLessThanOrEqual(MAX_CARDMARKET_INDEX_BYTES);
  });

  it("keeps official product IDs authoritative and packaging variants distinct", () => {
    const byId = new Map(officialCardmarketIndex.entries.map((entry) => [entry.idProduct, entry]));
    expect(byId.get("718514")).toMatchObject({
      name: "Pokémon Card 151 Booster Box",
      objectType: "box",
      canonicalPath: "/en/Pokemon/Products",
      variantKey: "cardmarket:718514",
    });
    expect(byId.get("568813")?.name).toBe("Blue Sky Stream Booster Box");
    expect(byId.get("568813")?.language).toBeUndefined();
    expect(byId.get("832232")?.name).toBe("Team Rocket Tins: Team Rocket's Mewtwo ex Tin");
    expect(byId.get("832233")?.name).toBe("Team Rocket Tins: Team Rocket's Mewtwo ex Tin (US Version)");
    expect(new Set(officialCardmarketIndex.entries.map(({ idProduct }) => idProduct)).size).toBe(officialCardmarketIndex.entries.length);
    expect(officialCardmarketIndex.entries.every(({ canonicalPath }) => canonicalPath === "/en/Pokemon/Products")).toBe(true);
  });

  it("resolves ID and pretty product routes to the same stable Cardmarket link", () => {
    const expectedUrl = "https://www.cardmarket.com/en/Pokemon/Products?idProduct=718514";
    const byId = resolveCardmarketProduct(`${expectedUrl}&utm_source=ignored`, officialCardmarketIndex, "2026-08-31T14:00:00.000Z");
    expect(byId).toMatchObject({ status: "exact", idProduct: "718514", canonicalUrl: expectedUrl });
    expect(byId.candidates[0]?.name).toBe("Pokémon Card 151 Booster Box");

    const byPrettyPath = resolveCardmarketProduct(
      "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/Pokemon-Card-151-Booster-Box",
      officialCardmarketIndex,
      "2026-08-31T14:00:00.000Z",
    );
    expect(byPrettyPath).toMatchObject({ status: "single", idProduct: "718514", canonicalUrl: expectedUrl });
    expect(cardmarketProductUrl("718514")).toBe(expectedUrl);
    expect(() => cardmarketProductUrl("not-an-id")).toThrow(/invalid/);
  });

  it("resolves only unique normalized names and safe omitted Booster Box suffixes", () => {
    expect(resolveCardmarketProductByName("pokemon card 151", "box", officialCardmarketIndex)?.idProduct).toBe("718514");
    expect(resolveCardmarketProductByName("  POKÉMON CARD 151 BOOSTER BOX  ", "box", officialCardmarketIndex)?.idProduct).toBe("718514");
    expect(resolveCardmarketProductByName("Mega Charizard X ex Tin", "tin", officialCardmarketIndex)?.idProduct).toBe("862173");
    expect(resolveCardmarketProductByName("Mega Charizard X ex Tin", "box", officialCardmarketIndex)).toBeUndefined();
    expect(resolveCardmarketProductByName("151", "box", officialCardmarketIndex)).toBeUndefined();
  });

  it("does not fuzzy-match ambiguous families, absent variants or duplicate official labels", () => {
    const syntheticIndex = createCardmarketIndex([
      syntheticEntry("1", "Anniversary Celebration: Partner Set Vol.1 Booster Box", "box"),
      syntheticEntry("2", "Anniversary Celebration: Partner Set Vol.2 Booster Box", "box"),
      syntheticEntry("3", "Anniversary Celebration: Partner Set Vol.3 Booster Box", "box"),
      syntheticEntry("4", "Twin Display Booster Box", "box"),
      syntheticEntry("5", "Twin Display Booster Box", "box"),
      syntheticEntry("6", "Battle Hearts: Sun Tin", "tin"),
      syntheticEntry("7", "Battle Hearts: Moon Tin", "tin"),
      syntheticEntry("8", "Powers Beyond: Ember Tin", "tin"),
      syntheticEntry("9", "Powers Beyond: Wave Tin", "tin"),
      syntheticEntry("10", "Powers Beyond: Sky Tin", "tin"),
    ], "2026-08-31T00:00:00.000Z", "Synthetic ambiguity audit");

    expect(resolveCardmarketProductByName("Anniversary Celebration", "box", syntheticIndex)).toBeUndefined();
    expect(resolveCardmarketProductByName("Twin Display Booster Box", "box", syntheticIndex)).toBeUndefined();
    expect(resolveCardmarketProductByName("Twin Display", "box", syntheticIndex)).toBeUndefined();
    expect(resolveCardmarketProductByName("Battle Hearts: Amber Tin", "tin", syntheticIndex)).toBeUndefined();
    expect(resolveCardmarketProductByName("Powers Beyond: Phoenix Tin", "tin", syntheticIndex)).toBeUndefined();
  });
});

describe("official Cardmarket index builder", () => {
  it("filters, sorts and emits a deterministic static TypeScript module", async () => {
    const directory = await makeTemporaryDirectory();
    const inputPath = join(directory, "products_nonsingles_6.json");
    const firstOutputPath = join(directory, "first.ts");
    const secondOutputPath = join(directory, "second.ts");
    const source = {
      version: 1,
      createdAt: "2026-08-31T12:24:44+02:00",
      products: [
        { idProduct: 20, name: "Public Tin", idCategory: 1014, categoryName: "Pokémon Tins" },
        { idProduct: 15, name: "Ignored Public Blister", idCategory: 1007, categoryName: "Pokémon Blisters" },
        { idProduct: 10, name: "Public Display", idCategory: 53, categoryName: "Pokémon Display" },
      ],
    };
    await writeFile(inputPath, JSON.stringify(source), "utf8");

    runBuilder(inputPath, firstOutputPath);
    runBuilder(inputPath, secondOutputPath);
    const first = await readFile(firstOutputPath, "utf8");
    const second = await readFile(secondOutputPath, "utf8");

    expect(first).toBe(second);
    expect(first).toContain(`Source: ${CARDMARKET_OFFICIAL_CATALOG_URL}`);
    expect(first).toContain("Source createdAt: 2026-08-31T12:24:44+02:00");
    expect(first.indexOf('[10, "Public Display", 0]')).toBeLessThan(first.indexOf('[20, "Public Tin", 1]'));
    expect(first).not.toContain("Ignored Public Blister");
    expect(first).toContain('canonicalPath: "/en/Pokemon/Products"');
  });

  it("fails closed when an official supported category changes identity", async () => {
    const directory = await makeTemporaryDirectory();
    const inputPath = join(directory, "products_nonsingles_6.json");
    const outputPath = join(directory, "index.ts");
    await writeFile(inputPath, JSON.stringify({
      version: 1,
      createdAt: "2026-08-31T12:24:44+02:00",
      products: [
        { idProduct: 10, name: "Renamed Display", idCategory: 53, categoryName: "Renamed Category" },
        { idProduct: 20, name: "Public Tin", idCategory: 1014, categoryName: "Pokémon Tins" },
      ],
    }), "utf8");

    const result = spawnSync(process.execPath, ["scripts/build-cardmarket-index.mjs", inputPath, outputPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("changed the published name of a supported category");
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pocketdex-cardmarket-index-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runBuilder(inputPath: string, outputPath: string): void {
  execFileSync(process.execPath, ["scripts/build-cardmarket-index.mjs", inputPath, outputPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function syntheticEntry(
  idProduct: string,
  name: string,
  objectType: "box" | "tin",
): CardmarketCatalogEntry {
  const prettySlug = name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    idProduct,
    name,
    objectType,
    categorySlug: objectType === "box" ? "booster-boxes" : "tins",
    prettySlug,
    canonicalPath: "/en/Pokemon/Products",
    variantKey: `cardmarket:${idProduct}`,
  };
}
