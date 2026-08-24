import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { MAX_WORKBOOK_BYTES, applyImport, createEmptyImportState, createWorkbookSourceFromRows, emptyWorkbookSource, previewWorkbook, readWorkbookFile } from "../src/domain/importer";
import { createBackup, createLocalStateStore, parseBackup, serializeBackup } from "../src/domain/backup";
import { createEmptyState, stableRecordId } from "../src/domain/model";
import { assertExactOwner, isExactOwner, privateCollectionPath } from "../src/privacy/owner";

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
        { Type: "single", Name: "Amber Finch", Set: "Meadow Signals", Quantity: 1 },
        { Type: "single", Name: "Amber Finch", Set: "Meadow Signals", Quantity: 2 },
        { Type: "single", Name: "Bad quantity", Quantity: 0 },
        { Name: "Needs type", Quantity: 1 },
      ] },
      { name: "Wants", rows: [{ Name: "Quiet Summit", Priority: "High" }] },
      { name: "Other", rows: [{ Name: "Ignored", Quantity: 1 }] },
    ]);
    const preview = await previewWorkbook(source);
    expect(preview.sourceUnchanged).toBe(true);
    expect(preview.sourceHashBefore).toBe(preview.sourceHashAfter);
    expect(preview.totals).toMatchObject({ acceptedRows: 3, skippedRows: 2, ambiguousRows: 1 });
    expect(preview.proposals).toHaveLength(2);
    const first = applyImport(createEmptyState("2026-01-01T00:00:00.000Z"), preview, "2026-01-02T00:00:00.000Z");
    const second = applyImport(first, preview, "2026-01-03T00:00:00.000Z");
    expect(first.records.map(({ id, holding, want }) => ({ id, holding, want }))).toEqual(second.records.map(({ id, holding, want }) => ({ id, holding, want })));
    expect(first.records.find((record) => record.catalog.name === "Amber Finch")?.holding?.quantity).toBe(3);
  });

  it("reads a local delimited file and rejects a changed preview source", async () => {
    const file = new File(["Type,Name,Quantity\nsingle,Local sample,2\n"], "synthetic.csv", { type: "text/csv" });
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
      "xl/worksheets/sheet1.xml": strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Type</t></is></c><c r="B1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>single</t></is></c><c r="B2" t="inlineStr"><is><t>XML sample</t></is></c></row></sheetData></worksheet>'),
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

describe("exact-owner boundary", () => {
  it("requires exact UID equality and generates owner-scoped paths", () => {
    expect(isExactOwner({ authenticatedUid: "synthetic-owner", expectedOwnerUid: "synthetic-owner" })).toBe(true);
    expect(isExactOwner({ authenticatedUid: "other-owner", expectedOwnerUid: "synthetic-owner" })).toBe(false);
    expect(() => assertExactOwner({ authenticatedUid: "other-owner", expectedOwnerUid: "synthetic-owner" })).toThrow(/denied/);
    expect(privateCollectionPath("synthetic-owner")).toBe("owners/synthetic-owner/private/collection");
    expect(() => privateCollectionPath(" ")).toThrow(/required/);
  });
});
