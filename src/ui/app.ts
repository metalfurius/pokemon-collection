import "./style.css";
import {
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
} from "../domain/change-sets";
import {
  createBackup,
  createLocalStateStore,
  parseBackup,
  serializeBackup,
} from "../domain/backup";
import {
  NEW_FLOW_OBJECT_TYPES,
  createEmptyState,
  isLegacyCardType,
  recordRevision,
  stableRecordId,
  type CollectionRecord,
  type CollectionState,
  type HoldingStatus,
  type NewFlowObjectType,
  type ObjectType,
  type WantPriority,
} from "../domain/model";
import {
  describeCardmarketEntry,
  resolveCardmarketProduct,
  usableCardmarketCatalog,
  type CardmarketCatalogEntry,
  type CardmarketCatalogIndex,
  type CardmarketResolution,
} from "../domain/cardmarket";
import { applyCardmarketIntake, type IntakeDestination } from "../domain/intake";
import { syntheticCardmarketIndex, syntheticState, syntheticWorkbook } from "../fixtures/synthetic";

type View = "collection" | "wants" | "add" | "settings";

export interface MountAppOptions {
  cardmarketIndex?: CardmarketCatalogIndex;
  initialView?: View;
}

interface IntakeUiState {
  sourceUrl: string;
  resolution?: CardmarketResolution;
  selectedEntry?: CardmarketCatalogEntry;
  destination: IntakeDestination;
  quantity: number;
  holdingStatus: HoldingStatus;
  priority: WantPriority;
  notes: string;
  name: string;
  setName: string;
}

interface UiState {
  view: View;
  query: string;
  type: NewFlowObjectType | "all";
  status: HoldingStatus | "all";
  message: string;
  preview?: ImportPreview;
  pendingChangeSet?: ProposedChangeSet;
  importProposalIndex: number;
  offline: boolean;
  intake: IntakeUiState;
}

// This is a synthetic local review identity only. It is intentionally not a Firebase credential or auth adapter.
const SYNTHETIC_OWNER_CONTEXT: ChangeSetOwnerContext = {
  authenticatedUid: "synthetic-owner",
  expectedOwnerUid: "synthetic-owner",
};

const SYNTHETIC_DEMO_DISMISSED_KEY = "pokemon-collection.synthetic-demo-dismissed.v1";

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

function recordMatches(record: CollectionRecord, ui: UiState): boolean {
  if (ui.view === "wants" && !record.want?.wanted) return false;
  if (ui.view === "collection" && !(record.holding && record.holding.quantity > 0)) return false;
  if (ui.type !== "all" && record.catalog.objectType !== ui.type) return false;
  if (ui.status !== "all" && record.holding?.status !== ui.status) return false;
  const haystack = [record.catalog.name, record.catalog.setName, record.catalog.number, record.notes, record.catalog.idProduct]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("es-ES");
  return ui.query === "" || haystack.includes(ui.query.toLocaleLowerCase("es-ES"));
}

function renderRecord(record: CollectionRecord): string {
  const legacy = isLegacyCardType(record.catalog.objectType);
  const subtitle = [record.catalog.setName, record.catalog.number ? `#${record.catalog.number}` : undefined]
    .filter(Boolean)
    .join(" · ");
  const holding = record.holding;
  const want = record.want?.wanted ? record.want : undefined;
  const quantityLabel = holding
    ? `×${holding.quantity} · ${formatHoldingStatus(holding.status)}`
    : want
      ? `Quiero ${want.quantity ?? 1}`
      : "Sin cantidad";
  const secondary = [
    holding?.condition ? `Estado: ${holding.condition}` : "",
    holding?.language ? `Idioma: ${holding.language}` : "",
    holding?.gradingCompany ? `${holding.gradingCompany} ${holding.grade ?? ""}` : "",
    want ? `Prioridad ${formatPriority(want.priority)}` : "",
    record.notes ?? "",
  ].filter(Boolean);
  return `<article class="item-card ${legacy ? "item-card--legacy" : ""}" data-record-id="${escapeHtml(record.id)}">
    <div class="item-card__topline"><span class="type-badge">${escapeHtml(formatType(record.catalog.objectType))}</span><span class="quantity" aria-label="Cantidad">${escapeHtml(quantityLabel)}</span></div>
    <h3>${escapeHtml(record.catalog.name)}</h3>
    <p class="muted">${escapeHtml(subtitle || (record.catalog.source === "cardmarket" ? "Producto sellado" : "Identidad de catálogo"))}</p>
    ${legacy ? `<p class="legacy-note">Registro histórico compatible; se conserva y se puede exportar.</p>` : ""}
    ${record.catalog.idProduct ? `<p class="source-id">Cardmarket idProduct <code>${escapeHtml(record.catalog.idProduct)}</code></p>` : ""}
    ${secondary.length ? `<details class="advanced"><summary>Detalles</summary><p>${secondary.map((line) => escapeHtml(line)).join("<br>")}</p></details>` : ""}
    <div class="item-actions" aria-label="Acciones para ${escapeHtml(record.catalog.name)}">
      ${holding ? `<button class="button button--small button--quiet" data-action="decrement" aria-label="Restar una unidad de ${escapeHtml(record.catalog.name)}">−</button><button class="button button--small" data-action="increment" aria-label="Añadir una unidad de ${escapeHtml(record.catalog.name)}">+</button><button class="button button--small button--quiet" data-action="toggle-status">${holding.status === "opened" ? "Marcar sellado" : "Marcar abierto"}</button>` : want ? `<button class="button button--small" data-action="add-holding">Guardar también en Collection</button>` : ""}
      ${want ? `<button class="button button--small button--quiet" data-action="remove-want">Quitar de Wants</button>` : ""}
      <button class="button button--small button--quiet" data-action="remove-record">Eliminar</button>
    </div>
    <details class="edit-panel"><summary>Editar detalles</summary>
      <form class="edit-form" data-edit-form="${escapeHtml(record.id)}">
        ${holding ? `<label>Cantidad<input name="quantity" type="number" min="1" step="1" value="${holding.quantity}" required></label><label>Estado<select name="status"><option value="owned" ${holding.status === "owned" ? "selected" : ""}>Sellado</option><option value="opened" ${holding.status === "opened" ? "selected" : ""}>Abierto</option></select></label><label>Condición<input name="condition" maxlength="80" value="${escapeHtml(holding.condition ?? "")}"></label><label>Idioma<input name="language" maxlength="30" value="${escapeHtml(holding.language ?? "")}"></label>${legacy ? `<label>Empresa de grading<input name="gradingCompany" maxlength="80" value="${escapeHtml(holding.gradingCompany ?? "")}"></label><label>Nota de grading<input name="grade" type="number" min="0" max="10" step="0.1" value="${holding.grade ?? ""}"></label>` : ""}` : ""}
        ${want ? `<label>Prioridad<select name="priority"><option value="low" ${want.priority === "low" ? "selected" : ""}>Baja</option><option value="normal" ${want.priority === "normal" ? "selected" : ""}>Normal</option><option value="high" ${want.priority === "high" ? "selected" : ""}>Alta</option></select></label><label>Unidades que buscas<input name="wantQuantity" type="number" min="1" step="1" value="${want.quantity ?? 1}" required></label>` : ""}
        <label class="form-span">Notas<textarea name="notes" maxlength="500">${escapeHtml(record.notes ?? "")}</textarea></label>
        <button class="button button--small button--primary" type="submit">Preparar revisión</button>
      </form>
    </details>
  </article>`;
}

function reviewValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (serialized ?? "—").slice(0, 1_200);
}

function changeFieldLabel(kind: ProposedChangeSet["operations"][number]["kind"]): string {
  return {
    "create-record": "Record",
    "delete-record": "Record",
    "set-holding": "Holding",
    "set-want": "Want",
    "set-notes": "Notas",
    "append-acquisition": "Hecho de adquisición",
    "append-price-observation": "Observación de precio",
  }[kind];
}

function renderChangeSetReview(changeSet: ProposedChangeSet | undefined): string {
  if (changeSet === undefined) return `<p class="muted">No hay un change set pendiente. Las actualizaciones sintéticas se preparan aquí antes de cualquier mutación local.</p>`;
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
    return `<label class="change-diff"><span class="change-diff__header"><input type="checkbox" data-change-operation="${escapeHtml(operation.operationId)}" checked><strong>${escapeHtml(changeFieldLabel(operation.kind))}</strong><code>${escapeHtml(operation.operationId)}</code></span><span class="change-diff__grid"><span><small>Antes</small><pre>${escapeHtml(reviewValue(before))}</pre></span><span aria-hidden="true" class="change-arrow">→</span><span><small>Después</small><pre>${escapeHtml(reviewValue(after))}</pre></span></span><span class="muted">${operation.kind === "append-price-observation" ? "Evidencia inmutable; no hay undo automático." : operation.kind === "append-acquisition" ? "Hecho inmutable; no hay undo automático." : "Hay un inverso seguro después de aprobar."}</span></label>`;
  }).join("");
  return `<section class="change-review" aria-live="polite"><div class="section-heading"><div><p class="eyebrow">Revisión del propietario</p><h3>${escapeHtml(changeSet.target.name)}</h3><p class="muted">${escapeHtml(changeSet.target.objectType)} · registro exacto <code>${escapeHtml(changeSet.target.recordId)}</code></p></div><span class="privacy-pill">Propietario sintético</span></div><p class="muted">Set <code>${escapeHtml(changeSet.changeSetId)}</code> · revisión de estado base <strong>${changeSet.base.stateRevision}</strong> · revisión de registro base <strong>${changeSet.base.recordRevision}</strong> · fuente <strong>${escapeHtml(changeSet.sourceEvidence.reference)}</strong></p><div class="change-diff-list">${diffs}</div><div class="tool-actions"><button class="button button--primary" data-action="approve-changeset">Aprobar selección</button><button class="button button--quiet" data-action="approve-all-changeset">Aprobar todo atómicamente</button><button class="button button--danger" data-action="reject-changeset">Rechazar</button></div></section>`;
}

function renderAudit(journal: ChangeSetJournal): string {
  const entries = [...journal.audit].reverse().slice(0, 8);
  if (entries.length === 0) return `<p class="muted">Todavía no hay entradas de auditoría.</p>`;
  return `<ul class="audit-list">${entries.map((entry) => `<li><div><strong>${escapeHtml(entry.status)}</strong> · ${escapeHtml(entry.changeSetId)}<br><span class="muted">${escapeHtml(entry.occurredAt)} · ${escapeHtml(entry.reason ?? entry.event)}</span></div>${entry.event === "applied" && entry.undoable ? `<button class="button button--small button--quiet" data-action="undo-changeset" data-change-set-id="${escapeHtml(entry.changeSetId)}">Undo</button>` : entry.event === "applied" ? `<span class="muted">solo anexado</span>` : ""}</li>`).join("")}</ul>`;
}

