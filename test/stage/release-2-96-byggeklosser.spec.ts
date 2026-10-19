import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.96.0 mot UTRULLET stage: steg for steg (#1075), skriv selv (#1076) og repetisjonskort (#1078) —
// hele kjeden med den ekte tjeneren: importert, tegnet og renset av tjeneren, vist i forhåndsvisningen
// i seksjonsredigeringen, og brukt av en deltaker i et publisert kurs, på PC- og telefonbredde.
//
// Det testen skriver på stage: én testseksjon og ett testkurs med navn som begynner på
// «Stage-test byggeklosser». Kurset publiseres for at deltakervisningen skal kunne måles, og begge
// slettes til slutt (STAGE_BEHOLD=1 lar kurset stå, så det kan ses på en ekte telefon).
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.
// Lokal prøvekjøring: STAGE_LOKAL=http://127.0.0.1:3001 (appen i mock-modus mot testdatabasen).

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin", "x-user-roles": "ADMINISTRATOR" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const VENT_MS = 45000;
const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.96 byggeklosser", hva, verdi: String(verdi) })}\n`, "utf8");
};
const bilde = (page: Page, navn: string) => { fs.mkdirSync(RAPPORT, { recursive: true }); return page.screenshot({ path: path.join(RAPPORT, `${navn}.png`), fullPage: false }); };

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(tekst) as Record<string, unknown>; } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const stempel = Date.now();
const TITTEL_START = "Stage-test byggeklosser ";
const TITTEL = `${TITTEL_START}${stempel}`;
const three = (tekst: string) => ({ nb: tekst, nn: tekst, "en-GB": tekst });
const SVAR = `Stage-test ${stempel}: vedtaket flyttes til torsdag.`;
const MARKDOWN = [
  "Laget av den automatiske stage-testen. Kan slettes.",
  "",
  ":::steg Slik behandler du en innsynsbegjæring",
  "### Registrer begjæringen",
  "Før den inn i saksarkivet samme dag, med dato for mottak.",
  "",
  "### Finn dokumentene",
  "Søk i arkivet etter alt begjæringen gjelder.",
  "",
  "### Svar og begrunn",
  "Send svaret med dokumentene.",
  ":::",
  "",
  ":::skriv Skriv vedtakspunktet for at styremøtene flyttes fra tirsdag til torsdag.",
  "**Vedtak:** Styremøtene flyttes fra tirsdag til torsdag kl. 09.00, gjeldende fra 1. november.",
  "",
  "- [ ] hva som ble bestemt, med dag og klokkeslett?",
  "- [ ] fra når det gjelder?",
  ":::",
  "",
  ":::repetisjon Fagord i møtearbeid",
  "### Vedtak",
  "Det møtet bestemte, med ansvarlig og frist.",
  "",
  "### Referent",
  "Den som skriver referatet.",
  ":::",
].join("\n");

let sectionId = "";
let courseId = "";
const behold = process.env.STAGE_BEHOLD === "1";

async function slettKurs(id: string) {
  await api("POST", `/api/admin/content/courses/${id}/unpublish`);
  await api("POST", `/api/admin/content/courses/${id}/archive`);
  return api("DELETE", `/api/admin/content/courses/${id}`);
}
async function slettSeksjon(id: string) {
  await api("POST", `/api/admin/content/sections/${id}/archive`);
  return api("DELETE", `/api/admin/content/sections/${id}`);
}
const erTestens = (tittel: unknown): boolean => JSON.stringify(tittel ?? "").includes(TITTEL_START);

test.beforeAll(async () => {
  if (!lokal && !auth) return;
  const kurs = ((await api("GET", "/api/admin/content/courses")).json.courses ?? []) as Array<{ id: string; title: unknown }>;
  const seksjoner = ((await api("GET", "/api/admin/content/sections")).json.sections ?? []) as Array<{ id: string; title: unknown }>;
  let slettet = 0;
  for (const k of kurs.filter((k) => erTestens(k.title))) if ((await slettKurs(k.id)).status < 300) slettet++;
  for (const s of seksjoner.filter((s) => erTestens(s.title))) if ((await slettSeksjon(s.id)).status < 300) slettet++;
  if (slettet > 0) noter("opprydding før start", `${slettet} testkurs/-seksjoner fra en tidligere kjøring er slettet`);
});

