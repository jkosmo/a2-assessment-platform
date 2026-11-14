import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.161.0 mot UTRULLET stage, med ekte data (#1152 4a, «Slett» virker for arkivert innhold):
//
//   A. En arkivert modul med en lagret og publisert versjon (flervalg) slettes, og er borte. Kontroll: ikke arkivert →
//      `delete_requires_archived`.
//   B. Et publisert kurs med egen modul og seksjon arkiveres (elementene følger med), og slettes. Etterpå kan modulen og
//      seksjonen slettes, og er borte.
//   C. I nettleseren: «Slett» på en arkivert modul i biblioteket fjerner raden, uten feilmelding.
//
// «Venter på vurdering», «fullført uten kursbevis», utkast og masseryddingen lar seg ikke lage gjennom API-et med
// stage-kontoen; de er dekket av integrasjonstestene (test/m2-course-delete-1152.test.ts, test/m2-content-delete-1152.test.ts).
//
// Det testen skriver på stage: ett kurs, tre moduler og én seksjon («Stage-test 2.161.0 …»). Alt slettes i testen; feiler den
// før det, arkiverer og sletter ryddingen det som står igjen. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json`
// og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.161.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }).catch((feil: unknown) => {
    throw new Error(`${metode} ${sti.split("?")[0]} svarte ikke: ${feil instanceof Error ? feil.message : String(feil)}`);
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
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const navn = (hva: string) => `Stage-test 2.161.0 ${hva} ${stempel}`;
const sporsmaal = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };

const laget = { moduler: [] as string[], seksjoner: [] as string[], kurs: [] as string[] };
const slettet = new Set<string>();
const modulsti = (id: string) => `/api/admin/content/modules/${id}`;
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

/** En publisert flervalgsmodul (versjon, flervalgssett, publisering). */
async function lagModul(tittel: string): Promise<string> {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(tittel), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const id = modul.json.module.id as string;
  laget.moduler.push(id);
  const sett = await api("POST", `${modulsti(id)}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `${modulsti(id)}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: sett.json.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 50 } } });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `${modulsti(id)}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 600)).toContain(publisert.status);
  return id;
}

async function arkiverModul(id: string) {
  await api("POST", `${modulsti(id)}/unpublish`, {});
  return api("POST", `${modulsti(id)}/archive`, {});
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const id of laget.kurs.filter((k) => !slettet.has(k))) {
    await arkiverKurs(api, id);
    const s = await api("DELETE", kurssti(id));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404 && !(await api("GET", kurssti(id))).json.course?.archivedAt) mislyktes.push(`kurs ${id.slice(-6)}`);
  }
  for (const id of laget.moduler.filter((m) => !slettet.has(m))) {
    await arkiverModul(id);
    const s = await api("DELETE", modulsti(id));
    noter("rydding: modul", s.status);
    if (s.status >= 300 && s.status !== 404 && !(await api("GET", `${modulsti(id)}/export`)).json.moduleExport?.module?.archivedAt) mislyktes.push(`modul ${id.slice(-6)}`);
  }
  for (const id of laget.seksjoner.filter((s) => !slettet.has(s))) {
    await api("POST", `${seksjonssti(id)}/archive`);
    const s = await api("DELETE", seksjonssti(id));
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404 && !(await api("GET", seksjonssti(id))).json.section?.archivedAt) mislyktes.push(`seksjon ${id.slice(-6)}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.161.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.161.0"));
});

