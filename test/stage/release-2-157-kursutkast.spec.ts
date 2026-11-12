import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.157.0 mot UTRULLET stage: #1140 etappe 2 — et publisert kurs redigeres gjennom et utkast (doc/design/PLAN_1140_E2.md,
// doc/COURSE_DRAFTS_GUIDE.md). Ingen bryter: utkast er alltid på.
//
// Det testen viser med ekte data:
//   - et publisert kurs UTEN utkast lagres direkte og importeres som før;
//   - utkastet lagres, og INGENTING deltakeren ser, endres (lest som en ekte deltaker: stage-testkontoen med
//     `x-stage-test-role: PARTICIPANT`, 2.154.1);
//   - kurset står som «published_with_draft» i detaljen og i lista, med navnet på den som lagret;
//   - med utkast stoppes direkte lagring og kursimport (`409 course_has_draft`);
//   - en fane med utdatert teller får `409 course_draft_changed`;
//   - «Publiser utkastet» sender utkastet ut: deltakeren ser det nye, og versjonen øker;
//   - «Forkast utkast» fjerner et utkast uten å endre kurset;
//   - den EKTE kursbyggeren: «Lagre» går til utkastet, merket «Nyere utkast» og linja vises, og «Publiser utkastet» og
//     «Forkast utkast» virker fra knappene.
//
// Det testen skriver på stage: tre seksjoner og ett kurs («Stage-test 2.157 …»). De arkiveres etterpå, og testen feiler hvis
// ryddingen feiler. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.157.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bilde = async (page: Page, navn: string) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, `2157-${navn}.png`), fullPage: true });
};

