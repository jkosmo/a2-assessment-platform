import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.131.0 mot UTRULLET stage: #934 skive 4a — innholdslåsen og kursskjemaets teller (doc/DESIGN_934.md, «4a»).
//   - kursdetaljen sender telleren (`contentRevision`), og en lagring med den går gjennom;
//   - to faner: den andre lagringen med samme lastede teller avvises med 409 `course_changed`, og ingenting av den
//     står lagret;
//   - en gammel fane (uten teller) avvises før første skriving: `PUT /:courseId` og `PUT …/items` gir
//     409 `course_form_outdated`, og navnet er uendret;
//   - et nytt kurs som aldri har vært ute, får elementene uten teller (slik skjemaet og agent-tokenet gjør).
//
// Det testen skriver på stage: to seksjoner og ett kurs («Stage-test 2.131 …»). Kurset arkiveres etterpå.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.131.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: { kursId?: string; seksjoner: string[] } = { seksjoner: [] };

async function lagSeksjon(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.131 ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  return id;
}

async function detalj() {
  const svar = await api("GET", `/api/admin/content/courses/${tilstand.kursId}`);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  return svar.json.course as { title: string; contentRevision: number; versionMajor: number; versionMinor: number };
}

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
});

test("versjonen er 2.131.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.131.0");
});

test("et nytt kurs får elementene uten teller, publiseres, og kursdetaljen sender telleren", async () => {
  test.setTimeout(120_000);
  const a = await lagSeksjon("A");
  const b = await lagSeksjon("B");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.131 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  const items = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }] });
  expect(items.status, items.tekst.slice(0, 300)).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);
  const nå = await detalj();
  noter("teller etter oppretting", nå.contentRevision);
  expect(typeof nå.contentRevision).toBe("number");
});

test("to faner: den første lagrer, den andre får 409 course_changed, og ingenting av den andre står lagret", async () => {
  const [a, b] = tilstand.seksjoner;
  const lastet = (await detalj()).contentRevision;
  const første = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/content`, {
    title: L(`Stage-test 2.131 kurs ${stempel} (fane A)`),
    items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }],
    expectedRevision: lastet,
  });
  expect(første.status, første.tekst.slice(0, 300)).toBe(200);
  const andre = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/content`, {
    title: L(`Stage-test 2.131 kurs ${stempel} (fane B)`),
    items: [{ type: "SECTION", sectionId: b }],
    expectedRevision: lastet,
  });
  noter("andre fane", { status: andre.status, error: andre.json.error });
  expect(andre.status).toBe(409);
  expect(andre.json.error).toBe("course_changed");
  const etter = await detalj();
  expect(JSON.parse(etter.title).nb).toContain("(fane A)");
});

test("en gammel fane (uten teller) avvises før første skriving, og navnet er uendret", async () => {
  const [a] = tilstand.seksjoner;
  const før = await detalj();
  const navn = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}`, { title: L("Gammel fane") });
  const elementer = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: a }], versionAware: true });
  noter("gammel fane", { navn: navn.json.error, elementer: elementer.json.error });
  expect(navn.status).toBe(409);
  expect(navn.json.error).toBe("course_form_outdated");
  expect(elementer.status).toBe(409);
  expect(elementer.json.error).toBe("course_form_outdated");
  const etter = await detalj();
  expect(etter.title).toBe(før.title);
  expect(etter.contentRevision).toBe(før.contentRevision);
});
