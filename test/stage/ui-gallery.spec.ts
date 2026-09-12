import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

// #1046 (spor 1 — utseende): ett skjermbilde per side, samme bredde, ekte stage-data. Ingen
// påstander; dette er et galleri for øyne, ikke en test. Kjøres med:
//   UI_GALLERY_DIR=<mappe> npx playwright test --config playwright.stage.config.ts test/stage/ui-gallery.spec.ts
// Uten UI_GALLERY_DIR hoppes den over, så den ikke fyller stage-suiten med bilder.
//
// Auth-veien er den samme som ui-surfaces.spec.ts: klienten tror den er i mock, serveren ser et
// ekte token. Tokenet leses fra .stage-auth.json og skal aldri logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const DIR = process.env.UI_GALLERY_DIR ?? "";
test.skip(!auth || !DIR, !auth ? `hopper over: ${reason}` : "hopper over: UI_GALLERY_DIR ikke satt");

// `handling` gjør det en bruker ville gjort først, så bildet viser innhold og ikke en tom startskjerm.
const SIDER: Array<{ fil: string; navn: string; rute: string; vent?: string; handling?: (page: Page) => Promise<void> }> = [
  { fil: "01-mine-kurs", navn: "Deltaker: Mine kurs", rute: "/participant", vent: ".course-accordion-item, #moduleList" },
  { fil: "02-fullforte", navn: "Deltaker: Fullførte", rute: "/participant/completed", vent: "#courseCertList" },
  { fil: "03-profil", navn: "Deltaker: Profil", rute: "/profile", vent: "#coursesBody" },
  { fil: "04-sensor", navn: "Sensor: køer", rute: "/review", vent: "#manualReviewQueueBody" },
  { fil: "05-rapporter", navn: "Rapporter", rute: "/results", vent: "#completionBody", handling: async (page) => { await page.locator("#loadResults").click().catch(() => undefined); } },
  { fil: "06-kullstatus", navn: "Kullstatus", rute: "/deltakere/status", vent: "#courseSelect", handling: async (page) => { await page.locator("#courseSelect").selectOption({ index: 1 }).catch(() => undefined); } },
  { fil: "07-admin-plattform", navn: "Admin: plattform", rute: "/admin-platform", vent: "#failedAssessmentsBody" },
  // /admin-content ER biblioteket (modulvelgeren); samtalen ligger under /module/:id/conversation.
  { fil: "08-forfatter-bibliotek", navn: "Forfatter: bibliotek", rute: "/admin-content" },
  { fil: "09-forfatter-samtale", navn: "Forfatter: modul (samtale)", rute: "MODUL", vent: "#previewContent, #chatLog, main" },
  { fil: "10-forfatter-kurs", navn: "Forfatter: kurs", rute: "/admin-content/courses" },
  { fil: "11-forfatter-seksjoner", navn: "Forfatter: seksjoner", rute: "/admin-content/sections" },
  { fil: "12-forfatter-klasser", navn: "Forfatter: klasser", rute: "/admin-content/classes" },
  { fil: "13-forfatter-kalibrering", navn: "Forfatter: kalibrering", rute: "/admin-content/calibration" },
];

let configCache: Record<string, unknown> | null = null;
async function hentConfig(): Promise<Record<string, unknown>> {
  if (configCache) return configCache;
  const svar = await fetch(`${BASE}/participant/config`);
  configCache = (await svar.json()) as Record<string, unknown>;
  return configCache;
}
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => {
    await r.continue({ headers: { ...r.request().headers(), authorization: `Bearer ${auth!.accessToken}` } });
  });
  const config = await hentConfig();
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...config, authMode: "mock" }) }),
  );
}

async function førstePubliserteModulId(): Promise<string> {
  const svar = await fetch(`${BASE}/api/admin/content/modules/library`, { headers: { authorization: `Bearer ${auth!.accessToken}` } });
  const data = (await svar.json()) as { modules?: Array<{ id: string; status?: string }> };
  const m = (data.modules ?? []).find((x) => x.status === "published") ?? (data.modules ?? [])[0];
  return m?.id ?? "";
}

test.describe.configure({ mode: "serial" });
for (const side of SIDER) {
  test(`skjermbilde: ${side.navn}`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await forberedSide(page);
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignorer */ } });
    const rute = side.rute === "MODUL" ? `/admin-content/module/${encodeURIComponent(await førstePubliserteModulId())}/conversation` : side.rute;
    await page.goto(`${BASE}${rute}`, { waitUntil: "domcontentloaded" });
    if (side.vent) await page.locator(side.vent).first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    if (side.handling) { await side.handling(page); await page.waitForLoadState("networkidle").catch(() => undefined); }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(DIR, `${side.fil}.jpg`), fullPage: true, type: "jpeg", quality: 70 });
  });
}
