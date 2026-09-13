import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveClassLifecycle, deriveContentLifecycle } from "../../src/modules/content/lifecycle.js";

// #1046 steg B: ÉN tilstand for alt innhold i forfatterlistene, regnet ut av tjeneren.
//
// Før svarte API-et på tre måter (moduler: `status` i fem verdier; kurs: publishedAt+archivedAt;
// seksjoner: activeVersionId+archivedAt), og klienten regnet ut status tre ganger med tre ulike
// betingelser. Testen måler regelen der den bor, og at ingen liste-oppskrift på klienten regner
// selv lenger.

describe("#1046 steg B — deriveContentLifecycle", () => {
  it("arkivert slår alt", () => {
    expect(deriveContentLifecycle({ archivedAt: new Date(), activeVersionId: "v2", latestVersionId: "v3" })).toBe("archived");
    expect(deriveContentLifecycle({ archivedAt: "2026-09-01T00:00:00Z", publishedAt: new Date() })).toBe("archived");
  });

  it("versjonert innhold: live versjon → published; nyere versjon enn den live → published_with_draft; ingen live → draft", () => {
    expect(deriveContentLifecycle({ archivedAt: null, activeVersionId: "v2", latestVersionId: "v2" })).toBe("published");
    expect(deriveContentLifecycle({ archivedAt: null, activeVersionId: "v2", latestVersionId: "v3" })).toBe("published_with_draft");
    expect(deriveContentLifecycle({ archivedAt: null, activeVersionId: null, latestVersionId: "v1" })).toBe("draft");
    // Et tomt skall uten versjoner er også et utkast.
    expect(deriveContentLifecycle({ archivedAt: null, activeVersionId: null, latestVersionId: null })).toBe("draft");
  });

  it("uversjonert innhold (kurs): publishedAt → published, ellers draft", () => {
    expect(deriveContentLifecycle({ archivedAt: null, publishedAt: new Date() })).toBe("published");
    expect(deriveContentLifecycle({ archivedAt: null, publishedAt: null })).toBe("draft");
  });

  it("klasser: aktiv eller arkivert", () => {
    expect(deriveClassLifecycle({ archivedAt: null })).toBe("active");
    expect(deriveClassLifecycle({ archivedAt: new Date() })).toBe("archived");
  });
});

describe("#1046 steg B — alle fire listekallene bruker regelen, og ingen klient-oppskrift regner selv", () => {
  const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("de fire produsentene på tjeneren kaller deriveContentLifecycle/deriveClassLifecycle", () => {
    expect(les("../../src/modules/adminContent/adminContentQueries.ts")).toContain("lifecycle: deriveContentLifecycle(");
    expect(les("../../src/routes/adminCourses.ts")).toContain("lifecycle: deriveContentLifecycle(");
    expect(les("../../src/routes/adminSections.ts")).toContain("lifecycle: deriveContentLifecycle(");
    expect(les("../../src/routes/adminClasses.ts")).toContain("lifecycle: deriveClassLifecycle(");
  });

  it("⚠️ liste-oppskriftene leser `lifecycle`; de regner ikke tilstand av archivedAt/publishedAt/activeVersionId/status", () => {
    for (const fil of ["library", "courses", "sections", "classes"]) {
      const js = les(`../../public/static/admin-content-${fil}.js`);
      const start = js.indexOf("createListPage({");
      expect(start, `${fil}: fant ikke oppskriften — kontrollcase`).toBeGreaterThan(-1);
      // Oppskriften slutter der getListPage returnerer.
      const slutt = js.indexOf("return listPage;", start);
      const oppskrift = js.slice(start, slutt);
      for (const gammelt of [/\.archivedAt\b/, /\.publishedAt\b/, /\.activeVersionId\b/, /\.status\s*===/, /\.status\s*!==/]) {
        expect(oppskrift, `${fil}: ${gammelt} i oppskriften — tilstanden skal leses fra lifecycle`).not.toMatch(gammelt);
      }
      expect(oppskrift, `${fil}: oppskriften skal lese lifecycle`).toMatch(/lifecycleOf\(|lifecycleBadge\(/);
    }
  });
});
