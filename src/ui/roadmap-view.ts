import {
  OBJECT_TYPES,
  ROADMAP_URGENCIES,
  roadmapProgress,
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
  type RoadmapFilters,
  type RoadmapRegion,
  type RoadmapStatus,
} from "../domain/roadmap";
import { canonicalizeCardmarketUrl } from "../domain/cardmarket";

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
  return `<p class="roadmap-node__price" data-price-ceiling-minor="${amountMinor}"><span>Precio techo</span><strong>${escapeRoadmapHtml(formatted)}</strong></p>`;
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

export function renderRoadmapNode(record: CollectionRecord): string {
  const progress = roadmapProgress(record);
  const urgency = roadmapUrgency(record);
  const language = roadmapLanguage(record);
  const tier = record.want?.tier?.trim();
  const subtitle = [record.catalog.setName, record.want?.releaseYear?.toString()].filter(Boolean).join(" · ");
  const link = cardmarketLink(record);
  const openGoalMode = record.want?.openGoalMode ?? (progress.targetOpened > 0 ? "required" : "none");
  const openedOptional = openGoalMode === "optional";
  const recordId = escapeRoadmapHtml(record.id);
  const exactLabel = link.exact ? "Ver producto exacto en Cardmarket" : "Buscar en Cardmarket";
  const canOpenSealed = progress.sealed > 0;
  return `<article class="roadmap-node roadmap-node--${progress.status}" data-roadmap-node="${recordId}" data-record-id="${recordId}" data-roadmap-status="${progress.status}" tabindex="-1">
    <header class="roadmap-node__header">
      <div><p class="roadmap-node__state"><span aria-hidden="true"></span>${statusLabels[progress.status]}</p><h4>${escapeRoadmapHtml(record.catalog.name)}</h4>${subtitle ? `<p class="roadmap-node__subtitle">${escapeRoadmapHtml(subtitle)}</p>` : ""}</div>
      <span class="roadmap-node__completion" aria-label="${progress.percent}% del objetivo obligatorio">${progress.percent}%</span>
    </header>
    <div class="roadmap-node__badges" aria-label="Datos del objetivo">
      <span class="roadmap-badge roadmap-badge--urgency" data-urgency="${urgency}">Urgencia ${urgencyLabels[urgency]}</span>
      <span class="roadmap-badge roadmap-badge--language">${escapeRoadmapHtml(language)}</span>
      ${tier ? `<span class="roadmap-badge roadmap-badge--tier">${escapeRoadmapHtml(tier)}</span>` : ""}
    </div>
    ${record.want?.actionNote ? `<p class="roadmap-node__objective"><span>Objetivo</span>${escapeRoadmapHtml(record.want.actionNote)}</p>` : ""}
    <div class="roadmap-node__tracks">
      ${renderTrack({ recordName: record.catalog.name, kind: "sealed", label: "Guardar", current: progress.sealed, target: progress.targetSealed })}
      ${renderTrack({ recordName: record.catalog.name, kind: "opened", label: "Abrir", current: progress.opened, target: progress.targetOpened, optional: openedOptional })}
    </div>
    ${priceCeiling(record)}
    <div class="roadmap-node__links"><a class="roadmap-cardmarket-link" data-cardmarket-link="${link.exact ? "exact" : "search"}" href="${escapeRoadmapHtml(link.href)}" target="_blank" rel="noopener noreferrer">${exactLabel}<span aria-hidden="true">↗</span></a></div>
    <div class="roadmap-node__actions" aria-label="Actualizar ${escapeRoadmapHtml(record.catalog.name)}">
      <button type="button" data-action="add-sealed" data-record-id="${recordId}">+ Guardé una</button>
      <button type="button" data-action="add-opened" data-record-id="${recordId}">+ Abrí una</button>
      <button type="button" data-action="open-sealed" data-record-id="${recordId}"${canOpenSealed ? "" : " disabled aria-disabled=\"true\""}>Abrir una sellada</button>
    </div>
  </article>`;
}

export function renderRoadmapHero(records: readonly CollectionRecord[]): string {
  const progress = aggregateRoadmapProgress(records);
  const nextMission = nextRoadmapMission(records);
  const hasOptionalOpenGoals = records.some((record) => record.want?.wanted
    && record.want.isRoadmap !== false
    && record.want.openGoalMode === "optional"
    && (record.want.targetOpenedQuantity ?? 0) > 0);
  return `<section class="roadmap-hero" aria-labelledby="roadmap-title">
    <div class="roadmap-hero__summary">
      <p class="roadmap-eyebrow">Tu mapa de colección</p>
      <h2 id="roadmap-title">Completa tu ruta</h2>
      <p><strong>${progress.completedRecordCount} de ${progress.recordCount}</strong> objetivos completados</p>
      <div class="roadmap-hero__progress" role="progressbar" aria-label="Progreso obligatorio total" aria-valuemin="0" aria-valuemax="${safeProgressMaximum(progress.totalSteps)}" aria-valuenow="${safeProgressValue(progress.completedSteps, progress.totalSteps)}" style="--roadmap-progress: ${progress.percent}%"><span aria-hidden="true"></span></div>
      <p class="roadmap-hero__percent"><strong>${progress.percent}%</strong> · ${progress.remainingSteps} pasos obligatorios pendientes</p>
    </div>
    <dl class="roadmap-hero__metrics">
      <div data-roadmap-metric="sealed"><dt>Guardar</dt><dd>${progress.completedSealed} / ${progress.targetSealed}</dd></div>
      <div data-roadmap-metric="opened"><dt>Abrir</dt><dd>${progress.completedOpened} / ${progress.targetOpened}</dd>${hasOptionalOpenGoals ? "<small>Incluye bonus opcionales</small>" : ""}</div>
      <div data-roadmap-metric="complete"><dt>Hitos</dt><dd>${progress.completedRecordCount} / ${progress.recordCount}</dd></div>
    </dl>
    <aside class="roadmap-next-mission" aria-label="Próxima misión">
      <p class="roadmap-eyebrow">Próxima misión</p>
      ${nextMission ? `<h3>${escapeRoadmapHtml(nextMission.catalog.name)}</h3><p>${escapeRoadmapHtml(roadmapRegion(nextMission))} · Urgencia ${urgencyLabels[roadmapUrgency(nextMission)]}</p><button type="button" data-action="focus-mission" data-record-id="${escapeRoadmapHtml(nextMission.id)}">Ver en el mapa</button>` : "<h3>Ruta al día</h3><p>No hay una compra activa pendiente.</p>"}
    </aside>
  </section>`;
}

