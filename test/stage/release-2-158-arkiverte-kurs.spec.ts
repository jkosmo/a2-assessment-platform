import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.158.0 mot UTRULLET stage, med ekte data (#1149 og «Nyere utkast»):
//
//   A. Et kurs som arkiveres, forsvinner fra «Brukt i kurs» og kursfilteret for seksjonen og modulen i det.
//   B. Fra 2.159.0 (#1150): seksjonen og modulen fulgte kurset inn i arkivet, merket med kurset (gjenopprettingen av kurset
//      ville gitt dem tilbake). Til og med 2.158 målte B at de kunne arkiveres for hånd etterpå; det er ikke lenger noe å
//      arkivere.
//   C. De kan ikke slettes, og svaret sier at kurset er arkivert — uten rådet om å ta dem ut av kurset.
//   D. Fra 2.159.0: seksjonen arkiveres om igjen for hånd (da er den «arkivert for seg»). Gjenopprettes kurset, kommer modulen
//      tilbake publisert med samme versjon, seksjonen blir stående, kurset er et utkast, og publiseringen stoppes av den
//      arkiverte seksjonen (`item_archived`). Kontroll: med seksjonen gjenopprettet og publisert, lykkes publiseringen.
//   E. Modulhodet sier «Nyere utkast» når skjemaet viser en lagring oppå den publiserte.
//
// Det testen skriver på stage: ett kurs, to moduler og én seksjon («Stage-test 2.158.0 …»). Alt arkiveres etterpå, og
// testen feiler hvis ryddingen feiler. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.158.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bildesti = (navn: string) => path.join(RAPPORT, `2158-${navn}.png`);

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
const KURS = `Stage-test 2.158.0 kurs ${stempel}`;
const MODUL = `Stage-test 2.158.0 modul ${stempel}`;
const MODUL_UTKAST = `Stage-test 2.158.0 modul med utkast ${stempel}`;
const SEKSJON = `Stage-test 2.158.0 seksjon ${stempel}`;

const sporsmaal = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };

const tilstand: { kurs?: string; modul?: string; modulUtkast?: string; seksjon?: string; fulgte?: Set<string> } = {};
/** Den publiserte versjonen av hver modul testen lager (#1150: gjenopprettingen skal gi den samme tilbake). */
const publisertVersjon = new Map<string, string>();
const kurssti = () => `/api/admin/content/courses/${tilstand.kurs}`;
const modulsti = (id = tilstand.modul) => `/api/admin/content/modules/${id}`;
const seksjonssti = () => `/api/admin/content/sections/${tilstand.seksjon}`;

