import { describe, expect, it } from "vitest";
import { groupRoadmapByRegion } from "../src/domain/roadmap";
import type { CollectionRecord, Want } from "../src/domain/model";
import { resolveProductMediaKey } from "../src/media";
import {
  renderMissionSheet,
  renderRoadmapFilters,
  renderRoadmapHero,
  renderRoadmapNode,
  renderRoadmapRegion,
  renderRoadmapRegionSelector,
  renderRoadmapView,
} from "../src/ui/roadmap-view";

const NOW = "2026-01-01T00:00:00.000Z";

function goal(overrides: Partial<Want> = {}): Want {
  return {
    wanted: true,
    priority: "normal",
    isRoadmap: true,
    targetSealedQuantity: 1,
    targetOpenedQuantity: 1,
    openGoalMode: "required",
    urgency: "medium",
    goalLanguage: "JP",
    segment: "Ruta principal",
    ...overrides,
  };
}

function record(id: string, overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id,
    catalog: { catalogId: id, objectType: "box", name: id, setName: "Set de prueba" },
    want: goal(),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("compact roadmap node rendering", () => {
  it("renders an image-led mission button with stable state, progress, record, and media hooks", () => {
    const product = record("mega-dream", {
      catalog: {
        catalogId: "mega-dream",
        objectType: "box",
        name: "Mega Dream ex",
        setName: "High Class",
        idProduct: "42",
      },
      holding: { quantity: 1, status: "owned", sealedQuantity: 1, openedQuantity: 0 },
    });

    const html = renderRoadmapNode(product, product.id);
    expect(html).toContain('<button type="button" class="roadmap-node roadmap-route-node roadmap-node--in-progress roadmap-node--selected"');
    expect(html).toContain('data-action="open-mission-sheet"');
    expect(html).toContain('data-roadmap-node="mega-dream"');
    expect(html).toContain('data-record-id="mega-dream"');
    expect(html).toContain('data-roadmap-status="in-progress"');
    expect(html).toContain('data-roadmap-progress="50"');
    expect(html).toContain(`data-media-key="${resolveProductMediaKey(product)}"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="');
    expect(html).toContain('data-product-media-fallback');
    expect(html).toContain('<img class="product-media__image" data-product-media');
    expect(html).not.toMatch(/<img[^>]+src=/);
    expect(html).not.toContain('data-goal-kind="sealed"');
    expect(html).not.toContain('data-cardmarket-link');
    expect(html).not.toContain('data-action="add-sealed"');
  });

  it("escapes all owner-controlled node content and leaves unselected buttons collapsed", () => {
    const hostile = record('id" onmouseover="alert(1)', {
      catalog: {
        catalogId: "hostile",
        objectType: "box",
        name: '<img src=x onerror="alert(1)">',
        setName: "</strong><script>alert(1)</script>",
      },
    });

    const html = renderRoadmapNode(hostile);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot; onmouseover=&quot;");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-selected="true"');
  });
});

describe("reusable mission sheet", () => {
  it("retains goals, price, marketplace, collection actions, edit fields, and local media controls", () => {
    const product = record("mega-dream", {
      catalog: {
        catalogId: "mega-dream",
        objectType: "box",
        name: "Mega Dream ex",
        setName: "High Class",
        idProduct: "42",
        sourceUrl: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/Mega-Dream?idProduct=42&utm_source=owner",
      },
      holding: {
        quantity: 2,
        status: "owned",
        sealedQuantity: 1,
        openedQuantity: 1,
        condition: "Near Mint",
        language: "EN",
      },
      want: goal({
        targetSealedQuantity: 2,
        targetOpenedQuantity: 2,
        openGoalMode: "optional",
        urgency: "critical",
        tier: "S",
        priceCeilingMinor: 12000,
        currency: "EUR",
        actionNote: "Una para abrir y otra para guardar",
      }),
      notes: "Nota privada",
    });

    const html = renderMissionSheet(product);
    expect(html).toContain('class="mission-sheet roadmap-mission-sheet"');
    expect(html).toContain('data-mission-sheet data-record-id="mega-dream"');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain('aria-describedby="');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-action="close-mission-sheet"');
    expect(html).toContain('data-goal-kind="sealed"');
    expect(html).toContain('data-goal-kind="opened"');
    expect(html).toContain("Bonus opcional");
    expect(html.match(/role="progressbar"/g)).toHaveLength(2);
    expect(html).toContain('data-price-ceiling-minor="12000"');
    expect(html).toContain('data-cardmarket-link="exact"');
    expect(html).toContain("https://www.cardmarket.com/en/Pokemon/Products?idProduct=42");
    expect(html).not.toContain("utm_source");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Ver producto exacto en Cardmarket");
    expect(html).toContain("Urgencia Crítica");
    expect(html).toContain(">JP<");
    expect(html).toContain(">S<");

    for (const action of ["add-sealed", "add-opened", "open-sealed", "remove-sealed", "remove-opened", "remove-want", "remove-record"]) {
      expect(html).toContain(`data-action="${action}" data-record-id="mega-dream"`);
    }
    expect(html).toContain('form class="edit-form" data-edit-form="mega-dream"');
    for (const field of ["sealedQuantity", "openedQuantity", "condition", "language", "targetSealedQuantity", "targetOpenedQuantity", "urgency", "goalLanguage", "notes"]) {
      expect(html).toContain(`name="${field}"`);
    }

    expect(html).toContain('data-product-media-input data-record-id="mega-dream"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("Añadir o reemplazar foto");
    expect(html).toContain('data-action="remove-product-media" data-record-id="mega-dream"');
    expect(html).toContain('data-product-media-fallback');
    expect(html).toContain('<img class="product-media__image" data-product-media');
    expect(html).not.toMatch(/<img[^>]+src=/);
  });

  it("keeps legacy grading fields and uses a bounded Cardmarket search for unsafe sources", () => {
    const legacy = record("legacy", {
      catalog: {
        catalogId: "legacy",
        objectType: "graded-card",
        name: "Mega Tin & Friends",
        sourceUrl: "javascript:alert(1)",
      },
      holding: {
        quantity: 1,
        status: "opened",
        sealedQuantity: 0,
        openedQuantity: 1,
        gradingCompany: "PSA",
        grade: 9,
      },
    });

    const html = renderMissionSheet(legacy);
    expect(html).toContain('name="gradingCompany"');
    expect(html).toContain('name="grade"');
    expect(html).toContain('data-cardmarket-link="search"');
    expect(html).toContain("https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Mega+Tin+%26+Friends");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('data-action="open-sealed" data-record-id="legacy" disabled aria-disabled="true"');
    expect(html).not.toContain('data-action="remove-sealed"');
  });

  it("escapes hostile sheet content and rejects lookalike Cardmarket hosts", () => {
    const hostile = record('id" onmouseover="alert(1)', {
      catalog: {
        catalogId: "hostile",
        objectType: "box",
        name: '<img src=x onerror="alert(1)">',
        setName: "</h2><script>alert(1)</script>",
        sourceUrl: "https://www.cardmarket.com.evil.example/product",
      },
      want: goal({
        goalLanguage: '"><svg onload=alert(1)>',
        tier: "<b>unsafe</b>",
        actionNote: "<script>alert(2)</script>",
      }),
      notes: "</textarea><script>alert(3)</script>",
    });

    const html = renderMissionSheet(hostile);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("cardmarket.com.evil");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot; onmouseover=&quot;");
    expect(html).toContain('data-cardmarket-link="search"');
  });
});

describe("camp, exploration kit, chapters, and active route", () => {
  const records = [
    record("alpha-complete", {
      catalog: { catalogId: "alpha-complete", objectType: "tin", name: "Alpha Complete", setName: "Alpha" },
      holding: { quantity: 2, status: "owned", sealedQuantity: 1, openedQuantity: 1 },
      want: goal({ urgency: "high", roadmapOrder: 1, segment: "Alpha" }),
    }),
    record("alpha-wait", {
      catalog: { catalogId: "alpha-wait", objectType: "box", name: "Alpha Wait", setName: "Alpha" },
      want: goal({ urgency: "wait", roadmapOrder: 2, segment: "Alpha", openGoalMode: "optional" }),
    }),
    record("beta-next", {
      catalog: { catalogId: "beta-next", objectType: "box", name: "Beta Next", setName: "Beta" },
      want: goal({ urgency: "critical", roadmapOrder: 3, segment: "Beta", goalLanguage: "ES" }),
    }),
    record("beta-other", {
      catalog: { catalogId: "beta-other", objectType: "tin", name: "Beta Other", setName: "Beta" },
      want: goal({ urgency: "medium", roadmapOrder: 4, segment: "Beta", goalLanguage: "ES" }),
    }),
    record("gamma-critical", {
      catalog: { catalogId: "gamma-critical", objectType: "box", name: "Gamma Critical", setName: "Gamma" },
      want: goal({ urgency: "critical", roadmapOrder: 5, segment: "Gamma", goalLanguage: "ES" }),
    }),
  ];

  it("renders the global camp/base summary and next actionable mission", () => {
    const html = renderRoadmapHero(records);
    expect(html).toContain('class="roadmap-hero roadmap-camp"');
    expect(html).toContain("Campamento base");
    expect(html).toContain('data-roadmap-metric="sealed"');
    expect(html).toContain('data-roadmap-metric="opened"');
    expect(html).toContain('data-roadmap-metric="complete"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Incluye bonus opcionales");
    expect(html).toContain("Beta Next");
    expect(html).toContain('data-action="focus-mission" data-record-id="beta-next" data-region-name="Beta"');
  });

  it("renders native collapsible exploration filters, opens active filters, and escapes a hostile query", () => {
    const collapsed = renderRoadmapFilters(records);
    expect(collapsed).toContain('<details class="roadmap-explorer" data-roadmap-filters>');
    expect(collapsed).toContain("Kit de exploración");
    expect(collapsed).toContain('role="search" aria-label="Buscar y filtrar el mapa"');

    const active = renderRoadmapFilters(records, {
      query: '"><script>alert(1)</script>',
      type: "tin",
      urgency: "wait",
      language: "JP",
      status: "not-started",
    }, 1);
    expect(active).toContain('<details class="roadmap-explorer" data-roadmap-filters open>');
    expect(active).toContain('value="tin" selected');
    expect(active).toContain('value="wait" selected');
    expect(active).toContain('value="JP" selected');
    expect(active).toContain('value="not-started" selected');
    expect(active).toContain('aria-live="polite"');
    expect(active).toContain("<strong>1</strong> objetivos visibles");
    expect(active).not.toContain("<script>");
    expect(active).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("renders every chapter as a selector while marking exactly one active", () => {
    const regions = groupRoadmapByRegion(records);
    const html = renderRoadmapRegionSelector(regions, "Beta");
    expect(html).toContain('data-roadmap-region-selector');
    expect(html).toContain('aria-label="Capítulos de la expedición"');
    expect(html.match(/data-action="select-roadmap-region"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('data-region-name="Beta" aria-pressed="true"');
    expect(html).toContain("Capítulo 1");
    expect(html).toContain("Capítulo 3");
  });

  it("keeps the active region as a semantic ordered route of compact buttons", () => {
    const region = groupRoadmapByRegion(records).find(({ name }) => name === "Alpha")!;
    const html = renderRoadmapRegion(region, "alpha-wait");
    expect(html).toContain('<li class="roadmap-route__region" data-roadmap-region="Alpha">');
    expect(html).toContain('<section class="roadmap-region" aria-labelledby="');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('<ol class="roadmap-region__nodes">');
    expect(html.indexOf('data-roadmap-node="alpha-complete"')).toBeLessThan(html.indexOf('data-roadmap-node="alpha-wait"'));
    expect(html.match(/data-action="open-mission-sheet"/g)).toHaveLength(2);
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
  });

  it("defaults to the next mission chapter and renders nodes for only that region", () => {
    const html = renderRoadmapView(records);
    expect(html).toContain('data-active-region="Beta"');
    expect(html).toContain('<ol class="roadmap-route" aria-label="Ruta de objetivos">');
    expect(html).toContain('data-roadmap-region="Beta"');
    expect(html).toContain('data-roadmap-node="beta-next"');
    expect(html).toContain('data-roadmap-node="beta-other"');
    expect(html).not.toContain('data-roadmap-node="alpha-complete"');
    expect(html).not.toContain('data-roadmap-node="alpha-wait"');
    expect(html).not.toContain('data-roadmap-node="gamma-critical"');
    expect(html.match(/data-roadmap-node=/g)).toHaveLength(2);
  });

  it("honors an explicit chapter and only marks a selected node without rendering a second sheet", () => {
    const html = renderRoadmapView(records, { activeRegion: "Alpha", selectedRecordId: "alpha-wait" });
    expect(html).toContain('data-active-region="Alpha"');
    expect(html).toContain('data-selected-record-id="alpha-wait"');
    expect(html).toContain('data-roadmap-node="alpha-complete"');
    expect(html).toContain('data-roadmap-node="alpha-wait"');
    expect(html).not.toContain('data-roadmap-node="beta-next"');
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
    expect(html).not.toContain('data-mission-sheet');
    expect(html).not.toContain('role="dialog"');
  });

  it("switches to the first matching chapter when filters hide the active one", () => {
    const html = renderRoadmapView(records, { activeRegion: "Alpha", language: "ES" });
    expect(html).toContain('data-active-region="Beta"');
    expect(html).toContain('data-roadmap-region="Beta"');
    expect(html).toContain('data-roadmap-node="beta-next"');
    expect(html).toContain('data-roadmap-node="beta-other"');
    expect(html).not.toContain('data-roadmap-node="gamma-critical"');
    expect(html.match(/data-action="select-roadmap-region"/g)).toHaveLength(2);
  });

  it("keeps the route landmark and exposes a recoverable empty state", () => {
    const html = renderRoadmapView(records, { query: "no existe" });
    expect(html).toContain('<ol class="roadmap-route" aria-label="Ruta de objetivos"></ol>');
    expect(html).toContain('class="roadmap-empty" role="status"');
    expect(html).toContain('data-action="clear-roadmap-filters"');
    expect(html).not.toContain('data-roadmap-node=');
  });
});
