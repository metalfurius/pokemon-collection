import {
  OBJECT_TYPES,
  ROADMAP_URGENCIES,
  isLegacyCardType,
  openedQuantity,
  roadmapProgress,
  sealedQuantity,
  type CollectionRecord,
  type ObjectType,
  type RoadmapUrgency,
} from "../domain/model";
import {
  aggregateRoadmapProgress,
  availableRoadmapLanguages,
  filterRoadmapRecords,
  groupRoadmapByRegion,
  nextRoadmapMission,
  roadmapLanguage,
  roadmapRegion,
  roadmapUrgency,
  selectActiveRoadmapRegion,
  type RoadmapFilters,
  type RoadmapRegion,
  type RoadmapStatus,
} from "../domain/roadmap";
import { canonicalizeCardmarketUrl } from "../domain/cardmarket";
import { resolveProductMediaKey } from "../media/index";

export interface RoadmapRenderState {
  activeRegion?: string;
  selectedRecordId?: string;
}

/** Filters stay top-level for compatibility with the existing view call site. */
export interface RoadmapRenderOptions extends RoadmapFilters, RoadmapRenderState {}

const typeLabels: Readonly<Record<ObjectType, string>> = {
  box: "Caja",
  tin: "Lata",
  single: "Carta individual",
  "graded-card": "Carta graduada",
  accessory: "Accesorio",
  custom: "Otro producto",
};

const urgencyLabels: Readonly<Record<RoadmapUrgency, string>> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
  opportunistic: "Oportunidad",
  wait: "Esperar",
  "wait-launch": "Esperar lanzamiento",
  "do-not-buy": "No comprar",
};

const statusLabels: Readonly<Record<RoadmapStatus, string>> = {
  "not-started": "Por empezar",
  "in-progress": "En progreso",
  complete: "Completado",
};

export function escapeRoadmapHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function selected(current: string | undefined, value: string): string {
  return current === value ? " selected" : "";
}

function safeProgressMaximum(target: number): number {
  return Math.max(1, target);
}

function safeProgressValue(current: number, target: number): number {
  return Math.min(Math.max(0, current), safeProgressMaximum(target));
}

function percent(current: number, target: number): number {
  return target <= 0 ? 0 : Math.min(100, Math.round((current / target) * 100));
}

function stableDomId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `roadmap-${(hash >>> 0).toString(36)}`;
}

function mediaMonogram(record: CollectionRecord): string {
  const letters = record.catalog.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("es-ES") ?? "")
    .join("");
  return letters || "PX";
}

function renderProductMedia(record: CollectionRecord, className: string): string {
  const recordId = escapeRoadmapHtml(record.id);
  const mediaKey = escapeRoadmapHtml(resolveProductMediaKey(record));
  return `<span class="${className} product-media" data-product-media-frame data-media-key="${mediaKey}">
    <span class="product-media__fallback" data-product-media-fallback aria-hidden="true"><span>${escapeRoadmapHtml(mediaMonogram(record))}</span></span>
    <img class="product-media__image" data-product-media data-media-key="${mediaKey}" data-record-id="${recordId}" alt="" hidden>
  </span>`;
}

function cardmarketLink(record: CollectionRecord): { href: string; exact: boolean } {
  const raw = record.catalog.sourceUrl?.trim();
  if (raw) {
    const parsed = canonicalizeCardmarketUrl(raw);
    if (!("issue" in parsed)) return { href: parsed.canonicalUrl, exact: true };
  }

  const search = new URL("https://www.cardmarket.com/en/Pokemon/Products/Search");
  search.searchParams.set("searchString", record.catalog.name);
  return { href: search.toString(), exact: false };
}

function priceCeiling(record: CollectionRecord): string {
  const amountMinor = record.want?.priceCeilingMinor;
  if (!Number.isInteger(amountMinor) || (amountMinor ?? -1) < 0) return "";
  const currency = record.want?.currency?.trim().toLocaleUpperCase("en-US") || "EUR";
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("es-ES", { style: "currency", currency }).format((amountMinor ?? 0) / 100);
  } catch {
    formatted = `${((amountMinor ?? 0) / 100).toFixed(2)} ${currency}`;
  }
  return `<p class="mission-sheet__price roadmap-node__price" data-price-ceiling-minor="${amountMinor}"><span>Precio techo</span><strong>${escapeRoadmapHtml(formatted)}</strong></p>`;
}

