import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.101.0 mot UTRULLET stage, med ekte API og ekte klient:
//   - etter «Oppdater dette kurset» ligger den nye versjonen klar, kurssiden spør straks, og «Publiser
//     alle» publiserer den (API og dialog);
//   - moduloversikten husker filteret når man kommer tilbake.
//
// Ikke prøvd her: revisjonsspørsmålet med beståtte og e-posten. Det krever en deltaker som har bestått,
// og et varsel til en ekte adresse — det dekkes av integrasjonstesten (outbox-raden og teksten).
//
// Det testen skriver på stage: «Stage-test 2.101 …»-seksjoner og -kurs, som ryddes til slutt.
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
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.101.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

const kursIder: string[] = [];
const seksjonIder: string[] = [];

test.afterAll(async () => {
  for (const id of kursIder) {
    await api("POST", `/api/admin/content/courses/${id}/unpublish`);
    await api("POST", `/api/admin/content/courses/${id}/archive`);
    const slettet = await api("DELETE", `/api/admin/content/courses/${id}`);
    noter("slett testkurs", slettet.status);
  }
  for (const id of seksjonIder) {
    await api("POST", `/api/admin/content/sections/${id}/archive`);
    const slettet = await api("DELETE", `/api/admin/content/sections/${id}`);
    noter("slett testseksjon", slettet.status);
  }
});

/** Et publisert kurs med én publisert seksjon, og en eksportfil der seksjonen er justert. */
async function kursMedJustertFil(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: tre(`Stage-test 2.101 del ${navn} ${stempel}`), bodyMarkdown: tre("Første versjon.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const sectionId = seksjon.json.section.id as string;
  seksjonIder.push(sectionId);
  expect((await api("POST", `/api/admin/content/sections/${sectionId}/publish`)).status).toBe(200);
  const kurs = await api("POST", "/api/admin/content/courses", { title: tre(`Stage-test 2.101 kurs ${navn} ${stempel}`) });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const courseId = kurs.json.course.id as string;
  kursIder.push(courseId);
  expect((await api("PUT", `/api/admin/content/courses/${courseId}/items`, { items: [{ type: "SECTION", sectionId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${courseId}/publish`)).status).toBe(200);
  const ut = await api("GET", `/api/admin/content/courses/${courseId}/export-package`);
  expect(ut.status, ut.tekst.slice(0, 300)).toBe(200);
  const fil = JSON.parse(JSON.stringify(ut.json.envelope ?? ut.json));
  fil.course.course.items[0].section.bodyMarkdown = tre(`Andre versjon — ${navn}.`);
  return { courseId, sectionId, fil };
}

async function levendeTekst(courseId: string) {
  const ut = await api("GET", `/api/admin/content/courses/${courseId}/export-package`);
  const item = (ut.json.envelope ?? ut.json).course.course.items[0];
  return { publishedAt: item.section.audit.publishedAt as string | null, nb: item.section.bodyMarkdown.nb as string };
}

test("versjonen er 2.101.1", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.101.1");
});

test("API: oppdateringen legger ny versjon klar; pending-versions viser den; publish-pending publiserer", async () => {
  // Rundt femten kall med pause mellom hvert (pace.js), mot en app som kan ha startet nettopp: 45 s holdt
  // ikke rett etter deployen av 2.101.1 (besto på andre forsøk).
  test.setTimeout(150_000);
  const { courseId, sectionId, fil } = await kursMedJustertFil("api");
  const svar = await api("POST", "/api/admin/content/courses/import", { payload: fil, mode: "updateExisting", targetId: courseId });
  expect(svar.status, svar.tekst.slice(0, 400)).toBe(201);

  const klar = await api("GET", `/api/admin/content/courses/${courseId}/pending-versions`);
  expect(klar.status, klar.tekst.slice(0, 300)).toBe(200);
  noter("ligger klar", { items: klar.json.items.length, passedTotal: klar.json.passedTotal });
  expect(klar.json.items).toHaveLength(1);
  expect(klar.json.items[0]).toMatchObject({ type: "SECTION", id: sectionId, isNew: false, publishable: true });
  expect(klar.json.passedTotal).toBe(0);

  const feilSett = await api("POST", `/api/admin/content/courses/${courseId}/publish-pending`, { versionIds: [] });
  noter("feil sett", feilSett.status);
  expect(feilSett.status).toBe(409);

  const publisert = await api("POST", `/api/admin/content/courses/${courseId}/publish-pending`, { versionIds: klar.json.items.map((i: { versionId: string }) => i.versionId) });
  noter("publiser alle", publisert.status);
  expect(publisert.status, publisert.tekst.slice(0, 300)).toBe(200);
  const etter = await levendeTekst(courseId);
  expect(etter.publishedAt).not.toBeNull();
  expect(etter.nb).toContain("Andre versjon — api");
  expect((await api("GET", `/api/admin/content/courses/${courseId}/pending-versions`)).json.items).toEqual([]);
});

test("klienten: etter «Oppdater dette kurset» spør kurssiden, og «Publiser alle» publiserer", async ({ page }) => {
  const { courseId, fil } = await kursMedJustertFil("ui");
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible({ timeout: 45000 });
  await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fil)) });
  await expect(page.locator("#courseImportChoiceDialog")).toBeVisible({ timeout: 45000 });
  await page.locator("#courseImportUpdateBtn").click();

  const dialog = page.locator("#pendingPublishDialog");
  await expect(dialog).toBeVisible({ timeout: 45000 });
  await expect(page).toHaveURL(new RegExp(`/admin-content/courses/${courseId}$`));
  await expect(page.locator("#pendingPublishTitle")).toHaveText("Publisere de nye versjonene?");
  await expect(page.locator("#pendingPublishList")).toContainText(`Stage-test 2.101 del ui ${stempel}`);
  await expect(page.locator("#pendingPublishRevision")).toBeHidden();
  noter("dialog etter import", "vist");
  await page.locator("#pendingPublishConfirmBtn").click();
  await expect(dialog).toBeHidden({ timeout: 45000 });
  await expect(page.locator(".toast__message").last()).toContainText("1 nye versjon(er) er publisert", { timeout: 45000 });
  await expect(page.locator('[data-action="publish-pending"]')).toHaveCount(0, { timeout: 45000 });

  const etter = await levendeTekst(courseId);
  noter("publisert fra dialogen", etter.publishedAt !== null);
  expect(etter.nb).toContain("Andre versjon — ui");
});

test("moduloversikten husker filteret når man kommer tilbake", async ({ page }) => {
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible({ timeout: 45000 });
  await page.locator('.list-filter-btn[data-filter="all"]').click();
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/admin-content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible({ timeout: 45000 });
  const aktiv = await page.locator('.list-filter-btn[data-filter="all"]').getAttribute("class");
  noter("filter husket", aktiv);
  await expect(page.locator('.list-filter-btn[data-filter="all"]')).toHaveClass(/active/);
});
