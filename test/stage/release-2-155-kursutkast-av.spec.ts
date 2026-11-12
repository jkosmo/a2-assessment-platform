import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.155.0 og 2.156.0 mot UTRULLET stage: #1140 etappe 2, skive 2a og 2b — utkast for et publisert kurs, bak bryteren
// `course_drafts` (doc/design/PLAN_1140_E2.md). Bryteren står AV, så det testen skal vise, er at ALT ER SOM FØR med den nye
// koden i veien (testen for publiseringsruta krever 2.156.0; resten er grønt også mot 2.155.0):
//   - migreringen er lagt inn (kursdetaljen leser den nye tabellen; uten den ville den feilet med 500);
//   - kursdetaljen sier at utkast er av, og at kurset ikke har noe utkast;
//   - et publisert kurs lagres direkte, som før (lagringen går gjennom `claimCourseRevision`, der låsen sitter);
//   - «Oppdater dette kurset» (import) går som før;
//   - utkastet kan ikke lagres med bryteren av (`409 course_drafts_off`), og hente og forkaste svarer 404.
//
// Hva testen IKKE kan se: alt som gjelder med bryteren på (lagre utkast, låsen). Det er prøvd lokalt i
// `test/m2-course-draft-1140-e2.test.ts`, og prøves på stage i skive 2c, der bryteren slås på.
//
// Det testen skriver på stage: to seksjoner og ett kurs («Stage-test 2.155 …»). De arkiveres etterpå, og testen feiler hvis
// ryddingen feiler. ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal ALDRI
// logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.155.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  // Et kall som blir hengende (første kjøring traff en omstart midt i utrullingen og sto i fire minutter uten å si hvor),
  // avbrytes etter 60 sekunder med metode og sti i feilen.
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

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: { kursId?: string; seksjoner: string[] } = { seksjoner: [] };
const kurssti = () => `/api/admin/content/courses/${tilstand.kursId}`;

async function lagSeksjon(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.155 ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = (seksjon.json.section?.id ?? seksjon.json.id) as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  return id;
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  const rydd = (hva: string, status: number) => {
    noter(hva, status);
    if (status >= 400) mislyktes.push(`${hva}: ${status}`);
  };
  if (tilstand.kursId) {
    rydd("avpubliser testkurs", (await api("POST", `${kurssti()}/unpublish`)).status);
    const kurs = await api("GET", kurssti());
    rydd("tøm testkurs", (await api("PUT", `${kurssti()}/items`, { items: [], expectedRevision: kurs.json.course?.contentRevision, version: "minor" })).status);
    rydd("arkiver testkurs", (await api("POST", `${kurssti()}/archive`)).status);
  }
  // Importen kan ha lagt klar nye versjoner på seksjonene; de arkiveres som de er.
  for (const id of tilstand.seksjoner) {
    await api("POST", `/api/admin/content/sections/${id}/unpublish`);
    rydd("arkiver testseksjon", (await api("POST", `/api/admin/content/sections/${id}/archive`)).status);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.155.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.155.0"));
});

