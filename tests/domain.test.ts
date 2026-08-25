import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { MAX_WORKBOOK_BYTES, applyImport, createEmptyImportState, createWorkbookSourceFromRows, emptyWorkbookSource, previewWorkbook, readWorkbookFile } from "../src/domain/importer";
import { createBackup, createLocalStateStore, parseBackup, serializeBackup } from "../src/domain/backup";
import { createEmptyState, stableRecordId } from "../src/domain/model";
import { assertExactOwner, isExactOwner, privateCollectionPath } from "../src/privacy/owner";
import {
  CARDMARKET_INDEX_MAX_AGE_DAYS,
  canonicalizeCardmarketUrl,
  createCardmarketIndex,
  parseCardmarketIndex,
  resolveCardmarketProduct,
  serializeCardmarketIndex,
  usableCardmarketCatalog,
} from "../src/domain/cardmarket";
import { applyCardmarketIntake } from "../src/domain/intake";
import { syntheticCardmarketIndex } from "../src/fixtures/synthetic";

describe("collection model", () => {
  it("creates deterministic IDs from normalized catalog identity", () => {
    expect(stableRecordId({ objectType: "single", name: "  Amber Finch ", setName: "Meadow Signals" }))
      .toBe(stableRecordId({ objectType: "single", name: "amber finch", setName: "meadow signals" }));
  });
});

describe("workbook preview and apply", () => {
  it("reports decisions, preserves source hashes, consolidates rows, and applies idempotently", async () => {
    const source = createWorkbookSourceFromRows([
      { name: "Inventory", rows: [
        { Type: "box", Name: "Amber Finch Collection Box", Set: "Meadow Signals", Quantity: 1 },
        { Type: "box", Name: "Amber Finch Collection Box", Set: "Meadow Signals", Quantity: 2 },
        { Type: "box", Name: "Bad quantity", Quantity: 0 },
        { Name: "Needs type", Quantity: 1 },
        { Type: "single", Name: "Historical single", Quantity: 1 },
      ] },
      { name: "Wants", rows: [{ Type: "tin", Name: "Quiet Summit", Priority: "High" }] },
      { name: "Other", rows: [{ Name: "Ignored", Quantity: 1 }] },
    ]);
    const preview = await previewWorkbook(source);
    expect(preview.sourceUnchanged).toBe(true);
    expect(preview.sourceHashBefore).toBe(preview.sourceHashAfter);
    expect(preview.totals).toMatchObject({ acceptedRows: 3, skippedRows: 3, ambiguousRows: 1 });
    expect(preview.proposals).toHaveLength(2);
    const first = applyImport(createEmptyState("2026-01-01T00:00:00.000Z"), preview, "2026-01-02T00:00:00.000Z");
    const second = applyImport(first, preview, "2026-01-03T00:00:00.000Z");
    expect(first.records.map(({ id, holding, want }) => ({ id, holding, want }))).toEqual(second.records.map(({ id, holding, want }) => ({ id, holding, want })));
    expect(first.records.find((record) => record.catalog.name === "Amber Finch Collection Box")?.holding?.quantity).toBe(3);
  });

  it("reads a local delimited file and rejects a changed preview source", async () => {
    const file = new File(["Type,Name,Quantity\nbox,Local sample,2\n"], "synthetic.csv", { type: "text/csv" });
    const source = await readWorkbookFile(file);
    const preview = await previewWorkbook(source);
    expect(preview.proposals[0]?.catalog.name).toBe("Local sample");
    expect(emptyWorkbookSource().sheets).toHaveLength(0);
    expect(createEmptyImportState().records).toHaveLength(0);
    expect(() => applyImport(createEmptyState(), { ...preview, sourceUnchanged: false })).toThrow(/changed/);
  });

  it("reads a synthetic xlsx ZIP with shared strings and inline cells", async () => {
    globalThis.DOMParser = DOMParser;
    const workbook = zipSync({
      "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Type</t></is></c><c r="B1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>box</t></is></c><c r="B2" t="inlineStr"><is><t>XML sample</t></is></c></row></sheetData></worksheet>'),
    });
    const source = await readWorkbookFile(new File([workbook], "synthetic.xlsx"));
    const preview = await previewWorkbook(source);
    expect(preview.proposals[0]?.catalog.name).toBe("XML sample");
    expect(preview.sourceUnchanged).toBe(true);
  });

  it("bounds local workbook input before parsing", async () => {
    const oversized = { name: "synthetic.csv", arrayBuffer: async () => new ArrayBuffer(MAX_WORKBOOK_BYTES + 1) } as File;
    await expect(readWorkbookFile(oversized)).rejects.toThrow(/20 MB/);
  });
});

