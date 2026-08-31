import "./style.css";
import {
  applyImport,
  previewWorkbook,
  readWorkbookFile,
  type ImportPreview,
} from "../domain/importer";
import {
  CHANGE_SET_OBJECT_TYPES,
  applyProposedChangeSet,
  createChangeSetJournalStore,
  createProposedChangeSet,
  createRecordOperation,
  makeChangeSetTarget,
  proposeChangeSet,
  rejectProposedChangeSet,
  setHoldingOperation,
  setNotesOperation,
  setWantOperation,
  targetFromRecord,
  undoAppliedChangeSet,
  type ChangeOperation,
  type ChangeSetJournal,
  type ChangeSetObjectType,
  type ChangeSetOwnerContext,
  type ProposedChangeSet,
  CHANGE_SET_JOURNAL_KEY,
} from "../domain/change-sets";
import {
  LOCAL_STATE_KEY,
  createBackup,
  createLocalStateStore,
  parseBackup,
  serializeBackup,
} from "../domain/backup";
import {
  createFullBackupArchive,
  parseFullBackupArchive,
  parseProductMediaPack,
} from "../domain/media-archive";
import {
  NEW_FLOW_OBJECT_TYPES,
  ROADMAP_URGENCIES,
  createEmptyState,
  holdingWithCounts,
  isLegacyCardType,
  openedQuantity,
  recordRevision,
  roadmapProgress,
  sealedQuantity,
  stableRecordId,
  totalHoldingQuantity,
  type CollectionRecord,
  type CollectionState,
  type HoldingStatus,
  type NewFlowObjectType,
  type ObjectType,
  type RoadmapUrgency,
  type WantPriority,
} from "../domain/model";
import {
  availableRoadmapLanguages,
  roadmapRegion,
  type RoadmapFilters,
  type RoadmapStatus,
} from "../domain/roadmap";
import {
  canonicalizeCardmarketUrl,
  describeCardmarketEntry,
  resolveCardmarketProduct,
  usableCardmarketCatalog,
  type CardmarketCatalogEntry,
  type CardmarketCatalogIndex,
  type CardmarketResolution,
} from "../domain/cardmarket";
import { applyCardmarketIntake } from "../domain/intake";
import { syntheticCardmarketIndex, syntheticState, syntheticWorkbook } from "../fixtures/synthetic";
import { LAST_IMPORT_BACKUP_KEY, SYNTHETIC_DEMO_DISMISSED_KEY, classifyExternalDeviceClear, clearPocketdexDevice, renderClearDeviceDialog, wrappedDialogFocusIndex } from "./clear-device-dialog";
import {
  createIndexedDbProductMediaStore,
  normalizeProductImage,
  ProductMediaObjectUrls,
  resolveProductMediaKey,
  type ProductMediaStore,
} from "../media";
import { renderMissionSheet, renderRoadmapView } from "./roadmap-view";
import { resolveLicensedProductMedia } from "../data/product-media-manifest";

type View = "map" | "collection" | "wants" | "add" | "settings";

export interface MountAppOptions {
  cardmarketIndex?: CardmarketCatalogIndex;
  initialView?: View;
  mediaStore?: ProductMediaStore;
}

interface IntakeUiState {
  sourceUrl: string;
  resolution?: CardmarketResolution;
  selectedEntry?: CardmarketCatalogEntry;
  targetSealedQuantity: number;
  targetOpenedQuantity: number;
  sealedQuantity: number;
  openedQuantity: number;
  urgency: RoadmapUrgency;
  goalLanguage: string;
  segment: string;
  notes: string;
  name: string;
  setName: string;
}

interface UiState {
  view: View;
  query: string;
  type: NewFlowObjectType | "all";
  status: HoldingStatus | "all";
  urgency: RoadmapUrgency | "all";
  language: string | "all";
  roadmapStatus: RoadmapStatus | "all";
  message: string;
  preview?: ImportPreview;
  pendingChangeSet?: ProposedChangeSet;
  importProposalIndex: number;
  offline: boolean;
  clearDeviceDialogOpen: boolean;
  activeRegion?: string;
  selectedRecordId?: string;
  mediaBusy: boolean;
  intake: IntakeUiState;
}

// This is a synthetic local review identity only. It is intentionally not a Firebase credential or auth adapter.
const SYNTHETIC_OWNER_CONTEXT: ChangeSetOwnerContext = {
  authenticatedUid: "synthetic-owner",
  expectedOwnerUid: "synthetic-owner",
};

const objectLabels: Record<ObjectType, string> = {
  box: "Caja",
  tin: "Lata",
  single: "Carta individual",
  "graded-card": "Carta graduada",
  accessory: "Accesorio",
  custom: "Otro producto",
};

const fieldLabels = {
  name: "Nombre",
  category: "Categoría",
  setName: "Colección",
  language: "Idioma",
  package: "Formato",
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function formatType(value: ObjectType): string {
  return objectLabels[value];
}

function formatHoldingStatus(value: HoldingStatus): string {
  return value === "opened" ? "Abierto" : "Sellado";
}

function formatPriority(value: WantPriority): string {
  return value === "high" ? "Alta" : value === "low" ? "Baja" : "Normal";
}

function now(): string {
  return new Date().toISOString();
}

function stableTextToken(value: string): string {
  const seeds = [2166136261, 2654435761, 2246822519, 3266489917];
  return seeds.map((seed, lane) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index) + lane;
      hash = Math.imul(hash, 16777619 + lane * 2) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }).join("");
}

function firstSharedCardmarketUrl(): string {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["url", "text", "shared_url", "link"]) {
    const value = params.get(key)?.trim() ?? "";
    if (value.startsWith("https://")) return value;
    const match = value.match(/https:\/\/(?:www\.)?cardmarket\.com\/[^\s]+/i);
    if (match?.[0]) return match[0];
  }
  return "";
}

export type ListFilterState = Pick<UiState, "view" | "query" | "type" | "status" | "urgency" | "language" | "roadmapStatus">;

export function recordMatches(record: CollectionRecord, ui: ListFilterState): boolean {
  if (ui.view === "wants") {
    if (!record.want?.wanted || roadmapProgress(record).remainingSteps === 0) return false;
    if (ui.urgency !== "all" && record.want.urgency !== ui.urgency) return false;
    if (ui.language !== "all" && (record.want.goalLanguage ?? record.holding?.language ?? "").toLocaleLowerCase("es-ES") !== ui.language.toLocaleLowerCase("es-ES")) return false;
    if (ui.roadmapStatus !== "all" && roadmapProgress(record).status !== ui.roadmapStatus) return false;
  }
  if (ui.view === "collection") {
    if (totalHoldingQuantity(record.holding) === 0) return false;
    if (ui.status === "owned" && sealedQuantity(record.holding) === 0) return false;
    if (ui.status === "opened" && openedQuantity(record.holding) === 0) return false;
  }
  if (ui.type !== "all" && record.catalog.objectType !== ui.type) return false;
  const haystack = [record.catalog.name, record.catalog.setName, record.catalog.number, record.notes, record.catalog.idProduct, record.want?.goalLanguage, record.want?.segment, record.want?.tier]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("es-ES");
  return ui.query === "" || haystack.includes(ui.query.toLocaleLowerCase("es-ES"));
}

function formatUrgency(value: RoadmapUrgency | undefined): string {
  return ({
    critical: "Muy alta",
    high: "Alta",
    medium: "Media",
    low: "Baja",
    opportunistic: "Oportunista",
    wait: "Esperar",
    "wait-launch": "Esperar lanzamiento",
    "do-not-buy": "No comprar",
  } as const)[value ?? "medium"];
}

