import { describe, expect, it } from "vitest";
import type { CollectionRecord } from "../src/domain/model";
import {
  PRODUCT_MEDIA_SCHEMA_VERSION,
  createMemoryProductMediaStore,
  productMediaImportAliases,
  resolveProductMediaKey,
  validateDecodedProductImage,
  validateProductImageInput,
  type ProductMediaAsset,
} from "../src/media/product-media";

const record: CollectionRecord = {
  id: "record_cm_test",
  catalog: {
    catalogId: "cardmarket:123",
    objectType: "box",
    name: "Test box",
    idProduct: "123",
    variantKey: "cardmarket:123",
  },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function asset(key: string): ProductMediaAsset {
  return {
    schemaVersion: PRODUCT_MEDIA_SCHEMA_VERSION,
    key,
    blob: new Blob(["webp"], { type: "image/webp" }),
    mimeType: "image/webp",
    width: 320,
    height: 240,
    source: { kind: "owner-upload" },
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

describe("product media identity and validation", () => {
  it("keeps owner media attached to the stable collection record and exposes import aliases", () => {
    expect(resolveProductMediaKey(record)).toBe("record:record_cm_test");
    expect(productMediaImportAliases(record)).toEqual(["123", "cardmarket:123", "record_cm_test", "record:record_cm_test"]);
  });

  it("accepts only bounded JPEG, PNG, and WebP inputs", () => {
    expect(() => validateProductImageInput({ name: "box.jpg", type: "image/jpeg", size: 20 })).not.toThrow();
    expect(() => validateProductImageInput({ name: "box.svg", type: "image/svg+xml", size: 20 })).toThrow(/JPEG/);
    expect(() => validateProductImageInput({ type: "image/png", size: 0 })).toThrow(/vacía/);
    expect(() => validateProductImageInput({ type: "image/webp", size: 21 * 1024 * 1024 })).toThrow(/20 MB/);
  });

  it("rejects decoded pixel bombs", () => {
    expect(() => validateDecodedProductImage(4_000, 3_000)).not.toThrow();
    expect(() => validateDecodedProductImage(12_001, 1)).toThrow(/demasiados píxeles/);
    expect(() => validateDecodedProductImage(8_000, 8_000)).toThrow(/demasiados píxeles/);
  });
});

describe("memory product media store", () => {
  it("supports deterministic CRUD and atomic replacement validation", async () => {
    const store = createMemoryProductMediaStore([asset("record:b")]);
    await store.put(asset("record:a"));
    expect((await store.list()).map(({ key }) => key)).toEqual(["record:a", "record:b"]);
    expect((await store.get("record:a"))?.width).toBe(320);
    await store.delete("record:a");
    expect(await store.get("record:a")).toBeUndefined();
    await store.replaceAll([asset("record:c")]);
    expect((await store.list()).map(({ key }) => key)).toEqual(["record:c"]);
    await expect(store.replaceAll([asset("record:d"), asset("record:d")])).rejects.toThrow(/repite/);
    expect((await store.list()).map(({ key }) => key)).toEqual(["record:c"]);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("requires complete provenance for distributable licensed packshots", async () => {
    const store = createMemoryProductMediaStore();
    const licensed = { ...asset("record:licensed"), source: { kind: "licensed-packshot" as const } };
    await expect(store.put(licensed)).rejects.toThrow(/fuente HTTPS/);
  });
});
