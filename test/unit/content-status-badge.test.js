import { describe, it, expect } from "vitest";
import {
  lifecycleStatusBadge,
  moduleLibraryStatusBadge,
} from "../../public/static/content-status-badge.js";

// #705: the three admin lists (Kurs/Moduler/Seksjoner) must render ONE status vocabulary via this
// shared module — Utkast/Publisert/Arkivert with the same `status-badge--{status}` classes.
const LABELS = {
  "adminContent.lifecycle.status.draft": "Utkast",
  "adminContent.lifecycle.status.published": "Publisert",
  "adminContent.lifecycle.status.archived": "Arkivert",
  "adminContent.lifecycle.newerDraft": "Nyere utkast",
};
const t = (key) => LABELS[key] ?? key;

describe("#705 shared content status badge", () => {
  it("renders the unified three-state vocabulary + classes", () => {
    expect(lifecycleStatusBadge("draft", t)).toBe(
      '<span class="status-badge status-badge--draft">Utkast</span>',
    );
    expect(lifecycleStatusBadge("published", t)).toBe(
      '<span class="status-badge status-badge--published">Publisert</span>',
    );
    expect(lifecycleStatusBadge("archived", t)).toBe(
      '<span class="status-badge status-badge--archived">Arkivert</span>',
    );
  });

  it("appends a secondary chip when asked, without changing the primary word", () => {
    const html = lifecycleStatusBadge("published", t, { chipKey: "adminContent.lifecycle.newerDraft" });
    expect(html).toContain("status-badge--published");
    expect(html).toContain(">Publisert<");
    expect(html).toContain('<span class="status-chip">Nyere utkast</span>');
  });

  it("collapses the module library five-state to the shared three-state (+chip)", () => {
    // archived / published map straight through.
    expect(moduleLibraryStatusBadge("archived", t)).toContain("status-badge--archived");
    expect(moduleLibraryStatusBadge("published", t)).toBe(
      '<span class="status-badge status-badge--published">Publisert</span>',
    );
    // empty shell (ready) and never-published (unpublished_draft) → Utkast.
    expect(moduleLibraryStatusBadge("ready", t)).toContain("status-badge--draft");
    expect(moduleLibraryStatusBadge("unpublished_draft", t)).toContain("status-badge--draft");
    // published + newer unpublished draft → Publisert + «nyere utkast»-chip (nothing lost).
    const pwd = moduleLibraryStatusBadge("published_with_draft", t);
    expect(pwd).toContain("status-badge--published");
    expect(pwd).toContain(">Publisert<");
    expect(pwd).toContain('<span class="status-chip">Nyere utkast</span>');
  });
});

// #1046 steg B: tjeneren leverer `lifecycle`; klienten leser ordet. Én reserve for gamle svar
// (og testers mock-data) — ett sted, ikke ett per side.
import { lifecycleOf, lifecycleBadge, matchesLifecycleFilter } from "../../public/static/content-status-badge.js";

describe("#1046 steg B — lifecycleOf / lifecycleBadge / matchesLifecycleFilter", () => {
  it("leser tjenerens ord først, og faller tilbake på de gamle feltene når det mangler", () => {
    expect(lifecycleOf({ lifecycle: "published_with_draft", archivedAt: "x" })).toBe("published_with_draft");
    expect(lifecycleOf({ archivedAt: "2026-09-01" })).toBe("archived");
    expect(lifecycleOf({ status: "published_with_draft" })).toBe("published_with_draft");
    expect(lifecycleOf({ status: "ready" })).toBe("draft");
    expect(lifecycleOf({ activeVersionId: "v1", archivedAt: null })).toBe("published");
    expect(lifecycleOf({ activeVersionId: null, archivedAt: null })).toBe("draft");
    expect(lifecycleOf({ publishedAt: "2026-09-01", archivedAt: null })).toBe("published");
    expect(lifecycleOf({ publishedAt: null, archivedAt: null })).toBe("draft");
    expect(lifecycleOf({ name: "Klasse", archivedAt: null })).toBe("active");
  });

  it("merket: published_with_draft gir Publisert + «nyere utkast»; klasser uten arkivering får ikke merke", () => {
    expect(lifecycleBadge({ lifecycle: "published_with_draft" }, t)).toBe(
      '<span class="status-badge status-badge--published">Publisert</span> <span class="status-chip">Nyere utkast</span>',
    );
    expect(lifecycleBadge({ lifecycle: "draft" }, t)).toContain("status-badge--draft");
    expect(lifecycleBadge({ lifecycle: "archived" }, t)).toContain("status-badge--archived");
    expect(lifecycleBadge({ lifecycle: "active" }, t)).toBe("");
  });

  it("filterknappene: én regel for alle listene", () => {
    const rader = ["draft", "published", "published_with_draft", "archived", "active"].map((lifecycle) => ({ lifecycle }));
    const treff = (key) => rader.filter((r) => matchesLifecycleFilter(r, key)).map((r) => r.lifecycle);
    expect(treff("all")).toEqual(["draft", "published", "published_with_draft", "archived", "active"]);
    expect(treff("active")).toEqual(["draft", "published", "published_with_draft", "active"]);
    expect(treff("archived")).toEqual(["archived"]);
    expect(treff("published")).toEqual(["published", "published_with_draft"]);
    // v1.2.20 (#460): aldri publisert OG live med et nyere utkast.
    expect(treff("unpublished_draft")).toEqual(["draft", "published_with_draft"]);
  });
});