test("med bryteren av: kursdetaljen sier «av», et publisert kurs lagres direkte, og utkastrutene svarer som de skal", async () => {
  test.setTimeout(240_000);
  const s1 = await lagSeksjon("seksjon 1");
  const s2 = await lagSeksjon("seksjon 2");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.155 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `${kurssti()}/items`, { items: [{ type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s2 }] })).status).toBe(204);
  const publisert = await api("POST", `${kurssti()}/publish`);
  expect(publisert.status, publisert.tekst.slice(0, 400)).toBe(200);

  // Kursdetaljen leser den nye tabellen. Uten migreringen: 500.
  const detalj = await api("GET", kurssti());
  noter("kursdetaljen", { status: detalj.status, drafts: detalj.json.course?.drafts });
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  expect(detalj.json.course.drafts).toEqual({ enabled: false, hasDraft: false });

  // Utkastrutene med bryteren av.
  const hent = await api("GET", `${kurssti()}/draft`);
  const lagre = await api("PUT", `${kurssti()}/draft`, { title: L("Skal ikke lagres"), items: [{ type: "SECTION", sectionId: s1 }], loaded: { expectedRevision: detalj.json.course.contentRevision } });
  // Fra 2.156.0 krever forkast utkastets id og teller; 2.155.0 ser bort fra dem. Uten utkast er svaret 404 i begge.
  const forkast = await api("DELETE", `${kurssti()}/draft?draftId=ingen&revision=1`);
  noter("utkastrutene med bryteren av", { hent: [hent.status, hent.json.error], lagre: [lagre.status, lagre.json.error], forkast: [forkast.status, forkast.json.error] });
  expect([hent.status, hent.json.error]).toEqual([404, "course_draft_not_found"]);
  expect([lagre.status, lagre.json.error]).toEqual([409, "course_drafts_off"]);
  expect([forkast.status, forkast.json.error]).toEqual([404, "course_draft_not_found"]);

  // Direkte lagring av det publiserte kurset, slik kursbyggeren gjør det i dag: ALLE feltene skjemaet sender (også tom
  // plassering og ingen tema), navn og rekkefølge i ett kall. 2.156.0 samlet oversettelsen fra kroppen til feltene i én
  // funksjon for denne ruta; derfor hele kroppen, ikke bare navnet.
  const nyttNavn = `Stage-test 2.155 kurs ${stempel}, lagret direkte`;
  const lagret = await api("PUT", `${kurssti()}/content`, {
    title: L(nyttNavn),
    description: L("Beskrivelse fra stage-testen."),
    certificationLevel: L("basic"),
    enrollmentPolicy: "RESTRICTED",
    discussionsEnabled: false,
    discussionOwnerNotifications: false,
    sortOrder: null,
    themeIds: [],
    items: [{ type: "SECTION", sectionId: s2 }, { type: "SECTION", sectionId: s1 }],
    expectedRevision: detalj.json.course.contentRevision,
  });
  noter("direkte lagring av publisert kurs", { status: lagret.status, error: lagret.json.error });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);
  const etter = await api("GET", kurssti());
  expect(JSON.parse(etter.json.course.title).nb).toBe(nyttNavn);
  expect(JSON.parse(etter.json.course.description).nb).toBe("Beskrivelse fra stage-testen.");
  expect({
    enrollmentPolicy: etter.json.course.enrollmentPolicy,
    discussionsEnabled: etter.json.course.discussionsEnabled,
    discussionOwnerNotifications: etter.json.course.discussionOwnerNotifications,
    sortOrder: etter.json.course.sortOrder,
    themeIds: etter.json.course.themeIds,
  }).toEqual({ enrollmentPolicy: "RESTRICTED", discussionsEnabled: false, discussionOwnerNotifications: false, sortOrder: null, themeIds: [] });
  expect(etter.json.course.contentRevision).toBeGreaterThan(detalj.json.course.contentRevision);
  expect(etter.json.course.drafts).toEqual({ enabled: false, hasDraft: false });
  const elementer = await api("GET", `${kurssti()}/items`);
  expect((elementer.json.items as Array<{ sectionId: string }>).map((i) => i.sectionId)).toEqual([s2, s1]);

  // En utdatert teller avvises fortsatt, og ingenting er skrevet.
  const utdatert = await api("PUT", `${kurssti()}/content`, { title: L("Fra en gammel fane"), items: [{ type: "SECTION", sectionId: s1 }], expectedRevision: detalj.json.course.contentRevision });
  noter("lagring med utdatert teller", { status: utdatert.status, error: utdatert.json.error });
  expect([utdatert.status, utdatert.json.error]).toEqual([409, "course_changed"]);
});

test("2.156.0: «Publiser utkastet» finnes, og svarer 409 course_drafts_off med bryteren av", async () => {
  test.skip(!tilstand.kursId, "kurset ble ikke laget");
  // Skiller 2.156.0 fra 2.155.0, der ruta ikke finnes (404).
  noter("versjon for publiseringsruta", await forventMinstVersjon(BASE, "2.156.0"));
  const før = await api("GET", kurssti());
  const publiser = await api("POST", `${kurssti()}/draft/publish`, { loaded: { draftId: "ingen", revision: 1 } });
  noter("publiser utkastet med bryteren av", { status: publiser.status, error: publiser.json.error });
  expect([publiser.status, publiser.json.error]).toEqual([409, "course_drafts_off"]);
  const etter = await api("GET", kurssti());
  expect(etter.json.course.contentRevision).toBe(før.json.course.contentRevision);
  // Forkast uten id og teller: 400 fra 2.156.0.
  const forkast = await api("DELETE", `${kurssti()}/draft`);
  noter("forkast uten id og teller", forkast.status);
  expect(forkast.status).toBe(400);
});

test("med bryteren av: «Oppdater dette kurset» (import) går som før", async () => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kursId, "kurset ble ikke laget");
  const ut = await api("GET", `${kurssti()}/export-package`);
  expect(ut.status, ut.tekst.slice(0, 300)).toBe(200);
  const fil = ut.json.envelope ?? ut.json;
  const før = await api("GET", kurssti());
  const inn = await api("POST", "/api/admin/content/courses/import", { payload: fil, mode: "updateExisting", targetId: tilstand.kursId });
  noter("import updateExisting", { status: inn.status, error: inn.json.error });
  expect(inn.status, inn.tekst.slice(0, 400)).toBe(201);
  expect(inn.json.courseId).toBe(tilstand.kursId);
  // Importen går gjennom telleren, der låsen sitter: den økte, og kurset er fortsatt publisert.
  const etter = await api("GET", kurssti());
  expect(etter.json.course.contentRevision).toBeGreaterThan(før.json.course.contentRevision);
  expect(etter.json.course.publishedAt).not.toBeNull();
});
