import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFileInfo } from "fflate";
import { parseBackup, serializeBackup, type BackupEnvelope } from "./backup";
import type { CollectionRecord } from "./model";
import {
  PRODUCT_MEDIA_SCHEMA_VERSION,
  assertProductMediaAsset,
  productMediaImportAliases,
  resolveProductMediaKey,
  type ProductMediaAsset,
  type ProductMediaSource,
} from "../media/product-media";

export const FULL_BACKUP_FORMAT = "pocketdex-full-backup" as const;
export const FULL_BACKUP_SCHEMA_VERSION = 1 as const;
export const MAX_MEDIA_ARCHIVE_BYTES = 160 * 1024 * 1024;
export const MAX_MEDIA_ARCHIVE_EXPANDED_BYTES = 320 * 1024 * 1024;
export const MAX_MEDIA_ARCHIVE_FILES = 512;

interface ProductMediaArchiveEntry {
  key: string;
  path: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  byteLength: number;
  source: ProductMediaSource;
  originalName?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProductMediaArchiveManifest {
  format: typeof FULL_BACKUP_FORMAT;
  schemaVersion: typeof FULL_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  assets: ProductMediaArchiveEntry[];
}

export interface ParsedFullBackupArchive {
  backup: BackupEnvelope;
  assets: readonly ProductMediaAsset[];
}

export interface ProductMediaPackCandidate {
  recordId: string;
  key: string;
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
}

export interface ParsedProductMediaPack {
  candidates: readonly ProductMediaPackCandidate[];
  unmatched: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownedBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && strFromU8(bytes.subarray(0, 4)) === "RIFF"
    && strFromU8(bytes.subarray(8, 12)) === "WEBP";
}

function mediaMime(filename: string, bytes: Uint8Array): ProductMediaPackCandidate["mimeType"] | undefined {
  const extension = filename.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "webp" && isWebp(bytes)) return "image/webp";
  if ((extension === "jpg" || extension === "jpeg") && bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (extension === "png" && bytes.length >= 8
    && bytes[0] === 0x89 && strFromU8(bytes.subarray(1, 4)) === "PNG") return "image/png";
  return undefined;
}

function checkedUnzip(input: Uint8Array, allowed: (file: UnzipFileInfo) => boolean): Record<string, Uint8Array> {
  if (input.byteLength <= 0 || input.byteLength > MAX_MEDIA_ARCHIVE_BYTES) throw new Error("El ZIP supera el límite seguro de 160 MB.");
  let files = 0;
  let expandedBytes = 0;
  return unzipSync(input, {
    filter(file) {
      files += 1;
      expandedBytes += file.originalSize;
      if (files > MAX_MEDIA_ARCHIVE_FILES || expandedBytes > MAX_MEDIA_ARCHIVE_EXPANDED_BYTES) {
        throw new Error("El ZIP contiene demasiados archivos o datos expandidos.");
      }
      if (file.name.includes("\\") || file.name.startsWith("/") || file.name.split("/").includes("..")) {
        throw new Error("El ZIP contiene una ruta no segura.");
      }
      return allowed(file);
    },
  });
}

function safeArchiveEntry(value: unknown): ProductMediaArchiveEntry {
  if (!isRecord(value)
    || typeof value.key !== "string"
    || typeof value.path !== "string"
    || value.mimeType !== "image/webp"
    || typeof value.width !== "number"
    || typeof value.height !== "number"
    || typeof value.byteLength !== "number"
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || !isRecord(value.source)
    || (value.source.kind !== "owner-upload" && value.source.kind !== "licensed-packshot")) {
    throw new Error("El manifiesto multimedia contiene una entrada no válida.");
  }
  if (value.originalName !== undefined && typeof value.originalName !== "string") throw new Error("El nombre multimedia no es válido.");
  const source: ProductMediaSource = {
    kind: value.source.kind,
    ...(typeof value.source.sourceUrl === "string" ? { sourceUrl: value.source.sourceUrl } : {}),
    ...(typeof value.source.license === "string" ? { license: value.source.license } : {}),
    ...(typeof value.source.attribution === "string" ? { attribution: value.source.attribution } : {}),
  };
  return {
    key: value.key,
    path: value.path,
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    byteLength: value.byteLength,
    source,
    ...(value.originalName ? { originalName: value.originalName.slice(0, 240) } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function createFullBackupArchive(
  backup: BackupEnvelope,
  inputAssets: readonly ProductMediaAsset[],
  createdAt = new Date().toISOString(),
): Promise<Blob> {
  parseBackup(serializeBackup(backup));
  if (inputAssets.length > MAX_MEDIA_ARCHIVE_FILES - 2) throw new Error("Hay demasiadas imágenes para una sola copia.");
  const assets = [...inputAssets].sort((left, right) => left.key.localeCompare(right.key));
  const seen = new Set<string>();
  const files: Record<string, Uint8Array> = { "backup.json": strToU8(serializeBackup(backup)) };
  const manifestAssets: ProductMediaArchiveEntry[] = [];
  for (const [index, asset] of assets.entries()) {
    assertProductMediaAsset(asset);
    if (seen.has(asset.key)) throw new Error(`La copia repite ${asset.key}.`);
    seen.add(asset.key);
    const path = `media/${String(index).padStart(4, "0")}.webp`;
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    if (!isWebp(bytes)) throw new Error(`El activo ${asset.key} no contiene un WebP válido.`);
    files[path] = bytes;
    manifestAssets.push({
      key: asset.key,
      path,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      source: asset.source,
      ...(asset.originalName ? { originalName: asset.originalName } : {}),
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    });
  }
  const manifest: ProductMediaArchiveManifest = {
    format: FULL_BACKUP_FORMAT,
    schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
    createdAt,
    assets: manifestAssets,
  };
  files["media-manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 6 });
  if (zipped.byteLength > MAX_MEDIA_ARCHIVE_BYTES) throw new Error("La copia comprimida supera el límite de 160 MB.");
  return new Blob([ownedBytes(zipped)], { type: "application/zip" });
}

export function parseFullBackupArchive(input: Uint8Array): ParsedFullBackupArchive {
  const files = checkedUnzip(input, () => true);
  const allowedStatic = new Set(["backup.json", "media-manifest.json"]);
  for (const filename of Object.keys(files)) {
    if (!allowedStatic.has(filename) && !/^media\/\d{4}\.webp$/.test(filename)) throw new Error(`La copia contiene un archivo inesperado: ${filename}.`);
  }
  const backupBytes = files["backup.json"];
  const manifestBytes = files["media-manifest.json"];
  if (!backupBytes || !manifestBytes) throw new Error("La copia completa no contiene sus archivos de control.");
  const backup = parseBackup(strFromU8(backupBytes));
  const rawManifest: unknown = JSON.parse(strFromU8(manifestBytes));
  if (!isRecord(rawManifest)
    || rawManifest.format !== FULL_BACKUP_FORMAT
    || rawManifest.schemaVersion !== FULL_BACKUP_SCHEMA_VERSION
    || typeof rawManifest.createdAt !== "string"
    || !Array.isArray(rawManifest.assets)) throw new Error("El manifiesto multimedia no es compatible.");
  if (rawManifest.assets.length > MAX_MEDIA_ARCHIVE_FILES - 2) throw new Error("La copia contiene demasiadas imágenes.");

  const assets: ProductMediaAsset[] = [];
  const seenKeys = new Set<string>();
  const seenPaths = new Set<string>();
  for (const rawEntry of rawManifest.assets) {
    const entry = safeArchiveEntry(rawEntry);
    if (!/^media\/\d{4}\.webp$/.test(entry.path) || seenKeys.has(entry.key) || seenPaths.has(entry.path)) {
      throw new Error("El manifiesto multimedia repite o referencia una ruta no válida.");
    }
    seenKeys.add(entry.key);
    seenPaths.add(entry.path);
    const bytes = files[entry.path];
    if (!bytes || bytes.byteLength !== entry.byteLength || !isWebp(bytes)) throw new Error(`La imagen ${entry.path} está dañada.`);
    const asset: ProductMediaAsset = {
      schemaVersion: PRODUCT_MEDIA_SCHEMA_VERSION,
      key: entry.key,
      blob: new Blob([ownedBytes(bytes)], { type: "image/webp" }),
      mimeType: "image/webp",
      width: entry.width,
      height: entry.height,
      source: entry.source,
      ...(entry.originalName ? { originalName: entry.originalName } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
    assertProductMediaAsset(asset);
    assets.push(asset);
  }
  const expectedPaths = new Set(["backup.json", "media-manifest.json", ...seenPaths]);
  if (Object.keys(files).some((path) => !expectedPaths.has(path))) throw new Error("La copia contiene imágenes no declaradas.");
  return { backup, assets };
}

export function parseProductMediaPack(input: Uint8Array, records: readonly CollectionRecord[]): ParsedProductMediaPack {
  const files = checkedUnzip(input, (file) => !file.name.endsWith("/"));
  const aliases = new Map<string, CollectionRecord>();
  const ambiguous = new Set<string>();
  for (const record of records) {
    for (const alias of productMediaImportAliases(record)) {
      const normalized = alias.toLocaleLowerCase("en-US");
      const existing = aliases.get(normalized);
      if (existing && existing.id !== record.id) ambiguous.add(normalized);
      else aliases.set(normalized, record);
    }
  }

  const candidates: ProductMediaPackCandidate[] = [];
  const unmatched: string[] = [];
  const seenRecords = new Set<string>();
  for (const [path, bytes] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const filename = path.split("/").pop() ?? path;
    if (filename.startsWith(".") || filename === "") continue;
    const identifier = filename.replace(/\.(?:jpe?g|png|webp)$/i, "").trim().toLocaleLowerCase("en-US");
    const mimeType = mediaMime(filename, bytes);
    if (!mimeType) throw new Error(`${filename} no es una imagen JPEG, PNG o WebP válida.`);
    const record = ambiguous.has(identifier) ? undefined : aliases.get(identifier);
    if (!record) { unmatched.push(filename); continue; }
    if (seenRecords.has(record.id)) throw new Error(`El pack contiene más de una imagen para ${record.catalog.name}.`);
    seenRecords.add(record.id);
    candidates.push({
      recordId: record.id,
      key: resolveProductMediaKey(record),
      filename,
      mimeType,
      bytes,
    });
  }
  return { candidates, unmatched };
}
