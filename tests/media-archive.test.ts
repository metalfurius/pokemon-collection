import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createBackup } from "../src/domain/backup";
import { createEmptyState, type CollectionRecord } from "../src/domain/model";
import {
  createFullBackupArchive,
  parseFullBackupArchive,
  parseProductMediaPack,
} from "../src/domain/media-archive";
import { PRODUCT_MEDIA_SCHEMA_VERSION, type ProductMediaAsset } from "../src/media/product-media";

function webpBytes(): Uint8Array {
  return new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);
}

function asset(key = "record:test"): ProductMediaAsset {
  return {
    schemaVersion: PRODUCT_MEDIA_SCHEMA_VERSION,
    key,
    blob: new Blob([webpBytes().slice().buffer as ArrayBuffer], { type: "image/webp" }),
    mimeType: "image/webp",
    width: 320,
    height: 240,
    source: { kind: "owner-upload" },
    originalName: "test.png",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

const record: CollectionRecord = {
  id: "test",
  catalog: { catalogId: "cardmarket:123", objectType: "box", name: "Test", idProduct: "123", variantKey: "cardmarket:123" },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

describe("complete Pocketdex backup archive", () => {
  it("round-trips the compatible JSON envelope and local media", async () => {
    const backup = createBackup(createEmptyState("2026-08-31T00:00:00.000Z"), "2026-08-31T00:00:00.000Z");
    const archive = await createFullBackupArchive(backup, [asset()]);
    const parsed = parseFullBackupArchive(new Uint8Array(await archive.arrayBuffer()));
    expect(parsed.backup).toEqual(backup);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]).toMatchObject({ key: "record:test", width: 320, source: { kind: "owner-upload" } });
    expect(new Uint8Array(await parsed.assets[0]!.blob.arrayBuffer())).toEqual(webpBytes());
  });

  it("rejects unexpected and incomplete archives", () => {
    const unexpected = zipSync({ "backup.json": strToU8("{}"), "surprise.txt": strToU8("no") });
    expect(() => parseFullBackupArchive(unexpected)).toThrow(/inesperado|control/);
    const incomplete = zipSync({ "backup.json": strToU8("{}") });
    expect(() => parseFullBackupArchive(incomplete)).toThrow(/control/);
  });
});

describe("owner media packs", () => {
  it("matches filenames by Cardmarket id or record id and reports unknown files", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
    const parsedByProduct = parseProductMediaPack(zipSync({ "123.png": png, "unknown.webp": webpBytes() }), [record]);
    expect(parsedByProduct.candidates).toMatchObject([{ recordId: "test", key: "record:test", filename: "123.png", mimeType: "image/png" }]);
    expect(parsedByProduct.unmatched).toEqual(["unknown.webp"]);
    const parsedByRecord = parseProductMediaPack(zipSync({ "folder/test.webp": webpBytes() }), [record]);
    expect(parsedByRecord.candidates[0]?.recordId).toBe("test");
  });

  it("rejects duplicate images for one product and disguised files", () => {
    expect(() => parseProductMediaPack(zipSync({ "123.webp": webpBytes(), "test.webp": webpBytes() }), [record])).toThrow(/más de una/);
    expect(() => parseProductMediaPack(zipSync({ "123.png": strToU8("not png") }), [record])).toThrow(/no es una imagen/);
  });
});
