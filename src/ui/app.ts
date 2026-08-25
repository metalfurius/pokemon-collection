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
  makeChangeSetTarget,
  proposeChangeSet,
  rejectProposedChangeSet,
  setHoldingOperation,
  setNotesOperation,
  setWantOperation,
  targetFromRecord,
  undoAppliedChangeSet,
  type ChangeSetObjectType,
  type ChangeOperation,
  type ChangeSetOwnerContext,
  type ChangeSetJournal,
  type ProposedChangeSet,
} from "../domain/change-sets";
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
  recordRevision,
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
  pendingChangeSet: ProposedChangeSet | undefined;
  importProposalIndex: number;
}

// This is a synthetic local review identity only. It is intentionally not a Firebase credential or auth adapter.
const SYNTHETIC_OWNER_CONTEXT: ChangeSetOwnerContext = {
  authenticatedUid: "synthetic-owner",
  expectedOwnerUid: "synthetic-owner",
};

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
    "set-notes": "Notes",
    "append-acquisition": "Acquisition fact",
    "append-price-observation": "Price observation",
  }[kind];
}

function renderChangeSetReview(changeSet: ProposedChangeSet | undefined): string {
  if (changeSet === undefined) {
    return `<p class="muted">No change set is waiting for review. Synthetic updates are prepared here before any local mutation.</p>`;
  }
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
    return `<label class="change-diff">
      <span class="change-diff__header"><input type="checkbox" data-change-operation="${escapeHtml(operation.operationId)}" checked><strong>${escapeHtml(changeFieldLabel(operation.kind))}</strong><code>${escapeHtml(operation.operationId)}</code></span>
      <span class="change-diff__grid"><span><small>Before</small><pre>${escapeHtml(reviewValue(before))}</pre></span><span aria-hidden="true" class="change-arrow">→</span><span><small>After</small><pre>${escapeHtml(reviewValue(after))}</pre></span></span>
      <span class="muted">${operation.kind === "append-price-observation" ? "Immutable evidence; this operation has no automatic undo." : operation.kind === "append-acquisition" ? "Immutable acquisition fact; this operation has no automatic undo." : "Safe inverse available after approval."}</span>
    </label>`;
  }).join("");
  return `<section class="change-review" aria-live="polite">
    <div class="section-heading"><div><p class="eyebrow">Owner review required</p><h3>${escapeHtml(changeSet.target.name)}</h3><p class="muted">${escapeHtml(changeSet.target.objectType)} · exact record <code>${escapeHtml(changeSet.target.recordId)}</code></p></div><span class="privacy-pill">Synthetic owner</span></div>
    <p class="muted">Set <code>${escapeHtml(changeSet.changeSetId)}</code> · base state revision <strong>${changeSet.base.stateRevision}</strong> · base record revision <strong>${changeSet.base.recordRevision}</strong> · source <strong>${escapeHtml(changeSet.sourceEvidence.reference)}</strong></p>
    <div class="change-diff-list">${diffs}</div>
    <div class="tool-actions"><button class="button button--primary" data-action="approve-changeset">Approve selected</button><button class="button button--quiet" data-action="approve-all-changeset">Approve all atomically</button><button class="button button--danger" data-action="reject-changeset">Reject</button></div>
  </section>`;
}