function renderWorkbookPreview(preview: ImportPreview | undefined): string {
  if (!preview) return "";
  const rows = preview.rows.map((row) => `<li><span>${escapeHtml(row.sheet)}:${row.rowNumber}</span><span class="row-${row.outcome}">${escapeHtml(row.outcome)} · ${escapeHtml(row.reason)}</span></li>`).join("");
  return `<section class="preview-panel" aria-live="polite"><div class="section-heading"><div><p class="eyebrow">Vista previa</p><h3>${escapeHtml(preview.filename)}</h3></div><span class="privacy-pill">Solo local</span></div><div class="summary-grid"><div><strong>${preview.totals.acceptedRows}</strong><span>aceptadas</span></div><div><strong>${preview.totals.ambiguousRows}</strong><span>ambiguas</span></div><div><strong>${preview.totals.skippedRows}</strong><span>omitidas</span></div><div><strong>${preview.proposals.length}</strong><span>productos</span></div></div><p class="hash-status">Hash antes: <code>${preview.sourceHashBefore.slice(0, 16)}…</code><br>después: <code>${preview.sourceHashAfter.slice(0, 16)}…</code> · ${preview.sourceUnchanged ? "sin cambios" : "cambió"}</p><details><summary>Decisiones por fila (${preview.rows.length})</summary><ul class="row-report">${rows}</ul></details><button class="button button--primary" data-action="prepare-import-change-set" ${preview.sourceUnchanged ? "" : "disabled"}>Preparar siguiente set para revisión</button></section>`;
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
  return `<section class="intake-result" aria-live="polite"><div class="${resultClass}"><strong>${escapeHtml(resolution.message)}</strong>${resolution.canonicalUrl ? `<span>Enlace normalizado: <code>${escapeHtml(resolution.canonicalUrl)}</code></span>` : ""}</div>${resolution.status === "multiple" ? `<div class="candidate-panel"><h3>Elige una variante</h3><p class="muted">No mezclamos envases ni idiomas automáticamente.</p><ul class="candidate-list">${candidateList}</ul></div>` : ""}${resolution.status === "zero" ? `<div class="empty-state empty-state--compact"><h3>No hay coincidencia</h3><p class="muted">Comprueba el producto o carga una versión actualizada del índice. No se creará un producto sin identidad.</p></div>` : ""}${selected ? `<form id="intake-preview-form" class="intake-preview-form"><div class="preview-heading"><div><p class="eyebrow">Vista editable</p><h3>${escapeHtml(selected.name)}</h3></div><span class="type-badge">${escapeHtml(formatType(selected.objectType))}</span></div><p class="muted">Origen: <code>${escapeHtml(resolution.sourceUrl)}</code></p><ul class="field-list">${details}</ul><div class="form-grid"><label>Nombre visible<input name="name" maxlength="240" value="${escapeHtml(ui.intake.name)}" required></label><label>Colección<input name="setName" maxlength="240" value="${escapeHtml(ui.intake.setName)}" placeholder="Si falta, puedes completarla"></label><label>Cantidad<input name="quantity" type="number" min="1" max="9999" step="1" value="${ui.intake.quantity}" required></label><label>Destino<select name="destination"><option value="wants" ${ui.intake.destination === "wants" ? "selected" : ""}>Lo quiero</option><option value="collection" ${ui.intake.destination === "collection" ? "selected" : ""}>Ya lo tengo</option></select></label><label>Estado<select name="holdingStatus"><option value="owned" ${ui.intake.holdingStatus === "owned" ? "selected" : ""}>Sellado</option><option value="opened" ${ui.intake.holdingStatus === "opened" ? "selected" : ""}>Abierto</option></select></label><label>Prioridad<select name="priority"><option value="low" ${ui.intake.priority === "low" ? "selected" : ""}>Baja</option><option value="normal" ${ui.intake.priority === "normal" ? "selected" : ""}>Normal</option><option value="high" ${ui.intake.priority === "high" ? "selected" : ""}>Alta</option></select></label><label class="form-span">Notas opcionales<textarea name="notes" maxlength="500" placeholder="Algo útil para encontrarlo después">${escapeHtml(ui.intake.notes)}</textarea></label></div><div class="destination-note"><strong>${ui.intake.destination === "wants" ? "Se preparará solo en Wants" : "Se preparará solo en Collection"}</strong><span>Antes de guardar, tendrás que revisar y confirmar el change set exacto.</span></div><button class="button button--primary button--wide" type="submit">Preparar cambio para revisión</button></form>` : ""}</section>`;
}

function renderAddView(ui: UiState, index: CardmarketCatalogIndex): string {
  return `<section class="add-layout"><div class="page-intro"><p class="eyebrow">Añadir</p><h2>Un enlace, una decisión.</h2><p class="muted">Pega o comparte un producto no-single de Cardmarket. Revisaremos su identidad localmente antes de preparar cualquier cambio.</p></div><form id="cardmarket-form" class="link-form"><label for="cardmarket-url">Enlace Cardmarket</label><div class="link-input-row"><input id="cardmarket-url" name="sourceUrl" type="url" inputmode="url" autocomplete="url" maxlength="2048" placeholder="https://www.cardmarket.com/en/Pokemon/Products/…" value="${escapeHtml(ui.intake.sourceUrl)}" required><button class="button button--quiet" type="button" data-action="paste-link">Pegar</button></div><div class="form-actions"><button class="button button--primary" type="submit">Continuar</button><button class="button button--quiet" type="button" data-action="share-help">¿Cómo compartir?</button></div><p class="helper">Solo HTTPS · sin páginas de vendedor, ofertas, búsquedas, listas ni cartas individuales. No abrimos ni enviamos el enlace.</p></form>${renderFreshness(index)}${renderIntakePreview(ui)}</section>`;
}

function renderChangeTools(ui: UiState, journal: ChangeSetJournal): string {
  return `<details id="change-panel" class="tool-card" open><summary><span><span class="eyebrow">Proposed changes</span><strong>Revisa antes de aplicar</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">El propietario autenticado sintético debe revisar el registro exacto, el antes/después, la revisión base y la fuente. Los sets son versionados, acotados, idempotentes y limitados a datos sellados/no-single.</p><div class="tool-actions"><button class="button button--quiet" data-action="preview-synthetic-change">Previsualizar update sellado sintético</button></div>${renderChangeSetReview(ui.pendingChangeSet)}<details class="audit-panel"><summary>Historial de auditoría (${journal.audit.length})</summary>${renderAudit(journal)}<div class="tool-actions"><button class="button button--quiet" data-action="replay-last-change">Repetir último set aceptado</button></div></details></details>`;
}

