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
  OBJECT_TYPES,
  type CollectionRecord,
  type CollectionState,
  type HoldingStatus,
  type ObjectType,
  createEmptyState,
  stableRecordId,
} from "../domain/model";
import { syntheticState, syntheticWorkbook } from "../fixtures/synthetic";

type View = "collection" | "wants";
const SYNTHETIC_DEMO_DISMISSED_KEY = "pokemon-collection.synthetic-demo-dismissed.v1";

interface UiState {
  view: View;
  query: string;
  type: ObjectType | "all";
  status: HoldingStatus | "all";
  message: string;
  preview: ImportPreview | undefined;
}

const objectLabels: Record<ObjectType, string> = {
  box: "Box",
  tin: "Tin",
  single: "Single",
  "graded-card": "Graded card",
  accessory: "Accessory",
  custom: "Custom",
};

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

function recordMatches(record: CollectionRecord, ui: UiState): boolean {
  if (ui.view === "wants" && !record.want?.wanted) return false;
  if (ui.view === "collection" && !(record.holding && record.holding.quantity > 0)) return false;
  if (ui.type !== "all" && record.catalog.objectType !== ui.type) return false;
  if (ui.status !== "all" && record.holding?.status !== ui.status) return false;
  const haystack = [record.catalog.name, record.catalog.setName, record.catalog.number, record.notes]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
  return ui.query === "" || haystack.includes(ui.query.toLocaleLowerCase("en-US"));
}

function quantityLabel(record: CollectionRecord): string {
  return record.holding?.quantity ? `×${record.holding.quantity}` : "Wanted";
}

function renderRecord(record: CollectionRecord): string {
  const subtitle = [record.catalog.setName, record.catalog.number ? `#${record.catalog.number}` : undefined]
    .filter(Boolean)
    .join(" · ");
  const advanced = [
    record.holding?.condition ? `Condition: ${record.holding.condition}` : "",
    record.holding?.language ? `Language: ${record.holding.language}` : "",
    record.holding?.gradingCompany ? `${record.holding.gradingCompany} ${record.holding.grade ?? ""}` : "",
    record.notes ?? "",
  ].filter(Boolean);
  return `<article class="item-card" data-record-id="${escapeHtml(record.id)}">
    <div class="item-card__topline">
      <span class="type-badge">${escapeHtml(formatType(record.catalog.objectType))}</span>
      <span class="quantity" aria-label="Quantity">${escapeHtml(quantityLabel(record))}</span>
    </div>
    <h3>${escapeHtml(record.catalog.name)}</h3>
    <p class="muted">${escapeHtml(subtitle || "Custom catalog item")}</p>
    ${advanced.length ? `<details class="advanced"><summary>Details</summary><p>${advanced.map((line) => escapeHtml(line)).join("<br>")}</p></details>` : ""}
    <div class="item-actions" aria-label="Actions for ${escapeHtml(record.catalog.name)}">
      <button class="button button--small" data-action="increment">${record.holding ? "Add one" : "Owned"}</button>
      ${record.holding ? `<button class="button button--small button--quiet" data-action="toggle-status">${record.holding.status === "opened" ? "Opened" : "Open"}</button>` : ""}
      <button class="button button--small button--quiet" data-action="toggle-want">${record.want?.wanted ? "Wanted" : "Want"}</button>
    </div>
  </article>`;
}

function renderPreview(preview: ImportPreview | undefined): string {
  if (preview === undefined) return "";
  const rows = preview.rows.map((row) => `<li><span>${escapeHtml(row.sheet)}:${row.rowNumber}</span><span class="row-${row.outcome}">${escapeHtml(row.outcome)} · ${escapeHtml(row.reason)}</span></li>`).join("");
  return `<section class="preview-panel" aria-live="polite">
    <div class="section-heading"><div><p class="eyebrow">Preview only</p><h2>${escapeHtml(preview.filename)}</h2></div><span class="privacy-pill">Local only</span></div>
    <div class="summary-grid">
      <div><strong>${preview.totals.acceptedRows}</strong><span>accepted rows</span></div>
      <div><strong>${preview.totals.ambiguousRows}</strong><span>ambiguous rows</span></div>
      <div><strong>${preview.totals.skippedRows}</strong><span>skipped rows</span></div>
      <div><strong>${preview.proposals.length}</strong><span>normalized items</span></div>
    </div>
    <p class="hash-status">Input hash before: <code>${preview.sourceHashBefore.slice(0, 16)}…</code><br>after: <code>${preview.sourceHashAfter.slice(0, 16)}…</code> · ${preview.sourceUnchanged ? "unchanged" : "changed"}</p>
    <details><summary>Row decisions (${preview.rows.length})</summary><ul class="row-report">${rows}</ul></details>
    <button class="button button--primary" data-action="apply-import" ${preview.sourceUnchanged ? "" : "disabled"}>Apply normalized rows</button>
  </section>`;
}

