import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// #1095 (2.88.x) mot stage, med ekte API og ekte klient: et kurs eksporteres med identiteter,
// justeres i fila, og importeres som OPPDATERING av det samme kurset — ny upublisert versjon,
// kurset urørt; den gamle fila avvises som utdatert; uten identiteter blir det et nytt kurs;
// og dialogen i Innholdsforvaltning spør og viser oppsummeringen på kurssiden.
//
// Det testen skriver på stage: «Stage-test 1095 …»-seksjon og -kurs, som ryddes til slutt.
// Byttet av elementer forfatteren ikke eier (2.88.1) kan ikke prøves her: tokenet er
// administrator, som går forbi eierskapsvakta — det dekkes av integrasjonstesten.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);

const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const stempel = Date.now();

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

async function ryddKurs(courseId: string) {
  // Kursets egne elementer (nye utkast fra importen) ryddes etter kurset.
  const detalj = await api("GET", `/api/admin/content/courses/${courseId}`);
  const items = ((detalj.json.course as Record<string, unknown> | undefined)?.items ?? []) as Array<{ type?: string; itemType?: string; sectionId?: string; section?: { id?: string } }>;
  for (const it of items) {
    const sid = it.sectionId ?? it.section?.id;
    if (sid && !seksjonIder.includes(sid)) seksjonIder.push(sid);
  }
  await api("POST", `/api/admin/content/courses/${courseId}/unpublish`);
  await api("POST", `/api/admin/content/courses/${courseId}/archive`);
  const slettet = await api("DELETE", `/api/admin/content/courses/${courseId}`);
  if (slettet.status >= 300) console.log(`rydding: kurs ${courseId} ikke slettet (${slettet.status}) — slett manuelt`);
}

test.afterAll(async () => {
  for (const id of kursIder) await ryddKurs(id);
  for (const id of seksjonIder) {
    await api("POST", `/api/admin/content/sections/${id}/archive`);
    const slettet = await api("DELETE", `/api/admin/content/sections/${id}`);
    if (slettet.status >= 300) console.log(`rydding: seksjon ${id} ikke slettet (${slettet.status}) — slett manuelt`);
  }
});

async function lagKurs(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: tre(`Stage-test 1095 del ${navn} ${stempel}`), bodyMarkdown: tre("Første versjon av teksten.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const sectionId = (seksjon.json.section as { id: string }).id;
  seksjonIder.push(sectionId);
  expect((await api("POST", `/api/admin/content/sections/${sectionId}/publish`)).status).toBe(200);
  const kurs = await api("POST", "/api/admin/content/courses", { title: tre(`Stage-test 1095 kurs ${navn} ${stempel}`) });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const courseId = (kurs.json.course as { id: string }).id;
  kursIder.push(courseId);
  expect((await api("PUT", `/api/admin/content/courses/${courseId}/items`, { items: [{ type: "SECTION", sectionId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${courseId}/publish`)).status).toBe(200);
  return { courseId, sectionId };
}

async function eksporter(courseId: string) {
  const ut = await api("GET", `/api/admin/content/courses/${courseId}/export-package`);
  expect(ut.status, ut.tekst.slice(0, 300)).toBe(200);
  return JSON.parse(JSON.stringify(ut.json.envelope ?? ut.json)) as any;
}

test.describe("#1095 — oppdatere et publisert kurs fra en eksportfil, mot stage", () => {
  test("API: eksporten bærer identiteter; oppdateringen legger ny upublisert versjon; den gamle fila er utdatert; uten identiteter blir det nytt kurs", async () => {
    const { courseId, sectionId } = await lagKurs("api");
    const fil = await eksporter(courseId);
    expect(fil.course.course.origin).toMatchObject({ courseId });
    expect(fil.course.course.items[0].origin).toEqual({ sectionId, versionNo: 1 });

    fil.course.course.items[0].section.bodyMarkdown = tre("Andre versjon av teksten — justert.");
    const svar = await api("POST", "/api/admin/content/courses/import", { payload: fil, mode: "updateExisting", targetId: courseId });
    expect(svar.status, svar.tekst.slice(0, 400)).toBe(201);
    expect(svar.json.courseId).toBe(courseId);
    expect(svar.json.summary).toMatchObject({ updatedSections: 1, createdSections: 0, removedSections: 0, unplacedModuleIds: [], replacedUnownedIds: [], keptUnownedIds: [] });

    // Kurset er fortsatt publisert; ny eksport bærer v2 (upublisert), så v1 lever.
    const kurs = await api("GET", `/api/admin/content/courses/${courseId}`);
    expect((kurs.json.course as { publishedAt: string | null }).publishedAt).not.toBeNull();
    const igjen = await eksporter(courseId);
    expect(igjen.course.course.items[0].origin).toEqual({ sectionId, versionNo: 2 });
    expect(igjen.course.course.items[0].section.bodyMarkdown.nb).toContain("Andre versjon");
    expect(igjen.course.course.items[0].section.audit.publishedAt).toBeNull();

    // Den første fila igjen: utdatert.
    const utdatert = await api("POST", "/api/admin/content/courses/import", { payload: fil, mode: "updateExisting", targetId: courseId });
    expect(utdatert.status, utdatert.tekst.slice(0, 400)).toBe(400);
    expect(utdatert.json.error).toBe("origin_stale");

    // Uten identiteter: nytt kurs, som før.
    const uten = JSON.parse(JSON.stringify(igjen));
    delete uten.course.course.origin;
    for (const it of uten.course.course.items) delete it.origin;
    uten.course.course.title = tre(`Stage-test 1095 kopi ${stempel}`);
    const nytt = await api("POST", "/api/admin/content/courses/import", { payload: uten, mode: "createNew" });
    expect(nytt.status, nytt.tekst.slice(0, 400)).toBe(201);
    expect(nytt.json.courseId).not.toBe(courseId);
    kursIder.push(nytt.json.courseId as string);
  });

  test("klienten: dialogen spør, «Oppdater dette kurset» oppdaterer, og oppsummeringen står på kurssiden", async ({ page }) => {
    const { courseId } = await lagKurs("ui");
    const fil = await eksporter(courseId);
    fil.course.course.items[0].section.bodyMarkdown = tre("Justert gjennom dialogen.");

    await forberedSide(page);
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".list-table tbody tr").first()).toBeVisible({ timeout: 45000 });
    await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fil)) });

    const dialog = page.locator("#courseImportChoiceDialog");
    await expect(dialog).toBeVisible({ timeout: 45000 });
    await expect(page.locator("#courseImportChoiceText")).toContainText(`Stage-test 1095 kurs ui ${stempel}`);
    await expect(page.locator("#courseImportUpdateBtn")).toHaveText("Oppdater dette kurset");
    await page.locator("#courseImportUpdateBtn").click();

    await expect(page).toHaveURL(new RegExp(`/admin-content/courses/${courseId}$`), { timeout: 45000 });
    await expect(page.locator(".toast__message")).toContainText("Kurset er oppdatert: 1 element(er)", { timeout: 45000 });

    const igjen = await eksporter(courseId);
    expect(igjen.course.course.items[0].origin.versionNo).toBe(2);
    expect(igjen.course.course.items[0].section.bodyMarkdown.nb).toContain("Justert gjennom dialogen");
  });
});
