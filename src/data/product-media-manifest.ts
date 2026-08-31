import type { CollectionRecord } from "../domain/model";
import { productMediaImportAliases } from "../media";

export interface LicensedProductMedia {
  /** Public, repository-owned path. Keep the file under public/product-media/. */
  path: `product-media/${string}.webp`;
  sourceUrl: `https://${string}`;
  license: string;
  licenseUrl?: `https://${string}`;
  attribution: string;
}

export type LicensedProductMediaManifest = Readonly<Record<string, LicensedProductMedia>>;

/**
 * Deliberately empty until a packshot has independently verified reuse rights.
 * Keys may be an idProduct, variantKey, record id, or the local record media key.
 */
export const PRODUCT_MEDIA_MANIFEST: LicensedProductMediaManifest = Object.freeze({});

function assertHttps(value: string, label: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} debe ser una URL HTTPS válida.`); }
  if (url.protocol !== "https:") throw new Error(`${label} debe usar HTTPS.`);
}

export function validateLicensedProductMediaManifest(manifest: LicensedProductMediaManifest): void {
  for (const [rawKey, entry] of Object.entries(manifest)) {
    const key = rawKey.trim();
    if (!key || key !== rawKey || key.length > 300 || /[\u0000-\u001f]/.test(key)) throw new Error("El manifiesto contiene una clave no válida.");
    if (!/^product-media\/[a-z0-9][a-z0-9._/-]*\.webp$/i.test(entry.path) || entry.path.includes("..")) throw new Error(`La ruta de ${key} no es un WebP local seguro.`);
    assertHttps(entry.sourceUrl, `La fuente de ${key}`);
    if (entry.licenseUrl) assertHttps(entry.licenseUrl, `La licencia de ${key}`);
    if (!entry.license.trim() || !entry.attribution.trim()) throw new Error(`El packshot ${key} necesita licencia y atribución.`);
  }
}

export function resolveLicensedProductMedia(
  record: CollectionRecord,
  manifest: LicensedProductMediaManifest = PRODUCT_MEDIA_MANIFEST,
): LicensedProductMedia | undefined {
  for (const alias of productMediaImportAliases(record)) {
    const exact = manifest[alias];
    if (exact) return exact;
    const normalized = alias.toLocaleLowerCase("en-US");
    const key = Object.keys(manifest).find((candidate) => candidate.toLocaleLowerCase("en-US") === normalized);
    if (key) return manifest[key];
  }
  return undefined;
}

validateLicensedProductMediaManifest(PRODUCT_MEDIA_MANIFEST);