describe("versioned backups", () => {
  it("round-trips and rejects future or malformed versions", () => {
    const backup = createBackup(createEmptyState("2026-01-01T00:00:00.000Z"), "2026-01-02T00:00:00.000Z");
    expect(parseBackup(serializeBackup(backup))).toEqual(backup);
    expect(() => parseBackup(JSON.stringify({ ...backup, schemaVersion: 99 }))).toThrow(/Unsupported/);
    expect(() => parseBackup("not-json")).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, state: { ...backup.state, records: [null] } }))).toThrow(/invalid record/);
  });

  it("loads, saves, and explicitly clears local state", () => {
    const values = new Map<string, string>();
    const fakeStorage: Storage = {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key) { return values.get(key) ?? null; },
      key(index) { return [...values.keys()][index] ?? null; },
      removeItem(key) { values.delete(key); },
      setItem(key, value) { values.set(key, value); },
    };
    const store = createLocalStateStore(fakeStorage);
    const state = createEmptyState("2026-01-03T00:00:00.000Z");
    expect(store.load().records).toEqual([]);
    expect(store.load().schemaVersion).toBe(1);
    store.save(state);
    expect(store.load()).toEqual(state);
    values.set("pokemon-collection.local-state.v1", "broken");
    expect(store.load().records).toEqual([]);
    expect(store.load().schemaVersion).toBe(1);
    store.save(state);
    store.clear();
    expect(store.load().records).toEqual([]);
  });
});

describe("Cardmarket URL and bounded catalog resolution", () => {
  const index = syntheticCardmarketIndex();

  it("resolves exact idProduct before localized pretty slug and strips tracking", () => {
    const exact = resolveCardmarketProduct(
      "https://www.cardmarket.com/es/Pokemon/Products/Booster-Boxes/Synthetic-Collection-Box?idProduct=900001&utm_source=synthetic&gclid=ignored",
      index,
      "2026-01-16T00:00:00.000Z",
    );
    expect(exact.status).toBe("exact");
    expect(exact.candidates[0]?.idProduct).toBe("900001");
    expect(exact.canonicalUrl).toBe("https://www.cardmarket.com/en/Pokemon/Products/booster-boxes/synthetic-collection-box?idProduct=900001");

    const pretty = resolveCardmarketProduct("https://cardmarket.com/en/Pokemon/Products/Booster-Boxes/Synthetic-Collection-Box", index);
    expect(pretty.status).toBe("multiple");
    expect(pretty.candidates.map((entry) => entry.idProduct)).toEqual(["900001", "900002"]);
  });

  it("rejects unsafe or non-product routes and reports zero matches", () => {
    expect(resolveCardmarketProduct("http://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/Synthetic-Collection-Box", index).issue).toBe("non-https");
    expect(resolveCardmarketProduct("https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/Synthetic-Collection-Box/Offers", index).issue).toBe("seller-or-offer");
    expect(resolveCardmarketProduct("https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes", index).issue).toBe("not-product");
    expect(resolveCardmarketProduct("https://www.cardmarket.com/en/Pokemon/Search/Synthetic", index).issue).toBe("not-product");
    expect(resolveCardmarketProduct("https://www.cardmarket.com/en/Pokemon/Products/Single-Cards/Synthetic-Card", index).issue).toBe("single-card");
    expect(resolveCardmarketProduct(`https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/${"x".repeat(2100)}`, index).issue).toBe("too-long");
    expect(resolveCardmarketProduct("https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/Unknown-Product?idProduct=999999", index).status).toBe("zero");
    expect(canonicalizeCardmarketUrl("not a url")).toMatchObject({ issue: "invalid-url" });
  });

  it("keeps createdAt freshness and falls back to the last known good snapshot", () => {
    const current = createCardmarketIndex([], "2026-01-15T00:00:00.000Z", "Current published catalog", {
      createdAt: "2026-01-10T00:00:00.000Z",
      sourceLabel: "Last known good catalog",
      entries: [index.entries[2]!],
    });
    const fallback = usableCardmarketCatalog(current, "2026-01-16T00:00:00.000Z");
    expect(fallback.use).toBe("last-known-good");
    expect(fallback.snapshot.createdAt).toBe("2026-01-10T00:00:00.000Z");
    const stale = usableCardmarketCatalog(createCardmarketIndex([index.entries[0]!], "2020-01-01T00:00:00.000Z"), "2026-01-16T00:00:00.000Z");
    expect(stale.use).toBe("stale");
    expect(stale.ageDays).toBeGreaterThan(CARDMARKET_INDEX_MAX_AGE_DAYS);
  });

  it("round-trips a bounded index and rejects single-card or duplicate identities", () => {
    expect(parseCardmarketIndex(serializeCardmarketIndex(index))).toEqual(index);
    expect(() => createCardmarketIndex([{ ...index.entries[0]!, objectType: "single" as never }], index.createdAt)).toThrow(/non-single/);
    expect(() => createCardmarketIndex([index.entries[0]!, index.entries[0]!], index.createdAt)).toThrow(/duplicate/);
  });
});

