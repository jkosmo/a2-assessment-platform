import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.102.0 mot UTRULLET stage, med ekte API, ekte klient og ekte oversetter:
//   - administrator lager et tema på bokmål, og nynorsk og engelsk fylles inn av oversetteren;
//   - kurset får temaet, og «Mine kurs» viser det under temaet, med valget for alfabetisk;
//   - slettes temaet, mister kurset det, og kurset står.
//
// Det testen skriver på stage: «Stage-test 2.102 …»-tema, -seksjon og -kurs, som ryddes til slutt.
// Kurset er publisert mens testen går, og står da i «Mine kurs» for alle på stage.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const stempel = Date.now();

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.102.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => {
    await vent();
    await r.continue({ headers: { ...r.request().headers(), ...hoder() } });
  });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.locale", "nb");
      localStorage.removeItem("a2.mineKurs.view");
    } catch { /* ignore */ }
  });
}

const temaNavn = `Stage-test 2.102 tema ${stempel}`;
let temaId = "";
let kursId = "";
let seksjonId = "";

test.afterAll(async () => {
  if (temaId) noter("slett testtema", (await api("DELETE", `/api/admin/content/themes/${temaId}`)).status);
  if (kursId) {
    await api("POST", `/api/admin/content/courses/${kursId}/unpublish`);
    await api("POST", `/api/admin/content/courses/${kursId}/archive`);
    noter("slett testkurs", (await api("DELETE", `/api/admin/content/courses/${kursId}`)).status);
  }
  if (seksjonId) {
    await api("POST", `/api/admin/content/sections/${seksjonId}/archive`);
    noter("slett testseksjon", (await api("DELETE", `/api/admin/content/sections/${seksjonId}`)).status);
  }
});

test("versjonen er 2.104.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.104.0");
});

test("Tema-siden: administrator lager et tema på bokmål, og oversetteren fyller nynorsk og engelsk", async ({ page }) => {
  test.setTimeout(150_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${BASE}/admin-content/themes`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#newThemeBtn")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#contentAreaNav a").first()).toHaveAttribute("id", "navTema");

  await page.locator("#newThemeBtn").click();
  await page.locator("#themeName-nb").fill(temaNavn);
  await page.locator("#themeDialogSaveBtn").click();
  await expect(page.locator("#themeDialog")).toBeHidden({ timeout: 90000 });

  const liste = await api("GET", "/api/admin/content/themes");
  const tema = liste.json.themes.find((t: { name: string }) => JSON.parse(t.name).nb === temaNavn);
  expect(tema, "temaet ble ikke lagret").toBeTruthy();
  temaId = tema.id;
  const navn = JSON.parse(tema.name);
  noter("oversatt", navn);
  expect(String(navn.nn ?? "").trim()).not.toBe("");
  expect(String(navn["en-GB"] ?? "").trim()).not.toBe("");
});

test("kurset får temaet, og «Mine kurs» viser det under temaet — og alfabetisk ved valg", async ({ page }) => {
  test.setTimeout(150_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: tre(`Stage-test 2.102 del ${stempel}`), bodyMarkdown: tre("Innhold.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  seksjonId = seksjon.json.section.id;
  expect((await api("POST", `/api/admin/content/sections/${seksjonId}/publish`)).status).toBe(200);
  const kurs = await api("POST", "/api/admin/content/courses", { title: tre(`Stage-test 2.102 kurs ${stempel}`), certificationLevel: "basic", themeIds: [temaId] });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${kursId}/items`, { items: [{ type: "SECTION", sectionId: seksjonId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${kursId}/publish`)).status).toBe(200);

  const detalj = await api("GET", `/api/admin/content/courses/${kursId}`);
  expect(detalj.json.course.themeIds).toEqual([temaId]);
  const mine = await api("GET", "/api/courses");
  const rad = mine.json.courses.find((c: { id: string }) => c.id === kursId);
  noter("Mine kurs-API", { themes: rad?.themes, antallTema: mine.json.themes?.length });
  expect(rad.themes).toEqual([{ id: temaId, name: temaNavn }]);
  expect(mine.json.themes.some((t: { id: string }) => t.id === temaId)).toBe(true);

  await forberedSide(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
  const overskrift = page.locator(".course-theme-heading", { hasText: temaNavn });
  await expect(overskrift).toBeVisible({ timeout: 45000 });
  // Kurset står rett under sitt tema.
  const rett = await page.locator("#courseAccordion").evaluate((root, navn) => {
    const els = [...root.querySelectorAll(".course-theme-heading, .course-accordion-title")];
    const i = els.findIndex((el) => el.textContent === navn);
    return els[i + 1]?.textContent ?? null;
  }, temaNavn);
  expect(rett).toBe(`Stage-test 2.102 kurs ${stempel}`);
  const bredde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  noter("overflyt 390", bredde);
  expect(bredde).toBeLessThanOrEqual(0);

  await page.locator('.course-view-btn[data-view="alphabetical"]').click();
  await expect(page.locator(".course-theme-heading")).toHaveCount(0);
  await expect(page.locator(`.course-accordion-item[data-course-id="${kursId}"]`)).toHaveCount(1);
});

test("slettes temaet, mister kurset det, og kurset står", async () => {
  const slettet = await api("DELETE", `/api/admin/content/themes/${temaId}`);
  noter("slett tema", slettet.json);
  expect(slettet.status).toBe(200);
  expect(slettet.json.detachedCourseCount).toBe(1);
  temaId = "";
  const detalj = await api("GET", `/api/admin/content/courses/${kursId}`);
  expect(detalj.status).toBe(200);
  expect(detalj.json.course.themeIds).toEqual([]);
});
