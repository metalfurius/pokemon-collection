import type { CollectionRecord } from "../domain/model";

export const PRODUCT_MEDIA_SCHEMA_VERSION = 1 as const;
export const PRODUCT_MEDIA_DB_NAME = "pocketdex-product-media-v1";
export const PRODUCT_MEDIA_STORE_NAME = "assets";
export const MAX_PRODUCT_MEDIA_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PRODUCT_MEDIA_PIXELS = 40_000_000;
export const MAX_PRODUCT_MEDIA_EDGE = 12_000;
export const MAX_PRODUCT_MEDIA_OUTPUT_BYTES = 4 * 1024 * 1024;
export const PRODUCT_MEDIA_MAX_RENDER_EDGE = 1_024;

const ALLOWED_INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ProductMediaSource {
  kind: "owner-upload" | "licensed-packshot";
  sourceUrl?: string;
  license?: string;
  attribution?: string;
}

export interface ProductMediaAsset {
  schemaVersion: typeof PRODUCT_MEDIA_SCHEMA_VERSION;
  key: string;
  blob: Blob;
  mimeType: "image/webp";
  width: number;
  height: number;
  source: ProductMediaSource;
  originalName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductMediaStore {
  get(key: string): Promise<ProductMediaAsset | undefined>;
  list(): Promise<readonly ProductMediaAsset[]>;
  put(asset: ProductMediaAsset): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Replaces the complete media set in one storage transaction. */
  replaceAll(assets: readonly ProductMediaAsset[]): Promise<void>;
}

export interface ProductImageInput {
  readonly name?: string;
  readonly size: number;
  readonly type: string;
}

export interface DecodedProductImage {
  width: number;
  height: number;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}

export interface NormalizeProductImageOptions {
  key: string;
  now?: string;
  decode?: (blob: Blob) => Promise<DecodedProductImage>;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

function validKey(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !/[\u0000-\u001f]/.test(value);
}

function validInstant(value: string): boolean {
  return value.length <= 80 && Number.isFinite(Date.parse(value));
}

export function resolveProductMediaKey(record: Pick<CollectionRecord, "id">): string {
  return `record:${record.id}`;
}

/** Public identifiers accepted by batch import, ordered from exact to local. */
export function productMediaImportAliases(record: CollectionRecord): readonly string[] {
  const aliases = [
    record.catalog.idProduct?.trim(),
    record.catalog.variantKey?.trim(),
    record.id,
    resolveProductMediaKey(record),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(aliases)];
}

export function validateProductImageInput(input: ProductImageInput): void {
  if (!ALLOWED_INPUT_TYPES.has(input.type.toLocaleLowerCase("en-US"))) {
    throw new Error("Usa una imagen JPEG, PNG o WebP.");
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new Error("La imagen está vacía o no es válida.");
  if (input.size > MAX_PRODUCT_MEDIA_INPUT_BYTES) throw new Error("La imagen supera el límite de 20 MB.");
}

export function validateDecodedProductImage(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("No se pudieron leer las dimensiones de la imagen.");
  }
  if (width > MAX_PRODUCT_MEDIA_EDGE || height > MAX_PRODUCT_MEDIA_EDGE || width * height > MAX_PRODUCT_MEDIA_PIXELS) {
    throw new Error("La imagen tiene demasiados píxeles para procesarla de forma segura.");
  }
}

export function assertProductMediaAsset(value: ProductMediaAsset): void {
  if (value.schemaVersion !== PRODUCT_MEDIA_SCHEMA_VERSION) throw new Error("Versión multimedia no compatible.");
  if (!validKey(value.key)) throw new Error("La clave multimedia no es válida.");
  if (!(value.blob instanceof Blob) || value.blob.type !== "image/webp" || value.mimeType !== "image/webp") {
    throw new Error("El activo multimedia debe ser WebP.");
  }
  if (value.blob.size <= 0 || value.blob.size > MAX_PRODUCT_MEDIA_OUTPUT_BYTES) throw new Error("El activo multimedia tiene un tamaño no permitido.");
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || value.width <= 0 || value.height <= 0
    || value.width > PRODUCT_MEDIA_MAX_RENDER_EDGE || value.height > PRODUCT_MEDIA_MAX_RENDER_EDGE) {
    throw new Error("Las dimensiones multimedia no son válidas.");
  }
  if (!validInstant(value.createdAt) || !validInstant(value.updatedAt)) throw new Error("La fecha multimedia no es válida.");
  if (value.source.kind !== "owner-upload" && value.source.kind !== "licensed-packshot") throw new Error("El origen multimedia no es válido.");
  if (value.source.kind === "licensed-packshot") {
    if (!value.source.sourceUrl?.startsWith("https://") || !value.source.license?.trim() || !value.source.attribution?.trim()) {
      throw new Error("Un packshot distribuible necesita fuente HTTPS, licencia y atribución.");
    }
  }
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PRODUCT_MEDIA_MAX_RENDER_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function canvasWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
  if (!blob || blob.type !== "image/webp") throw new Error("Este navegador no puede crear la copia WebP local.");
  if (blob.size > MAX_PRODUCT_MEDIA_OUTPUT_BYTES) throw new Error("La imagen procesada sigue siendo demasiado grande.");
  return blob;
}

async function browserDecode(blob: Blob): Promise<DecodedProductImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(context, width, height) { context.drawImage(bitmap, 0, 0, width, height); },
      close() { bitmap.close(); },
    };
  }

  if (typeof document === "undefined") throw new Error("Este navegador no puede decodificar imágenes locales.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = document.createElement("img");
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
      element.src = objectUrl;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(context, width, height) { context.drawImage(image, 0, 0, width, height); },
      close() { URL.revokeObjectURL(objectUrl); },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export async function normalizeProductImage(
  file: Blob & { readonly name?: string },
  options: NormalizeProductImageOptions,
): Promise<ProductMediaAsset> {
  validateProductImageInput(file);
  if (!validKey(options.key)) throw new Error("La clave multimedia no es válida.");
  const decoded = await (options.decode ?? browserDecode)(file);
  try {
    validateDecodedProductImage(decoded.width, decoded.height);
    const dimensions = scaledDimensions(decoded.width, decoded.height);
    const canvas = (options.createCanvas ?? ((width, height) => {
      if (typeof document === "undefined") throw new Error("Este navegador no puede procesar imágenes locales.");
      const element = document.createElement("canvas");
      element.width = width;
      element.height = height;
      return element;
    }))(dimensions.width, dimensions.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("No se pudo preparar la imagen local.");
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    decoded.draw(context, dimensions.width, dimensions.height);
    const blob = await canvasWebp(canvas);
    const timestamp = options.now ?? new Date().toISOString();
    const asset: ProductMediaAsset = {
      schemaVersion: PRODUCT_MEDIA_SCHEMA_VERSION,
      key: options.key,
      blob,
      mimeType: "image/webp",
      width: dimensions.width,
      height: dimensions.height,
      source: { kind: "owner-upload" },
      ...(file.name ? { originalName: file.name.slice(0, 240) } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assertProductMediaAsset(asset);
    return asset;
  } finally {
    decoded.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falló el almacenamiento multimedia local."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló la transacción multimedia local."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Se canceló la transacción multimedia local."));
  });
}

function openProductMediaDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(PRODUCT_MEDIA_DB_NAME, PRODUCT_MEDIA_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PRODUCT_MEDIA_STORE_NAME)) {
        database.createObjectStore(PRODUCT_MEDIA_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacén multimedia local."));
  });
}

export function createIndexedDbProductMediaStore(factory?: IDBFactory): ProductMediaStore {
  const resolvedFactory = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!resolvedFactory) throw new Error("IndexedDB no está disponible en este navegador.");
  let databasePromise: Promise<IDBDatabase> | undefined;
  const database = (): Promise<IDBDatabase> => databasePromise ??= openProductMediaDatabase(resolvedFactory);

  async function write(action: (store: IDBObjectStore) => void): Promise<void> {
    const transaction = (await database()).transaction(PRODUCT_MEDIA_STORE_NAME, "readwrite");
    action(transaction.objectStore(PRODUCT_MEDIA_STORE_NAME));
    await transactionDone(transaction);
  }

  return {
    async get(key) {
      if (!validKey(key)) return undefined;
      const transaction = (await database()).transaction(PRODUCT_MEDIA_STORE_NAME, "readonly");
      return requestResult(transaction.objectStore(PRODUCT_MEDIA_STORE_NAME).get(key)) as Promise<ProductMediaAsset | undefined>;
    },
    async list() {
      const transaction = (await database()).transaction(PRODUCT_MEDIA_STORE_NAME, "readonly");
      const assets = await requestResult(transaction.objectStore(PRODUCT_MEDIA_STORE_NAME).getAll()) as ProductMediaAsset[];
      return assets.sort((left, right) => left.key.localeCompare(right.key));
    },
    async put(asset) { assertProductMediaAsset(asset); await write((store) => { store.put(asset); }); },
    async delete(key) { if (validKey(key)) await write((store) => { store.delete(key); }); },
    async clear() { await write((store) => { store.clear(); }); },
    async replaceAll(assets) {
      const keys = new Set<string>();
      for (const asset of assets) {
        assertProductMediaAsset(asset);
        if (keys.has(asset.key)) throw new Error(`La copia multimedia repite ${asset.key}.`);
        keys.add(asset.key);
      }
      await write((store) => {
        store.clear();
        for (const asset of assets) store.put(asset);
      });
    },
  };
}