function renderTrack(options: {
  recordName: string;
  kind: "sealed" | "opened";
  label: string;
  current: number;
  target: number;
  optional?: boolean;
}): string {
  const { recordName, kind, label, current, target, optional = false } = options;
  const progressValue = safeProgressValue(current, target);
  const progressMaximum = safeProgressMaximum(target);
  const targetLabel = target === 0 ? "Sin objetivo" : optional ? "Bonus opcional" : "Objetivo";
  const accessibleLabel = `${recordName}: ${label}, ${current} de ${target}. ${targetLabel}.`;
  return `<div class="roadmap-track roadmap-track--${kind}" data-goal-kind="${kind}" data-goal-optional="${optional ? "true" : "false"}">
    <div class="roadmap-track__heading"><strong>${label}</strong><span>${escapeRoadmapHtml(targetLabel)}</span><span class="roadmap-track__count">${current} / ${target}</span></div>
    <div class="roadmap-track__bar" role="progressbar" aria-label="${escapeRoadmapHtml(accessibleLabel)}" aria-valuemin="0" aria-valuemax="${progressMaximum}" aria-valuenow="${progressValue}" style="--roadmap-progress: ${percent(progressValue, target)}%"><span aria-hidden="true"></span></div>
  </div>`;
}

export function renderRoadmapNode(record: CollectionRecord, selectedRecordId?: string): string {
  const progress = roadmapProgress(record);
  const selectedMission = selectedRecordId === record.id;
  const recordId = escapeRoadmapHtml(record.id);
  const mediaKey = escapeRoadmapHtml(resolveProductMediaKey(record));
  const subtitle = [record.catalog.setName, record.want?.releaseYear?.toString()].filter(Boolean).join(" · ");
  const dialogId = `${stableDomId(record.id)}-mission-sheet`;
  const selectedAttributes = selectedMission
    ? ` aria-expanded="true" aria-controls="${dialogId}" data-selected="true"`
    : ' aria-expanded="false"';
  const accessibleLabel = `${record.catalog.name}. ${statusLabels[progress.status]}. ${progress.percent}% del objetivo obligatorio.`;
  return `<button type="button" class="roadmap-node roadmap-route-node roadmap-node--${progress.status}${selectedMission ? " roadmap-node--selected" : ""}" data-action="open-mission-sheet" data-roadmap-node="${recordId}" data-record-id="${recordId}" data-roadmap-status="${progress.status}" data-roadmap-progress="${progress.percent}" data-media-key="${mediaKey}" aria-label="${escapeRoadmapHtml(accessibleLabel)}" aria-haspopup="dialog"${selectedAttributes}>
    ${renderProductMedia(record, "roadmap-node__media")}
    <span class="roadmap-node__body">
      <span class="roadmap-node__state"><span aria-hidden="true"></span>${statusLabels[progress.status]}</span>
      <strong class="roadmap-node__title">${escapeRoadmapHtml(record.catalog.name)}</strong>
      ${subtitle ? `<span class="roadmap-node__subtitle">${escapeRoadmapHtml(subtitle)}</span>` : ""}
      <span class="roadmap-node__progress" aria-hidden="true"><span style="--roadmap-progress: ${progress.percent}%"></span><strong>${progress.percent}%</strong></span>
    </span>
  </button>`;
}

