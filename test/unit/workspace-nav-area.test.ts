import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildWorkspaceNavigationItems } from "../../src/config/capabilities.js";
// @ts-expect-error — public/participant-console-state.js er en nettlesermodul uten .d.ts; testen bruker
// bare de rene funksjonene.
import { resolveWorkspaceNavigationItems, sanitizeWorkspaceNavigationItems } from "../../public/participant-console-state.js";

// 2.126.0 (produkteier 2026-11-01: «det bør uansett være tydelig hvor man er»). Toppmenyen markerte
// bare punktet når adressen var nøyaktig lenkas: på Moduler, Tema, Seksjoner, et åpent kurs,
// Fullførte, Manuell behandling og Resultater var INGENTING markert.
//
// Regelen testes mot sidene appen faktisk serverer — lest fra src/app.ts — så en ny side uten
// område blir rød her, ikke oppdaget av produkteier.

const ALL_ROLES = "PARTICIPANT,SUBJECT_MATTER_OWNER,ADMINISTRATOR,REVIEWER,APPEAL_HANDLER,REPORT_READER";
const items = buildWorkspaceNavigationItems([]);

function activeIds(pathname: string) {
  return resolveWorkspaceNavigationItems(items, ALL_ROLES, pathname)
    .filter((item: { active: boolean }) => item.active)
    .map((item: { id: string }) => item.id);
}

/** Sidene med toppmeny: hver `app.get` som sender en HTML-fil med `id="workspaceNav"`. */
function pagesWithMenu(): string[] {
  const source = fs.readFileSync(path.resolve("src/app.ts"), "utf8");
  const pages: string[] = [];
  const route = /app\.get\("([^"]+)",[^]*?(?=\napp\.|$)/g;
  for (const match of source.matchAll(route)) {
    const html = /sendFile\(path\.resolve\(process\.cwd\(\), "public", "([^"]+\.html)"\)\)/.exec(match[0]);
    if (!html) continue;
    const file = fs.readFileSync(path.resolve("public", html[1]), "utf8");
    if (file.includes('id="workspaceNav"')) pages.push(match[1].replace(/:[A-Za-z]+/g, "x"));
  }
  return pages;
}

describe("toppmenyen markerer området man står i", () => {
  it("finner sidene med toppmeny i src/app.ts (vakt mot at lesingen stille finner ingenting)", () => {
    const pages = pagesWithMenu();
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(pages).toEqual(expect.arrayContaining(["/participant", "/admin-content/themes", "/review", "/profile"]));
  });

  it("hver side med toppmeny har nøyaktig ett markert punkt", () => {
    const uten = pagesWithMenu().map((page) => [page, activeIds(page)] as const).filter(([, ids]) => ids.length !== 1);
    expect(uten).toEqual([]);
  });

  it.each([
    ["/admin-content", "admin-content"],
    ["/admin-content/themes", "admin-content"],
    ["/admin-content/sections", "admin-content"],
    ["/admin-content/courses/abc123", "admin-content"],
    ["/admin-content/module/m1/conversation", "admin-content"],
    ["/admin-content/calibration", "admin-content"],
    ["/deltakere/aktivitet", "deltakere"],
    ["/review", "deltakere"],
    ["/results", "deltakere"],
    ["/deltakere/status", "deltakere"],
  ])("%s → %s", (page, id) => {
    expect(activeIds(page)).toEqual([id]);
  });

  it("et område tar ikke naboer med samme begynnelse (/participant-activity er ikke /participant)", () => {
    expect(activeIds("/participant-activity")).toEqual([]);
    expect(activeIds("/reviewer")).toEqual([]);
  });

  it("områdets adresser overlever rensingen i klienten", () => {
    const [admin] = sanitizeWorkspaceNavigationItems([{ id: "a", path: "/a/b", labelKey: "k", areaPaths: ["/a", "ugyldig", 3] }]);
    expect(admin).toEqual({ id: "a", path: "/a/b", labelKey: "k", requiredRoles: [], areaPaths: ["/a"] });
  });
});