test.afterAll(async () => {
  if (behold) {
    if (courseId) noter("STÅR IGJEN PÅ STAGE (for å se på en ekte telefon)", `kurset «${TITTEL}» — slettes av neste kjøring`);
    return;
  }
  if (courseId) {
    const slettet = await slettKurs(courseId);
    noter("opprydding: testkurset", slettet.status < 300 ? "slettet" : `IKKE slettet (${slettet.status}: ${slettet.tekst.slice(0, 120)})`);
  }
  if (sectionId) {
    const slettet = await slettSeksjon(sectionId);
    noter("opprydding: testseksjon", slettet.status === 204 ? "slettet" : `IKKE slettet (${slettet.status}: ${slettet.tekst.slice(0, 120)})`);
  }
});

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => { await vent(); await r.continue({ headers: { ...r.request().headers(), ...hoder() } }); });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function åpneSeksjonSomDeltaker(page: Page) {
  await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
  const kurs = page.locator(".course-accordion-header").filter({ hasText: TITTEL }).first();
  await expect(kurs).toBeVisible({ timeout: VENT_MS });
  await kurs.click();
  const rad = page.locator(".course-item").filter({ hasText: TITTEL }).locator(".course-module-row").first();
  await expect(rad).toBeVisible({ timeout: VENT_MS });
  await rad.click();
  await expect(page.locator('#sectionReaderBody .content-steps[data-ready="true"]')).toBeVisible({ timeout: VENT_MS });
}