export function renderMissionSheet(record: CollectionRecord): string {
  const progress = roadmapProgress(record);
  const urgency = roadmapUrgency(record);
  const language = roadmapLanguage(record);
  const tier = record.want?.tier?.trim();
  const holding = record.holding;
  const want = record.want?.wanted ? record.want : undefined;
  const sealed = sealedQuantity(holding);
  const opened = openedQuantity(holding);
  const legacy = isLegacyCardType(record.catalog.objectType);
  const link = cardmarketLink(record);
  const linkLabel = link.exact ? "Ver producto exacto en Cardmarket" : "Buscar en Cardmarket";
  const openedOptional = record.want?.openGoalMode === "optional";
  const recordId = escapeRoadmapHtml(record.id);
  const mediaKey = escapeRoadmapHtml(resolveProductMediaKey(record));
  const baseId = stableDomId(record.id);
  const titleId = `${baseId}-mission-title`;
  const summaryId = `${baseId}-mission-summary`;
  const inputId = `${baseId}-media-input`;
  const subtitle = [record.catalog.setName, record.catalog.number ? `#${record.catalog.number}` : undefined, record.want?.releaseYear?.toString()]
    .filter(Boolean)
    .join(" · ");
  return `<aside id="${baseId}-mission-sheet" class="mission-sheet roadmap-mission-sheet" data-mission-sheet data-record-id="${recordId}" data-media-key="${mediaKey}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${summaryId}" tabindex="-1">
    <header class="mission-sheet__header">
      <div><p class="roadmap-eyebrow">Ficha de misión</p><h2 id="${titleId}">${escapeRoadmapHtml(record.catalog.name)}</h2><p id="${summaryId}">${escapeRoadmapHtml(subtitle || typeLabels[record.catalog.objectType])} · ${statusLabels[progress.status]} · ${progress.percent}%</p></div>
      <button type="button" class="mission-sheet__close" data-action="close-mission-sheet" aria-label="Cerrar ficha de ${escapeRoadmapHtml(record.catalog.name)}">Cerrar</button>
    </header>
    <div class="mission-sheet__visual">
      ${renderProductMedia(record, "mission-sheet__media")}
      <div class="mission-sheet__media-controls" aria-label="Foto local de ${escapeRoadmapHtml(record.catalog.name)}">
        <label for="${inputId}">Añadir o reemplazar foto</label>
        <input id="${inputId}" type="file" accept="image/jpeg,image/png,image/webp" data-product-media-input data-record-id="${recordId}" data-media-key="${mediaKey}">
        <button type="button" data-action="remove-product-media" data-record-id="${recordId}" data-media-key="${mediaKey}" disabled aria-disabled="true">Eliminar foto local</button>
      </div>
      <p class="mission-sheet__attribution" data-product-media-attribution data-media-key="${mediaKey}" hidden></p>
    </div>
    <div class="mission-sheet__content">
      <div class="mission-sheet__badges roadmap-node__badges" aria-label="Datos de la misión">
        <span class="roadmap-badge roadmap-badge--type">${typeLabels[record.catalog.objectType]}</span>
        <span class="roadmap-badge roadmap-badge--urgency" data-urgency="${urgency}">Urgencia ${urgencyLabels[urgency]}</span>
        <span class="roadmap-badge roadmap-badge--language">${escapeRoadmapHtml(language)}</span>
        ${tier ? `<span class="roadmap-badge roadmap-badge--tier">${escapeRoadmapHtml(tier)}</span>` : ""}
      </div>
      ${record.want?.actionNote ? `<p class="mission-sheet__objective roadmap-node__objective"><span>Objetivo</span>${escapeRoadmapHtml(record.want.actionNote)}</p>` : ""}
      <section class="mission-sheet__goals" aria-label="Objetivos de ${escapeRoadmapHtml(record.catalog.name)}">
        ${renderTrack({ recordName: record.catalog.name, kind: "sealed", label: "Guardar", current: progress.sealed, target: progress.targetSealed })}
        ${renderTrack({ recordName: record.catalog.name, kind: "opened", label: "Abrir", current: progress.opened, target: progress.targetOpened, optional: openedOptional })}
      </section>
      ${priceCeiling(record)}
      <a class="mission-sheet__cardmarket roadmap-cardmarket-link cardmarket-link" data-cardmarket-link="${link.exact ? "exact" : "search"}" href="${escapeRoadmapHtml(link.href)}" target="_blank" rel="noopener noreferrer">${linkLabel}<span aria-hidden="true">↗</span></a>
      <div class="mission-sheet__actions roadmap-node__actions item-actions" aria-label="Actualizar ${escapeRoadmapHtml(record.catalog.name)}">
        <button type="button" class="button button--small" data-action="add-sealed" data-record-id="${recordId}">+ Guardé una</button>
        <button type="button" class="button button--small" data-action="add-opened" data-record-id="${recordId}">+ Abrí una</button>
        <button type="button" class="button button--small button--quiet" data-action="open-sealed" data-record-id="${recordId}"${sealed > 0 ? "" : ' disabled aria-disabled="true"'}>Abrir una sellada</button>
        ${sealed > 0 ? `<button type="button" class="button button--small button--quiet" data-action="remove-sealed" data-record-id="${recordId}" aria-label="Restar una sellada">− sellada</button>` : ""}
        ${opened > 0 ? `<button type="button" class="button button--small button--quiet" data-action="remove-opened" data-record-id="${recordId}" aria-label="Restar una abierta">− abierta</button>` : ""}
        ${want ? `<button type="button" class="button button--small button--quiet" data-action="remove-want" data-record-id="${recordId}">Quitar de Quiero</button>` : ""}
        <button type="button" class="button button--small button--quiet" data-action="remove-record" data-record-id="${recordId}">Ocultar registro</button>
      </div>
      <details class="mission-sheet__edit edit-panel">
        <summary>Editar detalles</summary>
        <form class="edit-form" data-edit-form="${recordId}">
          ${holding ? `<label>Selladas<input name="sealedQuantity" type="number" min="0" step="1" value="${sealed}" required></label><label>Abiertas<input name="openedQuantity" type="number" min="0" step="1" value="${opened}" required></label><label>Condición<input name="condition" maxlength="80" value="${escapeRoadmapHtml(holding.condition ?? "")}"></label><label>Idioma actual<input name="language" maxlength="30" value="${escapeRoadmapHtml(holding.language ?? "")}"></label>${legacy ? `<label>Empresa de grading<input name="gradingCompany" maxlength="80" value="${escapeRoadmapHtml(holding.gradingCompany ?? "")}"></label><label>Nota de grading<input name="grade" type="number" min="0" max="10" step="0.1" value="${holding.grade ?? ""}"></label>` : ""}` : ""}
          ${want ? `<label>Quiero guardar<input name="targetSealedQuantity" type="number" min="0" step="1" value="${progress.targetSealed}" required></label><label>Quiero abrir<input name="targetOpenedQuantity" type="number" min="0" step="1" value="${progress.targetOpened}" required></label><label>Urgencia<select name="urgency">${ROADMAP_URGENCIES.map((candidate) => `<option value="${candidate}"${selected(want.urgency, candidate)}>${urgencyLabels[candidate]}</option>`).join("")}</select></label><label>Idioma objetivo<input name="goalLanguage" maxlength="30" value="${escapeRoadmapHtml(want.goalLanguage ?? "")}"></label>` : ""}
          <label class="form-span">Notas<textarea name="notes" maxlength="500">${escapeRoadmapHtml(record.notes ?? "")}</textarea></label>
          <button class="button button--small button--primary" type="submit">Preparar revisión</button>
        </form>
      </details>
    </div>
  </aside>`;
}

