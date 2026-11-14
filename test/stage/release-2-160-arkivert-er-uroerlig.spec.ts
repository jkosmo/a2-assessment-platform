import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.160.0 mot UTRULLET stage, med ekte data (#1151, «arkivert er urørlig»):
//
//   A. Slett krever arkivert: en seksjon og et kurs som ikke er arkivert, gir `delete_requires_archived` og finnes etterpå.
//      Kontroll: arkivert slettes seksjonen med en gang.
//   B. Et arkivert kurs med modul og seksjon (de fulgte kurset inn i arkivet): hvert endringskall avvises med riktig kode
//      (`course_archived`, `module_archived`, `section_archived`), og ingenting er endret etterpå.
//   C. I nettleseren: modulsida og seksjonsredigereren åpnes skrivebeskyttet med linja om arkivert; forhåndsvisningen av
//      modulen er ikke sperret.
//   D. Gjenopprettes kurset, kan modulen og seksjonen endres igjen (kontroll: vakta handler om arkivert, ikke noe annet).
//   E. Arkivert på nytt kan kurset og seksjonen slettes med en gang. Modulen kan ikke (eldre regel: en modul med lagrede
//      versjoner slettes ikke, #1152); den står igjen arkivert. Det er også ryddingen.
//
// Det testen skriver på stage: ett kurs, én modul og to seksjoner («Stage-test 2.160.0 …»). Modulen blir liggende arkivert,
// resten slettes i E; feiler testen
// før det, arkiverer og sletter ryddingen det som står igjen, og feiler hvis noe blir liggende uarkivert.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.160.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bildesti = (navn: string) => path.join(RAPPORT, `2160-${navn}.png`);

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
const KURS = `Stage-test 2.160.0 kurs ${stempel}`;
const MODUL = `Stage-test 2.160.0 modul ${stempel}`;
const SEKSJON = `Stage-test 2.160.0 seksjon ${stempel}`;
const LØS_SEKSJON = `Stage-test 2.160.0 løs seksjon ${stempel}`;
const TEKST = "Tekst som ikke skal endres.";

const sporsmaal = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };

const tilstand: { kurs?: string; modul?: string; seksjon?: string; løsSeksjon?: string; mcqSett?: string; modulversjon?: string; slettet: Set<string> } = { slettet: new Set() };
const kurssti = () => `/api/admin/content/courses/${tilstand.kurs}`;
const modulsti = () => `/api/admin/content/modules/${tilstand.modul}`;
const seksjonssti = (id = tilstand.seksjon) => `/api/admin/content/sections/${id}`;

/** Det testen sammenligner før og etter de avviste kallene. */
async function øyeblikk() {
  const kurs = (await api("GET", kurssti())).json.course;
  const modul = (await api("GET", `${modulsti()}/export`)).json.moduleExport;
  const seksjon = (await api("GET", seksjonssti())).json.section;
  return {
    kurs: { tittel: kurs?.title, revisjon: kurs?.contentRevision, publisertVersjon: kurs?.version ?? kurs?.versionNo ?? null, elementer: (kurs?.items ?? []).length },
    modul: { tittel: modul?.module?.title, versjoner: (modul?.versions?.moduleVersions ?? []).length, sett: (modul?.versions?.mcqSetVersions ?? []).length },
    seksjon: { tittel: seksjon?.title, tekst: seksjon?.bodyMarkdown, versjon: seksjon?.activeVersionId ?? null },
  };
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  // Arkiver og slett det som står igjen. Blir noe liggende, skal det i det minste være arkivert.
  const rydd = async (hva: string, sti: string, lesSti: string, arkiver: () => Promise<{ status: number }>) => {
    const arkivert = await arkiver();
    const slettet = await api("DELETE", sti);
    noter(`rydding: ${hva}`, { arkiver: arkivert.status, slett: slettet.status });
    if (slettet.status < 300 || slettet.status === 404) return;
    const etter = await api("GET", lesSti);
    const arkivertNå = etter.json.course?.archivedAt ?? etter.json.section?.archivedAt ?? etter.json.moduleExport?.module?.archivedAt;
    if (etter.status === 200 && !arkivertNå) mislyktes.push(`${hva} står igjen uarkivert (slett ${slettet.status})`);
  };
  if (tilstand.kurs && !tilstand.slettet.has(tilstand.kurs)) {
    await rydd("testkurs", kurssti(), kurssti(), () => arkiverKurs(api, tilstand.kurs!));
  }
  if (tilstand.modul && !tilstand.slettet.has(tilstand.modul)) {
    await rydd("testmodul", modulsti(), `${modulsti()}/export`, async () => {
      await api("POST", `${modulsti()}/unpublish`, {});
      return api("POST", `${modulsti()}/archive`, {});
    });
  }
  for (const id of [tilstand.seksjon, tilstand.løsSeksjon]) {
    if (!id || tilstand.slettet.has(id)) continue;
    await rydd(`testseksjon ${id.slice(-6)}`, seksjonssti(id), seksjonssti(id), () => api("POST", `${seksjonssti(id)}/archive`));
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.160.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.160.0"));
});