export function renderRoadmapFilters(
  records: readonly CollectionRecord[],
  filters: Readonly<RoadmapFilters> = {},
  visibleCount = filterRoadmapRecords(records, filters).length,
): string {
  const languages = availableRoadmapLanguages(records);
  const query = filters.query ?? "";
  return `<form class="roadmap-filters" data-roadmap-filters aria-label="Buscar y filtrar el mapa">
    <label class="roadmap-filter roadmap-filter--query">Buscar<input id="roadmap-query" name="query" type="search" value="${escapeRoadmapHtml(query)}" placeholder="Producto, set, segmento…"></label>
    <label class="roadmap-filter">Tipo<select id="roadmap-type-filter" name="type"><option value="all"${selected(filters.type, "all")}>Todos</option>${OBJECT_TYPES.map((type) => `<option value="${type}"${selected(filters.type, type)}>${typeLabels[type]}</option>`).join("")}</select></label>
    <label class="roadmap-filter">Urgencia<select id="roadmap-urgency-filter" name="urgency"><option value="all"${selected(filters.urgency, "all")}>Todas</option>${ROADMAP_URGENCIES.map((urgency) => `<option value="${urgency}"${selected(filters.urgency, urgency)}>${urgencyLabels[urgency]}</option>`).join("")}</select></label>
    <label class="roadmap-filter">Idioma<select id="roadmap-language-filter" name="language"><option value="all"${selected(filters.language, "all")}>Todos</option>${languages.map((language) => `<option value="${escapeRoadmapHtml(language)}"${selected(filters.language, language)}>${escapeRoadmapHtml(language)}</option>`).join("")}</select></label>
    <label class="roadmap-filter">Estado<select id="roadmap-status-filter" name="status"><option value="all"${selected(filters.status, "all")}>Todos</option>${(["not-started", "in-progress", "complete"] as const).map((status) => `<option value="${status}"${selected(filters.status, status)}>${statusLabels[status]}</option>`).join("")}</select></label>
    <button type="button" data-action="clear-roadmap-filters">Limpiar filtros</button>
    <p class="roadmap-filter-results" aria-live="polite"><strong>${visibleCount}</strong> objetivos visibles</p>
  </form>`;
}

export function renderRoadmapRegion(region: Readonly<RoadmapRegion>): string {
  const headingId = stableDomId(region.name);
  const progress = region.progress;
  return `<li class="roadmap-route__region" data-roadmap-region="${escapeRoadmapHtml(region.name)}">
    <section class="roadmap-region" aria-labelledby="${headingId}">
      <header class="roadmap-region__header"><div><p class="roadmap-eyebrow">Región</p><h3 id="${headingId}">${escapeRoadmapHtml(region.name)}</h3><p>${progress.completedRecordCount} de ${progress.recordCount} hitos completados</p></div><strong>${progress.percent}%</strong></header>
      <div class="roadmap-region__progress" role="progressbar" aria-label="Progreso obligatorio de ${escapeRoadmapHtml(region.name)}" aria-valuemin="0" aria-valuemax="${safeProgressMaximum(progress.totalSteps)}" aria-valuenow="${safeProgressValue(progress.completedSteps, progress.totalSteps)}" style="--roadmap-progress: ${progress.percent}%"><span aria-hidden="true"></span></div>
      <ol class="roadmap-region__nodes">${region.records.map((record) => `<li>${renderRoadmapNode(record)}</li>`).join("")}</ol>
    </section>
  </li>`;
}

export function renderRoadmapView(
  records: readonly CollectionRecord[],
  filters: Readonly<RoadmapFilters> = {},
): string {
  const visibleRecords = filterRoadmapRecords(records, filters);
  const regions = groupRoadmapByRegion(visibleRecords);
  return `<section class="roadmap-view" data-roadmap-view>
    ${renderRoadmapHero(records)}
    ${renderRoadmapFilters(records, filters, visibleRecords.length)}
    <ol class="roadmap-route" aria-label="Ruta de objetivos">${regions.map(renderRoadmapRegion).join("")}</ol>
    ${visibleRecords.length === 0 ? `<div class="roadmap-empty" role="status"><h3>No hay objetivos que coincidan</h3><p>Prueba otros filtros para recuperar la ruta.</p><button type="button" data-action="clear-roadmap-filters">Limpiar filtros</button></div>` : ""}
  </section>`;
}