export function renderRoadmapHero(records: readonly CollectionRecord[]): string {
  const progress = aggregateRoadmapProgress(records);
  const nextMission = nextRoadmapMission(records);
  const hasOptionalOpenGoals = records.some((record) => record.want?.wanted
    && record.want.isRoadmap !== false
    && record.want.openGoalMode === "optional"
    && (record.want.targetOpenedQuantity ?? 0) > 0);
  const nextRegion = nextMission ? roadmapRegion(nextMission) : undefined;
  return `<section class="roadmap-hero roadmap-camp" data-roadmap-camp aria-labelledby="roadmap-title">
    <div class="roadmap-hero__summary roadmap-camp__summary">
      <p class="roadmap-eyebrow">Campamento base</p>
      <h2 id="roadmap-title">Tu expedición, de un vistazo</h2>
      <p><strong>${progress.completedRecordCount} de ${progress.recordCount}</strong> objetivos completados</p>
      <div class="roadmap-hero__progress" role="progressbar" aria-label="Progreso obligatorio total" aria-valuemin="0" aria-valuemax="${safeProgressMaximum(progress.totalSteps)}" aria-valuenow="${safeProgressValue(progress.completedSteps, progress.totalSteps)}" style="--roadmap-progress: ${progress.percent}%"><span aria-hidden="true"></span></div>
      <p class="roadmap-hero__percent"><strong>${progress.percent}%</strong> · ${progress.remainingSteps} pasos obligatorios pendientes</p>
    </div>
    <dl class="roadmap-hero__metrics roadmap-camp__metrics">
      <div data-roadmap-metric="sealed"><dt>Guardar</dt><dd>${progress.completedSealed} / ${progress.targetSealed}</dd></div>
      <div data-roadmap-metric="opened"><dt>Abrir</dt><dd>${progress.completedOpened} / ${progress.targetOpened}</dd>${hasOptionalOpenGoals ? "<small>Incluye bonus opcionales</small>" : ""}</div>
      <div data-roadmap-metric="complete"><dt>Hitos</dt><dd>${progress.completedRecordCount} / ${progress.recordCount}</dd></div>
    </dl>
    <aside class="roadmap-next-mission roadmap-camp__next" aria-label="Próxima misión">
      <p class="roadmap-eyebrow">Próxima misión</p>
      ${nextMission ? `<h3>${escapeRoadmapHtml(nextMission.catalog.name)}</h3><p>${escapeRoadmapHtml(nextRegion ?? "")} · Urgencia ${urgencyLabels[roadmapUrgency(nextMission)]}</p><button type="button" data-action="focus-mission" data-record-id="${escapeRoadmapHtml(nextMission.id)}" data-region-name="${escapeRoadmapHtml(nextRegion ?? "")}">Abrir misión</button>` : "<h3>Ruta al día</h3><p>No hay una compra activa pendiente.</p>"}
    </aside>
  </section>`;
}