export function mountApp(root: HTMLElement): void {
  const storage = createLocalStateStore(window.localStorage);
  let collection = storage.load();
  let usingSyntheticDemo = collection.records.length === 0 && window.localStorage.getItem(SYNTHETIC_DEMO_DISMISSED_KEY) !== "true";
  if (usingSyntheticDemo) collection = syntheticState();
  const ui: UiState = { view: "collection", query: "", type: "all", status: "all", message: "", preview: undefined };

  function save(next: CollectionState): void {
    collection = next;
    usingSyntheticDemo = false;
    window.localStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, "true");
    storage.save(collection);
  }

  function render(): void {
    const visible = collection.records.filter((record) => recordMatches(record, ui));
    const ownedQuantity = collection.records.reduce((sum, record) => sum + (record.holding?.quantity ?? 0), 0);
    const wantedCount = collection.records.filter((record) => record.want?.wanted).length;
    root.innerHTML = `<div class="app-shell">
      <header class="app-header">
        <div><p class="eyebrow">Private collection workspace</p><h1>Pocketdex</h1><p class="muted">A calm, local-first catalog for your collection.</p></div>
        <span class="privacy-pill">${usingSyntheticDemo ? "Synthetic preview" : "This device only"}</span>
      </header>
      <nav class="tabs" aria-label="Collection views">
        <button class="tab ${ui.view === "collection" ? "tab--active" : ""}" data-view="collection">Collection <span>${ownedQuantity}</span></button>
        <button class="tab ${ui.view === "wants" ? "tab--active" : ""}" data-view="wants">Wants <span>${wantedCount}</span></button>
      </nav>
      <main>
        <section class="hero-card">
          <div><p class="eyebrow">${ui.view === "collection" ? "Your shelf" : "Next to find"}</p><h2>${ui.view === "collection" ? "Everything in one quiet place." : "Keep a short, useful list."}</h2><p class="muted">Search, filter, and make quick updates without exposing private data.</p></div>
          <div class="stat-row"><div><strong>${ownedQuantity}</strong><span>owned units</span></div><div><strong>${wantedCount}</strong><span>wanted items</span></div></div>
        </section>
        <section class="toolbar" aria-label="Filters">
          <label class="search-field"><span class="sr-only">Search items</span><input id="search" type="search" placeholder="Search name, set, number…" value="${escapeHtml(ui.query)}"></label>
          <label><span class="sr-only">Filter by type</span><select id="type-filter"><option value="all">All types</option>${OBJECT_TYPES.map((type) => `<option value="${type}" ${ui.type === type ? "selected" : ""}>${formatType(type)}</option>`).join("")}</select></label>
          <label><span class="sr-only">Filter by status</span><select id="status-filter"><option value="all">All statuses</option><option value="owned" ${ui.status === "owned" ? "selected" : ""}>Owned</option><option value="opened" ${ui.status === "opened" ? "selected" : ""}>Opened</option></select></label>
        </section>
        <section class="section-heading"><div><p class="eyebrow">${visible.length} visible</p><h2>${ui.view === "collection" ? "Recent items" : "Wanted items"}</h2></div><button class="button button--primary" data-action="focus-create">+ Add custom</button></section>
        <section class="item-grid" aria-live="polite">${visible.length ? visible.map(renderRecord).join("") : `<div class="empty-state"><h3>No matching items</h3><p class="muted">Try another filter or add a custom item below.</p></div>`}</section>
        <section class="tools-grid">
          <details id="create-panel" class="tool-card" open><summary><span><span class="eyebrow">Fast entry</span><strong>Add a custom item</strong></span><span aria-hidden="true">⌄</span></summary>
            <form id="create-form" class="form-grid">
              <label>Name<input name="name" required maxlength="120" autocomplete="off" placeholder="e.g. Sunrise binder"></label>
              <label>Type<select name="objectType">${OBJECT_TYPES.map((type) => `<option value="${type}">${formatType(type)}</option>`).join("")}</select></label>
              <label>Quantity<input name="quantity" type="number" min="1" step="1" value="1" required></label>
              <label>Set or group<input name="setName" maxlength="120" placeholder="Optional"></label>
              <label class="form-span">Advanced fields <span class="muted">optional</span><details><summary>Show advanced fields</summary><div class="form-grid nested"><label>Number<input name="number" maxlength="40"></label><label>Status<select name="status"><option value="owned">Owned</option><option value="opened">Opened</option></select></label><label>Condition<input name="condition" maxlength="80"></label><label>Language<input name="language" maxlength="30"></label><label>Notes<textarea name="notes" maxlength="500"></textarea></label></div></details></label>
              <button class="button button--primary form-span" type="submit">Add to this device</button>
            </form>
          </details>
          <details class="tool-card"><summary><span><span class="eyebrow">Preview-first</span><strong>Import a workbook</strong></span><span aria-hidden="true">⌄</span></summary>
            <p class="muted">The source stays in this browser. Nothing is uploaded, changed, or auto-applied.</p>
            <div class="tool-actions"><label class="button button--quiet file-button">Choose .xlsx<input id="workbook-file" type="file" accept=".xlsx,.xls,.csv,.tsv" hidden></label><button class="button button--quiet" data-action="preview-synthetic">Preview synthetic fixture</button></div>
            ${renderPreview(ui.preview)}
          </details>
          <details class="tool-card"><summary><span><span class="eyebrow">Portability</span><strong>Export or restore</strong></span><span aria-hidden="true">⌄</span></summary>
            <p class="muted">Backups are versioned JSON files. Restore validates the schema before replacing local state.</p>
            <div class="tool-actions"><button class="button button--quiet" data-action="export">Export backup</button><label class="button button--quiet file-button">Restore backup<input id="restore-file" type="file" accept="application/json,.json" hidden></label><button class="button button--danger" data-action="clear">Clear this device</button></div>
          </details>
        </section>
        <section class="privacy-note"><span class="privacy-icon" aria-hidden="true">◈</span><div><strong>Private by design</strong><p class="muted">Catalog identity can be public later; holdings, wants, notes, acquisitions, and price observations stay owner-scoped. This preview contains synthetic data only.</p></div></section>
        ${ui.message ? `<p class="toast" role="status">${escapeHtml(ui.message)}</p>` : ""}
      </main>
    </div>`;
    bindEvents();
  }

  function bindEvents(): void {
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => {
      ui.view = button.dataset.view as View;
      render();
    }));
    root.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
      ui.query = (event.target as HTMLInputElement).value;
      render();
      const search = root.querySelector<HTMLInputElement>("#search");
      search?.focus();
      search?.setSelectionRange(ui.query.length, ui.query.length);
    });
    root.querySelector<HTMLSelectElement>("#type-filter")?.addEventListener("change", (event) => {
      ui.type = (event.target as HTMLSelectElement).value as UiState["type"];
      render();
    });
    root.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => {
      ui.status = (event.target as HTMLSelectElement).value as UiState["status"];
      render();
    });
    root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
      const action = element.dataset.action;
      const card = element.closest<HTMLElement>("[data-record-id]");
      const recordId = card?.dataset.recordId;
      if (action === "focus-create") {
        root.querySelector<HTMLDetailsElement>("#create-panel")?.setAttribute("open", "");
        root.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
        return;
      }
      if (action === "preview-synthetic") {
        void previewWorkbook(syntheticWorkbook()).then((preview) => { ui.preview = preview; ui.message = "Synthetic workbook preview ready."; render(); });
        return;
      }
      if (action === "apply-import" && ui.preview) {
        save(applyImport(collection, ui.preview));
        ui.preview = undefined;
        ui.message = "Import applied locally; the source workbook was not changed.";
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
        ui.message = "Versioned backup exported from this device.";
        render();
        return;
      }
      if (action === "clear") {
        if (!window.confirm("Clear all local collection data from this device? This cannot be undone without a backup.")) return;
        storage.clear();
        window.localStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, "true");
        collection = createEmptyState();
        usingSyntheticDemo = false;
        ui.preview = undefined;
        ui.message = "Local collection data cleared from this device.";
        render();
        return;
      }
      if (!recordId) return;
      const record = collection.records.find((candidate) => candidate.id === recordId);
      if (!record) return;
      if (action === "increment") {
        const holding = record.holding ?? { quantity: 0, status: "owned" as const };
        save({ ...collection, records: collection.records.map((candidate) => candidate.id === recordId ? { ...candidate, holding: { ...holding, quantity: holding.quantity + 1 }, updatedAt: new Date().toISOString() } : candidate), updatedAt: new Date().toISOString() });
        ui.message = "Quantity updated on this device.";
        render();
      }
      if (action === "toggle-status" && record.holding) {
        const nextStatus: HoldingStatus = record.holding.status === "opened" ? "owned" : "opened";
        const now = new Date().toISOString();
        save({ ...collection, records: collection.records.map((candidate) => candidate.id === recordId ? { ...candidate, holding: { ...candidate.holding as NonNullable<CollectionRecord["holding"]>, status: nextStatus }, updatedAt: now } : candidate), updatedAt: now });
        ui.message = nextStatus === "opened" ? "Marked opened." : "Marked owned.";
        render();
      }
      if (action === "toggle-want") {
        save({ ...collection, records: collection.records.map((candidate) => candidate.id === recordId ? { ...candidate, want: { wanted: !candidate.want?.wanted, priority: candidate.want?.priority ?? "normal" }, updatedAt: new Date().toISOString() } : candidate), updatedAt: new Date().toISOString() });
        ui.message = record.want?.wanted ? "Removed from wants." : "Added to wants.";
        render();
      }
    }));
    root.querySelector<HTMLFormElement>("#create-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const name = String(form.get("name") ?? "").trim();
      const objectType = String(form.get("objectType") ?? "custom") as ObjectType;
      const quantity = Math.max(1, Number(form.get("quantity") ?? 1));
      const now = new Date().toISOString();
      const identity = { objectType, name, setName: String(form.get("setName") ?? "").trim() || undefined, number: String(form.get("number") ?? "").trim() || undefined };
      const id = stableRecordId(identity);
      const existing = collection.records.find((record) => record.id === id);
      const nextRecord: CollectionRecord = existing ? { ...existing, holding: { ...(existing.holding ?? { status: "owned" as const }), quantity: (existing.holding?.quantity ?? 0) + quantity }, updatedAt: now } : {
        id,
        catalog: { catalogId: id, ...identity },
        holding: { quantity, status: String(form.get("status") ?? "owned") as HoldingStatus, condition: String(form.get("condition") ?? "").trim() || undefined, language: String(form.get("language") ?? "").trim() || undefined },
        want: { wanted: false, priority: "normal" },
        notes: String(form.get("notes") ?? "").trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      save({ ...collection, records: existing ? collection.records.map((record) => record.id === id ? nextRecord : record) : [nextRecord, ...collection.records], updatedAt: now });
      ui.message = "Custom item saved locally.";
      render();
    });
    root.querySelector<HTMLInputElement>("#workbook-file")?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        ui.preview = await previewWorkbook(await readWorkbookFile(file));
        ui.message = "Workbook preview ready. Review every row before applying.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "Could not read workbook";
      }
      render();
    });
    root.querySelector<HTMLInputElement>("#restore-file")?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const restored = parseBackup(await file.text());
        if (!window.confirm("Replace the current local collection with this backup?")) return;
        save(restored.state);
        ui.message = "Backup restored locally.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "Could not restore backup";
      }
      render();
    });
  }

  render();
}
