import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

// #1046 nivå to: galleri over de SKJEMABASERTE skjermbildene — det man ser når et element i en
// liste er åpnet, og det man ser når noe nytt skal lages. Samme metode som listenivået: ekte
// skjermbilder fra stage, så en bruttoliste over det som kan gjøres likt, så anbefalt variant.
//
// Kjøres bare når UI_GALLERY_DIR er satt (og stage-token finnes). Skriver jpg per side.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const DIR = process.env.UI_GALLERY_DIR ?? "";
test.skip(!auth || !DIR, !auth ? `hopper over: ${reason}` : "hopper over: UI_GALLERY_DIR ikke satt");

type Side = { fil: string; navn: string; rute: string; vent?: string; handling?: (page: Page) => Promise<void> };

const headers = () => ({ authorization: `Bearer ${auth!.accessToken}` });
async function førsteId(url: string, plukk: (data: any) => string | undefined): Promise<string> {
  const svar = await fetch(`${BASE}${url}`, { headers: headers() });
  return plukk(await svar.json()) ?? "";
}
const modulId = () => førsteId("/api/admin/content/modules/library", (d) => (d.modules ?? []).find((m: any) => m.lifecycle === "published" || m.status === "published")?.id ?? d.modules?.[0]?.id);
const kursId = () => førsteId("/api/admin/content/courses", (d) => (d.courses ?? []).find((c: any) => c.lifecycle === "published")?.id ?? d.courses?.[0]?.id);
const seksjonId = () => førsteId("/api/admin/content/sections", (d) => d.sections?.[0]?.id);

const klikkFane = (id: string) => async (page: Page) => { await page.locator(`#${id}`).click().catch(() => undefined); };

const SIDER: Side[] = [
  // Lage nytt
  { fil: "20-ny-modul-dialog", navn: "Ny modul (dialog)", rute: "/admin-content", vent: "#createModuleBtn",
    handling: async (page) => { await page.locator("#createModuleBtn").click(); await page.locator("#createModuleDialog[open]").waitFor({ timeout: 5000 }).catch(() => undefined); } },
  { fil: "21-nytt-kurs", navn: "Nytt kurs (side)", rute: "/admin-content/courses/new", vent: "#pageContent form, #pageContent input" },
  { fil: "22-ny-seksjon", navn: "Ny seksjon (editor)", rute: "/admin-content/sections?new", vent: "#titleInput" },
  { fil: "23-ny-klasse", navn: "Ny klasse (prompt — kan ikke fotograferes, se merknad)", rute: "/admin-content/classes", vent: "#newClassBtn" },
  // Det åpnede elementet
  { fil: "30-modul-rediger", navn: "Modul: Rediger-fanen", rute: "MODUL", vent: "#tabEdit", handling: klikkFane("tabEdit") },
  { fil: "31-modul-forhandsvis", navn: "Modul: Forhåndsvis-fanen", rute: "MODUL", vent: "#tabPreview", handling: klikkFane("tabPreview") },
  { fil: "32-modul-innstillinger", navn: "Modul: Innstillinger-fanen", rute: "MODUL", vent: "#tabSettings", handling: klikkFane("tabSettings") },
  { fil: "33-kurs-detalj", navn: "Kurs: åpnet", rute: "KURS", vent: "#detailPageTitle, .module-list-item" },
  { fil: "34-seksjon-editor", navn: "Seksjon: åpnet (editor)", rute: "SEKSJON", vent: "#titleInput" },
  { fil: "35-klasse-detalj", navn: "Klasse: åpnet", rute: "/admin-content/classes", vent: "#classesTableBody",
    handling: async (page) => { await page.locator('#classesTableBody [data-action="open"]').first().click().catch(() => undefined); await page.locator("#memberChips, #backToClasses").first().waitFor({ timeout: 10_000 }).catch(() => undefined); } },
  { fil: "36-kvalitet-valgt-modul", navn: "Vurderingskvalitet: modul valgt (terskelskjema)", rute: "/admin-content/calibration", vent: "#qModuleSelect",
    handling: async (page) => { await page.locator("#qModuleSelect").selectOption({ index: 1 }).catch(() => undefined); await page.locator("#qThresholdCard:not([hidden])").waitFor({ timeout: 15_000 }).catch(() => undefined); } },
  { fil: "37-manuell-behandling-valgt", navn: "Manuell behandling: sak valgt", rute: "/review", vent: "#manualReviewQueueBody",
    handling: async (page) => { await page.locator("#manualReviewQueueBody tr").first().click().catch(() => undefined); } },
  { fil: "38-plattform", navn: "Plattforminnstillinger (skjema)", rute: "/admin-platform", vent: "#failedAssessmentsBody" },
  { fil: "39-profil", navn: "Profil (skjema)", rute: "/profile", vent: "#coursesBody" },
  // Deltakerens skjema
  { fil: "40-deltaker-modul", navn: "Deltaker: modul åpnet (svarskjema)", rute: "/participant", vent: ".course-accordion-item",
    handling: async (page) => {
      await page.locator(".course-accordion-header").first().click().catch(() => undefined);
      await page.locator(".course-module-row").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await page.locator(".course-module-row").first().click().catch(() => undefined);
      await page.locator("#moduleListSection, #assessmentForm, .module-card, #promptText").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    } },
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

test.describe.configure({ mode: "serial" });
for (const side of SIDER) {
  test(`skjermbilde: ${side.navn}`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await forberedSide(page);
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignorer */ } });
    let rute = side.rute;
    if (rute === "MODUL") rute = `/admin-content/module/${encodeURIComponent(await modulId())}/conversation`;
    if (rute === "KURS") rute = `/admin-content/courses/${encodeURIComponent(await kursId())}`;
    if (rute === "SEKSJON") rute = `/admin-content/sections?id=${encodeURIComponent(await seksjonId())}`;
    await page.goto(`${BASE}${rute}`, { waitUntil: "domcontentloaded" });
    if (side.vent) await page.locator(side.vent).first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    if (side.handling) { await side.handling(page); await page.waitForLoadState("networkidle").catch(() => undefined); }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(DIR, `${side.fil}.jpg`), fullPage: true, type: "jpeg", quality: 70 });
  });
}
