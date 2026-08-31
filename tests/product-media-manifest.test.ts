import { describe, expect, it } from "vitest";
import type { CollectionRecord } from "../src/domain/model";
import {
  resolveLicensedProductMedia,
  validateLicensedProductMediaManifest,
  type LicensedProductMediaManifest,
} from "../src/data/product-media-manifest";

const record: CollectionRecord = {
  id: "local-record",
  catalog: { catalogId: "catalog", objectType: "box", name: "Atlas Box", idProduct: "12345", variantKey: "atlas-en" },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const valid: LicensedProductMediaManifest = {
  "12345": {
    path: "product-media/12345.webp",
    sourceUrl: "https://example.test/original",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Example photographer",
  },
};

describe("licensed product media manifest", () => {
  it("resolves the strongest public identity alias", () => {
    expect(resolveLicensedProductMedia(record, valid)?.path).toBe("product-media/12345.webp");
  });

  it("requires a safe local WebP, HTTPS provenance, licence and attribution", () => {
    const media = valid["12345"]!;
    expect(() => validateLicensedProductMediaManifest(valid)).not.toThrow();
    expect(() => validateLicensedProductMediaManifest({
      bad: { ...media, path: "product-media/../bad.webp" },
    })).toThrow(/ruta/i);
    expect(() => validateLicensedProductMediaManifest({
      bad: { ...media, sourceUrl: "http://example.test/original" as `https://${string}` },
    })).toThrow(/HTTPS/i);
    expect(() => validateLicensedProductMediaManifest({
      bad: { ...media, attribution: "" },
    })).toThrow(/licencia y atribución/i);
  });
});
