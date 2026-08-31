import { describe, expect, it } from "vitest";
import { groupRoadmapByRegion } from "../src/domain/roadmap";
import type { CollectionRecord, Want } from "../src/domain/model";
import {
  renderRoadmapFilters,
  renderRoadmapHero,
  renderRoadmapNode,
  renderRoadmapRegion,
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

describe("roadmap node rendering", () => {
  it("renders textual state, both tracks, optional bonus, actions, price, and an exact Cardmarket link", () => {
    const product = record("mega-dream", {
      catalog: {
        catalogId: "mega-dream",
        objectType: "box",
        name: "Mega Dream ex",
        setName: "High Class",
        sourceUrl: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes/Mega-Dream?idProduct=42&utm_source=owner",
      },
      holding: { quantity: 1, status: "owned", sealedQuantity: 1, openedQuantity: 0, language: "EN" },
      want: goal({
        targetSealedQuantity: 1,
        targetOpenedQuantity: 1,
        openGoalMode: "optional",
        urgency: "critical",
        tier: "S",
        priceCeilingMinor: 12000,
        currency: "EUR",
        actionNote: "Una para abrir y otra para guardar",
      }),
    });

    const html = renderRoadmapNode(product);
    expect(html).toContain("Completado");
    expect(html).toContain('data-goal-kind="sealed"');
    expect(html).toContain('data-goal-kind="opened"');
    expect(html).toContain("Guardar");
    expect(html).toContain("Abrir");
    expect(html).toContain("Bonus opcional");
    expect(html.match(/role="progressbar"/g)).toHaveLength(2);
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('data-action="add-sealed" data-record-id="mega-dream"');
    expect(html).toContain('data-action="add-opened" data-record-id="mega-dream"');
    expect(html).toContain('data-action="open-sealed" data-record-id="mega-dream"');
    expect(html).toContain('data-cardmarket-link="exact"');
    expect(html).toContain("https://www.cardmarket.com/en/Pokemon/Products?idProduct=42");
    expect(html).not.toContain("utm_source");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Ver producto exacto en Cardmarket");
    expect(html).toContain('data-price-ceiling-minor="12000"');
    expect(html).toContain("Urgencia Crítica");
    expect(html).toContain(">JP<");
    expect(html).toContain(">S<");
  });

  it("falls back to a bounded Cardmarket search and disables transfer with no sealed copy", () => {
    const html = renderRoadmapNode(record("search", {
      catalog: {
        catalogId: "search",
        objectType: "tin",
        name: "Mega Tin & Friends",
        sourceUrl: "javascript:alert(1)",
      },
      holding: { quantity: 1, status: "opened", sealedQuantity: 0, openedQuantity: 1 },
    }));

    expect(html).toContain('data-cardmarket-link="search"');
    expect(html).toContain("https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Mega+Tin+%26+Friends");
    expect(html).toContain("Buscar en Cardmarket");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('data-action="open-sealed" data-record-id="search" disabled aria-disabled="true"');
  });

  it("escapes all owner-controlled content and rejects lookalike Cardmarket hosts", () => {
    const hostile = record('id" onmouseover="alert(1)', {
      catalog: {
        catalogId: "hostile",
        objectType: "box",
        name: '<img src=x onerror="alert(1)">',
        setName: "</h4><script>alert(1)</script>",
        sourceUrl: "https://www.cardmarket.com.evil.example/product",
      },
      want: goal({
        goalLanguage: '"><svg onload=alert(1)>',
        tier: "<b>unsafe</b>",
        actionNote: "<script>alert(2)</script>",
      }),
    });

    const html = renderRoadmapNode(hostile);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("cardmarket.com.evil");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot; onmouseover=&quot;");
    expect(html).toContain('data-cardmarket-link="search"');
  });

  it("does not label seller or offer routes as exact products", () => {
    const html = renderRoadmapNode(record("seller-route", {
      catalog: {
        catalogId: "seller-route",
        objectType: "tin",
        name: "Safe fallback tin",
        sourceUrl: "https://www.cardmarket.com/en/Pokemon/Products/Sellers/Owner",
      },
    }));

    expect(html).toContain('data-cardmarket-link="search"');
    expect(html).not.toContain("/Products/Sellers/Owner");
  });
});

describe("roadmap hero, filters, regions, and complete view", () => {
  const records = [
    record("next", {
      catalog: { catalogId: "next", objectType: "box", name: "Next Quest", setName: "Alpha" },
      want: goal({ urgency: "critical", roadmapOrder: 2, segment: "Alpha", openGoalMode: "optional" }),
    }),
    record("complete", {
      catalog: { catalogId: "complete", objectType: "tin", name: "Complete Quest", setName: "Alpha" },
      holding: { quantity: 2, status: "owned", sealedQuantity: 1, openedQuantity: 1 },
      want: goal({ urgency: "high", roadmapOrder: 1, segment: "Alpha" }),
    }),
    record("spanish", {
      catalog: { catalogId: "spanish", objectType: "tin", name: "Caja española", setName: "Beta" },
      want: goal({ urgency: "wait", goalLanguage: "ES", roadmapOrder: 3, segment: "Beta" }),
    }),
  ];

  it("renders separate metrics, required aggregate progress, and the next actionable mission", () => {
    const html = renderRoadmapHero(records);
    expect(html).toContain('data-roadmap-metric="sealed"');
    expect(html).toContain('data-roadmap-metric="opened"');
    expect(html).toContain('data-roadmap-metric="complete"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain("Incluye bonus opcionales");
    expect(html).toContain("Next Quest");
    expect(html).toContain('data-action="focus-mission" data-record-id="next"');
  });

  it("renders labeled, selected filters and escapes a hostile query", () => {
    const html = renderRoadmapFilters(records, {
      query: '"><script>alert(1)</script>',
      type: "tin",
      urgency: "wait",
      language: "ES",
      status: "not-started",
    }, 1);
    expect(html).toContain('aria-label="Buscar y filtrar el mapa"');
    expect(html).toContain('value="tin" selected');
    expect(html).toContain('value="wait" selected');
    expect(html).toContain('value="ES" selected');
    expect(html).toContain('value="not-started" selected');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("<strong>1</strong> objetivos visibles");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("renders a region with accessible progress and an ordered list of nodes", () => {
    const region = groupRoadmapByRegion(records)[0]!;
    const html = renderRoadmapRegion(region);
    expect(html).toContain('<li class="roadmap-route__region"');
    expect(html).toContain('<section class="roadmap-region" aria-labelledby="');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('<ol class="roadmap-region__nodes">');
    expect(html.indexOf("Complete Quest")).toBeLessThan(html.indexOf("Next Quest"));
  });

  it("renders the full route as an ol and filters regions without changing hero totals", () => {
    const html = renderRoadmapView(records, { language: "ES" });
    expect(html).toContain('<ol class="roadmap-route" aria-label="Ruta de objetivos">');
    expect(html).toContain('data-roadmap-region="Beta"');
    expect(html).not.toContain('data-roadmap-region="Alpha"');
    expect(html).toContain("1 de 3");
    expect(html).toContain("Caja española");
  });

  it("keeps the route landmark and provides a recoverable empty state", () => {
    const html = renderRoadmapView(records, { query: "no existe" });
    expect(html).toContain('<ol class="roadmap-route" aria-label="Ruta de objetivos"></ol>');
    expect(html).toContain('class="roadmap-empty" role="status"');
    expect(html).toContain('data-action="clear-roadmap-filters"');
  });
});