/** En publisert flervalgsmodul. `medNyereLagring` legger en upublisert versjon oppå. */
async function lagModul(navn: string, medNyereLagring = false): Promise<string> {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(navn), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const id = modul.json.module.id as string;
  const sett = await api("POST", `${modulsti(id)}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = () => api("POST", `${modulsti(id)}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: sett.json.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 50 } } });
  const første = await versjon();
  expect(første.status, første.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `${modulsti(id)}/module-versions/${første.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 600)).toContain(publisert.status);
  publisertVersjon.set(id, første.json.moduleVersion.id as string);
  if (medNyereLagring) expect((await versjon()).status).toBe(201);
  return id;
}

const sortert = (liste: string[]) => [...liste].sort();

/** Slik listene ser elementene: `courses` og `courseCount`. */
async function brukILister() {
  const seksjoner = await api("GET", "/api/admin/content/sections");
  const bibliotek = await api("GET", "/api/admin/content/modules/library?locale=nb");
  expect(seksjoner.status).toBe(200);
  expect(bibliotek.status).toBe(200);
  const s = (seksjoner.json.sections ?? []).find((rad: { id: string }) => rad.id === tilstand.seksjon);
  const m = (bibliotek.json.modules ?? []).find((rad: { id: string }) => rad.id === tilstand.modul);
  const navn = (rad: { courses?: Array<{ title: string }> } | undefined) => (rad?.courses ?? []).map((c) => c.title);
  return { seksjon: { antall: s?.courseCount, kurs: navn(s) }, modul: { antall: m?.courseCount, kurs: navn(m) } };
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  const rydd = (hva: string, status: number) => {
    noter(hva, status);
    if (status >= 400) mislyktes.push(`${hva}: ${status}`);
  };
  if (tilstand.kurs) {
    // Kurset kan stå gjenopprettet (utkast eller, etter D, publisert) eller arkivert, alt etter hvor langt testen kom. Tøm det
    // og arkiver det.
    await api("POST", `${kurssti()}/restore`);
    await api("POST", `${kurssti()}/unpublish`);
    const kurs = await api("GET", kurssti());
    rydd("tøm testkurs", (await api("PUT", `${kurssti()}/items`, { items: [], expectedRevision: kurs.json.course?.contentRevision })).status);
    rydd("arkiver testkurs", (await arkiverKurs(api, tilstand.kurs)).status);
  }
  for (const [navn, id] of [["modul", tilstand.modul], ["modul med utkast", tilstand.modulUtkast]] as const) {
    if (!id) continue;
    await api("POST", `${modulsti(id)}/unpublish`, {});
    const arkivert = await api("POST", `${modulsti(id)}/archive`, {});
    // Allerede arkivert i testen er også i orden.
    rydd(`arkiver test${navn}`, arkivert.status === 400 || arkivert.status === 409 ? 200 : arkivert.status);
    const etter = await api("GET", `${modulsti(id)}/export`);
    if (!etter.json.moduleExport?.module?.archivedAt) mislyktes.push(`test${navn} er ikke arkivert`);
  }
  if (tilstand.seksjon) {
    await api("POST", `${seksjonssti()}/archive`);
    const etter = await api("GET", seksjonssti());
    if (!etter.json.section?.archivedAt) mislyktes.push("testseksjonen er ikke arkivert");
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

// #1150: B og D måler oppførselen fra 2.159.0 (innholdet følger kurset inn i arkivet og tilbake).
test("versjonen er minst 2.159.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.159.0"));
});

test("testdata: et kurs med en publisert modul og en publisert seksjon; kontroll: begge viser kurset som bruk", async () => {
  test.setTimeout(240_000);
  tilstand.modul = await lagModul(MODUL);
  tilstand.modulUtkast = await lagModul(MODUL_UTKAST, true);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(SEKSJON), bodyMarkdown: L("Text.", "Tekst.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id;

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(KURS), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kurs = kurs.json.course.id;
  const elementer = await api("PUT", `${kurssti()}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }, { type: "MODULE", moduleId: tilstand.modul }] });
  expect(elementer.status, elementer.tekst.slice(0, 300)).toBe(204);

  const før = await brukILister();
  noter("før arkivering av kurset", før);
  expect(før).toEqual({ seksjon: { antall: 1, kurs: [KURS] }, modul: { antall: 1, kurs: [KURS] } });
  // Kontroll: i et AKTIVT kurs stoppes arkivering av elementet, som før.
  const stoppet = await api("POST", `${seksjonssti()}/archive`);
  noter("arkiver seksjon i aktivt kurs", { status: stoppet.status, error: stoppet.json.error });
  expect(stoppet.json.error).toBe("content_in_use");
});