test("A: en arkivert modul med en publisert versjon slettes; kontroll: ikke arkivert → delete_requires_archived", async () => {
  test.setTimeout(180_000);
  const id = await lagModul(navn("modul A"));
  const før = await api("DELETE", modulsti(id));
  noter("A, ikke arkivert", { status: før.status, error: før.json.error });
  expect([før.status, før.json.error]).toEqual([400, "delete_requires_archived"]);

  const arkivert = await arkiverModul(id);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  const s = await api("DELETE", modulsti(id));
  noter("A, arkivert", { status: s.status, error: s.json.error });
  expect(s.status, s.tekst.slice(0, 300)).toBeLessThan(300);
  slettet.add(id);
  // Eierskapssjekken kommer før oppslaget, så en modul som ikke finnes, gir 403 (ingen eier) — ikke 404. Borte fra lista er
  // det som teller.
  const etter = await api("GET", `${modulsti(id)}/export`);
  expect([403, 404]).toContain(etter.status);
  const bibliotek = await api("GET", "/api/admin/content/modules/library?locale=nb");
  expect(bibliotek.status).toBe(200);
  expect((bibliotek.json.modules ?? []).some((m: { id: string }) => m.id === id), "modulen står fortsatt i biblioteket").toBe(false);
});

test("B: et arkivert kurs med egen modul og seksjon slettes, og så elementene", async () => {
  test.setTimeout(300_000);
  const modul = await lagModul(navn("modul B"));
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(navn("seksjon B")), bodyMarkdown: L("Text.", "Tekst.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const seksjonId = seksjon.json.section.id as string;
  laget.seksjoner.push(seksjonId);
  expect((await api("POST", `${seksjonssti(seksjonId)}/publish`)).status).toBe(200);

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(navn("kurs B")), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const kursId = kurs.json.course.id as string;
  laget.kurs.push(kursId);
  expect((await api("PUT", `${kurssti(kursId)}/items`, { items: [{ type: "SECTION", sectionId: seksjonId }, { type: "MODULE", moduleId: modul }] })).status).toBe(204);
  expect((await api("POST", `${kurssti(kursId)}/publish`)).status).toBe(200);

  const arkivert = await arkiverKurs(api, kursId);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  expect([...arkivert.fulgte].sort()).toEqual([modul, seksjonId].sort());

  const k = await api("DELETE", kurssti(kursId));
  noter("B, kurset", { status: k.status, error: k.json.error, details: k.json.details });
  expect(k.status, k.tekst.slice(0, 300)).toBeLessThan(300);
  slettet.add(kursId);
  const m = await api("DELETE", modulsti(modul));
  const s = await api("DELETE", seksjonssti(seksjonId));
  noter("B, elementene", { modul: [m.status, m.json.error], seksjon: [s.status, s.json.error] });
  expect(m.status, m.tekst.slice(0, 300)).toBeLessThan(300);
  expect(s.status, s.tekst.slice(0, 300)).toBeLessThan(300);
  slettet.add(modul);
  slettet.add(seksjonId);
  expect((await api("GET", seksjonssti(seksjonId))).status).toBe(404);
});

test("C: «Slett» på en arkivert modul i biblioteket fjerner raden uten feilmelding", async ({ page }) => {
  test.setTimeout(240_000);
  const tittel = navn("modul C");
  const id = await lagModul(tittel);
  expect((await arkiverModul(id)).status).toBe(200);

  await forberedSide(page);
  page.on("dialog", (d) => void d.accept());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content`, { waitUntil: "domcontentloaded" });
  const arkivFilter = page.locator('.list-filter-btn[data-filter="archived"]');
  await expect(arkivFilter).toBeVisible({ timeout: 45_000 });
  await arkivFilter.click();
  const rad = page.locator("tr", { hasText: tittel });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  const svar = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/modules/${id}`), { timeout: 45_000 });
  const slett = rad.locator('[data-action="delete"], button:has-text("Slett")').first();
  if (!(await slett.isVisible())) await rad.locator("details.row-more > summary").click();
  await slett.click();
  const r = await svar;
  noter("C, svaret", r.status());
  expect(r.status()).toBeLessThan(300);
  slettet.add(id);
  await expect(rad).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".toast--error, .toast__message:has-text('kunne ikke')")).toHaveCount(0);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2161-bibliotek-etter-slett.png") });
});