function cardmarketHref(record: CollectionRecord): { href: string; exact: boolean } {
  const fallback = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(record.catalog.name)}`;
  const sourceUrl = record.catalog.sourceUrl?.trim();
  if (!sourceUrl) return { href: fallback, exact: false };
  const parsed = canonicalizeCardmarketUrl(sourceUrl);
  if (!("issue" in parsed)) return { href: parsed.canonicalUrl, exact: true };
  return { href: fallback, exact: false };
}

function mediaMonogram(record: CollectionRecord): string {
  const words = record.catalog.name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toLocaleUpperCase("es-ES") ?? "").join("") || "PX";
}

function renderGalleryMedia(record: CollectionRecord): string {
  const key = escapeHtml(resolveProductMediaKey(record));
  return `<span class="product-media expedition-card__media" data-product-media-frame data-media-key="${key}"><span class="product-media__fallback" data-product-media-fallback aria-hidden="true"><span>${escapeHtml(mediaMonogram(record))}</span></span><img class="product-media__image" data-product-media data-media-key="${key}" data-record-id="${escapeHtml(record.id)}" alt="" hidden></span>`;
}

export function renderExpeditionCard(record: CollectionRecord, view: "collection" | "wants"): string {
  const progress = roadmapProgress(record);
  const sealed = sealedQuantity(record.holding);
  const opened = openedQuantity(record.holding);
  const subtitle = [record.catalog.setName, record.want?.releaseYear?.toString()].filter(Boolean).join(" · ");
  const statusLabel = progress.status === "complete" ? "Completada" : progress.status === "in-progress" ? "En curso" : "Por iniciar";
  const contextLabel = view === "wants"
    ? `${statusLabel} · ${progress.percent}% del objetivo`
    : `${sealed} sellada${sealed === 1 ? "" : "s"} · ${opened} abierta${opened === 1 ? "" : "s"}`;
  return `<article class="expedition-card expedition-card--${view}" data-record-id="${escapeHtml(record.id)}">
    <button type="button" class="expedition-card__trigger" data-action="open-mission-sheet" data-record-id="${escapeHtml(record.id)}" aria-haspopup="dialog" aria-label="Abrir ficha de ${escapeHtml(record.catalog.name)}">
      ${renderGalleryMedia(record)}
      <span class="expedition-card__body"><span class="expedition-card__type">${escapeHtml(formatType(record.catalog.objectType))}</span><strong>${escapeHtml(record.catalog.name)}</strong><small>${escapeHtml(subtitle || "Objeto de expedición")}</small><span class="expedition-card__status"><span>${escapeHtml(contextLabel)}</span>${view === "wants" ? `<strong>${progress.percent}%</strong>` : ""}</span></span>
    </button>
  </article>`;
}

function reviewValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (serialized ?? "—").slice(0, 1_200);
}

function changeFieldLabel(kind: ProposedChangeSet["operations"][number]["kind"]): string {
  return {
    "create-record": "Registro",
    "delete-record": "Registro",
    "set-holding": "Existencias",
    "set-want": "Objetivo",
    "set-notes": "Notas",
    "append-acquisition": "Hecho de adquisición",
    "append-price-observation": "Observación de precio",
  }[kind];
}

function renderChangeSetReview(changeSet: ProposedChangeSet | undefined): string {
  if (changeSet === undefined) return `<p class="muted">No hay cambios pendientes de confirmar.</p>`;
  const diffs = changeSet.operations.map((operation) => {
    const before = operation.kind === "create-record" ? null
      : operation.kind === "delete-record" ? operation.before
        : operation.kind === "set-holding" || operation.kind === "set-want" || operation.kind === "set-notes" ? operation.before
          : null;
    const after = operation.kind === "create-record" ? operation.after
      : operation.kind === "delete-record" ? null
        : operation.kind === "set-holding" || operation.kind === "set-want" || operation.kind === "set-notes" ? operation.after
          : operation.kind === "append-acquisition" ? operation.acquisition
            : operation.observation;
    let summary = changeFieldLabel(operation.kind);
    if (operation.kind === "set-holding") {
      const sealedDelta = sealedQuantity(operation.after) - sealedQuantity(operation.before);
      const openedDelta = openedQuantity(operation.after) - openedQuantity(operation.before);
      summary = sealedDelta === -1 && openedDelta === 1 ? "Abrir una unidad sellada"
        : sealedDelta === 1 && openedDelta === 0 ? "Añadir una unidad sellada"
          : sealedDelta === 0 && openedDelta === 1 ? "Añadir una unidad abierta"
            : sealedDelta === -1 && openedDelta === 0 ? "Restar una unidad sellada"
              : sealedDelta === 0 && openedDelta === -1 ? "Restar una unidad abierta"
                : "Actualizar existencias";
    }
    if (operation.kind === "set-want") summary = "Actualizar objetivos del roadmap";
    if (operation.kind === "create-record") summary = "Crear esta misión";
    if (operation.kind === "delete-record") summary = "Eliminar este producto";
    return `<label class="change-diff"><span class="change-diff__header"><input type="checkbox" data-change-operation="${escapeHtml(operation.operationId)}" checked><strong>${escapeHtml(summary)}</strong></span><details><summary>Ver datos técnicos</summary><span class="change-diff__grid"><span><small>Antes</small><pre>${escapeHtml(reviewValue(before))}</pre></span><span aria-hidden="true" class="change-arrow">→</span><span><small>Después</small><pre>${escapeHtml(reviewValue(after))}</pre></span></span></details><span class="muted">${operation.kind === "append-price-observation" || operation.kind === "append-acquisition" ? "Este dato histórico no se modifica después." : "Podrás deshacerlo desde Ajustes."}</span></label>`;
  }).join("");
  return `<section class="change-review" aria-live="polite"><div><p class="eyebrow">Confirma el cambio</p><h3>${escapeHtml(changeSet.target.name)}</h3><p class="muted">Pocketdex todavía no ha modificado tu colección.</p></div><div class="change-diff-list">${diffs}</div><details class="advanced"><summary>Auditoría y origen</summary><p>Registro <code>${escapeHtml(changeSet.target.recordId)}</code><br>Estado base ${changeSet.base.stateRevision}/${changeSet.base.recordRevision}<br>Fuente ${escapeHtml(changeSet.sourceEvidence.reference)}</p></details><div class="tool-actions"><button class="button button--primary" data-action="approve-all-changeset">Aplicar cambio</button><button class="button button--danger" data-action="reject-changeset">Cancelar</button></div></section>`;
}

export function reversibleHideOperations(record: CollectionRecord): ChangeOperation[] {
  const target = targetFromRecord(record);
  const revision = recordRevision(record);
  const operations: ChangeOperation[] = [];
  if (record.holding) operations.push(setHoldingOperation(target, revision, record.holding, null, "hide-holding"));
  if (record.want) operations.push(setWantOperation(target, revision, record.want, null, "hide-want"));
  return operations;
}

function renderAudit(journal: ChangeSetJournal): string {
  const entries = [...journal.audit].reverse().slice(0, 8);
  if (entries.length === 0) return `<p class="muted">Todavía no hay entradas de auditoría.</p>`;
  const statusLabel = (status: string): string => ({ proposed: "Pendiente", applied: "Aplicado", "partially-applied": "Aplicado en parte", rejected: "Cancelado", conflict: "En conflicto", replayed: "Ya aplicado", undone: "Deshecho", "not-undoable": "No reversible" } as Record<string, string>)[status] ?? status;
  return `<ul class="audit-list">${entries.map((entry) => `<li><div><strong>${escapeHtml(statusLabel(entry.status))}</strong> · ${escapeHtml(entry.changeSetId)}<br><span class="muted">${escapeHtml(entry.occurredAt)} · ${escapeHtml(entry.reason ?? statusLabel(entry.event))}</span></div>${entry.event === "applied" && entry.undoable ? `<button class="button button--small button--quiet" data-action="undo-changeset" data-change-set-id="${escapeHtml(entry.changeSetId)}">Deshacer</button>` : entry.event === "applied" ? `<span class="muted">solo anexado</span>` : ""}</li>`).join("")}</ul>`;
}

function renderWorkbookPreview(preview: ImportPreview | undefined): string {
  if (!preview) return "";
  const rows = preview.rows.map((row) => `<li><span>${escapeHtml(row.sheet)}:${row.rowNumber}</span><span class="row-${row.outcome}">${escapeHtml(row.outcome)} · ${escapeHtml(row.reason)}</span></li>`).join("");
  const canApply = preview.sourceUnchanged && preview.totals.ambiguousRows === 0 && preview.proposals.length > 0;
  const progress = preview.totals.targetSteps > 0 ? Math.round((preview.totals.completedSteps / preview.totals.targetSteps) * 100) : 0;
  return `<section class="preview-panel" aria-live="polite"><div class="section-heading"><div><p class="eyebrow">Vista previa</p><h3>${escapeHtml(preview.filename)}</h3></div><span class="privacy-pill">Solo local</span></div><div class="summary-grid"><div><strong>${preview.totals.roadmapItems || preview.proposals.length}</strong><span>objetivos</span></div><div><strong>${preview.totals.completedSteps}/${preview.totals.targetSteps}</strong><span>pasos hechos</span></div><div><strong>${progress}%</strong><span>progreso inicial</span></div><div><strong>${preview.totals.ambiguousRows}</strong><span>ambiguas</span></div></div><p class="hash-status">Archivo verificado: <code>${preview.sourceHashBefore.slice(0, 16)}…</code> · ${preview.sourceUnchanged ? "sin cambios durante la lectura" : "cambió durante la lectura"}</p><details><summary>Decisiones por fila (${preview.rows.length})</summary><ul class="row-report">${rows}</ul></details><div class="tool-actions"><button class="button button--primary" data-action="apply-import-atomic" ${canApply ? "" : "disabled"}>Cargar mapa completo (${preview.proposals.length})</button><button class="button button--quiet" data-action="prepare-import-change-set" ${preview.sourceUnchanged ? "" : "disabled"}>Revisar un registro</button></div><p class="helper">Pocketdex guarda automáticamente una copia anterior para deshacer la importación completa.</p></section>`;
}

function renderFreshness(index: CardmarketCatalogIndex): string {
  const catalog = usableCardmarketCatalog(index);
  const useLabel = catalog.use === "fresh" ? "fresco" : catalog.use === "stale" ? "antiguo" : catalog.use === "last-known-good" ? "último válido" : "vacío";
  return `<p class="index-status"><strong>Índice ${useLabel}</strong> · ${catalog.snapshot.entries.length} productos · creado ${escapeHtml(catalog.snapshot.createdAt.slice(0, 10))}<br><span class="muted">${escapeHtml(catalog.snapshot.sourceLabel)}</span></p>`;
}

function renderIntakePreview(ui: UiState): string {
  const resolution = ui.intake.resolution;
  if (!resolution) return "";
  const resultClass = resolution.status === "invalid" || resolution.status === "zero" ? "notice notice--warn" : "notice";
  const candidateList = resolution.candidates.map((entry) => `<li><button class="candidate" data-action="select-candidate" data-id-product="${escapeHtml(entry.idProduct)}"><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.language ?? "Idioma no indicado")} · ${escapeHtml(entry.package ?? "Formato no indicado")}</small></span><span aria-hidden="true">›</span></button></li>`).join("");
  const selected = ui.intake.selectedEntry;
  const details = selected ? describeCardmarketEntry(selected).map((field) => `<li><span>${fieldLabels[field.key]}</span><span class="field-state field-state--${field.state}">${field.value ? escapeHtml(field.value) : "Falta"} · ${field.state === "published" ? "publicado" : field.state === "inferred" ? "inferido" : "falta"}</span></li>`).join("") : "";
  const goalTotal = ui.intake.targetSealedQuantity + ui.intake.targetOpenedQuantity;
  const holdingTotal = ui.intake.sealedQuantity + ui.intake.openedQuantity;
  return `<section class="intake-result" aria-live="polite"><div class="${resultClass}"><strong>${escapeHtml(resolution.message)}</strong>${resolution.canonicalUrl ? `<span>Enlace normalizado: <code>${escapeHtml(resolution.canonicalUrl)}</code></span>` : ""}</div>${resolution.status === "multiple" ? `<div class="candidate-panel"><h3>Elige una variante</h3><p class="muted">No mezclamos envases ni idiomas automáticamente.</p><ul class="candidate-list">${candidateList}</ul></div>` : ""}${resolution.status === "zero" ? `<div class="empty-state empty-state--compact"><h3>No hay coincidencia</h3><p class="muted">Comprueba el producto. Pocketdex no inventará una identidad.</p></div>` : ""}${selected ? `<form id="intake-preview-form" class="intake-preview-form"><div class="preview-heading"><div><p class="eyebrow">Nueva misión</p><h3>${escapeHtml(selected.name)}</h3></div><span class="type-badge">${escapeHtml(formatType(selected.objectType))}</span></div><ul class="field-list">${details}</ul><div class="form-grid"><label>Nombre visible<input name="name" maxlength="240" value="${escapeHtml(ui.intake.name)}" required></label><label>Colección<input name="setName" maxlength="240" value="${escapeHtml(ui.intake.setName)}"></label><label>Quiero guardar<input name="targetSealedQuantity" type="number" min="0" max="9999" step="1" value="${ui.intake.targetSealedQuantity}" required></label><label>Quiero abrir<input name="targetOpenedQuantity" type="number" min="0" max="9999" step="1" value="${ui.intake.targetOpenedQuantity}" required></label><label>Ya tengo selladas<input name="sealedQuantity" type="number" min="0" max="9999" step="1" value="${ui.intake.sealedQuantity}" required></label><label>Ya tengo abiertas<input name="openedQuantity" type="number" min="0" max="9999" step="1" value="${ui.intake.openedQuantity}" required></label><label>Urgencia<select name="urgency">${ROADMAP_URGENCIES.map((urgency) => `<option value="${urgency}" ${ui.intake.urgency === urgency ? "selected" : ""}>${formatUrgency(urgency)}</option>`).join("")}</select></label><label>Idioma objetivo<input name="goalLanguage" maxlength="40" value="${escapeHtml(ui.intake.goalLanguage)}" placeholder="JP, EN, KR…"></label><label class="form-span">Región del mapa<input name="segment" maxlength="160" value="${escapeHtml(ui.intake.segment)}" placeholder="p. ej. Era moderna"></label><label class="form-span">Notas opcionales<textarea name="notes" maxlength="500">${escapeHtml(ui.intake.notes)}</textarea></label></div><div class="destination-note"><strong>${goalTotal} pasos de objetivo · ${holdingTotal} unidades actuales</strong><span>Guardar y abrir son independientes. Revisarás el cambio exacto antes de aplicarlo.</span></div><button class="button button--primary button--wide" type="submit">Preparar misión</button></form>` : ""}</section>`;
}

function renderAddView(ui: UiState, index: CardmarketCatalogIndex, journal: ChangeSetJournal): string {
  void journal;
  return `<section class="add-layout scout-station"><div class="page-intro"><p class="eyebrow">Puesto de registro</p><h2>Convierte un producto en una nueva misión.</h2><p class="muted">Pega un producto no-single, confirma su identidad y decide después cuánto quieres guardar o abrir.</p></div><form id="cardmarket-form" class="link-form"><label for="cardmarket-url">Enlace Cardmarket</label><div class="link-input-row"><input id="cardmarket-url" name="sourceUrl" type="url" inputmode="url" autocomplete="url" maxlength="2048" placeholder="https://www.cardmarket.com/en/Pokemon/Products/…" value="${escapeHtml(ui.intake.sourceUrl)}" required><button class="button button--quiet" type="button" data-action="paste-link">Pegar</button></div><div class="form-actions"><button class="button button--primary" type="submit">Explorar producto</button><button class="button button--quiet" type="button" data-action="share-help">¿Cómo compartir?</button></div><p class="helper">La identidad se resuelve contra el catálogo público incluido; el enlace no sale de tu dispositivo.</p></form>${renderFreshness(index)}${renderIntakePreview(ui)}</section>`;
}

function renderChangeTools(ui: UiState, journal: ChangeSetJournal): string {
  return `<details id="change-panel" class="tool-card"><summary><span><span class="eyebrow">Historial seguro</span><strong>Cambios y deshacer</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Cada cambio confirmado queda registrado. Los cambios reversibles pueden deshacerse desde este historial.</p>${renderChangeSetReview(ui.pendingChangeSet)}<details class="audit-panel"><summary>Historial (${journal.audit.length})</summary>${renderAudit(journal)}<div class="tool-actions"><button class="button button--quiet" data-action="replay-last-change">Comprobar último cambio</button></div></details></details>`;
}

function renderCustomTool(): string {
  return `<details id="create-panel" class="tool-card"><summary><span><span class="eyebrow">Entrada manual</span><strong>Añadir otro producto</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Úsalo cuando el producto no esté en Cardmarket. Podrás revisar el resultado antes de guardarlo.</p><form id="create-form" class="form-grid"><label>Nombre<input name="name" required maxlength="120" autocomplete="off" placeholder="p. ej. Archivador especial"></label><label>Tipo<select name="objectType">${CHANGE_SET_OBJECT_TYPES.map((type) => `<option value="${type}">${formatType(type)}</option>`).join("")}</select></label><label>Cantidad<input name="quantity" type="number" min="1" step="1" value="1" required></label><label>Set o grupo<input name="setName" maxlength="120" placeholder="Opcional"></label><label class="form-span">Más detalles <span class="muted">opcionales</span><details><summary>Mostrar</summary><div class="form-grid nested"><label>Número<input name="number" maxlength="40"></label><label>Estado<select name="status"><option value="owned">Sellado</option><option value="opened">Abierto</option></select></label><label>Condición<input name="condition" maxlength="80"></label><label>Idioma<input name="language" maxlength="30"></label><label>Notas<textarea name="notes" maxlength="500"></textarea></label></div></details></label><button class="button button--primary form-span" type="submit">Revisar producto</button></form></details>`;
}

function renderCollectionView(ui: UiState, collection: CollectionState): string {
  const visible = collection.records.filter((record) => recordMatches(record, ui));
  const isWants = ui.view === "wants";
  const languages = availableRoadmapLanguages(collection.records);
  return `<section class="page-intro expedition-intro"><p class="eyebrow">${isWants ? "Diario de misiones" : "Vitrina de expedición"}</p><h2>${isWants ? "Lo que queda por descubrir." : "Los hallazgos que ya forman parte de tu ruta."}</h2><p class="muted">${isWants ? "Cada ficha conserva por separado el objetivo de guardar y el de abrir." : "Las piezas selladas y abiertas conviven en una vitrina visual, sin perder sus cantidades."}</p></section><details class="toolbar-drawer"${ui.query || ui.type !== "all" || (isWants ? ui.urgency !== "all" || ui.language !== "all" || ui.roadmapStatus !== "all" : ui.status !== "all") ? " open" : ""}><summary><span><strong>Kit de búsqueda</strong><small>${visible.length} fichas visibles</small></span></summary><section class="toolbar toolbar--collection" aria-label="Buscar y filtrar esta vista"><label class="search-field"><span>Buscar</span><input id="search" type="search" placeholder="Producto, colección, código…" value="${escapeHtml(ui.query)}"></label><label>Tipo<select id="type-filter"><option value="all">Todos</option>${NEW_FLOW_OBJECT_TYPES.map((type) => `<option value="${type}" ${ui.type === type ? "selected" : ""}>${formatType(type)}</option>`).join("")}</select></label>${isWants ? `<label>Urgencia<select id="urgency-filter"><option value="all">Todas</option>${ROADMAP_URGENCIES.map((urgency) => `<option value="${urgency}" ${ui.urgency === urgency ? "selected" : ""}>${formatUrgency(urgency)}</option>`).join("")}</select></label><label>Idioma<select id="language-filter"><option value="all">Todos</option>${languages.map((language) => `<option value="${escapeHtml(language)}" ${ui.language === language ? "selected" : ""}>${escapeHtml(language)}</option>`).join("")}</select></label><label>Progreso<select id="roadmap-status-list-filter"><option value="all">Todos</option><option value="not-started" ${ui.roadmapStatus === "not-started" ? "selected" : ""}>Por empezar</option><option value="in-progress" ${ui.roadmapStatus === "in-progress" ? "selected" : ""}>En progreso</option></select></label>` : `<label>Existencias<select id="status-filter"><option value="all">Todas</option><option value="owned" ${ui.status === "owned" ? "selected" : ""}>Con selladas</option><option value="opened" ${ui.status === "opened" ? "selected" : ""}>Con abiertas</option></select></label>`}</section></details><section class="section-heading expedition-section-heading"><div><p class="eyebrow">${visible.length} ${isWants ? "misiones" : "hallazgos"}</p><h2>${isWants ? "Cartas de misión" : "Vitrina actual"}</h2></div><button class="button button--primary" data-action="go-add">+ Registrar</button></section><section class="item-grid expedition-grid" aria-live="polite">${visible.length ? visible.map((record) => renderExpeditionCard(record, isWants ? "wants" : "collection")).join("") : `<div class="empty-state"><div class="empty-icon" aria-hidden="true">◇</div><h3>No hay coincidencias</h3><p class="muted">${collection.records.length ? "Prueba otros filtros." : "Importa tu roadmap desde Base o registra un producto."}</p><button class="button button--primary" data-action="go-add">Registrar producto</button></div>`}</section>`;
}

function renderSettingsView(ui: UiState, collection: CollectionState, index: CardmarketCatalogIndex, journal: ChangeSetJournal): string {
  const hasImportBackup = window.localStorage.getItem(LAST_IMPORT_BACKUP_KEY) !== null;
  return `<section class="page-intro base-intro"><p class="eyebrow">Campamento base</p><h2>Prepara y protege tu expedición.</h2><p class="muted">Importaciones, imágenes, copias y revisiones viven aquí, fuera de la ruta diaria.</p></section>
  <div class="tools-grid">
    <details class="tool-card" open><summary><span><span class="eyebrow">Mapa de expedición</span><strong>Importar el Excel completo</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Pocketdex reconoce CAJAS_MASTER y TINS_MASTER, sus cabeceras españolas y los objetivos separados de guardar/abrir. El archivo solo se procesa localmente.</p><div class="tool-actions"><label class="button button--primary file-button">Elegir .xlsx<input id="workbook-file" aria-label="Elegir archivo Excel" type="file" accept=".xlsx,.xls,.csv,.tsv"></label>${hasImportBackup ? `<button class="button button--quiet" data-action="undo-last-import">Recuperar estado anterior</button>` : ""}</div>${renderWorkbookPreview(ui.preview)}</details>
    <details class="tool-card"><summary><span><span class="eyebrow">Catálogo</span><strong>Identidad Cardmarket</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Índice público incluido en la aplicación, sin credenciales ni scraping en el navegador.</p>${renderFreshness(index)}</details>
    <details class="tool-card"><summary><span><span class="eyebrow">Galería local</span><strong>Añadir un pack de imágenes</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Importa un ZIP de JPEG, PNG o WebP. El nombre de cada archivo debe ser el idProduct, variantKey o identificador del registro; Pocketdex lo empareja y lo convierte localmente.</p><div class="tool-actions"><label class="button button--primary file-button">Elegir pack .zip<input id="media-pack-file" aria-label="Elegir pack ZIP de imágenes" type="file" accept="application/zip,.zip" ${ui.mediaBusy ? "disabled" : ""}></label></div><p class="helper">Usa fotos propias o packshots con una licencia que permita guardarlos y redistribuirlos. Google Imágenes y Cardmarket no conceden esa licencia por aparecer en una búsqueda.</p></details>
    <details id="backup-panel" class="tool-card"><summary><span><span class="eyebrow">Portabilidad</span><strong>Exportar o restaurar</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">La copia completa ZIP incluye objetivos, existencias, historial y fotos. La copia JSON ligera no incluye imágenes.</p><div class="tool-actions"><button class="button button--primary" data-action="export-full" ${ui.mediaBusy ? "disabled" : ""}>Copia completa .zip</button><label class="button button--quiet file-button">Restaurar ZIP<input id="restore-full-file" aria-label="Elegir copia completa ZIP" type="file" accept="application/zip,.zip" ${ui.mediaBusy ? "disabled" : ""}></label><button class="button button--quiet" data-action="export">Copia JSON</button><label class="button button--quiet file-button">Restaurar JSON<input id="restore-file" aria-label="Elegir copia de seguridad JSON" type="file" accept="application/json,.json"></label><button class="button button--danger" data-action="clear">Borrar este dispositivo</button></div><details class="paste-restore"><summary>Restaurar pegando una copia JSON</summary><form id="restore-text-form"><label for="restore-json">Copia Pocketdex</label><textarea id="restore-json" name="backupJson" rows="5" required placeholder="Pega aquí una copia exportada por Pocketdex"></textarea><button class="button button--primary" type="submit">Validar y restaurar</button><p class="helper">Se guardará una copia del estado actual para poder deshacer.</p></form></details></details>
    ${renderCustomTool()}${renderChangeTools(ui, journal)}
    <details class="tool-card"><summary><span><span class="eyebrow">Privacidad</span><strong>Tus datos se quedan aquí</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Colección, objetivos y notas se guardan en almacenamiento local; las fotos procesadas viven en IndexedDB. No se suben, no se consultan desde terceros y la app sigue funcionando sin conexión.</p></details>
  </div>`;
}

function downloadLocalBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function mountApp(root: HTMLElement, options: MountAppOptions = {}): void {
  const storage = createLocalStateStore(window.localStorage);
  const changeSetStorage = createChangeSetJournalStore(window.localStorage);
  const productMediaStore = options.mediaStore ?? createIndexedDbProductMediaStore();
  const productMediaUrls = new ProductMediaObjectUrls();
  let renderEpoch = 0;
  let collection = storage.load();
  let changeSetJournal = changeSetStorage.load();
  let usingSyntheticDemo = collection.records.length === 0 && new URLSearchParams(window.location.search).get("demo") === "1";
  if (usingSyntheticDemo) collection = syntheticState();
  const catalogIndex = options.cardmarketIndex ?? syntheticCardmarketIndex();
  type ReviewReturnFocus = { view: View; id?: string; action?: string; recordId?: string; formId?: string; name?: string };
  let reviewReturnFocus: ReviewReturnFocus | undefined;
  let missionReturnFocus: { view: View; recordId: string } | undefined;
  const ui: UiState = {
    view: options.initialView ?? "map",
    query: "",
    type: "all",
    status: "all",
    urgency: "all",
    language: "all",
    roadmapStatus: "all",
    message: "",
    preview: undefined,
    pendingChangeSet: undefined,
    importProposalIndex: 0,
    offline: !navigator.onLine,
    clearDeviceDialogOpen: false,
    activeRegion: undefined,
    selectedRecordId: undefined,
    mediaBusy: false,
    intake: { sourceUrl: firstSharedCardmarketUrl(), targetSealedQuantity: 1, targetOpenedQuantity: 0, sealedQuantity: 0, openedQuantity: 0, urgency: "medium", goalLanguage: "", segment: "", notes: "", name: "", setName: "" },
  };

  function save(next: CollectionState): void {
    collection = next;
    usingSyntheticDemo = false;
    window.localStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, "true");
    storage.save(collection);
  }

  function saveJournal(next: ChangeSetJournal): void {
    changeSetJournal = next;
    changeSetStorage.save(changeSetJournal);
  }

  function captureReviewReturnFocus(): ReviewReturnFocus {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    return {
      view: ui.view,
      id: active?.id || undefined,
      action: active?.dataset.action,
      recordId: active?.closest<HTMLElement>("[data-record-id]")?.dataset.recordId,
      formId: active?.closest<HTMLFormElement>("form")?.id || undefined,
      name: active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement ? active.name || undefined : undefined,
    };
  }

  function restoreReviewReturnFocus(origin: ReviewReturnFocus | undefined): void {
    if (!origin) return;
    const selectors = [
      origin.id ? `#${CSS.escape(origin.id)}` : "",
      origin.recordId && origin.action ? `[data-record-id="${CSS.escape(origin.recordId)}"] [data-action="${CSS.escape(origin.action)}"]` : "",
      origin.formId && origin.name ? `#${CSS.escape(origin.formId)} [name="${CSS.escape(origin.name)}"]` : "",
      `[data-view="${CSS.escape(origin.view)}"]`,
    ].filter(Boolean);
    for (const selector of selectors) {
      const target = root.querySelector<HTMLElement>(selector);
      if (target) { target.focus(); return; }
    }
  }

  function queueChangeSet(changeSet: ProposedChangeSet, message = "El cambio está listo para revisar. Todavía no se ha guardado."): void {
    if (ui.pendingChangeSet !== undefined) {
      ui.message = "Termina o cancela la revisión actual antes de preparar otro cambio.";
      render();
      return;
    }
    reviewReturnFocus = captureReviewReturnFocus();
    saveJournal(proposeChangeSet(changeSetJournal, changeSet, SYNTHETIC_OWNER_CONTEXT));
    ui.pendingChangeSet = changeSet;
    ui.message = message;
    render();
  }

  function prepareRecordChange(record: CollectionRecord, operations: readonly ChangeOperation[], sourceReference = "synthetic-ui-action"): void {
    try {
      const target = targetFromRecord(record);
      const changeSet = createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations, idempotencyKey: `ui-${record.id}-${operations.map((operation) => operation.kind).join("-")}-${Date.now()}`, sourceEvidence: { kind: "owner-note", reference: sourceReference, capturedAt: now() } });
      queueChangeSet(changeSet);
    } catch (error) {
      ui.message = error instanceof Error ? error.message : "No se pudo preparar el cambio";
      render();
    }
  }

  function prepareSyntheticChange(): void {
    const record = collection.records.find((candidate) => candidate.catalog.name === "Sunlit Travel Tin");
    try {
      if (!record) {
        const fixture = syntheticState().records.find((candidate) => candidate.catalog.name === "Sunlit Travel Tin");
        if (!fixture) throw new Error("La fixture sellada sintética no está disponible.");
        const target = targetFromRecord(fixture);
        const after = { ...fixture, revision: 0 };
        queueChangeSet(createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations: [createRecordOperation(target, 0, after, "synthetic-sealed-record")], idempotencyKey: "synthetic-sealed-sunlit-tin-v1", sourceEvidence: { kind: "synthetic-fixture", reference: "synthetic-sunlit-tin", capturedAt: now(), note: "Local synthetic fixture only." } }), "Fixture sellada preparada para revisión exacta.");
        return;
      }
      const target = targetFromRecord(record);
      const before = record.holding ?? null;
      const after = before === null ? { quantity: 1, status: "owned" as const, condition: "Sealed" } : { ...before, quantity: before.quantity + 1, status: "owned" as const };
      prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), before, after, "synthetic-sealed-holding")], "synthetic-sealed-fixture");
    } catch (error) {
      ui.message = error instanceof Error ? error.message : "No se pudo preparar la fixture sellada";
      render();
    }
  }

  function prepareImportChange(): void {
    if (!ui.preview || !ui.preview.sourceUnchanged) return;
    const next = ui.preview.proposals.find((proposal, index) => index >= ui.importProposalIndex && CHANGE_SET_OBJECT_TYPES.includes(proposal.catalog.objectType as ChangeSetObjectType));
    if (!next) {
      ui.message = "No hay otra propuesta de importación sellada/no-single. Las filas single quedan explícitamente fuera de alcance.";
      render();
      return;
    }
    const index = ui.preview.proposals.indexOf(next);
    const existing = collection.records.find((record) => record.id === next.recordId);
    const createdAt = now();
    try {
      const target = existing ? targetFromRecord(existing) : makeChangeSetTarget({ recordId: next.recordId, catalogId: next.catalog.catalogId, objectType: next.catalog.objectType as ChangeSetObjectType, name: next.catalog.name, setName: next.catalog.setName, number: next.catalog.number });
      const operations: ChangeOperation[] = [];
      if (existing) {
        const baseRevision = recordRevision(existing);
        const importedHolding = next.holding ? { ...(existing.holding ?? {}), ...next.holding } : undefined;
        if (importedHolding && JSON.stringify(importedHolding) !== JSON.stringify(existing.holding ?? null)) operations.push(setHoldingOperation(target, baseRevision, existing.holding ?? null, importedHolding, "import-holding"));
        if (next.want && JSON.stringify(next.want) !== JSON.stringify(existing.want ?? null)) operations.push(setWantOperation(target, baseRevision, existing.want ?? null, next.want, "import-want"));
        if (next.notes !== undefined && next.notes !== (existing.notes ?? null)) operations.push(setNotesOperation(target, baseRevision, existing.notes ?? null, next.notes || null, "import-notes"));
      } else {
        operations.push(createRecordOperation(target, 0, { id: next.recordId, catalog: next.catalog, holding: next.holding, want: next.want, notes: next.notes, createdAt, updatedAt: createdAt, revision: 0 }, "import-record"));
      }
      if (operations.length === 0) {
        ui.importProposalIndex = index + 1;
        ui.message = "Esa propuesta normalizada no cambiaría nada.";
        render();
        return;
      }
      ui.importProposalIndex = index;
      queueChangeSet(createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations, idempotencyKey: `import-${ui.preview.sourceHashBefore}-${next.recordId}`, sourceEvidence: { kind: "workbook-preview", reference: ui.preview.filename, capturedAt: createdAt, snapshotHash: ui.preview.sourceHashBefore, note: "Vista previa local; no se sube el workbook ni se consulta un marketplace." }, createdAt }), "La propuesta de importación está lista para revisión exacta.");
    } catch (error) {
      ui.message = error instanceof Error ? error.message : "No se pudo preparar la importación";
      render();
    }
  }

  function prepareIntakeChange(): void {
    const entry = ui.intake.selectedEntry;
    const resolution = ui.intake.resolution;
    if (!entry || !resolution?.canonicalUrl) return;
    try {
      const counts = [ui.intake.targetSealedQuantity, ui.intake.targetOpenedQuantity, ui.intake.sealedQuantity, ui.intake.openedQuantity];
      if (!counts.every((value) => Number.isInteger(value) && value >= 0) || counts.every((value) => value === 0)) throw new Error("Define al menos un objetivo o una unidad actual con cantidades enteras desde cero.");
      const goalTotal = ui.intake.targetSealedQuantity + ui.intake.targetOpenedQuantity;
      const holdingTotal = ui.intake.sealedQuantity + ui.intake.openedQuantity;
      const priority: WantPriority = ui.intake.urgency === "critical" || ui.intake.urgency === "high" ? "high" : ["low", "wait", "wait-launch", "do-not-buy"].includes(ui.intake.urgency) ? "low" : "normal";
      const draft = {
        entry: { ...entry, name: ui.intake.name.trim() || entry.name, ...(ui.intake.setName.trim() ? { setName: ui.intake.setName.trim() } : {}) },
        canonicalUrl: resolution.canonicalUrl,
        destination: goalTotal > 0 ? "wants" as const : "collection" as const,
        quantity: Math.max(1, goalTotal || holdingTotal),
        holdingStatus: ui.intake.sealedQuantity > 0 ? "owned" as const : "opened" as const,
        priority,
        notes: ui.intake.notes,
      };
      const next = applyCardmarketIntake(collection, draft);
      const normalized = next.records.find((record) => record.catalog.idProduct === entry.idProduct);
      if (!normalized) throw new Error("No se pudo construir una identidad Cardmarket válida.");
      const desired: CollectionRecord = {
        ...normalized,
        holding: holdingWithCounts(normalized.holding, ui.intake.sealedQuantity, ui.intake.openedQuantity),
        want: goalTotal > 0 ? {
          wanted: true,
          priority,
          quantity: goalTotal,
          targetSealedQuantity: ui.intake.targetSealedQuantity,
          targetOpenedQuantity: ui.intake.targetOpenedQuantity,
          openGoalMode: ui.intake.targetOpenedQuantity > 0 ? "required" : "none",
          urgency: ui.intake.urgency,
          goalLanguage: ui.intake.goalLanguage.trim() || entry.language,
          segment: ui.intake.segment.trim() || ui.intake.setName.trim() || "Nuevas misiones",
          isRoadmap: true,
        } : undefined,
      };
      const existing = collection.records.find((record) => record.catalog.idProduct === entry.idProduct);
      const target = existing ? targetFromRecord(existing) : makeChangeSetTarget({ recordId: desired.id, catalogId: desired.catalog.catalogId, objectType: desired.catalog.objectType as ChangeSetObjectType, name: desired.catalog.name, setName: desired.catalog.setName, number: desired.catalog.number });
      const operations: ChangeOperation[] = [];
      if (!existing) {
        operations.push(createRecordOperation(target, 0, { ...desired, revision: 0 }, "cardmarket-record"));
      } else {
        const baseRevision = recordRevision(existing);
        if (JSON.stringify(desired.holding ?? null) !== JSON.stringify(existing.holding ?? null)) operations.push(setHoldingOperation(target, baseRevision, existing.holding ?? null, desired.holding ?? null, "cardmarket-holding"));
        if (JSON.stringify(desired.want ?? null) !== JSON.stringify(existing.want ?? null)) operations.push(setWantOperation(target, baseRevision, existing.want ?? null, desired.want ?? null, "cardmarket-want"));
        const nextNotes = ui.intake.notes.trim() || null;
        if (nextNotes !== (existing.notes ?? null)) operations.push(setNotesOperation(target, baseRevision, existing.notes ?? null, nextNotes, "cardmarket-notes"));
      }
      if (operations.length === 0) throw new Error("Este intake no produciría ningún cambio.");
      queueChangeSet(createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations, idempotencyKey: `cardmarket-${entry.idProduct}-${counts.join("-")}-${ui.intake.urgency}-${stableTextToken(`${ui.intake.goalLanguage}|${ui.intake.segment}|${ui.intake.notes.trim()}`)}`, sourceEvidence: { kind: "public-catalog-snapshot", reference: `${resolution.catalog.snapshot.sourceLabel}:${resolution.catalog.snapshot.createdAt}:idProduct-${entry.idProduct}`, capturedAt: now(), sourceUrl: resolution.canonicalUrl, note: `Catálogo público incluido (${resolution.catalog.use}); no se abrió la página del marketplace.` } }), "La misión está lista para revisión; todavía no se ha guardado.");
    } catch (error) {
      ui.message = error instanceof Error ? error.message : "No se pudo preparar este producto";
      render();
    }
  }

  function resetIntake(): void {
    ui.intake.resolution = undefined;
    ui.intake.selectedEntry = undefined;
    ui.intake.name = "";
    ui.intake.setName = "";
    ui.intake.notes = "";
    ui.intake.targetSealedQuantity = 1;
    ui.intake.targetOpenedQuantity = 0;
    ui.intake.sealedQuantity = 0;
    ui.intake.openedQuantity = 0;
    ui.intake.urgency = "medium";
    ui.intake.goalLanguage = "";
    ui.intake.segment = "";
  }

  async function hydrateProductMedia(epoch: number): Promise<void> {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("[data-product-media][data-media-key]"));
    const keys = [...new Set(images.map((image) => image.dataset.mediaKey).filter((key): key is string => Boolean(key)))];
    await Promise.all(keys.map(async (key) => {
      try {
        const asset = await productMediaStore.get(key);
        const matchingImages = images.filter((image) => image.dataset.mediaKey === key && image.isConnected);
        if (epoch !== renderEpoch || matchingImages.length === 0) return;
        const recordId = matchingImages.find((image) => image.dataset.recordId)?.dataset.recordId;
        const record = recordId ? collection.records.find((candidate) => candidate.id === recordId) : undefined;
        const licensed = !asset && record ? resolveLicensedProductMedia(record) : undefined;
        if (!asset && !licensed) return;
        const href = asset ? productMediaUrls.assign(key, asset.blob) : new URL(licensed!.path, document.baseURI).toString();
        for (const image of matchingImages) {
          image.src = href;
          image.hidden = false;
          const frame = image.closest<HTMLElement>("[data-product-media-frame]");
          frame?.classList.add("product-media--loaded");
          const fallback = frame?.querySelector<HTMLElement>("[data-product-media-fallback]");
          if (fallback) fallback.hidden = true;
        }
        const source = asset?.source.kind === "licensed-packshot" ? asset.source : licensed;
        if (source?.sourceUrl && source.attribution && source.license) {
          root.querySelectorAll<HTMLElement>(`[data-product-media-attribution][data-media-key="${CSS.escape(key)}"]`).forEach((attribution) => {
            const link = document.createElement("a");
            link.href = source.sourceUrl!;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = source.attribution!;
            attribution.replaceChildren(link, document.createTextNode(` · ${source.license}`));
            attribution.hidden = false;
          });
        }
        root.querySelectorAll<HTMLButtonElement>(`[data-action="remove-product-media"][data-media-key="${CSS.escape(key)}"]`).forEach((button) => {
          if (asset) {
            button.disabled = false;
            button.setAttribute("aria-disabled", "false");
          }
        });
      } catch {
        // A broken or unavailable local media database must never block the collection UI.
      }
    }));
  }

  async function replaceFromFullBackup(
    restored: ReturnType<typeof parseFullBackupArchive>,
  ): Promise<void> {
    const previousCollection = collection;
    const previousJournal = changeSetJournal;
    const previousAssets = await productMediaStore.list();
    try {
      save(restored.backup.state);
      if (restored.backup.changeSetJournal) saveJournal(restored.backup.changeSetJournal);
      else {
        changeSetStorage.clear();
        changeSetJournal = changeSetStorage.load();
      }
      await productMediaStore.replaceAll(restored.assets);
    } catch (error) {
      try {
        save(previousCollection);
        saveJournal(previousJournal);
        await productMediaStore.replaceAll(previousAssets);
      } catch {
        throw new Error("La restauración falló y no se pudo completar la reversión local. Conserva el ZIP y recarga antes de seguir.");
      }
      throw error;
    }
  }

  function closeMissionSheet(): void {
    const origin = missionReturnFocus;
    ui.selectedRecordId = undefined;
    missionReturnFocus = undefined;
    render();
    if (!origin || origin.view !== ui.view) return;
    root.querySelector<HTMLButtonElement>(`[data-action="open-mission-sheet"][data-record-id="${CSS.escape(origin.recordId)}"]`)?.focus();
  }

  function render(): void {
    const epoch = ++renderEpoch;
    productMediaUrls.clear();
    const ownedQuantity = collection.records.reduce((sum, record) => sum + totalHoldingQuantity(record.holding), 0);
    const wantedCount = collection.records.filter((record) => record.want?.wanted && roadmapProgress(record).remainingSteps > 0).length;
    const roadmapCount = collection.records.filter((record) => record.want?.wanted && record.want.isRoadmap !== false).length;
    const filters: RoadmapFilters = { query: ui.query, type: ui.type, urgency: ui.urgency, language: ui.language, status: ui.roadmapStatus };
    const page = ui.view === "map"
      ? renderRoadmapView(collection.records, { ...filters, activeRegion: ui.activeRegion, selectedRecordId: ui.selectedRecordId })
      : ui.view === "add"
        ? renderAddView(ui, catalogIndex, changeSetJournal)
        : ui.view === "settings"
          ? renderSettingsView(ui, collection, catalogIndex, changeSetJournal)
          : renderCollectionView(ui, collection);
    const selectedRecord = ui.selectedRecordId
      ? collection.records.find((record) => record.id === ui.selectedRecordId)
      : undefined;
    if (ui.selectedRecordId && !selectedRecord) ui.selectedRecordId = undefined;
    const missionOpen = Boolean(selectedRecord && !ui.pendingChangeSet && !ui.clearDeviceDialogOpen);
    const appShellState = ui.clearDeviceDialogOpen || ui.pendingChangeSet || missionOpen ? ` inert aria-hidden="true"` : "";
    const missionLayer = missionOpen && selectedRecord
      ? `<div class="mission-sheet-layer" data-mission-sheet-layer>${renderMissionSheet(selectedRecord)}</div>`
      : "";
    root.innerHTML = `<div class="app-shell"${appShellState}><header class="app-header"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true">⌁</span><div><p class="eyebrow">Atlas privado · local-first</p><h1>Pocketdex</h1><p class="muted">Convierte tu colección en una ruta que apetece completar.</p></div></div><div class="header-pills"><span class="privacy-pill">${usingSyntheticDemo ? "Demo" : "Solo este dispositivo"}</span>${ui.offline ? `<span class="offline-pill">Sin conexión</span>` : ""}</div></header><nav class="tabs" aria-label="Secciones principales"><button class="tab ${ui.view === "map" ? "tab--active" : ""}" data-view="map" aria-current="${ui.view === "map" ? "page" : "false"}"><span class="tab__icon" aria-hidden="true">⌁</span>Mapa <em>${roadmapCount}</em></button><button class="tab ${ui.view === "collection" ? "tab--active" : ""}" data-view="collection" aria-current="${ui.view === "collection" ? "page" : "false"}"><span class="tab__icon" aria-hidden="true">◇</span>Vitrina <em>${ownedQuantity}</em></button><button class="tab ${ui.view === "wants" ? "tab--active" : ""}" data-view="wants" aria-current="${ui.view === "wants" ? "page" : "false"}"><span class="tab__icon" aria-hidden="true">◎</span>Misiones <em>${wantedCount}</em></button><button class="tab tab--add ${ui.view === "add" ? "tab--active" : ""}" data-view="add" aria-current="${ui.view === "add" ? "page" : "false"}"><span class="tab__icon" aria-hidden="true">＋</span>Registrar</button><button class="tab ${ui.view === "settings" ? "tab--active" : ""}" data-view="settings" aria-current="${ui.view === "settings" ? "page" : "false"}"><span class="tab__icon" aria-hidden="true">⚙</span>Base</button></nav><main>${page}</main>${ui.message ? `<div class="toast" role="status"><span>${escapeHtml(ui.message)}</span></div>` : ""}</div>${ui.pendingChangeSet ? `<aside class="review-drawer" role="dialog" aria-modal="true" aria-label="Revisión pendiente">${renderChangeSetReview(ui.pendingChangeSet)}</aside>` : ""}${renderClearDeviceDialog(ui.clearDeviceDialogOpen)}${missionLayer}`;
    bindEvents();
    void hydrateProductMedia(epoch);
    if (ui.pendingChangeSet) root.querySelector<HTMLButtonElement>(".review-drawer [data-action='approve-all-changeset']")?.focus();
    else if (ui.clearDeviceDialogOpen) root.querySelector<HTMLButtonElement>("[data-action='cancel-clear-device']")?.focus();
    else if (missionOpen) root.querySelector<HTMLElement>("[data-mission-sheet]")?.focus();
  }

  function applyExternalDeviceClear(): void {
    void productMediaStore.clear().catch(() => {
      ui.message = "Otra pestaña borró la colección, pero la galería local no pudo verificarse.";
      render();
    });
    collection = createEmptyState();
    changeSetJournal = changeSetStorage.load();
    usingSyntheticDemo = false;
    ui.preview = undefined;
    ui.pendingChangeSet = undefined;
    ui.importProposalIndex = 0;
    ui.clearDeviceDialogOpen = false;
    ui.selectedRecordId = undefined;
    ui.activeRegion = undefined;
    ui.message = "Otra pestaña borró los datos locales de este dispositivo.";
    render();
  }

  function bindEvents(): void {
    const renderAndFocus = (selector: string): void => {
      render();
      root.querySelector<HTMLElement>(selector)?.focus();
    };
    const focusSettingsTab = (): void => root.querySelector<HTMLButtonElement>("[data-view='settings']")?.focus();
    const focusClearDeviceTrigger = (): void => {
      const panel = root.querySelector<HTMLDetailsElement>("#backup-panel");
      if (panel) panel.open = true;
      root.querySelector<HTMLButtonElement>("[data-action='clear']")?.focus();
    };
    const closeClearDeviceDialog = (): void => { ui.clearDeviceDialogOpen = false; render(); focusClearDeviceTrigger(); };
    const clearDeviceDialog = root.querySelector<HTMLElement>("[data-clear-device-dialog]");
    clearDeviceDialog?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeClearDeviceDialog(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(clearDeviceDialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const nextIndex = wrappedDialogFocusIndex(controls.indexOf(document.activeElement as HTMLButtonElement), event.shiftKey, controls.length);
      if (nextIndex === undefined) return;
      event.preventDefault();
      controls[nextIndex]?.focus();
    });
    const reviewDrawer = root.querySelector<HTMLElement>(".review-drawer");
    reviewDrawer?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        reviewDrawer.querySelector<HTMLButtonElement>("[data-action='reject-changeset']")?.click();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(reviewDrawer.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), summary"));
      const nextIndex = wrappedDialogFocusIndex(controls.indexOf(document.activeElement as HTMLElement), event.shiftKey, controls.length);
      if (nextIndex === undefined) return;
      event.preventDefault();
      controls[nextIndex]?.focus();
    });
    const missionSheet = root.querySelector<HTMLElement>("[data-mission-sheet]");
    missionSheet?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeMissionSheet(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(missionSheet.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary"));
      const nextIndex = wrappedDialogFocusIndex(controls.indexOf(document.activeElement as HTMLElement), event.shiftKey, controls.length);
      if (nextIndex === undefined) return;
      event.preventDefault();
      controls[nextIndex]?.focus();
    });
    root.querySelector<HTMLElement>("[data-mission-sheet-layer]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeMissionSheet();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => {
      ui.view = button.dataset.view as View;
      ui.selectedRecordId = undefined;
      missionReturnFocus = undefined;
      ui.message = "";
      render();
    }));
    root.querySelector<HTMLButtonElement>("[data-action='go-add']")?.addEventListener("click", () => { ui.view = "add"; ui.message = ""; render(); });
    root.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => { ui.query = (event.target as HTMLInputElement).value; render(); const search = root.querySelector<HTMLInputElement>("#search"); search?.focus(); search?.setSelectionRange(ui.query.length, ui.query.length); });
    root.querySelector<HTMLSelectElement>("#type-filter")?.addEventListener("change", (event) => { ui.type = (event.target as HTMLSelectElement).value as UiState["type"]; renderAndFocus("#type-filter"); });
    root.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => { ui.status = (event.target as HTMLSelectElement).value as UiState["status"]; renderAndFocus("#status-filter"); });
    root.querySelector<HTMLSelectElement>("#urgency-filter")?.addEventListener("change", (event) => { ui.urgency = (event.target as HTMLSelectElement).value as UiState["urgency"]; renderAndFocus("#urgency-filter"); });
    root.querySelector<HTMLSelectElement>("#language-filter")?.addEventListener("change", (event) => { ui.language = (event.target as HTMLSelectElement).value; renderAndFocus("#language-filter"); });
    root.querySelector<HTMLSelectElement>("#roadmap-status-list-filter")?.addEventListener("change", (event) => { ui.roadmapStatus = (event.target as HTMLSelectElement).value as UiState["roadmapStatus"]; renderAndFocus("#roadmap-status-list-filter"); });
    root.querySelector<HTMLInputElement>("#roadmap-query")?.addEventListener("input", (event) => { ui.query = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>("#roadmap-query"); input?.focus(); input?.setSelectionRange(ui.query.length, ui.query.length); });
    root.querySelector<HTMLSelectElement>("#roadmap-type-filter")?.addEventListener("change", (event) => { ui.type = (event.target as HTMLSelectElement).value as UiState["type"]; renderAndFocus("#roadmap-type-filter"); });
    root.querySelector<HTMLSelectElement>("#roadmap-urgency-filter")?.addEventListener("change", (event) => { ui.urgency = (event.target as HTMLSelectElement).value as UiState["urgency"]; renderAndFocus("#roadmap-urgency-filter"); });
    root.querySelector<HTMLSelectElement>("#roadmap-language-filter")?.addEventListener("change", (event) => { ui.language = (event.target as HTMLSelectElement).value; renderAndFocus("#roadmap-language-filter"); });
    root.querySelector<HTMLSelectElement>("#roadmap-status-filter")?.addEventListener("change", (event) => { ui.roadmapStatus = (event.target as HTMLSelectElement).value as UiState["roadmapStatus"]; renderAndFocus("#roadmap-status-filter"); });
    root.querySelector<HTMLInputElement>("#cardmarket-url")?.addEventListener("input", (event) => { ui.intake.sourceUrl = (event.target as HTMLInputElement).value; });
    root.querySelector<HTMLButtonElement>("[data-action='paste-link']")?.addEventListener("click", async () => { try { ui.intake.sourceUrl = await navigator.clipboard.readText(); ui.message = "Enlace pegado; revisa y continúa."; render(); root.querySelector<HTMLInputElement>("#cardmarket-url")?.focus(); } catch { ui.message = "No se pudo leer el portapapeles. Pega el enlace en el campo."; render(); } });
    root.querySelector<HTMLButtonElement>("[data-action='share-help']")?.addEventListener("click", () => { ui.message = "Desde Cardmarket, usa Compartir y elige Pocketdex; también puedes pegar el enlace aquí."; render(); });
    root.querySelector<HTMLFormElement>("#cardmarket-form")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); ui.intake.sourceUrl = String(form.get("sourceUrl") ?? "").trim(); ui.intake.resolution = resolveCardmarketProduct(ui.intake.sourceUrl, catalogIndex); ui.intake.selectedEntry = ui.intake.resolution.candidates.length === 1 ? ui.intake.resolution.candidates[0] : undefined; if (ui.intake.selectedEntry) { ui.intake.name = ui.intake.selectedEntry.name; ui.intake.setName = ui.intake.selectedEntry.setName ?? ""; ui.intake.goalLanguage = ui.intake.selectedEntry.language ?? ""; ui.intake.segment = ui.intake.selectedEntry.setName ?? "Nuevas misiones"; } ui.message = ui.intake.resolution.message; render(); root.querySelector<HTMLElement>(".intake-result")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("input", (event) => { const target = event.target as HTMLInputElement | HTMLTextAreaElement; if (target.name === "name") ui.intake.name = target.value; if (target.name === "setName") ui.intake.setName = target.value; if (target.name === "targetSealedQuantity") ui.intake.targetSealedQuantity = Number(target.value); if (target.name === "targetOpenedQuantity") ui.intake.targetOpenedQuantity = Number(target.value); if (target.name === "sealedQuantity") ui.intake.sealedQuantity = Number(target.value); if (target.name === "openedQuantity") ui.intake.openedQuantity = Number(target.value); if (target.name === "goalLanguage") ui.intake.goalLanguage = target.value; if (target.name === "segment") ui.intake.segment = target.value; if (target.name === "notes") ui.intake.notes = target.value; });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("change", (event) => { const target = event.target as HTMLSelectElement | HTMLInputElement; if (target.name === "urgency") ui.intake.urgency = target.value as RoadmapUrgency; window.setTimeout(() => renderAndFocus("#intake-preview-form [name='urgency']"), 0); });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("submit", (event) => { event.preventDefault(); prepareIntakeChange(); });
    root.querySelectorAll<HTMLButtonElement>("[data-action='select-candidate']").forEach((button) => button.addEventListener("click", () => { const idProduct = button.dataset.idProduct; const selected = ui.intake.resolution?.candidates.find((entry) => entry.idProduct === idProduct); if (!selected) return; ui.intake.selectedEntry = selected; ui.intake.name = selected.name; ui.intake.setName = selected.setName ?? ""; ui.intake.goalLanguage = selected.language ?? ""; ui.intake.segment = selected.setName ?? "Nuevas misiones"; ui.message = "Variante seleccionada; define objetivos y existencias."; render(); }));
    root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", async () => {
      const action = element.dataset.action;
      if (["go-add", "paste-link", "share-help", "select-candidate"].includes(action ?? "")) return;
      if (action === "select-roadmap-region") {
        ui.activeRegion = element.dataset.regionName;
        ui.selectedRecordId = undefined;
        missionReturnFocus = undefined;
        render();
        if (ui.activeRegion) root.querySelector<HTMLButtonElement>(`[data-action="select-roadmap-region"][data-region-name="${CSS.escape(ui.activeRegion)}"]`)?.focus();
        return;
      }
      if (action === "open-mission-sheet") {
        const targetId = element.dataset.recordId ?? element.closest<HTMLElement>("[data-record-id]")?.dataset.recordId;
        const record = targetId ? collection.records.find((candidate) => candidate.id === targetId) : undefined;
        if (!record) return;
        missionReturnFocus = { view: ui.view, recordId: record.id };
        ui.selectedRecordId = record.id;
        if (ui.view === "map") ui.activeRegion = roadmapRegion(record);
        render();
        return;
      }
      if (action === "close-mission-sheet") { closeMissionSheet(); return; }
      if (action === "remove-product-media") {
        const key = element.dataset.mediaKey;
        if (!key || ui.mediaBusy || !window.confirm("¿Eliminar esta foto local de la ficha?")) return;
        ui.mediaBusy = true;
        try {
          await productMediaStore.delete(key);
          ui.message = "Foto local eliminada; el atlas vuelve a usar su ilustración original.";
        } catch (error) {
          ui.message = error instanceof Error ? error.message : "No se pudo eliminar la foto local.";
        } finally {
          ui.mediaBusy = false;
          render();
        }
        return;
      }
      if (action === "clear-roadmap-filters") { ui.query = ""; ui.type = "all"; ui.urgency = "all"; ui.language = "all"; ui.roadmapStatus = "all"; render(); return; }
      if (action === "focus-mission") {
        const targetId = element.dataset.recordId;
        const record = targetId ? collection.records.find((candidate) => candidate.id === targetId) : undefined;
        if (!record) return;
        ui.query = "";
        ui.type = "all";
        ui.urgency = "all";
        ui.language = "all";
        ui.roadmapStatus = "all";
        ui.activeRegion = element.dataset.regionName || roadmapRegion(record);
        missionReturnFocus = { view: "map", recordId: record.id };
        ui.selectedRecordId = record.id;
        render();
        return;
      }
      if (action === "preview-synthetic") { void previewWorkbook(syntheticWorkbook(), catalogIndex).then((preview) => { ui.preview = preview; ui.message = "Fixture sintética lista para revisar."; render(); }); return; }
      if (action === "apply-import-atomic") {
        const preview = ui.preview;
        if (!preview?.sourceUnchanged || preview.totals.ambiguousRows > 0) return;
        if (!window.confirm(`¿Cargar los ${preview.proposals.length} objetivos del roadmap? Guardaremos una copia anterior para deshacer.`)) return;
        try {
          window.localStorage.setItem(LAST_IMPORT_BACKUP_KEY, serializeBackup(createBackup(collection, now(), changeSetJournal)));
          save(applyImport(collection, preview, now()));
          ui.preview = undefined;
          ui.pendingChangeSet = undefined;
          ui.importProposalIndex = 0;
          ui.view = "map";
          ui.query = "";
          ui.type = "all";
          ui.urgency = "all";
          ui.language = "all";
          ui.roadmapStatus = "all";
          ui.message = `${preview.proposals.length} objetivos cargados. El mapa ya refleja guardadas, abiertas, urgencia e idioma.`;
        } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo aplicar la importación completa"; }
        render();
        return;
      }
      if (action === "undo-last-import") {
        const serialized = window.localStorage.getItem(LAST_IMPORT_BACKUP_KEY);
        if (!serialized || !window.confirm("¿Restaurar el estado anterior a la última importación?")) return;
        try {
          const restored = parseBackup(serialized);
          save(restored.state);
          if (restored.changeSetJournal) saveJournal(restored.changeSetJournal);
          window.localStorage.removeItem(LAST_IMPORT_BACKUP_KEY);
          ui.preview = undefined;
          ui.pendingChangeSet = undefined;
          ui.view = "map";
          ui.message = "Importación deshecha; se restauró la copia anterior.";
        } catch (error) { ui.message = error instanceof Error ? error.message : "La copia anterior no se pudo restaurar"; }
        render();
        return;
      }
      if (action === "preview-synthetic-change") { prepareSyntheticChange(); return; }
      if (action === "prepare-import-change-set") { prepareImportChange(); return; }
      if (action === "approve-changeset" || action === "approve-all-changeset") {
        const pending = ui.pendingChangeSet;
        if (!pending) return;
        const returnFocus = reviewReturnFocus;
        const selected = Array.from(root.querySelectorAll<HTMLInputElement>("[data-change-operation]:checked")).map((input) => input.dataset.changeOperation ?? "").filter(Boolean);
        try {
          const result = applyProposedChangeSet(collection, pending, SYNTHETIC_OWNER_CONTEXT, { journal: changeSetJournal, mode: action === "approve-all-changeset" ? "atomic" : "partial", approvedOperationIds: action === "approve-all-changeset" ? undefined : selected });
          saveJournal(result.journal);
          if (result.status === "conflict") ui.message = result.conflict?.message ?? "La revisión quedó obsoleta y no se aplicó.";
          else { save(result.state); if (pending.sourceEvidence.kind === "workbook-preview") ui.importProposalIndex += 1; ui.pendingChangeSet = undefined; reviewReturnFocus = undefined; if (pending.sourceEvidence.kind === "public-catalog-snapshot") resetIntake(); ui.message = result.status === "replayed" ? "Este cambio ya estaba aplicado; no se duplicó." : "Cambio aplicado y guardado en el historial."; }
        } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo aplicar el cambio"; }
        render();
        if (!ui.pendingChangeSet) restoreReviewReturnFocus(returnFocus);
        return;
      }
      if (action === "reject-changeset") { const pending = ui.pendingChangeSet; if (!pending) return; const returnFocus = reviewReturnFocus; try { saveJournal(rejectProposedChangeSet(changeSetJournal, pending, SYNTHETIC_OWNER_CONTEXT)); if (pending.sourceEvidence.kind === "workbook-preview") ui.importProposalIndex += 1; ui.pendingChangeSet = undefined; reviewReturnFocus = undefined; ui.message = "Cambio cancelado; no se modificó ningún dato."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo cancelar el cambio"; } render(); if (!ui.pendingChangeSet) restoreReviewReturnFocus(returnFocus); return; }
      if (action === "replay-last-change") { const accepted = [...changeSetJournal.accepted].reverse()[0]; const proposal = accepted ? changeSetJournal.proposals.find((candidate) => candidate.changeSetId === accepted.changeSetId) : undefined; if (!proposal) { ui.message = "No hay un cambio aplicado que comprobar."; render(); return; } try { const result = applyProposedChangeSet(collection, proposal, SYNTHETIC_OWNER_CONTEXT, { journal: changeSetJournal }); saveJournal(result.journal); ui.message = result.status === "replayed" ? "Comprobado: el cambio ya estaba aplicado y no se duplicó." : result.conflict?.message ?? "No se pudo comprobar el cambio."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo comprobar el cambio"; } render(); return; }
      if (action === "undo-changeset") { const changeSetId = element.dataset.changeSetId; if (!changeSetId) return; try { const result = undoAppliedChangeSet(collection, changeSetJournal, changeSetId, SYNTHETIC_OWNER_CONTEXT); saveJournal(result.journal); if (result.status === "applied") { save(result.state); ui.message = "Cambio deshecho y guardado en el historial."; } else ui.message = result.reason ?? result.conflict?.message ?? "No se pudo deshacer."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo deshacer el cambio"; } render(); return; }
      if (action === "load-synthetic") { if (!window.confirm("¿Cargar datos sintéticos de demostración en este dispositivo?")) return; save(syntheticState()); ui.message = "Estado sintético cargado localmente."; render(); return; }
      if (action === "export") { const backup = new Blob([serializeBackup(createBackup(collection, now(), changeSetJournal))], { type: "application/json" }); downloadLocalBlob(backup, `pocketdex-backup-v${collection.schemaVersion}.json`); ui.message = "Copia JSON versionada exportada; las fotos siguen solo en este dispositivo."; render(); return; }
      if (action === "export-full") {
        if (ui.mediaBusy) return;
        ui.mediaBusy = true;
        ui.message = "Preparando la copia completa local…";
        render();
        try {
          const archive = await createFullBackupArchive(createBackup(collection, now(), changeSetJournal), await productMediaStore.list());
          downloadLocalBlob(archive, `pocketdex-atlas-completo-v${collection.schemaVersion}.zip`);
          ui.message = "Copia completa exportada con colección, historial y galería local.";
        } catch (error) {
          ui.message = error instanceof Error ? error.message : "No se pudo crear la copia completa.";
        } finally {
          ui.mediaBusy = false;
          render();
        }
        return;
      }
      if (action === "clear") { ui.clearDeviceDialogOpen = true; ui.message = ""; render(); root.querySelector<HTMLButtonElement>("[data-action='cancel-clear-device']")?.focus(); return; }
      if (action === "cancel-clear-device") { closeClearDeviceDialog(); return; }
      if (action === "confirm-clear-device") {
        if (ui.mediaBusy) return;
        ui.mediaBusy = true;
        (element as HTMLButtonElement).disabled = true;
        let clearedSuccessfully = false;
        const previousCollection = collection;
        const previousJournal = changeSetJournal;
        const previousImportBackup = window.localStorage.getItem(LAST_IMPORT_BACKUP_KEY);
        const previousDemoDismissed = window.localStorage.getItem(SYNTHETIC_DEMO_DISMISSED_KEY);
        let previousAssets: Awaited<ReturnType<ProductMediaStore["list"]>> | undefined;
        try {
          previousAssets = await productMediaStore.list();
          await productMediaStore.clear();
          const cleared = clearPocketdexDevice({ collectionStorage: storage, journalStorage: changeSetStorage, browserStorage: window.localStorage });
          collection = cleared.collection;
          changeSetJournal = cleared.journal;
          usingSyntheticDemo = false;
          ui.preview = undefined;
          ui.pendingChangeSet = undefined;
          ui.importProposalIndex = 0;
          ui.selectedRecordId = undefined;
          ui.activeRegion = undefined;
          ui.clearDeviceDialogOpen = false;
          ui.message = "Colección, historial y fotos locales borrados de este dispositivo.";
          clearedSuccessfully = true;
        } catch (error) {
          try {
            save(previousCollection);
            saveJournal(previousJournal);
            if (previousImportBackup === null) window.localStorage.removeItem(LAST_IMPORT_BACKUP_KEY);
            else window.localStorage.setItem(LAST_IMPORT_BACKUP_KEY, previousImportBackup);
            if (previousDemoDismissed === null) window.localStorage.removeItem(SYNTHETIC_DEMO_DISMISSED_KEY);
            else window.localStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, previousDemoDismissed);
            if (previousAssets) await productMediaStore.replaceAll(previousAssets);
            ui.message = error instanceof Error ? `${error.message} No se borró la expedición.` : "No se pudieron borrar todos los datos locales; la expedición se conservó.";
          } catch {
            ui.message = "El borrado quedó incompleto y no se pudo revertir. Recarga y restaura tu copia completa antes de continuar.";
          }
        } finally {
          ui.mediaBusy = false;
          render();
          if (clearedSuccessfully) focusSettingsTab();
        }
        return;
      }
      if (action === "go-add") { ui.view = "add"; render(); return; }
      const recordId = element.closest<HTMLElement>("[data-record-id]")?.dataset.recordId;
      const record = recordId ? collection.records.find((candidate) => candidate.id === recordId) : undefined;
      if (!record) return;
      try {
        const target = targetFromRecord(record);
        const currentSealed = sealedQuantity(record.holding);
        const currentOpened = openedQuantity(record.holding);
        const holdingAction = action === "add-sealed" || action === "add-opened" || action === "open-sealed" || action === "remove-sealed" || action === "remove-opened";
        if (holdingAction) {
          let nextSealed = currentSealed;
          let nextOpened = currentOpened;
          if (action === "add-sealed") nextSealed += 1;
          if (action === "add-opened") nextOpened += 1;
          if (action === "open-sealed") { if (nextSealed < 1) return; nextSealed -= 1; nextOpened += 1; }
          if (action === "remove-sealed") { if (nextSealed < 1) return; nextSealed -= 1; }
          if (action === "remove-opened") { if (nextOpened < 1) return; nextOpened -= 1; }
          const after = holdingWithCounts(record.holding, nextSealed, nextOpened) ?? null;
          prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), record.holding ?? null, after, `holding-${action}`)], `collection-${action}`);
        }
        if (action === "toggle-want") { const after = record.want ? { ...record.want, wanted: !record.want.wanted } : { wanted: true, priority: "normal" as const }; prepareRecordChange(record, [setWantOperation(target, recordRevision(record), record.want ?? null, after, "toggle-want")]); }
        if (action === "remove-want" && record.want?.wanted) { if (!window.confirm("¿Quitar este producto de Quiero y del roadmap?")) return; prepareRecordChange(record, [setWantOperation(target, recordRevision(record), record.want, null, "remove-want")]); }
        if (action === "remove-record") {
          if (!window.confirm("¿Ocultar este registro de Colección, Quiero y Mapa? Su historial se conservará y podrás deshacerlo.")) return;
          const operations = reversibleHideOperations(record);
          if (operations.length > 0) prepareRecordChange(record, operations, "hide-record");
        }
      } catch (error) { ui.message = error instanceof Error ? error.message : "Este registro no pertenece al alcance sellado/no-single"; render(); }
    }));
    root.querySelectorAll<HTMLFormElement>("[data-edit-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const record = collection.records.find((candidate) => candidate.id === form.dataset.editForm);
      if (!record) return;
      const values = new FormData(form);
      const nextSealed = values.get("sealedQuantity") === null ? sealedQuantity(record.holding) : Number(values.get("sealedQuantity"));
      const nextOpened = values.get("openedQuantity") === null ? openedQuantity(record.holding) : Number(values.get("openedQuantity"));
      const currentProgress = roadmapProgress(record);
      const targetSealed = values.get("targetSealedQuantity") === null ? currentProgress.targetSealed : Number(values.get("targetSealedQuantity"));
      const targetOpened = values.get("targetOpenedQuantity") === null ? currentProgress.targetOpened : Number(values.get("targetOpenedQuantity"));
      if (![nextSealed, nextOpened, targetSealed, targetOpened].every((value) => Number.isInteger(value) && value >= 0) || (record.want?.wanted && targetSealed + targetOpened === 0)) { ui.message = "Las cantidades deben ser enteros desde cero y el objetivo debe conservar al menos un paso."; render(); return; }
      try {
        const target = targetFromRecord(record);
        const baseRevision = recordRevision(record);
        const operations: ChangeOperation[] = [];
        if (record.holding) { const counted = holdingWithCounts({ ...record.holding, condition: String(values.get("condition") ?? "").trim() || undefined, language: String(values.get("language") ?? "").trim() || undefined }, nextSealed, nextOpened) ?? null; if (JSON.stringify(counted) !== JSON.stringify(record.holding)) operations.push(setHoldingOperation(target, baseRevision, record.holding, counted, "edit-holding")); }
        if (record.want?.wanted) { const urgency = (values.get("urgency") as RoadmapUrgency | null) ?? record.want.urgency ?? "medium"; const after = { ...record.want, quantity: targetSealed + targetOpened, targetSealedQuantity: targetSealed, targetOpenedQuantity: targetOpened, openGoalMode: targetOpened === 0 ? "none" as const : record.want.openGoalMode === "optional" ? "optional" as const : "required" as const, urgency, goalLanguage: String(values.get("goalLanguage") ?? "").trim() || undefined, isRoadmap: record.want.isRoadmap ?? true }; if (JSON.stringify(after) !== JSON.stringify(record.want)) operations.push(setWantOperation(target, baseRevision, record.want, after, "edit-want")); }
        const notes = String(values.get("notes") ?? "").trim() || null;
        if (notes !== (record.notes ?? null)) operations.push(setNotesOperation(target, baseRevision, record.notes ?? null, notes, "edit-notes"));
        if (operations.length === 0) { ui.message = "No hay cambios que revisar."; render(); return; }
        prepareRecordChange(record, operations, "record-edit");
      } catch (error) { ui.message = error instanceof Error ? error.message : "Este registro no se puede editar de forma segura"; render(); }
    }));
    root.querySelectorAll<HTMLInputElement>("[data-product-media-input]").forEach((input) => input.addEventListener("change", async (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      const key = input.dataset.mediaKey;
      if (!file || !key || ui.mediaBusy) return;
      ui.mediaBusy = true;
      ui.message = "Procesando la foto dentro de este dispositivo…";
      render();
      try {
        await productMediaStore.put(await normalizeProductImage(file, { key }));
        ui.message = "Foto local añadida a la ficha y a toda la expedición.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "No se pudo procesar la foto local.";
      } finally {
        ui.mediaBusy = false;
        render();
      }
    }));
    root.querySelector<HTMLInputElement>("#workbook-file")?.addEventListener("change", async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { ui.preview = await previewWorkbook(await readWorkbookFile(file), catalogIndex); ui.message = "Vista previa lista. Revisa cada fila antes de preparar cambios."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo leer el workbook"; } render(); });
    root.querySelector<HTMLInputElement>("#restore-file")?.addEventListener("change", async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { const restored = parseBackup(await file.text()); if (!window.confirm("¿Reemplazar la colección local con esta copia?")) return; save(restored.state); if (restored.changeSetJournal) saveJournal(restored.changeSetJournal); else { changeSetStorage.clear(); changeSetJournal = changeSetStorage.load(); } ui.pendingChangeSet = undefined; ui.importProposalIndex = 0; ui.message = "Copia versionada restaurada localmente."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo restaurar la copia"; } render(); });
    root.querySelector<HTMLInputElement>("#restore-full-file")?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || ui.mediaBusy) return;
      ui.mediaBusy = true;
      ui.message = "Verificando la copia completa…";
      render();
      try {
        const restored = parseFullBackupArchive(new Uint8Array(await file.arrayBuffer()));
        if (!window.confirm(`¿Reemplazar la expedición y la galería local con ${restored.backup.state.records.length} registros y ${restored.assets.length} fotos?`)) {
          ui.message = "Restauración completa cancelada; no se cambió ningún dato.";
          return;
        }
        await replaceFromFullBackup(restored);
        ui.pendingChangeSet = undefined;
        ui.preview = undefined;
        ui.importProposalIndex = 0;
        ui.selectedRecordId = undefined;
        ui.activeRegion = undefined;
        ui.view = "map";
        ui.message = "Copia completa restaurada: expedición, historial y galería local.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "No se pudo restaurar la copia completa.";
      } finally {
        ui.mediaBusy = false;
        render();
      }
    });
    root.querySelector<HTMLInputElement>("#media-pack-file")?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || ui.mediaBusy) return;
      ui.mediaBusy = true;
      ui.message = "Validando y procesando el pack local…";
      render();
      try {
        const pack = parseProductMediaPack(new Uint8Array(await file.arrayBuffer()), collection.records);
        if (pack.candidates.length === 0) throw new Error(`El pack no coincide con ningún registro (${pack.unmatched.length} archivos sin pareja).`);
        const normalized = [];
        for (const candidate of pack.candidates) {
          const owned = candidate.bytes.slice().buffer as ArrayBuffer;
          const imageFile = new File([owned], candidate.filename, { type: candidate.mimeType });
          normalized.push(await normalizeProductImage(imageFile, { key: candidate.key }));
        }
        const nextAssets = new Map((await productMediaStore.list()).map((asset) => [asset.key, asset]));
        for (const asset of normalized) nextAssets.set(asset.key, asset);
        await productMediaStore.replaceAll([...nextAssets.values()]);
        ui.message = `${normalized.length} fotos añadidas al atlas${pack.unmatched.length ? `; ${pack.unmatched.length} archivos no encontraron ficha` : ""}.`;
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "No se pudo importar el pack de imágenes.";
      } finally {
        ui.mediaBusy = false;
        render();
      }
    });
    root.querySelector<HTMLFormElement>("#restore-text-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const serialized = String(new FormData(event.currentTarget as HTMLFormElement).get("backupJson") ?? "").trim();
        const restored = parseBackup(serialized);
        window.localStorage.setItem(LAST_IMPORT_BACKUP_KEY, serializeBackup(createBackup(collection, now(), changeSetJournal)));
        save(restored.state);
        if (restored.changeSetJournal) saveJournal(restored.changeSetJournal);
        else { changeSetStorage.clear(); changeSetJournal = changeSetStorage.load(); }
        ui.pendingChangeSet = undefined;
        ui.preview = undefined;
        ui.importProposalIndex = 0;
        ui.query = "";
        ui.type = "all";
        ui.urgency = "all";
        ui.language = "all";
        ui.roadmapStatus = "all";
        ui.view = "map";
        ui.message = `${restored.state.records.length} objetivos restaurados. El mapa ya está listo.`;
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "La copia pegada no es válida";
      }
      render();
    });
    root.querySelector<HTMLFormElement>("#create-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const name = String(form.get("name") ?? "").trim();
      const objectType = String(form.get("objectType") ?? "custom") as ChangeSetObjectType;
      const quantity = Number(form.get("quantity") ?? 1);
      if (!name || !CHANGE_SET_OBJECT_TYPES.includes(objectType) || !Number.isInteger(quantity) || quantity < 1) { ui.message = "Indica un nombre acotado, un tipo sellado/no-single y una cantidad entera positiva."; render(); return; }
      const identity = { objectType, name, setName: String(form.get("setName") ?? "").trim() || undefined, number: String(form.get("number") ?? "").trim() || undefined };
      const id = stableRecordId(identity);
      const existing = collection.records.find((record) => record.id === id);
      const createdAt = now();
      try {
        const target = existing ? targetFromRecord(existing) : makeChangeSetTarget({ recordId: id, catalogId: id, ...identity });
        const status = String(form.get("status") ?? "owned") as HoldingStatus;
        const operation: ChangeOperation = existing
          ? setHoldingOperation(target, recordRevision(existing), existing.holding ?? null, holdingWithCounts(existing.holding, sealedQuantity(existing.holding) + (status === "owned" ? quantity : 0), openedQuantity(existing.holding) + (status === "opened" ? quantity : 0)) ?? null, "custom-holding")
          : createRecordOperation(target, 0, { id, catalog: { catalogId: id, ...identity }, holding: holdingWithCounts({ quantity, status, condition: String(form.get("condition") ?? "").trim() || undefined, language: String(form.get("language") ?? "").trim() || undefined }, status === "owned" ? quantity : 0, status === "opened" ? quantity : 0), notes: String(form.get("notes") ?? "").trim() || undefined, createdAt, updatedAt: createdAt, revision: 0 }, "custom-record");
        queueChangeSet(createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations: [operation], idempotencyKey: `custom-${id}-${Date.now()}`, sourceEvidence: { kind: "owner-note", reference: "synthetic-custom-entry", capturedAt: createdAt } }), "El producto custom está listo para revisión. No se ha cambiado ningún dato.");
      } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo preparar el producto custom"; render(); }
    });
  }

  window.addEventListener("offline", () => { ui.offline = true; ui.message = "Sin conexión: tus cambios siguen guardándose en este dispositivo."; render(); });
  window.addEventListener("online", () => { ui.offline = false; ui.message = "Conexión recuperada. No hay sincronización automática ni duplicados."; render(); });
  window.addEventListener("storage", (event) => {
    const externalClear = classifyExternalDeviceClear(event.key, event.newValue, usingSyntheticDemo);
    if (externalClear === "collection" || externalClear === "synthetic-demo") {
      applyExternalDeviceClear();
      return;
    }
    if (externalClear === "journal") {
      changeSetJournal = changeSetStorage.load();
      ui.pendingChangeSet = undefined;
      ui.message = "Otra pestaña borró el historial local de este dispositivo.";
      render();
      return;
    }
    if (event.key === LOCAL_STATE_KEY && event.newValue !== null) {
      try {
        collection = parseBackup(event.newValue).state;
        ui.message = "Otra pestaña actualizó este dispositivo; se revalidará la revisión base.";
        render();
      } catch {
        // Invalid cross-tab state is ignored; the local in-memory state remains unchanged.
      }
    }
    if (event.key === CHANGE_SET_JOURNAL_KEY && event.newValue !== null) {
      changeSetJournal = changeSetStorage.load();
      render();
    }
  });
  render();
}
