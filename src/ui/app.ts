import "./style.css";
import {
  applyImport,
  previewWorkbook,
  readWorkbookFile,
  type ImportPreview,
} from "../domain/importer";
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
  undoState?: CollectionState;
  offline: boolean;
  intake: IntakeUiState;
}

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
    <div class="item-card__topline">
      <span class="type-badge">${escapeHtml(formatType(record.catalog.objectType))}</span>
      <span class="quantity" aria-label="Cantidad">${escapeHtml(quantityLabel)}</span>
    </div>
    <h3>${escapeHtml(record.catalog.name)}</h3>
    <p class="muted">${escapeHtml(subtitle || (record.catalog.source === "cardmarket" ? "Producto sellado" : "Identidad de catálogo"))}</p>
    ${legacy ? `<p class="legacy-note">Registro histórico compatible; se conserva y se puede exportar.</p>` : ""}
    ${record.catalog.idProduct ? `<p class="source-id">Cardmarket idProduct <code>${escapeHtml(record.catalog.idProduct)}</code></p>` : ""}
    ${secondary.length ? `<details class="advanced"><summary>Detalles</summary><p>${secondary.map((line) => escapeHtml(line)).join("<br>")}</p></details>` : ""}
    <div class="item-actions" aria-label="Acciones para ${escapeHtml(record.catalog.name)}">
      ${holding ? `<button class="button button--small button--quiet" data-action="decrement" aria-label="Restar una unidad de ${escapeHtml(record.catalog.name)}">−</button><button class="button button--small" data-action="increment" aria-label="Añadir una unidad de ${escapeHtml(record.catalog.name)}">+</button><button class="button button--small button--quiet" data-action="toggle-status">${holding.status === "opened" ? "Marcar sellado" : "Marcar abierto"}</button>` : want ? `<button class="button button--small" data-action="add-holding">Guardar también en colección</button>` : ""}
      ${want ? `<button class="button button--small button--quiet" data-action="remove-want">Quitar de Wants</button>` : ""}
      <button class="button button--small button--quiet" data-action="remove-record">Eliminar</button>
    </div>
    <details class="edit-panel"><summary>Editar detalles</summary>
      <form class="edit-form" data-edit-form="${escapeHtml(record.id)}">
        ${holding ? `<label>Cantidad<input name="quantity" type="number" min="1" step="1" value="${holding.quantity}" required></label><label>Estado<select name="status"><option value="owned" ${holding.status === "owned" ? "selected" : ""}>Sellado</option><option value="opened" ${holding.status === "opened" ? "selected" : ""}>Abierto</option></select></label><label>Condición<input name="condition" maxlength="80" value="${escapeHtml(holding.condition ?? "")}"></label><label>Idioma<input name="language" maxlength="30" value="${escapeHtml(holding.language ?? "")}"></label>${legacy ? `<label>Empresa de grading<input name="gradingCompany" maxlength="80" value="${escapeHtml(holding.gradingCompany ?? "")}"></label><label>Nota de grading<input name="grade" type="number" min="0" max="10" step="0.1" value="${holding.grade ?? ""}"></label>` : ""}` : ""}
        ${want ? `<label>Prioridad<select name="priority"><option value="low" ${want.priority === "low" ? "selected" : ""}>Baja</option><option value="normal" ${want.priority === "normal" ? "selected" : ""}>Normal</option><option value="high" ${want.priority === "high" ? "selected" : ""}>Alta</option></select></label><label>Unidades que buscas<input name="wantQuantity" type="number" min="1" step="1" value="${want.quantity ?? 1}" required></label>` : ""}
        <label class="form-span">Notas<textarea name="notes" maxlength="500">${escapeHtml(record.notes ?? "")}</textarea></label>
        <button class="button button--small button--primary" type="submit">Guardar cambios</button>
      </form>
    </details>
  </article>`;
}

function renderWorkbookPreview(preview: ImportPreview | undefined): string {
  if (!preview) return "";
  const rows = preview.rows.map((row) => `<li><span>${escapeHtml(row.sheet)}:${row.rowNumber}</span><span class="row-${row.outcome}">${escapeHtml(row.outcome)} · ${escapeHtml(row.reason)}</span></li>`).join("");
  return `<section class="preview-panel" aria-live="polite">
    <div class="section-heading"><div><p class="eyebrow">Vista previa</p><h3>${escapeHtml(preview.filename)}</h3></div><span class="privacy-pill">Solo local</span></div>
    <div class="summary-grid"><div><strong>${preview.totals.acceptedRows}</strong><span>aceptadas</span></div><div><strong>${preview.totals.ambiguousRows}</strong><span>ambiguas</span></div><div><strong>${preview.totals.skippedRows}</strong><span>omitidas</span></div><div><strong>${preview.proposals.length}</strong><span>productos</span></div></div>
    <p class="hash-status">Hash antes: <code>${preview.sourceHashBefore.slice(0, 16)}…</code><br>después: <code>${preview.sourceHashAfter.slice(0, 16)}…</code> · ${preview.sourceUnchanged ? "sin cambios" : "cambió"}</p>
    <details><summary>Decisiones por fila (${preview.rows.length})</summary><ul class="row-report">${rows}</ul></details>
    <button class="button button--primary" data-action="apply-import" ${preview.sourceUnchanged ? "" : "disabled"}>Aplicar productos aceptados</button>
  </section>`;
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
  return `<section class="intake-result" aria-live="polite">
    <div class="${resultClass}"><strong>${escapeHtml(resolution.message)}</strong>${resolution.canonicalUrl ? `<span>Enlace normalizado: <code>${escapeHtml(resolution.canonicalUrl)}</code></span>` : ""}</div>
    ${resolution.status === "multiple" ? `<div class="candidate-panel"><h3>Elige una variante</h3><p class="muted">No mezclamos envases ni idiomas automáticamente.</p><ul class="candidate-list">${candidateList}</ul></div>` : ""}
    ${resolution.status === "zero" ? `<div class="empty-state empty-state--compact"><h3>No hay coincidencia</h3><p class="muted">Comprueba el producto o carga una versión actualizada del índice. No se creará un producto sin identidad.</p></div>` : ""}
    ${selected ? `<form id="intake-preview-form" class="intake-preview-form">
      <div class="preview-heading"><div><p class="eyebrow">Vista editable</p><h3>${escapeHtml(selected.name)}</h3></div><span class="type-badge">${escapeHtml(formatType(selected.objectType))}</span></div>
      <p class="muted">Origen: <code>${escapeHtml(resolution.sourceUrl)}</code></p>
      <ul class="field-list">${details}</ul>
      <div class="form-grid"><label>Nombre visible<input name="name" maxlength="240" value="${escapeHtml(ui.intake.name)}" required></label><label>Colección<input name="setName" maxlength="240" value="${escapeHtml(ui.intake.setName)}" placeholder="Si falta, puedes completarla"></label><label>Cantidad<input name="quantity" type="number" min="1" max="9999" step="1" value="${ui.intake.quantity}" required></label><label>Destino<select name="destination"><option value="wants" ${ui.intake.destination === "wants" ? "selected" : ""}>Lo quiero</option><option value="collection" ${ui.intake.destination === "collection" ? "selected" : ""}>Ya lo tengo</option></select></label><label>Estado<select name="holdingStatus"><option value="owned" ${ui.intake.holdingStatus === "owned" ? "selected" : ""}>Sellado</option><option value="opened" ${ui.intake.holdingStatus === "opened" ? "selected" : ""}>Abierto</option></select></label><label>Prioridad<select name="priority"><option value="low" ${ui.intake.priority === "low" ? "selected" : ""}>Baja</option><option value="normal" ${ui.intake.priority === "normal" ? "selected" : ""}>Normal</option><option value="high" ${ui.intake.priority === "high" ? "selected" : ""}>Alta</option></select></label><label class="form-span">Notas opcionales<textarea name="notes" maxlength="500" placeholder="Algo útil para encontrarlo después">${escapeHtml(ui.intake.notes)}</textarea></label></div>
      <div class="destination-note"><strong>${ui.intake.destination === "wants" ? "Se guardará solo en Wants" : "Se guardará solo en Collection"}</strong><span>${ui.intake.destination === "wants" ? "No se añadirá ninguna unidad a tu colección." : "No se marcará como quiero salvo que ya exista esa decisión."}</span></div>
      <button class="button button--primary button--wide" type="submit">${ui.intake.destination === "wants" ? "Guardar en Wants" : "Guardar en Collection"}</button>
    </form>` : ""}
  </section>`;
}

function renderAddView(ui: UiState, index: CardmarketCatalogIndex): string {
  return `<section class="add-layout">
    <div class="page-intro"><p class="eyebrow">Añadir</p><h2>Un enlace, una decisión.</h2><p class="muted">Pega o comparte un producto no-single de Cardmarket. Revisaremos su identidad localmente antes de guardar nada.</p></div>
    <form id="cardmarket-form" class="link-form">
      <label for="cardmarket-url">Enlace Cardmarket</label>
      <div class="link-input-row"><input id="cardmarket-url" name="sourceUrl" type="url" inputmode="url" autocomplete="url" maxlength="2048" placeholder="https://www.cardmarket.com/en/Pokemon/Products/…" value="${escapeHtml(ui.intake.sourceUrl)}" required><button class="button button--quiet" type="button" data-action="paste-link">Pegar</button></div>
      <div class="form-actions"><button class="button button--primary" type="submit">Continuar</button><button class="button button--quiet" type="button" data-action="share-help">¿Cómo compartir?</button></div>
      <p class="helper">Solo HTTPS · sin páginas de vendedor, ofertas, búsquedas, listas ni cartas individuales. No abrimos ni enviamos el enlace.</p>
    </form>
    ${renderFreshness(index)}
    ${renderIntakePreview(ui)}
  </section>`;
}

function renderCollectionView(ui: UiState, collection: CollectionState): string {
  const visible = collection.records.filter((record) => recordMatches(record, ui));
  return `<section class="page-intro"><p class="eyebrow">${ui.view === "wants" ? "Wants" : "Collection"}</p><h2>${ui.view === "wants" ? "Lo que quieres encontrar." : "Lo que ya tienes."}</h2><p class="muted">${ui.view === "wants" ? "Una lista clara, sin convertir deseos en existencias." : "Productos sellados y registros históricos, en tu dispositivo."}</p></section>
    <section class="toolbar" aria-label="Buscar y filtrar esta vista"><label class="search-field"><span class="sr-only">Buscar en esta vista</span><input id="search" type="search" placeholder="Buscar nombre, colección o idProduct…" value="${escapeHtml(ui.query)}"></label><label><span class="sr-only">Filtrar por tipo</span><select id="type-filter"><option value="all">Todos los productos</option>${NEW_FLOW_OBJECT_TYPES.map((type) => `<option value="${type}" ${ui.type === type ? "selected" : ""}>${formatType(type)}</option>`).join("")}</select></label><label><span class="sr-only">Filtrar por estado</span><select id="status-filter"><option value="all">Todos los estados</option><option value="owned" ${ui.status === "owned" ? "selected" : ""}>Sellado</option><option value="opened" ${ui.status === "opened" ? "selected" : ""}>Abierto</option></select></label></section>
    <section class="section-heading"><div><p class="eyebrow">${visible.length} visibles</p><h2>${ui.view === "wants" ? "Productos que quieres" : "Productos recientes"}</h2></div><button class="button button--primary" data-action="go-add">+ Añadir producto</button></section>
    <section class="item-grid" aria-live="polite">${visible.length ? visible.map(renderRecord).join("") : `<div class="empty-state"><div class="empty-icon" aria-hidden="true">◌</div><h3>${ui.query || ui.type !== "all" || ui.status !== "all" ? "No hay coincidencias" : ui.view === "wants" ? "Tu lista Wants está vacía" : "Tu Collection está vacía"}</h3><p class="muted">${ui.query || ui.type !== "all" || ui.status !== "all" ? "Prueba otro término o limpia los filtros." : ui.view === "wants" ? "Pega un enlace de producto y elige «Lo quiero»." : "Pega un enlace de producto y elige «Ya lo tengo»."}</p>${!ui.query && ui.type === "all" && ui.status === "all" ? `<button class="button button--primary" data-action="go-add">Añadir desde Cardmarket</button>` : ""}</div>`}</section>`;
}

function renderSettingsView(ui: UiState, collection: CollectionState, index: CardmarketCatalogIndex): string {
  return `<section class="page-intro"><p class="eyebrow">Ajustes y herramientas</p><h2>Controla tu copia local.</h2><p class="muted">Importación, copias de seguridad y estado del índice viven aquí para no estorbar el uso diario.</p></section>
    <div class="tools-grid">
      <details class="tool-card" open><summary><span><span class="eyebrow">Catálogo</span><strong>Identidad Cardmarket</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">El índice derivado se usa sin credenciales, sin scraping y sin enviar enlaces a un backend. La aplicación conserva su fecha y un último índice válido.</p>${renderFreshness(index)}<p class="helper">La demo local usa datos sintéticos; una compilación de producto puede sustituirla por el índice publicado validado.</p></details>
      <details id="import-panel" class="tool-card"><summary><span><span class="eyebrow">Compatibilidad</span><strong>Importar workbook</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">La vista previa acepta productos no-single. Una fila sin tipo es ambigua y las cartas individuales se omiten; los registros históricos siguen siendo restaurables.</p><div class="tool-actions"><label class="button button--quiet file-button">Elegir .xlsx<input id="workbook-file" type="file" accept=".xlsx,.xls,.csv,.tsv" hidden></label><button class="button button--quiet" data-action="preview-synthetic">Probar fixture sintético</button></div>${renderWorkbookPreview(ui.preview)}</details>
      <details id="backup-panel" class="tool-card"><summary><span><span class="eyebrow">Portabilidad</span><strong>Exportar o restaurar</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Las copias versionadas incluyen campos compatibles, incluidos registros históricos. Restaurar valida antes de reemplazar esta copia local.</p><div class="tool-actions"><button class="button button--quiet" data-action="export">Exportar copia</button><label class="button button--quiet file-button">Restaurar copia<input id="restore-file" type="file" accept="application/json,.json" hidden></label><button class="button button--quiet" data-action="load-synthetic">Cargar estado sintético</button><button class="button button--danger" data-action="clear">Borrar este dispositivo</button></div></details>
      <details class="tool-card"><summary><span><span class="eyebrow">Ayuda</span><strong>Privacidad y estados</strong></span><span aria-hidden="true">⌄</span></summary><p class="muted">Los datos de colección, Wants, notas y copias permanecen en este dispositivo. Sin conexión puedes seguir editando; al volver a conectar no hay reintentos de red que dupliquen entradas.</p><p class="muted">Si una identidad no está en el índice, Pocketdex no inventa un producto ni lo convierte en una carta.</p></details>
    </div>`;
}

export function mountApp(root: HTMLElement, options: MountAppOptions = {}): void {
  const storage = createLocalStateStore(window.localStorage);
  let collection = storage.load();
  const catalogIndex = options.cardmarketIndex ?? syntheticCardmarketIndex();
  const ui: UiState = {
    view: options.initialView ?? "collection",
    query: "",
    type: "all",
    status: "all",
    message: "",
    offline: !navigator.onLine,
    intake: {
      sourceUrl: firstSharedCardmarketUrl(),
      destination: "wants",
      quantity: 1,
      holdingStatus: "owned",
      priority: "normal",
      notes: "",
      name: "",
      setName: "",
    },
  };

  function save(next: CollectionState): void {
    collection = next;
    storage.save(collection);
  }

  function withUndo(next: CollectionState, message: string): void {
    ui.undoState = collection;
    save(next);
    ui.message = message;
    render();
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
    const page = ui.view === "add"
      ? renderAddView(ui, catalogIndex)
      : ui.view === "settings"
        ? renderSettingsView(ui, collection, catalogIndex)
        : renderCollectionView(ui, collection);
    root.innerHTML = `<div class="app-shell">
      <header class="app-header"><div><p class="eyebrow">Espacio privado · local-first</p><h1>Pocketdex</h1><p class="muted">Tu colección, sin ruido y en tu dispositivo.</p></div><div class="header-pills"><span class="privacy-pill">${catalogIndex.sourceLabel.startsWith("Synthetic") ? "Demo sintética" : "Solo este dispositivo"}</span>${ui.offline ? `<span class="offline-pill">Sin conexión · cambios locales</span>` : ""}</div></header>
      <nav class="tabs" aria-label="Secciones principales"><button class="tab ${ui.view === "collection" ? "tab--active" : ""}" data-view="collection" aria-current="${ui.view === "collection" ? "page" : "false"}">Collection <span>${ownedQuantity}</span></button><button class="tab ${ui.view === "wants" ? "tab--active" : ""}" data-view="wants" aria-current="${ui.view === "wants" ? "page" : "false"}">Wants <span>${wantedCount}</span></button><button class="tab tab--add ${ui.view === "add" ? "tab--active" : ""}" data-view="add" aria-current="${ui.view === "add" ? "page" : "false"}">Añadir</button><button class="tab ${ui.view === "settings" ? "tab--active" : ""}" data-view="settings" aria-current="${ui.view === "settings" ? "page" : "false"}">Ajustes</button></nav>
      <main>${page}</main>
      ${ui.message ? `<div class="toast" role="status"><span>${escapeHtml(ui.message)}</span>${ui.undoState ? `<button class="button button--small button--quiet" data-action="undo">Deshacer</button>` : ""}</div>` : ""}
    </div>`;
    bindEvents();
  }

  function bindEvents(): void {
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => {
      ui.view = button.dataset.view as View;
      ui.message = "";
      render();
    }));
    root.querySelector<HTMLButtonElement>("[data-action='go-add']")?.addEventListener("click", () => { ui.view = "add"; ui.message = ""; render(); });
    root.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
      ui.query = (event.target as HTMLInputElement).value;
      render();
      const search = root.querySelector<HTMLInputElement>("#search");
      search?.focus();
      search?.setSelectionRange(ui.query.length, ui.query.length);
    });
    root.querySelector<HTMLSelectElement>("#type-filter")?.addEventListener("change", (event) => { ui.type = (event.target as HTMLSelectElement).value as UiState["type"]; render(); });
    root.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => { ui.status = (event.target as HTMLSelectElement).value as UiState["status"]; render(); });
    root.querySelector<HTMLInputElement>("#cardmarket-url")?.addEventListener("input", (event) => { ui.intake.sourceUrl = (event.target as HTMLInputElement).value; });
    root.querySelector<HTMLButtonElement>("[data-action='paste-link']")?.addEventListener("click", async () => {
      try {
        ui.intake.sourceUrl = await navigator.clipboard.readText();
        ui.message = "Enlace pegado; revisa y continúa.";
        render();
        root.querySelector<HTMLInputElement>("#cardmarket-url")?.focus();
      } catch {
        ui.message = "No se pudo leer el portapapeles. Pega el enlace en el campo.";
        render();
      }
    });
    root.querySelector<HTMLButtonElement>("[data-action='share-help']")?.addEventListener("click", () => { ui.message = "Desde Cardmarket, usa Compartir y elige Pocketdex; también puedes pegar el enlace aquí."; render(); });
    root.querySelector<HTMLFormElement>("#cardmarket-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      ui.intake.sourceUrl = String(form.get("sourceUrl") ?? "").trim();
      ui.intake.resolution = resolveCardmarketProduct(ui.intake.sourceUrl, catalogIndex);
      ui.intake.selectedEntry = ui.intake.resolution.candidates.length === 1 ? ui.intake.resolution.candidates[0] : undefined;
      if (ui.intake.selectedEntry) {
        ui.intake.name = ui.intake.selectedEntry.name;
        ui.intake.setName = ui.intake.selectedEntry.setName ?? "";
      }
      ui.message = ui.intake.resolution.message;
      render();
      root.querySelector<HTMLElement>(".intake-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (target.name === "name") ui.intake.name = target.value;
      if (target.name === "setName") ui.intake.setName = target.value;
      if (target.name === "quantity") ui.intake.quantity = Number(target.value);
      if (target.name === "notes") ui.intake.notes = target.value;
    });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement | HTMLInputElement;
      if (target.name === "destination") ui.intake.destination = target.value as IntakeDestination;
      if (target.name === "holdingStatus") ui.intake.holdingStatus = target.value as HoldingStatus;
      if (target.name === "priority") ui.intake.priority = target.value as WantPriority;
      render();
    });
    root.querySelector<HTMLFormElement>("#intake-preview-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const entry = ui.intake.selectedEntry;
      if (!entry || !ui.intake.resolution?.canonicalUrl) return;
      try {
        const editedEntry: CardmarketCatalogEntry = { ...entry, name: ui.intake.name.trim() || entry.name, ...(ui.intake.setName.trim() ? { setName: ui.intake.setName.trim() } : {}) };
        const destination = ui.intake.destination;
        const next = applyCardmarketIntake(collection, { entry: editedEntry, canonicalUrl: ui.intake.resolution.canonicalUrl, destination, quantity: ui.intake.quantity, holdingStatus: ui.intake.holdingStatus, priority: ui.intake.priority, notes: ui.intake.notes });
        save(next);
        ui.message = destination === "wants" ? "Guardado en Wants. No se añadió ninguna posesión." : "Guardado en Collection. No se marcó como quiero.";
        resetIntake();
        ui.view = destination === "wants" ? "wants" : "collection";
        render();
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "No se pudo guardar este producto";
        render();
      }
    });
    root.querySelectorAll<HTMLButtonElement>("[data-action='select-candidate']").forEach((button) => button.addEventListener("click", () => {
      const idProduct = button.dataset.idProduct;
      const selected = ui.intake.resolution?.candidates.find((entry) => entry.idProduct === idProduct);
      if (!selected) return;
      ui.intake.selectedEntry = selected;
      ui.intake.name = selected.name;
      ui.intake.setName = selected.setName ?? "";
      ui.message = "Variante seleccionada; revisa los campos antes de guardar.";
      render();
    }));
    root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
      const action = element.dataset.action;
      if (["go-add", "paste-link", "share-help", "select-candidate"].includes(action ?? "")) return;
      const recordId = element.closest<HTMLElement>("[data-record-id]")?.dataset.recordId;
      const record = recordId ? collection.records.find((candidate) => candidate.id === recordId) : undefined;
      if (action === "undo" && ui.undoState) {
        const previous = ui.undoState;
        ui.undoState = undefined;
        save(previous);
        ui.message = "Cambio deshecho.";
        render();
        return;
      }
      if (action === "preview-synthetic") {
        void previewWorkbook(syntheticWorkbook()).then((preview) => { ui.preview = preview; ui.message = "Fixture sintético listo para revisar."; render(); });
        return;
      }
      if (action === "apply-import" && ui.preview) {
        save(applyImport(collection, ui.preview));
        ui.preview = undefined;
        ui.message = "Importación aplicada; el workbook original no cambió.";
        render();
        return;
      }
      if (action === "load-synthetic") {
        if (!window.confirm("¿Cargar datos sintéticos de demostración en este dispositivo?")) return;
        save(syntheticState());
        ui.message = "Estado sintético cargado localmente.";
        render();
        return;
      }
      if (action === "export") {
        const backup = new Blob([serializeBackup(createBackup(collection))], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(backup);
        link.download = `pocketdex-backup-v${collection.schemaVersion}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        ui.message = "Copia versionada exportada desde este dispositivo.";
        render();
        return;
      }
      if (action === "clear") {
        if (!window.confirm("¿Borrar toda la colección local? Solo podrás recuperarla con una copia.")) return;
        storage.clear();
        collection = createEmptyState();
        ui.preview = undefined;
        ui.message = "Datos locales borrados de este dispositivo.";
        render();
        return;
      }
      if (!record) return;
      const timestamp = now();
      if (action === "increment" && record.holding) {
        withUndo({ ...collection, records: collection.records.map((candidate) => candidate.id === record.id ? { ...candidate, holding: { ...candidate.holding as NonNullable<CollectionRecord["holding"]>, quantity: (candidate.holding?.quantity ?? 0) + 1 }, updatedAt: timestamp } : candidate), updatedAt: timestamp }, "Cantidad actualizada.");
      }
      if (action === "add-holding" && !record.holding) {
        withUndo({ ...collection, records: collection.records.map((candidate) => candidate.id === record.id ? { ...candidate, holding: { quantity: 1, status: "owned" as const }, updatedAt: timestamp } : candidate), updatedAt: timestamp }, "Añadido a Collection de forma explícita; Wants se conserva aparte.");
      }
      if (action === "decrement" && record.holding) {
        if (record.holding.quantity <= 1) {
          if (!window.confirm("¿Quitar la última unidad de Collection?")) return;
          const nextRecords = record.want?.wanted
            ? collection.records.map((candidate) => candidate.id === record.id ? { ...candidate, holding: undefined, updatedAt: timestamp } : candidate)
            : collection.records.filter((candidate) => candidate.id !== record.id);
          withUndo({ ...collection, records: nextRecords, updatedAt: timestamp }, record.want?.wanted ? "Unidad retirada; tu Want sigue intacto." : "Producto retirado de Collection.");
        } else {
          withUndo({ ...collection, records: collection.records.map((candidate) => candidate.id === record.id ? { ...candidate, holding: { ...candidate.holding as NonNullable<CollectionRecord["holding"]>, quantity: Math.max(1, (candidate.holding?.quantity ?? 1) - 1) }, updatedAt: timestamp } : candidate), updatedAt: timestamp }, "Cantidad actualizada.");
        }
      }
      if (action === "toggle-status" && record.holding) {
        const nextStatus: HoldingStatus = record.holding.status === "opened" ? "owned" : "opened";
        withUndo({ ...collection, records: collection.records.map((candidate) => candidate.id === record.id ? { ...candidate, holding: { ...candidate.holding as NonNullable<CollectionRecord["holding"]>, status: nextStatus }, updatedAt: timestamp } : candidate), updatedAt: timestamp }, `Estado cambiado a ${formatHoldingStatus(nextStatus).toLocaleLowerCase("es-ES")}.`);
      }
      if (action === "remove-want" && record.want?.wanted) {
        if (!window.confirm("¿Quitar este producto de Wants?")) return;
        const nextRecords = record.holding ? collection.records.map((candidate) => candidate.id === record.id ? { ...candidate, want: undefined, updatedAt: timestamp } : candidate) : collection.records.filter((candidate) => candidate.id !== record.id);
        withUndo({ ...collection, records: nextRecords, updatedAt: timestamp }, "Quitado de Wants.");
      }
      if (action === "remove-record") {
        if (!window.confirm("¿Eliminar este registro? Esta acción se puede deshacer ahora.")) return;
        withUndo({ ...collection, records: collection.records.filter((candidate) => candidate.id !== record.id), updatedAt: timestamp }, "Registro eliminado.");
      }
    }));
    root.querySelectorAll<HTMLFormElement>("[data-edit-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const recordId = form.dataset.editForm;
      const record = collection.records.find((candidate) => candidate.id === recordId);
      if (!record) return;
      const values = new FormData(form);
      const rawQuantity = values.get("quantity");
      const quantity = rawQuantity === null ? record.holding?.quantity : Number(rawQuantity);
      const rawWantQuantity = values.get("wantQuantity");
      const wantQuantity = rawWantQuantity === null ? record.want?.quantity : Number(rawWantQuantity);
      if ((quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) || (wantQuantity !== undefined && (!Number.isInteger(wantQuantity) || wantQuantity < 1))) {
        ui.message = "La cantidad debe ser un número entero positivo.";
        render();
        return;
      }
      const timestamp = now();
      const gradeRaw = values.get("grade");
      const parsedGrade = gradeRaw === null || String(gradeRaw).trim() === "" ? undefined : Number(gradeRaw);
      if (parsedGrade !== undefined && !Number.isFinite(parsedGrade)) {
        ui.message = "La nota de grading debe ser numérica.";
        render();
        return;
      }
      const nextRecords = collection.records.map((candidate) => candidate.id === record.id ? {
        ...candidate,
        ...(candidate.holding && quantity !== undefined ? { holding: { ...candidate.holding, quantity, status: (values.get("status") as HoldingStatus | null) ?? candidate.holding.status, condition: String(values.get("condition") ?? candidate.holding.condition ?? "").trim() || undefined, language: String(values.get("language") ?? candidate.holding.language ?? "").trim() || undefined, ...(values.has("gradingCompany") ? { gradingCompany: String(values.get("gradingCompany") ?? "").trim() || undefined, grade: parsedGrade } : {}) } } : {}),
        ...(candidate.want?.wanted && wantQuantity !== undefined ? { want: { ...candidate.want, quantity: wantQuantity, priority: (values.get("priority") as WantPriority | null) ?? candidate.want.priority } } : {}),
        notes: String(values.get("notes") ?? "").trim() || undefined,
        updatedAt: timestamp,
      } : candidate);
      withUndo({ ...collection, records: nextRecords, updatedAt: timestamp }, "Detalles guardados.");
    }));
    root.querySelector<HTMLInputElement>("#workbook-file")?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        ui.preview = await previewWorkbook(await readWorkbookFile(file));
        ui.message = "Vista previa lista. Revisa cada fila antes de aplicar.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "No se pudo leer el workbook";
      }
      render();
    });
    root.querySelector<HTMLInputElement>("#restore-file")?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const restored = parseBackup(await file.text());
        if (!window.confirm("¿Reemplazar la colección local con esta copia?")) return;
        save(restored.state);
        ui.message = "Copia restaurada localmente.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "No se pudo restaurar la copia";
      }
      render();
    });
  }

  window.addEventListener("offline", () => { ui.offline = true; ui.message = "Sin conexión: tus cambios siguen guardándose en este dispositivo."; render(); });
  window.addEventListener("online", () => { ui.offline = false; ui.message = "Conexión recuperada. No hay sincronización automática ni duplicados."; render(); });
  render();
}