export function createMemoryProductMediaStore(initial: readonly ProductMediaAsset[] = []): ProductMediaStore {
  const assets = new Map<string, ProductMediaAsset>();
  for (const asset of initial) { assertProductMediaAsset(asset); assets.set(asset.key, asset); }
  return {
    async get(key) { return assets.get(key); },
    async list() { return [...assets.values()].sort((left, right) => left.key.localeCompare(right.key)); },
    async put(asset) { assertProductMediaAsset(asset); assets.set(asset.key, asset); },
    async delete(key) { assets.delete(key); },
    async clear() { assets.clear(); },
    async replaceAll(next) {
      const replacement = new Map<string, ProductMediaAsset>();
      for (const asset of next) {
        assertProductMediaAsset(asset);
        if (replacement.has(asset.key)) throw new Error(`La copia multimedia repite ${asset.key}.`);
        replacement.set(asset.key, asset);
      }
      assets.clear();
      for (const [key, asset] of replacement) assets.set(key, asset);
    },
  };
}

export class ProductMediaObjectUrls {
  readonly #urls = new Map<string, string>();

  assign(key: string, blob: Blob): string {
    this.revoke(key);
    const url = URL.createObjectURL(blob);
    this.#urls.set(key, url);
    return url;
  }

  revoke(key: string): void {
    const url = this.#urls.get(key);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.#urls.delete(key);
  }

  clear(): void {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    this.#urls.clear();
  }
}