test("testdata: et publisert kurs med en publisert modul og en publisert seksjon, og en løs seksjon", async () => {
  test.setTimeout(240_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(MODUL), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.modul = modul.json.module.id;
  const sett = await api("POST", `${modulsti()}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  tilstand.mcqSett = sett.json.mcqSetVersion.id;
  const versjon = await api("POST", `${modulsti()}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: tilstand.mcqSett, assessmentPolicy: { passRules: { mcqMinPercent: 50 } } });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  tilstand.modulversjon = versjon.json.moduleVersion.id;
  const publisert = await api("POST", `${modulsti()}/module-versions/${tilstand.modulversjon}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 600)).toContain(publisert.status);

  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(SEKSJON), bodyMarkdown: L(TEKST) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id;
  const seksjonPublisert = await api("POST", `${seksjonssti()}/publish`);
  expect(seksjonPublisert.status, seksjonPublisert.tekst.slice(0, 300)).toBe(200);

  const løs = await api("POST", "/api/admin/content/sections", { title: L(LØS_SEKSJON), bodyMarkdown: L(TEKST) });
  expect(løs.status, løs.tekst.slice(0, 300)).toBe(201);
  tilstand.løsSeksjon = løs.json.section.id;

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(KURS), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kurs = kurs.json.course.id;
  const elementer = await api("PUT", `${kurssti()}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }, { type: "MODULE", moduleId: tilstand.modul }] });
  expect(elementer.status, elementer.tekst.slice(0, 300)).toBe(204);
  const kursPublisert = await api("POST", `${kurssti()}/publish`);
  expect(kursPublisert.status, kursPublisert.tekst.slice(0, 300)).toBe(200);
});

test("A: slett krever arkivert — seksjon og kurs avvises og finnes etterpå; kontroll: arkivert seksjon slettes", async () => {
  test.setTimeout(120_000);
  test.skip(!tilstand.kurs || !tilstand.løsSeksjon, "testdataene ble ikke laget");
  const seksjon = await api("DELETE", seksjonssti(tilstand.løsSeksjon));
  const kurs = await api("DELETE", kurssti());
  noter("A, sletting uten arkivering", {
    seksjon: { status: seksjon.status, error: seksjon.json.error, details: seksjon.json.details, message: seksjon.json.message },
    kurs: { status: kurs.status, error: kurs.json.error, details: kurs.json.details, message: kurs.json.message },
  });
  expect([seksjon.status, seksjon.json.error, seksjon.json.details?.itemType], seksjon.tekst.slice(0, 300)).toEqual([400, "delete_requires_archived", "SECTION"]);
  expect([kurs.status, kurs.json.error, kurs.json.details?.itemType], kurs.tekst.slice(0, 300)).toEqual([400, "delete_requires_archived", "COURSE"]);
  expect((await api("GET", seksjonssti(tilstand.løsSeksjon))).status).toBe(200);
  expect((await api("GET", kurssti())).json.course?.archivedAt ?? null).toBeNull();

  // Kontroll: arkivert slettes den med en gang.
  const arkivert = await api("POST", `${seksjonssti(tilstand.løsSeksjon)}/archive`);
  const slettet = await api("DELETE", seksjonssti(tilstand.løsSeksjon));
  noter("A, kontroll", { arkiver: arkivert.status, slett: slettet.status });
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  expect(slettet.status, slettet.tekst.slice(0, 300)).toBeLessThan(300);
  tilstand.slettet.add(tilstand.løsSeksjon!);
  expect((await api("GET", seksjonssti(tilstand.løsSeksjon))).status).toBe(404);
});