test.describe("2.96 — steg, skriv selv og repetisjonskort på stage", () => {
  test("seksjonen importeres, og tjeneren tegner og renser de tre blokkene", async () => {
    const pakke = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "section",
      section: { title: three(TITTEL), bodyMarkdown: three(MARKDOWN), audit: {}, assets: [] },
    };
    const importert = await api("POST", "/api/admin/content/sections/import", { payload: pakke, mode: "createNew" });
    expect(importert.status, importert.tekst.slice(0, 400)).toBe(201);
    sectionId = importert.json.sectionId as string;

    const html = (await api("POST", "/api/admin/content/sections/preview", { markdown: MARKDOWN, locale: "nb" })).json.html as string;
    expect((html.match(/<li class="content-step">/g) ?? []).length).toBe(3);
    expect(html).toContain('data-count="Steg {n} av {total}"');
    expect(html).toMatch(/<textarea class="content-write-field" data-write-field="" rows="4" aria-label="Skriv vedtakspunktet/);
    expect((html.match(/<input type="checkbox">/g) ?? []).length).toBe(2);
    expect(html).toContain('<summary class="content-write-show">Vis eksempelsvar</summary>');
    expect((html.match(/<dt class="content-flash-front">/g) ?? []).length).toBe(2);
    const en = (await api("POST", "/api/admin/content/sections/preview", { markdown: MARKDOWN, locale: "en-GB" })).json.html as string;
    expect(en).toContain('data-count="Step {n} of {total}"');
    noter("gjengivelsen på tjeneren", "3 steg i <ol>, tekstfelt + 2 avkrysningsbokser + <details>, 2 kort i <dl>; etikettene følger språket");
  });

  test("forhåndsvisningen i editoren: gjennomgangen blar, og kortene er en øving", async ({ page }) => {
    await forberedSide(page);
    await page.goto(`${BASE}/admin-content/sections?id=${sectionId}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-form-tab-btn="forhandsvisning"]').click({ timeout: VENT_MS });
    const steg = page.locator('#previewPane .content-steps[data-ready="true"]');
    await expect(steg).toBeVisible({ timeout: VENT_MS });
    await steg.locator("[data-steps-next]").click();
    await expect(steg.locator(".content-steps-count")).toContainText("Steg 2 av 3");
    await expect(page.locator('#previewPane .content-flash[data-ready="true"] [data-flash-card]')).toBeVisible();
    noter("forhåndsvisning", "steg 2 av 3 etter Neste; repetisjonskortene vises som øving");
  });

  test("seksjonen publiseres og legges i et publisert testkurs", async () => {
    const publisert = await api("POST", `/api/admin/content/sections/${sectionId}/publish`);
    expect(publisert.status, publisert.tekst.slice(0, 300)).toBe(200);
    const kurs = await api("POST", "/api/admin/content/courses", { title: three(TITTEL) });
    expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
    courseId = (kurs.json.course as { id: string }).id;
    const innhold = await api("PUT", `/api/admin/content/courses/${courseId}/items`, { items: [{ type: "SECTION", sectionId }] });
    expect(innhold.status, innhold.tekst.slice(0, 300)).toBe(204);
    const kursPublisert = await api("POST", `/api/admin/content/courses/${courseId}/publish`);
    expect(kursPublisert.status, kursPublisert.tekst.slice(0, 300)).toBe(200);
  });

  test("deltakeren, PC: blar med knapp og piltast, skriver og finner teksten igjen, snur og markerer kort", async ({ page }) => {
    await forberedSide(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await åpneSeksjonSomDeltaker(page);
    const rot = page.locator("#sectionReaderBody");

    const steg = rot.locator(".content-steps");
    await expect(steg.locator("[data-steps-prev]")).toHaveAttribute("aria-disabled", "true");
    await steg.locator("[data-steps-next]").click();
    await page.keyboard.press("ArrowRight");
    await expect(steg.locator(".content-steps-count")).toContainText("Steg 3 av 3");
    await expect(steg.locator("[data-steps-next]")).toHaveAttribute("aria-disabled", "true");

    await rot.locator(".content-write-field").fill(SVAR);
    await rot.locator(".content-write-show").click();
    await expect(rot.locator(".content-write-example")).toBeVisible();
    await rot.getByRole("checkbox", { name: "fra når det gjelder?" }).check();

    const kort = rot.locator("[data-flash-card]");
    await kort.click();
    await rot.getByRole("button", { name: "Øv mer" }).click();
    await kort.click();
    await rot.getByRole("button", { name: "Kunne det" }).click();
    await expect(rot.locator(".content-flash-score")).toHaveText("Du kunne 1 av 2.");
    await bilde(page, "2-96-deltaker-1280");

    await page.reload({ waitUntil: "domcontentloaded" });
    await åpneSeksjonSomDeltaker(page);
    await expect(page.locator("#sectionReaderBody .content-write-field")).toHaveValue(SVAR);
    noter("deltaker, PC", "steg 3 av 3 med Neste låst; teksten står der etter omlasting; «Du kunne 1 av 2»");
  });

  test("deltakeren, telefon (390 px): ingenting går ut av leseren", async ({ page }) => {
    await forberedSide(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await åpneSeksjonSomDeltaker(page);
    const rot = page.locator("#sectionReaderBody");
    await rot.locator(".content-write-show").click();
    await rot.locator("[data-flash-card]").click();
    const utenfor = await rot.evaluate((el) => {
      const kant = el.getBoundingClientRect().right + 0.5;
      return [...el.querySelectorAll<HTMLElement>("*")].filter((x) => { const b = x.getBoundingClientRect(); return b.width > 1 && b.height > 1 && b.right > kant; }).length;
    });
    expect(utenfor, "ingenting går ut av leseren").toBe(0);
    const sidelengs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sidelengs).toBeLessThanOrEqual(0);
    await bilde(page, "2-96-deltaker-390");
    noter("deltaker, telefon", "ingen elementer utenfor leseren, ingen sideveis rulling");
  });
});