function renderAudit(journal: ChangeSetJournal): string {
  const entries = [...journal.audit].reverse().slice(0, 8);
  if (entries.length === 0) return `<p class="muted">No change-set audit entries yet.</p>`;
  return `<ul class="audit-list">${entries.map((entry) => `<li><div><strong>${escapeHtml(entry.status)}</strong> · ${escapeHtml(entry.changeSetId)}<br><span class="muted">${escapeHtml(entry.occurredAt)} · ${escapeHtml(entry.reason ?? entry.event)}</span></div>${entry.event === "applied" && entry.undoable ? `<button class="button button--small button--quiet" data-action="undo-changeset" data-change-set-id="${escapeHtml(entry.changeSetId)}">Undo</button>` : entry.event === "applied" ? `<span class="muted">append-only</span>` : ""}</li>`).join("")}</ul>`;
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
    <button class="button button--primary" data-action="prepare-import-change-set" ${preview.sourceUnchanged ? "" : "disabled"}>Prepare next owner-reviewed set</button>
  </section>`;
}

export function mountApp(root: HTMLElement): void {
  const storage = createLocalStateStore(window.localStorage);
  const changeSetStorage = createChangeSetJournalStore(window.localStorage);
  let collection = storage.load();
  let changeSetJournal = changeSetStorage.load();
  let usingSyntheticDemo = collection.records.length === 0 && window.localStorage.getItem(SYNTHETIC_DEMO_DISMISSED_KEY) !== "true";
  if (usingSyntheticDemo) collection = syntheticState();
  const ui: UiState = { view: "collection", query: "", type: "all", status: "all", message: "", preview: undefined, pendingChangeSet: undefined, importProposalIndex: 0 };

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

  function queueChangeSet(changeSet: ProposedChangeSet, message = "Owner review ready. No data has been changed yet."): void {
    if (ui.pendingChangeSet !== undefined) {
      ui.message = "Review or reject the current change set before preparing another.";
      render();
      return;
    }
    saveJournal(proposeChangeSet(changeSetJournal, changeSet, SYNTHETIC_OWNER_CONTEXT));
    ui.pendingChangeSet = changeSet;
    ui.message = message;
    render();
  }

  function prepareRecordChange(record: CollectionRecord, operation: ChangeOperation, sourceReference = "synthetic-ui-action"): void {
    try {
      const target = targetFromRecord(record);
      const changeSet = createProposedChangeSet({
        ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid,
        current: collection,
        target,
        operations: [operation],
        idempotencyKey: `ui-${Date.now()}-${record.id}-${operation.kind}`,
        sourceEvidence: { kind: "owner-note", reference: sourceReference, capturedAt: new Date().toISOString() },
      });
      queueChangeSet(changeSet);
    } catch (error) {
      ui.message = error instanceof Error ? error.message : "Could not prepare the change set";
      render();
    }
  }

  function prepareSyntheticChange(): void {
    const record = collection.records.find((candidate) => candidate.catalog.name === "Sunlit Tin");
    if (!record) {
      ui.message = "The synthetic sealed fixture is not available in this state.";
      render();
      return;
    }
    const target = targetFromRecord(record);
    const before = record.holding ?? null;
    const after = before === null ? { quantity: 1, status: "owned" as const, condition: "Sealed" } : { ...before, quantity: before.quantity + 1, status: "owned" as const };
    prepareRecordChange(record, setHoldingOperation(target, recordRevision(record), before, after, "synthetic-sealed-holding"), "synthetic-sealed-fixture");
  }

  function prepareImportChange(): void {
    if (!ui.preview || !ui.preview.sourceUnchanged) return;
    const next = ui.preview.proposals.find((proposal, index) => index >= ui.importProposalIndex && CHANGE_SET_OBJECT_TYPES.includes(proposal.catalog.objectType as ChangeSetObjectType));
    if (!next) {
      ui.message = "No additional sealed/non-single import proposal is available. Single-card rows remain unchanged and explicitly out of scope.";
      render();
      return;
    }
    const index = ui.preview.proposals.indexOf(next);
    ui.importProposalIndex = index;
    const existing = collection.records.find((record) => record.id === next.recordId);
    const now = new Date().toISOString();
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
        operations.push({
          kind: "create-record",
          operationId: "import-record",
          target,
          baseRevision: 0,
          before: null,
          after: {
            id: next.recordId,
            catalog: next.catalog,
            holding: next.holding,
            want: next.want,
            notes: next.notes,
            createdAt: now,
            updatedAt: now,
            revision: 0,
          },
        });
      }
      if (operations.length === 0) {
        ui.importProposalIndex = index + 1;
        ui.message = "That normalized import proposal would make no change.";
        render();
        return;
      }
      const changeSet = createProposedChangeSet({
        ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid,
        current: collection,
        target,
        operations,
        idempotencyKey: `import-${ui.preview.sourceHashBefore}-${next.recordId}`,
        sourceEvidence: { kind: "workbook-preview", reference: ui.preview.filename, capturedAt: now, snapshotHash: ui.preview.sourceHashBefore, note: "Browser-local preview; no workbook upload or marketplace fetch." },
        createdAt: now,
      });
      queueChangeSet(changeSet, "Import proposal is ready for exact-record owner review.");
    } catch (error) {
      ui.message = error instanceof Error ? error.message : "Could not prepare the import change set";
      render();
    }
  }

  function render(): void {
    const createPanelOpen = root.querySelector<HTMLDetailsElement>("#create-panel")?.open ?? true;
    const importPanelOpen = root.querySelector<HTMLDetailsElement>("#import-panel")?.open ?? false;
    const backupPanelOpen = root.querySelector<HTMLDetailsElement>("#backup-panel")?.open ?? false;
    const changePanelOpen = root.querySelector<HTMLDetailsElement>("#change-panel")?.open ?? true;
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
          <details id="change-panel" class="tool-card" ${changePanelOpen ? "open" : ""}><summary><span><span class="eyebrow">Proposed changes</span><strong>Review before applying</strong></span><span aria-hidden="true">⌄</span></summary>
            <p class="muted">The authenticated synthetic owner must review an exact-record before/after diff. Sets are versioned, bounded, idempotent, and limited to sealed/non-single updates.</p>
            <div class="tool-actions"><button class="button button--quiet" data-action="preview-synthetic-change">Preview synthetic sealed update</button></div>
            ${renderChangeSetReview(ui.pendingChangeSet)}
            <details class="audit-panel"><summary>Audit history (${changeSetJournal.audit.length})</summary>${renderAudit(changeSetJournal)}<div class="tool-actions"><button class="button button--quiet" data-action="replay-last-change">Replay last accepted set</button></div></details>
          </details>
          <details id="create-panel" class="tool-card" ${createPanelOpen ? "open" : ""}><summary><span><span class="eyebrow">Fast entry</span><strong>Add a custom item</strong></span><span aria-hidden="true">⌄</span></summary>
            <form id="create-form" class="form-grid">
              <label>Name<input name="name" required maxlength="120" autocomplete="off" placeholder="e.g. Sunrise binder"></label>
              <label>Type<select name="objectType">${CHANGE_SET_OBJECT_TYPES.map((type) => `<option value="${type}">${formatType(type)}</option>`).join("")}</select></label>
              <label>Quantity<input name="quantity" type="number" min="1" step="1" value="1" required></label>
              <label>Set or group<input name="setName" maxlength="120" placeholder="Optional"></label>
              <label class="form-span">Advanced fields <span class="muted">optional</span><details><summary>Show advanced fields</summary><div class="form-grid nested"><label>Number<input name="number" maxlength="40"></label><label>Status<select name="status"><option value="owned">Owned</option><option value="opened">Opened</option></select></label><label>Condition<input name="condition" maxlength="80"></label><label>Language<input name="language" maxlength="30"></label><label>Notes<textarea name="notes" maxlength="500"></textarea></label></div></details></label>
              <button class="button button--primary form-span" type="submit">Add to this device</button>
            </form>
          </details>
          <details id="import-panel" class="tool-card" ${importPanelOpen ? "open" : ""}><summary><span><span class="eyebrow">Preview-first</span><strong>Import a workbook</strong></span><span aria-hidden="true">⌄</span></summary>
            <p class="muted">The source stays in this browser. Nothing is uploaded, changed, or auto-applied.</p>
            <div class="tool-actions"><label class="button button--quiet file-button">Choose .xlsx<input id="workbook-file" type="file" accept=".xlsx,.xls,.csv,.tsv" hidden></label><button class="button button--quiet" data-action="preview-synthetic">Preview synthetic fixture</button></div>
            ${renderPreview(ui.preview)}
          </details>
          <details id="backup-panel" class="tool-card" ${backupPanelOpen ? "open" : ""}><summary><span><span class="eyebrow">Portability</span><strong>Export or restore</strong></span><span aria-hidden="true">⌄</span></summary>
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
      if (action === "preview-synthetic-change") {
        prepareSyntheticChange();
        return;
      }
      if (action === "prepare-import-change-set") {
        prepareImportChange();
        return;
      }
      if (action === "approve-changeset" || action === "approve-all-changeset") {
        const pending = ui.pendingChangeSet;
        if (!pending) return;
        const selected = Array.from(root.querySelectorAll<HTMLInputElement>("[data-change-operation]:checked")).map((input) => input.dataset.changeOperation ?? "").filter(Boolean);
        try {
          const result = applyProposedChangeSet(collection, pending, SYNTHETIC_OWNER_CONTEXT, {
            journal: changeSetJournal,
            mode: action === "approve-all-changeset" ? "atomic" : "partial",
            approvedOperationIds: action === "approve-all-changeset" ? undefined : selected,
          });
          saveJournal(result.journal);
          if (result.status === "conflict") {
            ui.message = result.conflict?.message ?? "The proposed change set is stale and was not applied.";
          } else {
            save(result.state);
            if (pending.sourceEvidence.kind === "workbook-preview") ui.importProposalIndex += 1;
            ui.pendingChangeSet = undefined;
            ui.message = result.status === "replayed" ? "Replay detected; no duplicate data was written." : "Approved change set applied and recorded in the audit history.";
          }
        } catch (error) {
          ui.message = error instanceof Error ? error.message : "Could not apply the proposed change set";
        }
        render();
        return;
      }
      if (action === "reject-changeset") {
        const pending = ui.pendingChangeSet;
        if (!pending) return;
        try {
          saveJournal(rejectProposedChangeSet(changeSetJournal, pending, SYNTHETIC_OWNER_CONTEXT));
          if (pending.sourceEvidence.kind === "workbook-preview") ui.importProposalIndex += 1;
          ui.pendingChangeSet = undefined;
          ui.message = "Proposed change set rejected; no data was changed.";
        } catch (error) {
          ui.message = error instanceof Error ? error.message : "Could not reject the proposed change set";
        }
        render();
        return;
      }
      if (action === "replay-last-change") {
        const accepted = [...changeSetJournal.accepted].reverse()[0];
        const proposal = accepted ? changeSetJournal.proposals.find((candidate) => candidate.changeSetId === accepted.changeSetId) : undefined;
        if (!proposal) {
          ui.message = "No accepted change set is available to replay.";
          render();
          return;
        }
        try {
          const result = applyProposedChangeSet(collection, proposal, SYNTHETIC_OWNER_CONTEXT, { journal: changeSetJournal });
          saveJournal(result.journal);
          ui.message = result.status === "replayed" ? "Replay detected; no duplicate data was written." : result.conflict?.message ?? "Replay could not be applied.";
        } catch (error) {
          ui.message = error instanceof Error ? error.message : "Could not replay the change set";
        }
        render();
        return;
      }
      if (action === "undo-changeset") {
        const changeSetId = element.dataset.changeSetId;
        if (!changeSetId) return;
        try {
          const result = undoAppliedChangeSet(collection, changeSetJournal, changeSetId, SYNTHETIC_OWNER_CONTEXT);
          saveJournal(result.journal);
          if (result.status === "applied") {
            save(result.state);
            ui.message = "Safe inverse applied and recorded in the audit history.";
          } else {
            ui.message = result.reason ?? result.conflict?.message ?? "Undo was not applied.";
          }
        } catch (error) {
          ui.message = error instanceof Error ? error.message : "Could not undo the change set";
        }
        render();
        return;
      }
      if (action === "export") {
        const backup = new Blob([serializeBackup(createBackup(collection, new Date().toISOString(), changeSetJournal))], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(backup);
        link.download = `pocketdex-backup-v${collection.schemaVersion}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        ui.message = "Versioned collection and change-set audit backup exported from this device.";
        render();
        return;
      }
      if (action === "clear") {
        if (!window.confirm("Clear all local collection data from this device? This cannot be undone without a backup.")) return;
        storage.clear();
        changeSetStorage.clear();
        changeSetJournal = createChangeSetJournalStore(window.localStorage).load();
        window.localStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, "true");
        collection = createEmptyState();
        usingSyntheticDemo = false;
        ui.preview = undefined;
        ui.pendingChangeSet = undefined;
        ui.importProposalIndex = 0;
        ui.message = "Local collection data cleared from this device.";
        render();
        return;
      }
      if (!recordId) return;
      const record = collection.records.find((candidate) => candidate.id === recordId);
      if (!record) return;
      try {
        const target = targetFromRecord(record);
        if (action === "increment") {
          const before = record.holding ?? null;
          const after = before === null ? { quantity: 1, status: "owned" as const } : { ...before, quantity: before.quantity + 1 };
          prepareRecordChange(record, setHoldingOperation(target, recordRevision(record), before, after, "increment-holding"));
        }
        if (action === "toggle-status" && record.holding) {
          const nextStatus: HoldingStatus = record.holding.status === "opened" ? "owned" : "opened";
          prepareRecordChange(record, setHoldingOperation(target, recordRevision(record), record.holding, { ...record.holding, status: nextStatus }, "toggle-status"));
        }
        if (action === "toggle-want") {
          prepareRecordChange(record, setWantOperation(target, recordRevision(record), record.want ?? null, { wanted: !record.want?.wanted, priority: record.want?.priority ?? "normal" }, "toggle-want"));
        }
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "This record is outside the sealed/non-single change-set scope";
        render();
      }
    }));
    root.querySelector<HTMLFormElement>("#create-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const name = String(form.get("name") ?? "").trim();
      const objectType = String(form.get("objectType") ?? "custom") as ChangeSetObjectType;
      const quantity = Number(form.get("quantity") ?? 1);
      if (!name || !CHANGE_SET_OBJECT_TYPES.includes(objectType) || !Number.isInteger(quantity) || quantity < 1) {
        ui.message = "Enter a bounded name, supported sealed/non-single type, and positive whole quantity.";
        render();
        return;
      }
      const now = new Date().toISOString();
      const identity = { objectType, name, setName: String(form.get("setName") ?? "").trim() || undefined, number: String(form.get("number") ?? "").trim() || undefined };
      const id = stableRecordId(identity);
      const existing = collection.records.find((record) => record.id === id);
      try {
        const target = existing ? targetFromRecord(existing) : makeChangeSetTarget({ recordId: id, catalogId: id, ...identity });
        const operation: ChangeOperation = existing
          ? setHoldingOperation(target, recordRevision(existing), existing.holding ?? null, { ...(existing.holding ?? { status: "owned" as const }), quantity: (existing.holding?.quantity ?? 0) + quantity }, "custom-holding")
          : {
              kind: "create-record",
              operationId: "custom-record",
              target,
              baseRevision: 0,
              before: null,
              after: {
                id,
                catalog: { catalogId: id, ...identity },
                holding: { quantity, status: String(form.get("status") ?? "owned") as HoldingStatus, condition: String(form.get("condition") ?? "").trim() || undefined, language: String(form.get("language") ?? "").trim() || undefined },
                want: { wanted: false, priority: "normal" },
                notes: String(form.get("notes") ?? "").trim() || undefined,
                createdAt: now,
                updatedAt: now,
                revision: 0,
              },
            };
        const changeSet = createProposedChangeSet({
          ownerUid: SYNTHETIC_OWNER_CONTEXT.expectedOwnerUid,
          current: collection,
          target,
          operations: [operation],
          idempotencyKey: `custom-${id}-${Date.now()}`,
          sourceEvidence: { kind: "owner-note", reference: "synthetic-custom-entry", capturedAt: now },
          createdAt: now,
        });
        queueChangeSet(changeSet, "Custom item is ready for owner review. No data has changed yet.");
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "Could not prepare the custom item";
        render();
      }
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
        if (restored.changeSetJournal) saveJournal(restored.changeSetJournal);
        else {
          changeSetStorage.clear();
          changeSetJournal = createChangeSetJournalStore(window.localStorage).load();
        }
        ui.pendingChangeSet = undefined;
        ui.importProposalIndex = 0;
        ui.message = "Versioned collection and change-set audit backup restored locally.";
      } catch (error) {
        ui.message = error instanceof Error ? error.message : "Could not restore backup";
      }
      render();
    });
  }

  render();
}