describe("explicit Cardmarket intake destinations", () => {
  it("creates exactly one Want without a holding and makes retries idempotent", () => {
    const entry = syntheticCardmarketIndex().entries[0]!;
    const draft = { entry, canonicalUrl: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/synthetic-collection-box?idProduct=900001", destination: "wants" as const, quantity: 1, holdingStatus: "owned" as const, priority: "high" as const, notes: "Synthetic note" };
    const first = applyCardmarketIntake(createEmptyState("2026-01-01T00:00:00.000Z"), draft, "2026-01-02T00:00:00.000Z");
    const retry = applyCardmarketIntake(first, draft, "2026-01-03T00:00:00.000Z");
    expect(first.records).toHaveLength(1);
    expect(first.records[0]?.holding).toBeUndefined();
    expect(first.records[0]?.want).toMatchObject({ wanted: true, priority: "high", quantity: 1 });
    expect(retry).toEqual(first);
    expect(first.records[0]?.createdAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("creates a holding only for Ya lo tengo and preserves an explicit Want separately", () => {
    const entry = syntheticCardmarketIndex().entries[2]!;
    const draft = { entry, canonicalUrl: "https://www.cardmarket.com/en/Pokemon/Products/Tins/synthetic-travel-tin?idProduct=900003", destination: "collection" as const, quantity: 2, holdingStatus: "opened" as const, priority: "normal" as const, notes: "" };
    const state = applyCardmarketIntake(createEmptyState(), draft, "2026-01-05T00:00:00.000Z");
    expect(state.records[0]?.holding).toMatchObject({ quantity: 2, status: "opened" });
    expect(state.records[0]?.want).toBeUndefined();
    const wanted = applyCardmarketIntake(state, { ...draft, destination: "wants", priority: "low", quantity: 1 }, "2026-01-06T00:00:00.000Z");
    expect(wanted.records).toHaveLength(1);
    expect(wanted.records[0]?.holding?.quantity).toBe(2);
    expect(wanted.records[0]?.want).toMatchObject({ wanted: true, priority: "low" });
    expect(wanted.records[0]?.createdAt).toBe("2026-01-05T00:00:00.000Z");
  });

  it("does not silently merge a packaging or language variant", () => {
    const index = syntheticCardmarketIndex();
    const first = applyCardmarketIntake(createEmptyState(), { entry: index.entries[0]!, canonicalUrl: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/synthetic-collection-box?idProduct=900001", destination: "wants", quantity: 1, holdingStatus: "owned", priority: "normal" });
    const variant = { ...index.entries[0]!, variantKey: "different-language" };
    expect(() => applyCardmarketIntake(first, { entry: variant, canonicalUrl: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/synthetic-collection-box?idProduct=900001", destination: "wants", quantity: 1, holdingStatus: "owned", priority: "normal" })).toThrow(/variant/);
  });
});

describe("exact-owner boundary", () => {
  it("requires exact UID equality and generates owner-scoped paths", () => {
    expect(isExactOwner({ authenticatedUid: "synthetic-owner", expectedOwnerUid: "synthetic-owner" })).toBe(true);
    expect(isExactOwner({ authenticatedUid: "other-owner", expectedOwnerUid: "synthetic-owner" })).toBe(false);
    expect(() => assertExactOwner({ authenticatedUid: "other-owner", expectedOwnerUid: "synthetic-owner" })).toThrow(/denied/);
    expect(privateCollectionPath("synthetic-owner")).toBe("owners/synthetic-owner/private/collection");
    expect(() => privateCollectionPath(" ")).toThrow(/required/);
  });
});