type Som = "fagansvarlig" | "deltaker";
async function api(som: Som, metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: {
      ...hoder(),
      "x-locale": "nb",
      ...(som === "deltaker" ? { "x-stage-test-role": "PARTICIPANT" } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
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

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const KURSNAVN = `Stage-test 2.157 kurs ${stempel}`;
const tilstand: { kursId?: string; seksjoner: string[] } = { seksjoner: [] };
const kurssti = () => `/api/admin/content/courses/${tilstand.kursId}`;
const detalj = async () => (await api("fagansvarlig", "GET", kurssti())).json.course;

async function lagSeksjon(navn: string) {
  const seksjon = await api("fagansvarlig", "POST", "/api/admin/content/sections", { title: L(`Stage-test 2.157 ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("fagansvarlig", "POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  return id;
}

/** Det en ekte deltaker ser av kurset: navnet og rekkefølgen. */
async function deltakerenSer() {
  const svar = await api("deltaker", "GET", `/api/courses/${tilstand.kursId}`);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  return {
    harNavn: (navn: string) => svar.tekst.includes(navn),
    seksjoner: (svar.json.course.items as Array<{ sectionId?: string | null }>).map((i) => i.sectionId),
  };
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  const rydd = (hva: string, status: number) => {
    noter(hva, status);
    if (status >= 400) mislyktes.push(`${hva}: ${status}`);
  };
  if (tilstand.kursId) {
    // Et utkast som ligger igjen (en test stoppet midtveis), låser kurset: forkast det først.
    const utkast = await api("fagansvarlig", "GET", `${kurssti()}/draft`);
    if (utkast.status === 200) {
      rydd("forkast utkast som lå igjen", (await api("fagansvarlig", "DELETE", `${kurssti()}/draft?draftId=${utkast.json.draft.id}&revision=${utkast.json.draft.revision}`)).status);
    }
    rydd("avpubliser testkurs", (await api("fagansvarlig", "POST", `${kurssti()}/unpublish`)).status);
    const kurs = await api("fagansvarlig", "GET", kurssti());
    rydd("tøm testkurs", (await api("fagansvarlig", "PUT", `${kurssti()}/items`, { items: [], expectedRevision: kurs.json.course?.contentRevision, version: "minor" })).status);
    rydd("arkiver testkurs", (await api("fagansvarlig", "POST", `${kurssti()}/archive`)).status);
  }
  for (const id of tilstand.seksjoner) {
    await api("fagansvarlig", "POST", `/api/admin/content/sections/${id}/unpublish`);
    rydd("arkiver testseksjon", (await api("fagansvarlig", "POST", `/api/admin/content/sections/${id}/archive`)).status);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.157.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.157.0"));
});

test("uten utkast: et publisert kurs lagres direkte og importeres som før", async () => {
  test.setTimeout(240_000);
  const s1 = await lagSeksjon("seksjon 1");
  const s2 = await lagSeksjon("seksjon 2");
  await lagSeksjon("seksjon 3");
  // Åpent kurs, så deltakeren (stage-testkontoen som deltaker) ser det uten klasse.
  const kurs = await api("fagansvarlig", "POST", "/api/admin/content/courses", { title: L(KURSNAVN), certificationLevel: "basic", enrollmentPolicy: "OPEN" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("fagansvarlig", "PUT", `${kurssti()}/items`, { items: [{ type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s2 }] })).status).toBe(204);
  expect((await api("fagansvarlig", "POST", `${kurssti()}/publish`)).status).toBe(200);

  const før = await detalj();
  noter("kursdetaljen uten utkast", { hasDraft: før.hasDraft, lifecycle: før.lifecycle });
  expect({ hasDraft: før.hasDraft, lifecycle: før.lifecycle }).toEqual({ hasDraft: false, lifecycle: "published" });
  expect((await api("fagansvarlig", "GET", `${kurssti()}/draft`)).status).toBe(404);

  const lagret = await api("fagansvarlig", "PUT", `${kurssti()}/content`, {
    title: L(KURSNAVN), description: L("Lagret direkte."), sortOrder: null, themeIds: [],
    items: [{ type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s2 }], expectedRevision: før.contentRevision,
  });
  noter("direkte lagring uten utkast", { status: lagret.status, error: lagret.json.error });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);

  const ut = await api("fagansvarlig", "GET", `${kurssti()}/export-package`);
  expect(ut.status, ut.tekst.slice(0, 300)).toBe(200);
  const inn = await api("fagansvarlig", "POST", "/api/admin/content/courses/import", { payload: ut.json.envelope ?? ut.json, mode: "updateExisting", targetId: tilstand.kursId });
  noter("import uten utkast", { status: inn.status, error: inn.json.error });
  expect(inn.status, inn.tekst.slice(0, 400)).toBe(201);
});

test("utkastet lagres uten at deltakeren ser noe; kurset er låst for annet; publisering sender det ut; forkast fjerner det", async () => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kursId, "kurset ble ikke laget");
  const [s1, s2, s3] = tilstand.seksjoner;
  const publisert = await detalj();
  const utkastnavn = `${KURSNAVN}, fra utkastet`;
  const versjonFør = `${publisert.versionMajor}.${publisert.versionMinor}`;

  // Lagre utkastet: nytt navn, ny rekkefølge og en seksjon til.
  const lagre = await api("fagansvarlig", "PUT", `${kurssti()}/draft`, {
    title: L(utkastnavn), items: [{ type: "SECTION", sectionId: s2 }, { type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s3 }],
    loaded: { expectedRevision: publisert.contentRevision },
  });
  noter("lagre utkast", { status: lagre.status, error: lagre.json.error, lagretAv: Boolean(lagre.json.draft?.updatedByName) });
  expect(lagre.status, lagre.tekst.slice(0, 300)).toBe(200);
  expect(lagre.json.draft.revision).toBe(1);
  expect(typeof lagre.json.draft.updatedByName).toBe("string");
  expect(lagre.json.draft.items.map((i: { sectionId: string }) => i.sectionId)).toEqual([s2, s1, s3]);

  // Kurset står som publisert med nyere utkast, i detaljen og i lista. Telleren og versjonen er urørt.
  const medUtkast = await detalj();
  expect({ hasDraft: medUtkast.hasDraft, lifecycle: medUtkast.lifecycle, contentRevision: medUtkast.contentRevision }).toEqual({ hasDraft: true, lifecycle: "published_with_draft", contentRevision: publisert.contentRevision });
  const liste = await api("fagansvarlig", "GET", "/api/admin/content/courses");
  const rad = (liste.json.courses as Array<{ id: string; lifecycle: string }>).find((c) => c.id === tilstand.kursId);
  noter("kurslista", rad?.lifecycle);
  expect(rad?.lifecycle).toBe("published_with_draft");

  // Deltakeren ser det publiserte, ikke utkastet.
  const sett = await deltakerenSer();
  noter("deltakeren mens utkastet ligger", { serUtkastnavnet: sett.harNavn(utkastnavn), seksjoner: sett.seksjoner.length });
  expect(sett.harNavn(utkastnavn)).toBe(false);
  expect(sett.seksjoner).toEqual([s1, s2]);

  // Kurset er låst for alt annet som skriver feltene eller lista.
  const direkte = await api("fagansvarlig", "PUT", `${kurssti()}/content`, { title: L("forbi utkastet"), items: [{ type: "SECTION", sectionId: s1 }], expectedRevision: publisert.contentRevision });
  const ut = await api("fagansvarlig", "GET", `${kurssti()}/export-package`);
  const inn = await api("fagansvarlig", "POST", "/api/admin/content/courses/import", { payload: ut.json.envelope ?? ut.json, mode: "updateExisting", targetId: tilstand.kursId });
  noter("låsen", { direkte: [direkte.status, direkte.json.error], import: [inn.status, inn.json.error] });
  expect([direkte.status, direkte.json.error]).toEqual([409, "course_has_draft"]);
  expect([inn.status, inn.json.error]).toEqual([409, "course_has_draft"]);
  expect((await detalj()).contentRevision).toBe(publisert.contentRevision);

  // En fane som lastet utkastet før en ny lagring, får 409 og skriver ingenting.
  const lastet = { draftId: lagre.json.draft.id as string, revision: 1 };
  expect((await api("fagansvarlig", "PUT", `${kurssti()}/draft`, { title: L(utkastnavn), items: [{ type: "SECTION", sectionId: s2 }, { type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s3 }], loaded: lastet })).status).toBe(200);
  const gammelFane = await api("fagansvarlig", "POST", `${kurssti()}/draft/publish`, { loaded: lastet });
  noter("publisering fra en fane med gammel teller", { status: gammelFane.status, error: gammelFane.json.error });
  expect([gammelFane.status, gammelFane.json.error]).toEqual([409, "course_draft_changed"]);
  expect((await deltakerenSer()).seksjoner).toEqual([s1, s2]);

  // Publiser utkastet: ingen har kursbevis, så ingen spørsmål. Deltakeren ser det nye, og versjonen øker.
  const publiser = await api("fagansvarlig", "POST", `${kurssti()}/draft/publish`, { loaded: { draftId: lastet.draftId, revision: 2 } });
  noter("publiser utkastet", { status: publiser.status, error: publiser.json.error });
  expect(publiser.status, publiser.tekst.slice(0, 300)).toBe(200);
  const etter = await detalj();
  noter("etter publisering", { hasDraft: etter.hasDraft, lifecycle: etter.lifecycle, versjon: `${versjonFør} → ${etter.versionMajor}.${etter.versionMinor}` });
  expect({ hasDraft: etter.hasDraft, lifecycle: etter.lifecycle }).toEqual({ hasDraft: false, lifecycle: "published" });
  expect(`${etter.versionMajor}.${etter.versionMinor}`).not.toBe(versjonFør);
  const settEtter = await deltakerenSer();
  expect(settEtter.harNavn(utkastnavn)).toBe(true);
  expect(settEtter.seksjoner).toEqual([s2, s1, s3]);

  // Et nytt utkast, forkastet: kurset er som før, og utkastet er borte.
  const nytt = await api("fagansvarlig", "PUT", `${kurssti()}/draft`, { title: L("Skal forkastes"), items: [{ type: "SECTION", sectionId: s1 }], loaded: { expectedRevision: etter.contentRevision } });
  expect(nytt.status, nytt.tekst.slice(0, 300)).toBe(200);
  const forkast = await api("fagansvarlig", "DELETE", `${kurssti()}/draft?draftId=${nytt.json.draft.id}&revision=${nytt.json.draft.revision}`);
  noter("forkast utkast", forkast.status);
  expect(forkast.status).toBe(204);
  const tilSlutt = await detalj();
  expect({ hasDraft: tilSlutt.hasDraft, lifecycle: tilSlutt.lifecycle, contentRevision: tilSlutt.contentRevision }).toEqual({ hasDraft: false, lifecycle: "published", contentRevision: etter.contentRevision });
  expect((await deltakerenSer()).seksjoner).toEqual([s2, s1, s3]);
});

test("den ekte kursbyggeren: «Lagre» går til utkastet, merket og linja vises, og «Publiser utkastet» og «Forkast utkast» virker", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kursId, "kurset ble ikke laget");
  await forberedSide(page);
  const kall: Array<{ metode: string; sti: string; status: number }> = [];
  page.on("response", (res) => {
    const req = res.request();
    const sti = new URL(req.url()).pathname;
    if (req.method() !== "GET" && sti.includes(`/courses/${tilstand.kursId}`)) kall.push({ metode: req.method(), sti: sti.split(`/courses/${tilstand.kursId}`)[1] || "/", status: res.status() });
  });
  page.on("dialog", (d) => d.accept());

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#formSaveBtn")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#title-nb")).not.toHaveValue("", { timeout: 30_000 });
  await expect(page.locator('[data-action="publish-draft"]')).toHaveCount(0);

  // Lagre: går til utkastet, ikke til kurset.
  const navnFraSkjemaet = `${KURSNAVN}, fra kursbyggeren`;
  await page.locator("#title-nb").fill(navnFraSkjemaet);
  await page.locator("#formSaveBtn").click();
  await expect(page.locator(".toast__message").first()).toHaveText("Utkast lagret.", { timeout: 45_000 });
  await expect(page.locator(".form-page-state .status-badge")).toHaveText("Publisert");
  await expect(page.locator(".form-page-state .status-chip").first()).toHaveText("Nyere utkast");
  await expect(page.locator("[data-course-draft-line]")).toContainText("Utkast lagret av");
  await expect(page.locator("[data-course-draft-line]")).toContainText("til utkastet er publisert.");
  await expect(page.locator('[data-action="publish-draft"]')).toBeVisible();
  await expect(page.locator('[data-action="discard-draft"]')).toBeVisible();
  await expect(page.locator('.form-page-actions [data-action="unpublish"], .form-page-actions .row-more [data-action="unpublish"]')).toHaveCount(1);
  noter("kursbyggeren: lagre", kall.filter((k) => k.sti === "/draft"));
  expect(kall.filter((k) => k.metode === "PUT")).toEqual([{ metode: "PUT", sti: "/draft", status: 200 }]);
  expect((await deltakerenSer()).harNavn(navnFraSkjemaet)).toBe(false);
  await bilde(page, "kursbygger-utkast-1280");

  // Kurslista viser merket.
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("tr", { hasText: KURSNAVN }).first();
  await expect(rad).toBeVisible({ timeout: 45_000 });
  await expect(rad).toContainText("Nyere utkast");
  await rad.scrollIntoViewIfNeeded();
  await bilde(page, "kursliste-nyere-utkast");

  // Publiser utkastet fra knappen (ingen kursbevis: ingen spørsmål).
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#title-nb")).toHaveValue(navnFraSkjemaet, { timeout: 45_000 });
  await page.locator('[data-action="publish-draft"]').click();
  await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er publisert.", { timeout: 45_000 });
  await expect(page.locator(".form-page-state .status-chip", { hasText: "Nyere utkast" })).toHaveCount(0);
  noter("kursbyggeren: publiser", kall.filter((k) => k.sti === "/draft/publish"));
  expect(kall.filter((k) => k.sti === "/draft/publish")).toEqual([{ metode: "POST", sti: "/draft/publish", status: 200 }]);
  expect((await deltakerenSer()).harNavn(navnFraSkjemaet)).toBe(true);
  await bilde(page, "kursbygger-etter-publisering-1280");

  // Et nytt utkast, forkastet fra knappen.
  await page.locator("#title-nb").fill(`${KURSNAVN}, skal forkastes`);
  await page.locator("#formSaveBtn").click();
  await expect(page.locator('[data-action="discard-draft"]')).toBeVisible({ timeout: 45_000 });
  await page.locator('[data-action="discard-draft"]').click();
  await expect(page.locator(".toast__message", { hasText: "Utkastet er forkastet." }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#title-nb")).toHaveValue(navnFraSkjemaet, { timeout: 45_000 });
  await expect(page.locator('[data-action="discard-draft"]')).toHaveCount(0);
  noter("kursbyggeren: forkast", kall.filter((k) => k.metode === "DELETE"));
  expect(kall.filter((k) => k.metode === "DELETE").map((k) => [k.sti, k.status])).toEqual([["/draft", 204]]);

  // Mobil: linja og knappene flyter ikke over.
  await page.locator("#title-nb").fill(`${KURSNAVN}, mobil`);
  await page.locator("#formSaveBtn").click();
  await expect(page.locator("[data-course-draft-line]")).toBeVisible({ timeout: 45_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const overløp = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  noter("kursbyggeren 390 px: vannrett overløp", overløp);
  expect(overløp).toBeLessThanOrEqual(0);
  await bilde(page, "kursbygger-utkast-390");
});