function hasActiveFilters(filters: Readonly<RoadmapFilters>): boolean {
  return Boolean(filters.query?.trim())
    || Boolean(filters.type && filters.type !== "all")
    || Boolean(filters.urgency && filters.urgency !== "all")
    || Boolean(filters.language && filters.language !== "all")
    || Boolean(filters.status && filters.status !== "all");
}

export function renderRoadmapFilters(
  records: readonly CollectionRecord[],
  filters: Readonly<RoadmapFilters> = {},
  visibleCount = filterRoadmapRecords(records, filters).length,
): string {
  const languages = availableRoadmapLanguages(records);
  const query = filters.query ?? "";
  return `<details class="roadmap-explorer" data-roadmap-filters${hasActiveFilters(filters) ? " open" : ""}>
    <summary><span><strong>Kit de exploración</strong><small>Buscar y filtrar el atlas</small></span><span class="roadmap-filter-results" aria-live="polite"><strong>${visibleCount}</strong> objetivos visibles</span></summary>
    <div class="roadmap-filters" role="search" aria-label="Buscar y filtrar el mapa">
      <label class="roadmap-filter roadmap-filter--query">Buscar<input id="roadmap-query" name="query" type="search" value="${escapeRoadmapHtml(query)}" placeholder="Producto, set, segmento…"></label>
      <label class="roadmap-filter">Tipo<select id="roadmap-type-filter" name="type"><option value="all"${selected(filters.type, "all")}>Todos</option>${OBJECT_TYPES.map((type) => `<option value="${type}"${selected(filters.type, type)}>${typeLabels[type]}</option>`).join("")}</select></label>
      <label class="roadmap-filter">Urgencia<select id="roadmap-urgency-filter" name="urgency"><option value="all"${selected(filters.urgency, "all")}>Todas</option>${ROADMAP_URGENCIES.map((urgency) => `<option value="${urgency}"${selected(filters.urgency, urgency)}>${urgencyLabels[urgency]}</option>`).join("")}</select></label>
      <label class="roadmap-filter">Idioma<select id="roadmap-language-filter" name="language"><option value="all"${selected(filters.language, "all")}>Todos</option>${languages.map((language) => `<option value="${escapeRoadmapHtml(language)}"${selected(filters.language, language)}>${escapeRoadmapHtml(language)}</option>`).join("")}</select></label>
      <label class="roadmap-filter">Estado<select id="roadmap-status-filter" name="status"><option value="all"${selected(filters.status, "all")}>Todos</option>${(["not-started", "in-progress", "complete"] as const).map((status) => `<option value="${status}"${selected(filters.status, status)}>${statusLabels[status]}</option>`).join("")}</select></label>
      <button type="button" data-action="clear-roadmap-filters">Limpiar filtros</button>
    </div>
  </details>`;
}