function renderCustomTool(): string {
  return `<details id="create-panel" class="tool-card"><summary><span><span class="eyebrow">Entrada rápida</span><strong>Añadir producto custom</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Solo se pueden proponer productos sellados/no-single. El botón prepara un change set; no escribe directamente.</p><form id="create-form" class="form-grid"><label>Nombre<input name="name" required maxlength="120" autocomplete="off" placeholder="p. ej. Sunrise binder"></label><label>Tipo<select name="objectType">${CHANGE_SET_OBJECT_TYPES.map((type) => `<option value="${type}">${formatType(type)}</option>`).join("")}</select></label><label>Cantidad<input name="quantity" type="number" min="1" step="1" value="1" required></label><label>Set o grupo<input name="setName" maxlength="120" placeholder="Opcional"></label><label class="form-span">Campos avanzados <span class="muted">opcionales</span><details><summary>Mostrar</summary><div class="form-grid nested"><label>Número<input name="number" maxlength="40"></label><label>Estado<select name="status"><option value="owned">Sellado</option><option value="opened">Abierto</option></select></label><label>Condición<input name="condition" maxlength="80"></label><label>Idioma<input name="language" maxlength="30"></label><label>Notas<textarea name="notes" maxlength="500"></textarea></label></div></details></label><button class="button button--primary form-span" type="submit">Preparar revisión</button></form></details>`;
}

function renderCollectionView(ui: UiState, collection: CollectionState, journal: ChangeSetJournal): string {
  const visible = collection.records.filter((record) => recordMatches(record, ui));
  return `<section class="page-intro"><p class="eyebrow">${ui.view === "wants" ? "Wants" : "Collection"}</p><h2>${ui.view === "wants" ? "Lo que quieres encontrar." : "Lo que ya tienes."}</h2><p class="muted">${ui.view === "wants" ? "Una lista clara, sin convertir deseos en existencias." : "Productos sellados y registros históricos, en tu dispositivo."}</p></section><section class="toolbar" aria-label="Buscar y filtrar esta vista"><label class="search-field"><span class="sr-only">Buscar en esta vista</span><input id="search" type="search" placeholder="Buscar nombre, colección o idProduct…" value="${escapeHtml(ui.query)}"></label><label><span class="sr-only">Filtrar por tipo</span><select id="type-filter"><option value="all">Todos los productos</option>${NEW_FLOW_OBJECT_TYPES.map((type) => `<option value="${type}" ${ui.type === type ? "selected" : ""}>${formatType(type)}</option>`).join("")}</select></label><label><span class="sr-only">Filtrar por estado</span><select id="status-filter"><option value="all">Todos los estados</option><option value="owned" ${ui.status === "owned" ? "selected" : ""}>Sellado</option><option value="opened" ${ui.status === "opened" ? "selected" : ""}>Abierto</option></select></label></section><section class="section-heading"><div><p class="eyebrow">${visible.length} visibles</p><h2>${ui.view === "wants" ? "Productos que quieres" : "Productos recientes"}</h2></div><button class="button button--primary" data-action="go-add">+ Añadir producto</button></section><section class="item-grid" aria-live="polite">${visible.length ? visible.map(renderRecord).join("") : `<div class="empty-state"><div class="empty-icon" aria-hidden="true">◌</div><h3>${ui.query || ui.type !== "all" || ui.status !== "all" ? "No hay coincidencias" : ui.view === "wants" ? "Tu lista Wants está vacía" : "Tu Collection está vacía"}</h3><p class="muted">${ui.query || ui.type !== "all" || ui.status !== "all" ? "Prueba otro término o limpia los filtros." : ui.view === "wants" ? "Pega un enlace de producto y elige «Lo quiero»." : "Pega un enlace de producto y elige «Ya lo tengo»."}</p>${!ui.query && ui.type === "all" && ui.status === "all" ? `<button class="button button--primary" data-action="go-add">Añadir desde Cardmarket</button>` : ""}</div>`}</section><section class="tools-grid">${renderChangeTools(ui, journal)}</section>`;
}

function renderSettingsView(ui: UiState, collection: CollectionState, index: CardmarketCatalogIndex, journal: ChangeSetJournal): string {
  return `<section class="page-intro"><p class="eyebrow">Ajustes y herramientas</p><h2>Controla tu copia local.</h2><p class="muted">Importación, copias de seguridad, change sets y estado del índice viven aquí.</p></section><div class="tools-grid"><details class="tool-card" open><summary><span><span class="eyebrow">Catálogo</span><strong>Identidad Cardmarket</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">El índice derivado se usa sin credenciales, sin scraping y sin enviar enlaces a un backend. La aplicación conserva su fecha y un último índice válido.</p>${renderFreshness(index)}<p class="helper">La demo local usa datos sintéticos; una compilación puede sustituirla por el índice publicado validado.</p></details><details id="import-panel" class="tool-card"><summary><span><span class="eyebrow">Compatibilidad</span><strong>Importar workbook</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">La vista previa acepta productos no-single. Una fila sin tipo es ambigua y las cartas individuales se omiten; los registros históricos siguen siendo restaurables.</p><div class="tool-actions"><label class="button button--quiet file-button">Elegir .xlsx<input id="workbook-file" type="file" accept=".xlsx,.xls,.csv,.tsv" hidden></label><button class="button button--quiet" data-action="preview-synthetic">Probar fixture sintético</button></div>${renderWorkbookPreview(ui.preview)}</details><details id="backup-panel" class="tool-card"><summary><span><span class="eyebrow">Portabilidad</span><strong>Exportar o restaurar</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Las copias versionadas incluyen campos compatibles y el journal de change sets. Restaurar valida antes de reemplazar esta copia local.</p><div class="tool-actions"><button class="button button--quiet" data-action="export">Exportar copia</button><label class="button button--quiet file-button">Restaurar copia<input id="restore-file" type="file" accept="application/json,.json" hidden></label><button class="button button--quiet" data-action="load-synthetic">Cargar estado sintético</button><button class="button button--danger" data-action="clear">Borrar este dispositivo</button></div></details>${renderCustomTool()}${renderChangeTools(ui, journal)}<details class="tool-card"><summary><span><span class="eyebrow">Ayuda</span><strong>Privacidad y estados</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Los datos de colección, Wants, notas y copias permanecen en este dispositivo. Sin conexión puedes seguir preparando y confirmando cambios; al volver a conectar no hay reintentos de red que dupliquen entradas.</p><p class="muted">Si una identidad no está en el índice, Pocketdex no inventa un producto ni lo convierte en una carta.</p></details></div>`;
}