test("B: et arkivert kurs, modul og seksjon avviser hvert endringskall med riktig kode, og ingenting er endret", async () => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  const arkivert = await arkiverKurs(api, tilstand.kurs!);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  expect([...arkivert.fulgte].sort()).toEqual([tilstand.modul!, tilstand.seksjon!].sort());

  const før = await øyeblikk();
  noter("B, før", før);
  const revisjon = (await api("GET", kurssti())).json.course?.contentRevision;

  const kall: Array<[string, string, string, unknown?]> = [
    ["course_archived", "PUT", kurssti(), { title: L(`${KURS} endret`), expectedRevision: revisjon }],
    ["course_archived", "PUT", `${kurssti()}/items`, { items: [{ type: "MODULE", moduleId: tilstand.modul }], expectedRevision: revisjon }],
    ["course_archived", "POST", `${kurssti()}/publish`],
    ["module_archived", "PATCH", `${modulsti()}/title`, { title: L(`${MODUL} endret`) }],
    ["module_archived", "POST", `${modulsti()}/mcq-set-versions`, { title: L("Set 2", "Sett 2"), questions: [sporsmaal] }],
    ["module_archived", "POST", `${modulsti()}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: tilstand.mcqSett, assessmentPolicy: { passRules: { mcqMinPercent: 60 } } }],
    // Publiseringsporten (før #1151) sjekker arkivert før vakta: 422 med `item_archived` blant punktene. Se `forventet` under.
    ["item_archived", "POST", `${modulsti()}/module-versions/${tilstand.modulversjon}/publish`, {}],
    ["section_archived", "PATCH", `${seksjonssti()}/title`, { title: L(`${SEKSJON} endret`) }],
    ["section_archived", "PUT", `${seksjonssti()}/content`, { bodyMarkdown: L("Endret tekst.") }],
    ["section_archived", "POST", `${seksjonssti()}/publish`],
  ];
  const svar: Array<{ kall: string; status: number; error: unknown; message: unknown }> = [];
  for (const [, metode, sti, body] of kall) {
    const r = await api(metode, sti, body);
    // Porten svarer med en liste; koden som gjelder, står blant punktene.
    const kode = r.json.error === "publish_blocked_by_validation" ? (r.json.issues ?? []).map((i: { code?: string }) => i.code).find((c: unknown) => c === "item_archived") ?? r.json.error : r.json.error;
    svar.push({ kall: `${metode} ${sti.replace(/\/api\/admin\/content\//, "").replace(/[a-z0-9]{20,}/gi, "…")}`, status: r.status, error: kode, message: r.json.message });
  }
  noter("B, svarene", svar);
  const forventet = (kode: string) => (kode === "item_archived" ? 422 : 400);
  expect(svar.map((s) => [s.kall, s.status, s.error])).toEqual(kall.map(([kode], i) => [svar[i].kall, forventet(kode), kode]));

  const etter = await øyeblikk();
  noter("B, etter", etter);
  expect(etter).toEqual(før);
});

test("C: modulsida og seksjonsredigereren åpnes skrivebeskyttet; forhåndsvisningen av modulen er åpen", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.modul || !tilstand.seksjon, "testdataene ble ikke laget");
  await forberedSide(page);
  const skrivinger: string[] = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) && /\/api\/admin\/content\/(modules|sections|courses)\//.test(r.url()) && !/\/preview$|content-owners|intent-log/.test(r.url())) skrivinger.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${BASE}/admin-content/module/${tilstand.modul}/conversation`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#previewEditTitle")).toHaveValue(MODUL, { timeout: 45_000 });
  await expect(page.locator("[data-module-archived-notice]")).toHaveText("Modulen er arkivert og kan ikke endres. Gjenopprett den for å endre den.");
  await expect(page.locator("#previewEditTitle")).toBeDisabled();
  await expect(page.locator("#formSaveBtn")).toHaveCount(0);
  await page.screenshot({ path: bildesti("modul-arkivert"), fullPage: true });
  await page.locator("#formTab-preview").click();
  await expect(page.locator("#previewContent")).toContainText("Hvem skal klagen sendes til?", { timeout: 30_000 });
  expect(await page.locator("#previewContent").evaluate((el) => el.closest("fieldset[disabled]") === null), "forhåndsvisningen er sperret").toBe(true);
  await page.locator("#formTab-edit").click();
  await expect(page.locator("#previewEditTitle")).toBeDisabled();

  await page.goto(`${BASE}/admin-content/sections?id=${tilstand.seksjon}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#titleInput")).toHaveValue(SEKSJON, { timeout: 45_000 });
  await expect(page.locator("[data-section-archived-notice]")).toHaveText("Seksjonen er arkivert og kan ikke endres. Gjenopprett den for å endre den.");
  await expect(page.locator("#titleInput")).toBeDisabled();
  await expect(page.locator("#markdownInput")).toBeDisabled();
  await expect(page.locator("#formSaveBtn")).toHaveCount(0);
  await page.screenshot({ path: bildesti("seksjon-arkivert"), fullPage: true });

  noter("C, skrivinger fra sidene", skrivinger);
  expect(skrivinger).toEqual([]);
});

test("D: gjenopprettet kurs — modulen og seksjonen kan endres igjen (kontroll)", async () => {
  test.setTimeout(120_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  const gjenopprettet = await api("POST", `${kurssti()}/restore`);
  expect(gjenopprettet.status, gjenopprettet.tekst.slice(0, 300)).toBe(200);
  const modul = await api("PATCH", `${modulsti()}/title`, { title: L(`${MODUL} gjenopprettet`) });
  const seksjon = await api("PATCH", `${seksjonssti()}/title`, { title: L(`${SEKSJON} gjenopprettet`) });
  noter("D", { gjenopprett: gjenopprettet.status, modulTittel: modul.status, seksjonTittel: seksjon.status });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(200);
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(200);
});

test("E: arkivert på nytt slettes kurset og seksjonen med en gang; modulen står igjen arkivert (eldre regel)", async () => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  const arkivert = await arkiverKurs(api, tilstand.kurs!);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  const kurs = await api("DELETE", kurssti());
  if (kurs.status < 300) tilstand.slettet.add(tilstand.kurs!);
  const modul = await api("DELETE", modulsti());
  if (modul.status < 300) tilstand.slettet.add(tilstand.modul!);
  const seksjon = await api("DELETE", seksjonssti());
  if (seksjon.status < 300) tilstand.slettet.add(tilstand.seksjon!);
  noter("E", { fulgte: [...arkivert.fulgte].length, kurs: [kurs.status, kurs.json.error], modul: [modul.status, modul.json.error], seksjon: [seksjon.status, seksjon.json.error] });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBeLessThan(300);
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBeLessThan(300);
  // Kjent, eldre regel (uendret i 2.160): en modul som har hatt en lagret versjon, kan ikke slettes (`deleteModule`,
  // «still has dependencies»; svaret er den generelle `delete_module_failed`). Den står igjen arkivert. Hører til #1152.
  noter("E, modulen", { status: modul.status, error: modul.json.error });
  if (modul.status >= 300) {
    const etter = await api("GET", `${modulsti()}/export`);
    expect(etter.json.moduleExport?.module?.archivedAt, "modulen som ikke kunne slettes, er ikke arkivert").toBeTruthy();
  }
});