test("A: kurset arkiveres og er borte fra «Brukt i kurs» og fra kursfilteret", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  const arkivert = await arkiverKurs(api, tilstand.kurs!);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  tilstand.fulgte = arkivert.fulgte;
  const etter = await brukILister();
  noter("etter arkivering av kurset", etter);
  expect(etter).toEqual({ seksjon: { antall: 0, kurs: [] }, modul: { antall: 0, kurs: [] } });

  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections`, { waitUntil: "domcontentloaded" });
  const filter = page.locator("#sectionCourseFilter");
  await expect(filter).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#sectionsTableBody tr").first()).toBeVisible({ timeout: 45_000 });
  const valg = await filter.locator("option").allInnerTexts();
  noter("kursfilteret i seksjonslista", { antallValg: valg.length, harTestkurset: valg.includes(KURS) });
  expect(valg).not.toContain(KURS);
  expect(valg.length, "kursfilteret er tomt: lista ble ikke lastet").toBeGreaterThan(1);
});

test("B og C: elementene fulgte kurset inn i arkivet, og kan ikke slettes; svaret sier at kurset er arkivert", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  // B (#1150): arkiveringen av kurset tok med seg begge, fordi de ikke brukes andre steder.
  const modul = await api("GET", `${modulsti()}/export`);
  const seksjon = await api("GET", seksjonssti());
  const forhånd = await api("GET", `${kurssti()}/restore-preview`);
  const kommerTilbake = (forhånd.json.returns ?? []).map((element: { id: string }) => element.id);
  noter("B", {
    fulgte: [...(tilstand.fulgte ?? [])],
    modulArkivert: modul.json.moduleExport?.module?.archivedAt ?? null,
    seksjonArkivert: seksjon.json.section?.archivedAt ?? null,
    kommerTilbake,
    blirStående: forhånd.json.staysArchived,
  });
  expect(sortert([...(tilstand.fulgte ?? [])])).toEqual(sortert([tilstand.modul!, tilstand.seksjon!]));
  expect(modul.json.moduleExport?.module?.archivedAt, "modulen fulgte ikke kurset inn i arkivet").toBeTruthy();
  expect(seksjon.json.section?.archivedAt, "seksjonen fulgte ikke kurset inn i arkivet").toBeTruthy();
  // Merket peker på kurset: gjenopprettingen av kurset ville gitt begge tilbake, og ingenting blir stående.
  expect(forhånd.status, forhånd.tekst.slice(0, 300)).toBe(200);
  expect(sortert(kommerTilbake)).toEqual(sortert([tilstand.modul!, tilstand.seksjon!]));
  expect(forhånd.json.staysArchived).toEqual([]);
  // Kontroll: å arkivere seksjonen for hånd igjen gir «allerede arkivert», ikke 200 (det var 2.158-oppførselen).
  const igjen = await api("POST", `${seksjonssti()}/archive`);
  noter("B, arkiver seksjonen igjen", { status: igjen.status, error: igjen.json.error });
  expect(igjen.json.error).toBe("section_already_archived");

  const slettSeksjon = await api("DELETE", seksjonssti());
  const slettModul = await api("DELETE", modulsti());
  noter("C, tjenerens svar", { seksjon: { status: slettSeksjon.status, error: slettSeksjon.json.error, details: slettSeksjon.json.details }, modul: { status: slettModul.status, error: slettModul.json.error } });
  for (const svar of [slettSeksjon, slettModul]) {
    expect(svar.status).toBe(400);
    expect(svar.json.error).toBe("content_in_archived_course");
    expect(svar.json.details).toMatchObject({ count: 1, archivedCount: 1, archivedCourseTitles: [KURS] });
    expect(svar.json.message).not.toMatch(/Gjenopprett kurset/);
  }

  // Det forfatteren ser: «Slett» på den arkiverte seksjonen.
  await forberedSide(page);
  await page.addInitScript(() => {
    const sett: string[] = [];
    (window as unknown as { __meldinger: string[] }).__meldinger = sett;
    new MutationObserver((endringer) => {
      for (const endring of endringer) {
        for (const node of endring.addedNodes) {
          if (!(node instanceof Element)) continue;
          const funnet = node.matches(".toast__message") ? [node] : [...node.querySelectorAll(".toast__message")];
          for (const el of funnet) sett.push(el.textContent ?? "");
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  page.on("dialog", (d) => void d.accept());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections?id=${tilstand.seksjon}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#titleInput")).toHaveValue(SEKSJON, { timeout: 45_000 });
  const slett = page.locator('.form-page-actions [data-editor-action="delete"]');
  if (!(await slett.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
  await slett.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? []), { timeout: 30_000 }).not.toEqual([]);
  const meldinger = await page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? []);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: bildesti("slett-seksjon-i-arkivert-kurs") });
  noter("C, meldingen forfatteren ser", meldinger);
  expect(meldinger.join(" | ")).toContain(KURS);
  expect(meldinger.join(" | ")).toContain("Et arkivert kurs beholder innholdet sitt.");
  expect(meldinger.join(" | ")).not.toContain("Gjenopprett kurset");
  // Seksjonen finnes fortsatt.
  expect((await api("GET", seksjonssti())).status).toBe(200);
});

test("D: modulen kommer tilbake publisert, seksjonen arkivert for seg blir stående, og publiseringen stoppes av den", async () => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  // Seksjonen gjenopprettes og arkiveres for hånd mens kurset er arkivert (#1149: et arkivert kurs stopper ikke det). Da er
  // merket borte, og den er «arkivert for seg».
  const forHåndInn = await api("POST", `${seksjonssti()}/restore`);
  const forHåndUt = await api("POST", `${seksjonssti()}/archive`);
  noter("D, seksjonen arkivert for seg", { gjenopprett: forHåndInn.status, arkiver: forHåndUt.status });
  expect([forHåndInn.status, forHåndUt.status], `${forHåndInn.tekst.slice(0, 200)} ${forHåndUt.tekst.slice(0, 200)}`).toEqual([200, 200]);

  const forhånd = await api("GET", `${kurssti()}/restore-preview`);
  expect(forhånd.status, forhånd.tekst.slice(0, 300)).toBe(200);
  expect(forhånd.json.returns.map((element: { id: string }) => element.id)).toEqual([tilstand.modul]);
  expect(forhånd.json.staysArchived).toEqual([expect.objectContaining({ id: tilstand.seksjon, reason: "archived_separately" })]);

  const gjenopprettet = await api("POST", `${kurssti()}/restore`);
  noter("D, svaret på gjenopprettingen", { status: gjenopprettet.status, returns: gjenopprettet.json.returns, staysArchived: gjenopprettet.json.staysArchived });
  expect(gjenopprettet.status, gjenopprettet.tekst.slice(0, 300)).toBe(200);
  // Samme versjon som før arkiveringen, publisert (ikke et utkast).
  expect(gjenopprettet.json.returns).toEqual([expect.objectContaining({ id: tilstand.modul, versionId: publisertVersjon.get(tilstand.modul!) })]);
  expect(gjenopprettet.json.returns[0].asDraft).toBeUndefined();
  expect(gjenopprettet.json.staysArchived).toEqual([expect.objectContaining({ id: tilstand.seksjon, reason: "archived_separately" })]);
  const kurs = (await api("GET", kurssti())).json.course;
  noter("kurset etter gjenoppretting", { lifecycle: kurs?.lifecycle, publishedAt: kurs?.publishedAt ?? null, archivedAt: kurs?.archivedAt ?? null });
  expect(kurs?.lifecycle).toBe("draft");
  expect(kurs?.publishedAt ?? null).toBeNull();

  const publiser = await api("POST", `${kurssti()}/publish`);
  noter("publiser gjenopprettet kurs med en arkivert seksjon", { status: publiser.status, svar: publiser.tekst.slice(0, 400) });
  expect(publiser.status).toBeGreaterThanOrEqual(400);
  expect(publiser.tekst).toContain("item_archived");

  // Kontroll: med seksjonen gjenopprettet og publisert stopper ingenting, og modulen trengte ingen ny publisering.
  const seksjonInn = await api("POST", `${seksjonssti()}/restore`);
  const seksjonUt = await api("POST", `${seksjonssti()}/publish`);
  const publiserIgjen = await api("POST", `${kurssti()}/publish`);
  noter("D, kontroll", { gjenopprettSeksjon: seksjonInn.status, publiserSeksjon: seksjonUt.status, publiserKurs: publiserIgjen.status, svar: publiserIgjen.tekst.slice(0, 300) });
  expect([seksjonInn.status, seksjonUt.status], `${seksjonInn.tekst.slice(0, 200)} ${seksjonUt.tekst.slice(0, 200)}`).toEqual([200, 200]);
  expect(publiserIgjen.status, publiserIgjen.tekst.slice(0, 300)).toBe(200);
});

test("E: modulhodet sier «Nyere utkast» ved siden av «Publisert v…»", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.modulUtkast, "modulen ble ikke laget");
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/module/${tilstand.modulUtkast}/conversation`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#previewEditTitle")).toHaveValue(MODUL_UTKAST, { timeout: 45_000 });
  const tilstandslinje = page.locator("#moduleFormHead .form-page-state");
  await expect(tilstandslinje.locator(".status-chip")).toHaveText("Nyere utkast", { timeout: 30_000 });
  await expect(tilstandslinje.locator(".status-badge--published")).toHaveText(/^Publisert v/);
  await expect(tilstandslinje.locator(".status-badge--draft")).toHaveCount(0);
  await page.locator("#moduleFormHead").screenshot({ path: bildesti("modulhode-nyere-utkast") });
  noter("E", await tilstandslinje.innerText());
});