export function mountApp(root: HTMLElement, options: MountAppOptions = {}): void {
  const storage = createLocalStateStore(window.localStorage);
  const changeSetStorage = createChangeSetJournalStore(window.localStorage);
  let collection = storage.load();
  let changeSetJournal = changeSetStorage.load();
  let usingSyntheticDemo = collection.records.length === 0 && window.localStorage.getItem(SYNTHETIC_DEMO_DISMISSED_KEY) !== "true";
  if (usingSyntheticDemo) collection = syntheticState();
  const catalogIndex = options.cardmarketIndex ?? syntheticCardmarketIndex();
  const ui: UiState = {
    view: options.initialView ?? "collection",
    query: "",
    type: "all",
    status: "all",
    message: "",
    preview: undefined,
    pendingChangeSet: undefined,
    importProposalIndex: 0,
    offline: !navigator.onLine,
    intake: { sourceUrl: firstSharedCardmarketUrl(), destination: "wants", quantity: 1, holdingStatus: "owned", priority: "normal", notes: "", name: "", setName: "" },
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

  function queueChangeSet(changeSet: ProposedChangeSet, message = "La revisión del propietario está lista. No se ha cambiado ningún dato."): void {
    if (ui.pendingChangeSet !== undefined) {
      ui.message = "Revisa o rechaza el change set actual antes de preparar otro.";
      render();
      return;
    }
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
      ui.message = error instanceof Error ? error.message : "No se pudo preparar el change set";
      render();
    }
  }

  function prepareSyntheticChange(): void {
    const record = collection.records.find((candidate) => candidate.catalog.name === "Sunlit Tin");
    try {
      if (!record) {
        const fixture = syntheticState().records.find((candidate) => candidate.catalog.name === "Sunlit Tin");
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
      const draft = { entry: { ...entry, name: ui.intake.name.trim() || entry.name, ...(ui.intake.setName.trim() ? { setName: ui.intake.setName.trim() } : {}) }, canonicalUrl: resolution.canonicalUrl, destination: ui.intake.destination, quantity: ui.intake.quantity, holdingStatus: ui.intake.holdingStatus, priority: ui.intake.priority, notes: ui.intake.notes };
      const next = applyCardmarketIntake(collection, draft);
      const desired = next.records.find((record) => record.catalog.idProduct === entry.idProduct);
      if (!desired) throw new Error("No se pudo construir una identidad Cardmarket válida.");
      const existing = collection.records.find((record) => record.catalog.idProduct === entry.idProduct);
      const target = existing ? targetFromRecord(existing) : makeChangeSetTarget({ recordId: desired.id, catalogId: desired.catalog.catalogId, objectType: desired.catalog.objectType as ChangeSetObjectType, name: desired.catalog.name, setName: desired.catalog.setName, number: desired.catalog.number });
      const operations: ChangeOperation[] = [];
      if (!existing) {
        operations.push(createRecordOperation(target, 0, { ...desired, revision: 0 }, "cardmarket-record"));
      } else {
        const baseRevision = recordRevision(existing);
        if (ui.intake.destination === "collection") {
          const after = { ...(existing.holding ?? { quantity: 0, status: ui.intake.holdingStatus }), quantity: (existing.holding?.quantity ?? 0) + ui.intake.quantity, status: ui.intake.holdingStatus };
          operations.push(setHoldingOperation(target, baseRevision, existing.holding ?? null, after, "cardmarket-holding"));
        } else {
          const after = { ...(existing.want ?? { wanted: true, priority: ui.intake.priority }), wanted: true as const, priority: ui.intake.priority, quantity: ui.intake.quantity };
          operations.push(setWantOperation(target, baseRevision, existing.want ?? null, after, "cardmarket-want"));
        }
        const nextNotes = ui.intake.notes.trim() || null;
        if (nextNotes !== (existing.notes ?? null)) operations.push(setNotesOperation(target, baseRevision, existing.notes ?? null, nextNotes, "cardmarket-notes"));
      }
      if (operations.length === 0) throw new Error("Este intake no produciría ningún cambio.");
      queueChangeSet(createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations, idempotencyKey: `cardmarket-${entry.idProduct}-${ui.intake.destination}-${ui.intake.quantity}-${ui.intake.holdingStatus}-${ui.intake.priority}-${ui.intake.notes.trim()}`, sourceEvidence: { kind: "public-catalog-snapshot", reference: `synthetic-cardmarket-index:${entry.idProduct}`, capturedAt: now(), sourceUrl: resolution.canonicalUrl, note: "Índice público/sintético permitido; no se abrió ninguna marketplace page." } }), "El intake está listo para revisión del propietario; todavía no se ha guardado.");
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
    ui.intake.quantity = 1;
    ui.intake.destination = "wants";
    ui.intake.priority = "normal";
    ui.intake.holdingStatus = "owned";
  }

  function render(): void {
    const ownedQuantity = collection.records.reduce((sum, record) => sum + (record.holding?.quantity ?? 0), 0);
    const wantedCount = collection.records.filter((record) => record.want?.wanted).length;
    const page = ui.view === "add" ? renderAddView(ui, catalogIndex) : ui.view === "settings" ? renderSettingsView(ui, collection, catalogIndex, changeSetJournal) : renderCollectionView(ui, collection, changeSetJournal);
    root.innerHTML = `<div class="app-shell"><header class="app-header"><div><p class="eyebrow">Espacio privado · local-first</p><h1>Pocketdex</h1><p class="muted">Tu colección, sin ruido y en tu dispositivo.</p></div><div class="header-pills"><span class="privacy-pill">${usingSyntheticDemo ? "Demo sintética" : "Solo este dispositivo"}</span>${ui.offline ? `<span class="offline-pill">Sin conexión · cambios locales</span>` : ""}</div></header><nav class="tabs" aria-label="Secciones principales"><button class="tab ${ui.view === "collection" ? "tab--active" : ""}" data-view="collection" aria-current="${ui.view === "collection" ? "page" : "false"}">Collection <span>${ownedQuantity}</span></button><button class="tab ${ui.view === "wants" ? "tab--active" : ""}" data-view="wants" aria-current="${ui.view === "wants" ? "page" : "false"}">Wants <span>${wantedCount}</span></button><button class="tab tab--add ${ui.view === "add" ? "tab--active" : ""}" data-view="add" aria-current="${ui.view === "add" ? "page" : "false"}">Añadir</button><button class="tab ${ui.view === "settings" ? "tab--active" : ""}" data-view="settings" aria-current="${ui.view === "settings" ? "page" : "false"}">Ajustes</button></nav><main>${page}</main>${ui.message ? `<div class="toast" role="status"><span>${escapeHtml(ui.message)}</span></div>` : ""}</div>`;
    bindEvents();
  }

  function bindEvents(): void {
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => { ui.view = button.dataset.view as View; ui.message = ""; render(); }));
    root.querySelector<HTMLButtonElement>("[data-action='go-add']")?.addEventListener("click", () => { ui.view = "add"; ui.message = ""; render(); });
    root.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => { ui.query = (event.target as HTMLInputElement).value; render(); const search = root.querySelector<HTMLInputElement>("#search"); search?.focus(); search?.setSelectionRange(ui.query.length, ui.query.length); });
    root.querySelector<HTMLSelectElement>("#type-filter")?.addEventListener("change", (event) => { ui.type = (event.target as HTMLSelectElement).value as UiState["type"]; render(); });
    root.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => { ui.status = (event.target as HTMLSelectElement).value as UiState["status"]; render(); });
    root.querySelector<HTMLInputElement>("#cardmarket-url")?.addEventListener("input", (event) => { ui.intake.sourceUrl = (event.target as HTMLInputElement).value; });
    root.querySelector<HTMLButtonElement>("[data-action='paste-link']")?.addEventListener("click", async () => { try { ui.intake.sourceUrl = await navigator.clipboard.readText(); ui.message = "Enlace pegado; revisa y continúa."; render(); root.querySelector<HTMLInputElement>("#cardmarket-url")?.focus(); } catch { ui.message = "No se pudo leer el portapapeles. Pega el enlace en el campo."; render(); } });
    root.querySelector<HTMLButtonElement>("[data-action='share-help']")?.addEventListener("click", () => { ui.message = "Desde Cardmarket, usa Compartir y elige Pocketdex; también puedes pegar el enlace aquí."; render(); });
    root.querySelector<HTMLFormElement>("#cardmarket-form")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); ui.intake.sourceUrl = String(form.get("sourceUrl") ?? "").trim(); ui.intake.resolution = resolveCardmarketProduct(ui.intake.sourceUrl, catalogIndex); ui.intake.selectedEntry = ui.intake.resolution.candidates.length === 1 ? ui.intake.resolution.candidates[0] : undefined; if (ui.intake.selectedEntry) { ui.intake.name = ui.intake.selectedEntry.name; ui.intake.setName = ui.intake.selectedEntry.setName ?? ""; } ui.message = ui.intake.resolution.message; render(); root.querySelector<HTMLElement>(".intake-result")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("input", (event) => { const target = event.target as HTMLInputElement | HTMLTextAreaElement; if (target.name === "name") ui.intake.name = target.value; if (target.name === "setName") ui.intake.setName = target.value; if (target.name === "quantity") ui.intake.quantity = Number(target.value); if (target.name === "notes") ui.intake.notes = target.value; });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("change", (event) => { const target = event.target as HTMLSelectElement | HTMLInputElement; if (target.name === "destination") ui.intake.destination = target.value as IntakeDestination; if (target.name === "holdingStatus") ui.intake.holdingStatus = target.value as HoldingStatus; if (target.name === "priority") ui.intake.priority = target.value as WantPriority; render(); });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("submit", (event) => { event.preventDefault(); prepareIntakeChange(); });
    root.querySelectorAll<HTMLButtonElement>("[data-action='select-candidate']").forEach((button) => button.addEventListener("click", () => { const idProduct = button.dataset.idProduct; const selected = ui.intake.resolution?.candidates.find((entry) => entry.idProduct === idProduct); if (!selected) return; ui.intake.selectedEntry = selected; ui.intake.name = selected.name; ui.intake.setName = selected.setName ?? ""; ui.message = "Variante seleccionada; revisa los campos antes de guardar."; render(); }));
    root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
      const action = element.dataset.action;
      if (["go-add", "paste-link", "share-help", "select-candidate"].includes(action ?? "")) return;
      if (action === "preview-synthetic") { void previewWorkbook(syntheticWorkbook()).then((preview) => { ui.preview = preview; ui.message = "Fixture sintética lista para revisar."; render(); }); return; }
      if (action === "preview-synthetic-change") { prepareSyntheticChange(); return; }
      if (action === "prepare-import-change-set") { prepareImportChange(); return; }
      if (action === "approve-changeset" || action === "approve-all-changeset") {
        const pending = ui.pendingChangeSet;
        if (!pending) return;
        const selected = Array.from(root.querySelectorAll<HTMLInputElement>("[data-change-operation]:checked")).map((input) => input.dataset.changeOperation ?? "").filter(Boolean);
        try {
          const result = applyProposedChangeSet(collection, pending, SYNTHETIC_OWNER_CONTEXT, { journal: changeSetJournal, mode: action === "approve-all-changeset" ? "atomic" : "partial", approvedOperationIds: action === "approve-all-changeset" ? undefined : selected });
          saveJournal(result.journal);
          if (result.status === "conflict") ui.message = result.conflict?.message ?? "El change set está obsoleto y no se aplicó.";
          else { save(result.state); if (pending.sourceEvidence.kind === "workbook-preview") ui.importProposalIndex += 1; ui.pendingChangeSet = undefined; if (pending.sourceEvidence.kind === "public-catalog-snapshot") resetIntake(); ui.message = result.status === "replayed" ? "Replay detectado; no se escribieron duplicados." : "Change set aprobado y registrado en auditoría."; }
        } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo aplicar el change set"; }
        render();
        return;
      }
      if (action === "reject-changeset") { const pending = ui.pendingChangeSet; if (!pending) return; try { saveJournal(rejectProposedChangeSet(changeSetJournal, pending, SYNTHETIC_OWNER_CONTEXT)); if (pending.sourceEvidence.kind === "workbook-preview") ui.importProposalIndex += 1; ui.pendingChangeSet = undefined; ui.message = "Change set rechazado; no se cambió ningún dato."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo rechazar el change set"; } render(); return; }
      if (action === "replay-last-change") { const accepted = [...changeSetJournal.accepted].reverse()[0]; const proposal = accepted ? changeSetJournal.proposals.find((candidate) => candidate.changeSetId === accepted.changeSetId) : undefined; if (!proposal) { ui.message = "No hay un change set aceptado para repetir."; render(); return; } try { const result = applyProposedChangeSet(collection, proposal, SYNTHETIC_OWNER_CONTEXT, { journal: changeSetJournal }); saveJournal(result.journal); ui.message = result.status === "replayed" ? "Replay detectado; no se escribieron duplicados." : result.conflict?.message ?? "El replay no se aplicó."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo repetir el change set"; } render(); return; }
      if (action === "undo-changeset") { const changeSetId = element.dataset.changeSetId; if (!changeSetId) return; try { const result = undoAppliedChangeSet(collection, changeSetJournal, changeSetId, SYNTHETIC_OWNER_CONTEXT); saveJournal(result.journal); if (result.status === "applied") { save(result.state); ui.message = "El inverso seguro se aplicó y quedó auditado."; } else ui.message = result.reason ?? result.conflict?.message ?? "Undo no aplicado."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo deshacer el change set"; } render(); return; }
      if (action === "load-synthetic") { if (!window.confirm("¿Cargar datos sintéticos de demostración en este dispositivo?")) return; save(syntheticState()); ui.message = "Estado sintético cargado localmente."; render(); return; }
      if (action === "export") { const backup = new Blob([serializeBackup(createBackup(collection, now(), changeSetJournal))], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(backup); link.download = `pocketdex-backup-v${collection.schemaVersion}.json`; link.click(); URL.revokeObjectURL(link.href); ui.message = "Copia versionada y auditoría exportadas desde este dispositivo."; render(); return; }
      if (action === "clear") { if (!window.confirm("¿Borrar toda la colección local? Solo podrás recuperarla con una copia.")) return; storage.clear(); changeSetStorage.clear(); changeSetJournal = changeSetStorage.load(); window.localStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, "true"); collection = createEmptyState(); usingSyntheticDemo = false; ui.preview = undefined; ui.pendingChangeSet = undefined; ui.importProposalIndex = 0; ui.message = "Datos locales borrados de este dispositivo."; render(); return; }
      if (action === "go-add") { ui.view = "add"; render(); return; }
      const recordId = element.closest<HTMLElement>("[data-record-id]")?.dataset.recordId;
      const record = recordId ? collection.records.find((candidate) => candidate.id === recordId) : undefined;
      if (!record) return;
      try {
        const target = targetFromRecord(record);
        if (action === "increment" && record.holding) prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), record.holding, { ...record.holding, quantity: record.holding.quantity + 1 }, "increment-holding")]);
        if (action === "decrement" && record.holding) {
          if (record.holding.quantity <= 1) {
            if (!window.confirm("¿Quitar la última unidad de Collection?")) return;
            if (record.want?.wanted) prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), record.holding, null, "remove-last-holding")]);
            else prepareRecordChange(record, [{ kind: "delete-record", operationId: "delete-record", target, baseRevision: recordRevision(record), before: record, after: null }]);
          } else prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), record.holding, { ...record.holding, quantity: record.holding.quantity - 1 }, "decrement-holding")]);
        }
        if (action === "add-holding" && !record.holding) prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), null, { quantity: 1, status: "owned" }, "add-holding")]);
        if (action === "toggle-status" && record.holding) { const nextStatus: HoldingStatus = record.holding.status === "opened" ? "owned" : "opened"; prepareRecordChange(record, [setHoldingOperation(target, recordRevision(record), record.holding, { ...record.holding, status: nextStatus }, "toggle-status")]); }
        if (action === "toggle-want") { const after = record.want ? { ...record.want, wanted: !record.want.wanted } : { wanted: true, priority: "normal" as const }; prepareRecordChange(record, [setWantOperation(target, recordRevision(record), record.want ?? null, after, "toggle-want")]); }
        if (action === "remove-want" && record.want?.wanted) { if (!window.confirm("¿Quitar este producto de Wants?")) return; if (record.holding) prepareRecordChange(record, [setWantOperation(target, recordRevision(record), record.want, null, "remove-want")]); else prepareRecordChange(record, [{ kind: "delete-record", operationId: "delete-record", target, baseRevision: recordRevision(record), before: record, after: null }]); }
        if (action === "remove-record") { if (!window.confirm("¿Eliminar este registro? Se preparará un inverso seguro.")) return; prepareRecordChange(record, [{ kind: "delete-record", operationId: "delete-record", target, baseRevision: recordRevision(record), before: record, after: null }]); }
      } catch (error) { ui.message = error instanceof Error ? error.message : "Este registro no pertenece al alcance sellado/no-single"; render(); }
    }));
    root.querySelectorAll<HTMLFormElement>("[data-edit-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const record = collection.records.find((candidate) => candidate.id === form.dataset.editForm);
      if (!record) return;
      const values = new FormData(form);
      const rawQuantity = values.get("quantity");
      const quantity = rawQuantity === null ? record.holding?.quantity : Number(rawQuantity);
      const rawWantQuantity = values.get("wantQuantity");
      const wantQuantity = rawWantQuantity === null ? record.want?.quantity : Number(rawWantQuantity);
      if ((quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) || (wantQuantity !== undefined && (!Number.isInteger(wantQuantity) || wantQuantity < 1))) { ui.message = "La cantidad debe ser un número entero positivo."; render(); return; }
      try {
        const target = targetFromRecord(record);
        const baseRevision = recordRevision(record);
        const operations: ChangeOperation[] = [];
        if (record.holding && quantity !== undefined) { const after = { ...record.holding, quantity, status: (values.get("status") as HoldingStatus | null) ?? record.holding.status, condition: String(values.get("condition") ?? "").trim() || undefined, language: String(values.get("language") ?? "").trim() || undefined }; if (JSON.stringify(after) !== JSON.stringify(record.holding)) operations.push(setHoldingOperation(target, baseRevision, record.holding, after, "edit-holding")); }
        if (record.want?.wanted && wantQuantity !== undefined) { const after = { ...record.want, quantity: wantQuantity, priority: (values.get("priority") as WantPriority | null) ?? record.want.priority }; if (JSON.stringify(after) !== JSON.stringify(record.want)) operations.push(setWantOperation(target, baseRevision, record.want, after, "edit-want")); }
        const notes = String(values.get("notes") ?? "").trim() || null;
        if (notes !== (record.notes ?? null)) operations.push(setNotesOperation(target, baseRevision, record.notes ?? null, notes, "edit-notes"));
        if (operations.length === 0) { ui.message = "No hay cambios que revisar."; render(); return; }
        prepareRecordChange(record, operations, "synthetic-record-edit");
      } catch (error) { ui.message = error instanceof Error ? error.message : "Este registro no se puede editar mediante change sets"; render(); }
    }));
    root.querySelector<HTMLInputElement>("#workbook-file")?.addEventListener("change", async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { ui.preview = await previewWorkbook(await readWorkbookFile(file)); ui.message = "Vista previa lista. Revisa cada fila antes de preparar cambios."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo leer el workbook"; } render(); });
    root.querySelector<HTMLInputElement>("#restore-file")?.addEventListener("change", async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { const restored = parseBackup(await file.text()); if (!window.confirm("¿Reemplazar la colección local con esta copia?")) return; save(restored.state); if (restored.changeSetJournal) saveJournal(restored.changeSetJournal); else { changeSetStorage.clear(); changeSetJournal = changeSetStorage.load(); } ui.pendingChangeSet = undefined; ui.importProposalIndex = 0; ui.message = "Copia versionada restaurada localmente."; } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo restaurar la copia"; } render(); });
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
        const operation: ChangeOperation = existing
          ? setHoldingOperation(target, recordRevision(existing), existing.holding ?? null, { ...(existing.holding ?? { status: "owned" as const }), quantity: (existing.holding?.quantity ?? 0) + quantity }, "custom-holding")
          : createRecordOperation(target, 0, { id, catalog: { catalogId: id, ...identity }, holding: { quantity, status: String(form.get("status") ?? "owned") as HoldingStatus, condition: String(form.get("condition") ?? "").trim() || undefined, language: String(form.get("language") ?? "").trim() || undefined }, notes: String(form.get("notes") ?? "").trim() || undefined, createdAt, updatedAt: createdAt, revision: 0 }, "custom-record");
        queueChangeSet(createProposedChangeSet({ ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid, current: collection, target, operations: [operation], idempotencyKey: `custom-${id}-${Date.now()}`, sourceEvidence: { kind: "owner-note", reference: "synthetic-custom-entry", capturedAt: createdAt } }), "El producto custom está listo para revisión. No se ha cambiado ningún dato.");
      } catch (error) { ui.message = error instanceof Error ? error.message : "No se pudo preparar el producto custom"; render(); }
    });
  }

  window.addEventListener("offline", () => { ui.offline = true; ui.message = "Sin conexión: tus cambios siguen guardándose en este dispositivo."; render(); });
  window.addEventListener("online", () => { ui.offline = false; ui.message = "Conexión recuperada. No hay sincronización automática ni duplicados."; render(); });
  window.addEventListener("storage", (event) => {
    if (event.key === "pokemon-collection.local-state.v1" && event.newValue !== null) {
      try {
        collection = parseBackup(event.newValue).state;
        ui.message = "Otra pestaña actualizó este dispositivo; se revalidará la revisión base.";
        render();
      } catch {
        // Invalid cross-tab state is ignored; the local in-memory state remains unchanged.
      }
    }
    if (event.key === "pokemon-collection.change-set-journal.v1" && event.newValue !== null) {
      changeSetJournal = changeSetStorage.load();
      render();
    }
  });
  render();
}
