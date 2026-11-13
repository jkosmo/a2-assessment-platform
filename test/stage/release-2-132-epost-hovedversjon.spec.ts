import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.132.0 mot UTRULLET stage: #934 skive 4b — e-post ved ny hovedversjon (doc/DESIGN_934.md, «4b»).
//   - kursdetaljen, `publish-preview` og `pending-versions` sender `majorEmailRecipients` (hvor mange en hovedversjon
//     sender e-post til), fra samme funksjon som lager e-postradene;
//   - testkontoen leser et lesekurs og får kursbevis for 1.0; da er den én mottaker;
//   - en hovedversjon gjennom kursskjemaets ene kall, med `confirmEmailRecipients`, går gjennom (2.0). Etterpå teller
//     tallet fortsatt beviset for 1.0 — e-posten går til dem med bevis for en ELDRE versjon — mens
//     `certificateHolders` (nåværende hovedversjon) er 0;
//   - en mindre versjon med feltet godtas også (en ny klient sender det bare ved hovedversjon, men feltet er ikke farlig).
//
// Hva testen IKKE kan se: radene i `CourseVersionNotice` (ingen rute viser dem) og 200-regelen (den krever 201 med
// kursbevis). Begge er dekket av integrasjonstesten. Er COURSE_MAJOR_EMAIL_ENABLED på på stage-workeren, får
// testkontoens adresse e-posten innen et par minutter — sjekk den for hånd (bilde, ingen lenker, språk).
//
// Det testen skriver på stage: tre seksjoner og ett kurs («Stage-test 2.132 …»), og et kursbevis for testkontoen.
// Kurset arkiveres etterpå (beviset står; et utstedt bevis slettes aldri).
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.132.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.132 ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  return id;
}

async function detalj() {
  const svar = await api("GET", `/api/admin/content/courses/${tilstand.kursId}`);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  return svar.json.course as { contentRevision: number; versionMajor: number; versionMinor: number; certificateHolders: number; majorEmailRecipients: number };
}

const tall = (c: { versionMajor: number; versionMinor: number; certificateHolders: number; majorEmailRecipients: number }) => ({
  versionMajor: c.versionMajor,
  versionMinor: c.versionMinor,
  certificateHolders: c.certificateHolders,
  majorEmailRecipients: c.majorEmailRecipients,
});

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await arkiverKurs(api, tilstand.kursId)).status);
  }
});

test("versjonen er minst 2.132.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.132.0"));
});

test("et nytt lesekurs: ingen mottakere; etter at testkontoen har lest alt, én — i detaljen, forhåndsvisningen og «nye versjoner»", async () => {
  test.setTimeout(150_000);
  const a = await lagSeksjon("A");
  const b = await lagSeksjon("B");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.132 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);
  expect(tall(await detalj())).toEqual({ versionMajor: 1, versionMinor: 0, certificateHolders: 0, majorEmailRecipients: 0 });

  for (const id of [a, b]) expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${id}/read`, { sectionVersionId: (await api("GET", `/api/courses/${tilstand.kursId}/sections/${id}`)).json.sectionVersionId })).status);
  const bevis = await api("GET", "/api/courses/completions");
  expect(bevis.status).toBe(200);
  expect((bevis.json.completions as Array<{ courseId: string }>).filter((c) => c.courseId === tilstand.kursId)).toHaveLength(1);

  const nå = await detalj();
  noter("tall etter kursbevis", tall(nå));
  expect(tall(nå)).toEqual({ versionMajor: 1, versionMinor: 0, certificateHolders: 1, majorEmailRecipients: 1 });
  const forhånd = await api("GET", `/api/admin/content/courses/${tilstand.kursId}/publish-preview`);
  expect(forhånd.json.course).toMatchObject({ certificateHolders: 1, majorEmailRecipients: 1 });
  const ventende = await api("GET", `/api/admin/content/courses/${tilstand.kursId}/pending-versions`);
  expect(ventende.status, ventende.tekst.slice(0, 300)).toBe(200);
  expect(ventende.json.course).toMatchObject({ certificateHolders: 1, majorEmailRecipients: 1 });
});

test("en hovedversjon med det bekreftede tallet går gjennom; etterpå teller e-posttallet fortsatt beviset for 1.0", async () => {
  test.setTimeout(150_000);
  const [a, b] = tilstand.seksjoner;
  const c = await lagSeksjon("C");
  const lastet = await detalj();
  const lagret = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/content`, {
    items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }, { type: "SECTION", sectionId: c }],
    version: "major",
    confirmEmailRecipients: lastet.majorEmailRecipients,
    expectedRevision: lastet.contentRevision,
  });
  noter("hovedversjon", { status: lagret.status, error: lagret.json.error });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);
  expect(tall(await detalj())).toEqual({ versionMajor: 2, versionMinor: 0, certificateHolders: 0, majorEmailRecipients: 1 });
});

test("en mindre versjon med feltet godtas (ingen 400), og gir ingen ny hovedversjon", async () => {
  const [a, b, c] = tilstand.seksjoner;
  const lastet = await detalj();
  const lagret = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/content`, {
    items: [{ type: "SECTION", sectionId: c }, { type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }],
    version: "minor",
    confirmEmailRecipients: 1,
    expectedRevision: lastet.contentRevision,
  });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);
  expect(tall(await detalj())).toMatchObject({ versionMajor: 2, versionMinor: 1 });
});