export function renderRoadmapRegionSelector(
  regions: readonly Readonly<RoadmapRegion>[],
  activeRegion?: string,
): string {
  if (regions.length === 0) return "";
  return `<nav class="roadmap-chapters" data-roadmap-region-selector aria-label="Capítulos de la expedición">
    <div><p class="roadmap-eyebrow">Regiones</p><h2>Elige un capítulo</h2></div>
    <ol>${regions.map((region, index) => {
      const active = region.name === activeRegion;
      const regionName = escapeRoadmapHtml(region.name);
      return `<li><button type="button" class="roadmap-chapter${active ? " roadmap-chapter--active" : ""}" data-action="select-roadmap-region" data-region-name="${regionName}" aria-pressed="${active ? "true" : "false"}"><span>Capítulo ${index + 1}</span><strong>${regionName}</strong><small>${region.progress.completedRecordCount}/${region.progress.recordCount} · ${region.progress.percent}%</small></button></li>`;
    }).join("")}</ol>
  </nav>`;
}

export function renderRoadmapRegion(region: Readonly<RoadmapRegion>, selectedRecordId?: string): string {
  const headingId = stableDomId(region.name);
  const progress = region.progress;
  return `<li class="roadmap-route__region" data-roadmap-region="${escapeRoadmapHtml(region.name)}">
    <section class="roadmap-region" aria-labelledby="${headingId}">
      <header class="roadmap-region__header"><div><p class="roadmap-eyebrow">Región activa</p><h3 id="${headingId}">${escapeRoadmapHtml(region.name)}</h3><p>${progress.completedRecordCount} de ${progress.recordCount} hitos completados</p></div><strong>${progress.percent}%</strong></header>
      <div class="roadmap-region__progress" role="progressbar" aria-label="Progreso obligatorio de ${escapeRoadmapHtml(region.name)}" aria-valuemin="0" aria-valuemax="${safeProgressMaximum(progress.totalSteps)}" aria-valuenow="${safeProgressValue(progress.completedSteps, progress.totalSteps)}" style="--roadmap-progress: ${progress.percent}%"><span aria-hidden="true"></span></div>
      <ol class="roadmap-region__nodes">${region.records.map((record) => `<li>${renderRoadmapNode(record, selectedRecordId)}</li>`).join("")}</ol>
    </section>
  </li>`;
}

export function renderRoadmapView(
  records: readonly CollectionRecord[],
  options: Readonly<RoadmapRenderOptions> = {},
): string {
  const filters: RoadmapFilters = {
    query: options.query,
    type: options.type,
    urgency: options.urgency,
    language: options.language,
    status: options.status,
  };
  const visibleRecords = filterRoadmapRecords(records, filters);
  const regions = groupRoadmapByRegion(visibleRecords);
  const activeRegion = selectActiveRoadmapRegion(visibleRecords, options.activeRegion);
  const activeRegionName = activeRegion?.name;
  const stateAttributes = `${activeRegionName ? ` data-active-region="${escapeRoadmapHtml(activeRegionName)}"` : ""}${options.selectedRecordId ? ` data-selected-record-id="${escapeRoadmapHtml(options.selectedRecordId)}"` : ""}`;
  return `<section class="roadmap-view" data-roadmap-view${stateAttributes}>
    ${renderRoadmapHero(records)}
    ${renderRoadmapRegionSelector(regions, activeRegionName)}
    ${renderRoadmapFilters(records, filters, visibleRecords.length)}
    <ol class="roadmap-route" aria-label="Ruta de objetivos">${activeRegion ? renderRoadmapRegion(activeRegion, options.selectedRecordId) : ""}</ol>
    ${visibleRecords.length === 0 ? `<div class="roadmap-empty" role="status"><h3>No hay objetivos que coincidan</h3><p>Prueba otros filtros para recuperar la ruta.</p><button type="button" data-action="clear-roadmap-filters">Limpiar filtros</button></div>` : ""}
  </section>`;
}
