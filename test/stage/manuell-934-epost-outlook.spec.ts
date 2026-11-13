import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// Manuell kontroll mot UTRULLET stage: #934 skive 4b, en ekte e-post om ny hovedversjon i en ekte innboks. Kjøres bare med
// MANUELL_EPOST=1 og COURSE_MAJOR_EMAIL_ENABLED=true på stage-workeren, med tokenet til kontoen som skal få e-posten
// (`npm run stage:auth`).
//
// Kurset blir stående publisert, for en rad på et arkivert kurs venter og sendes aldri. Testen skriver ut kurs-id-en. Når
// e-posten er sett: MANUELL_EPOST=1 RYDD_KURS=<id> arkiverer kurset.
// ⚠️ Tokenet skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(process.env.MANUELL_EPOST !== "1", "manuell kontroll, kjøres med MANUELL_EPOST=1");
test.skip(!auth, `hopper over: ${reason}`);

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { authorization: `Bearer ${auth!.accessToken}`, "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = new Date().toISOString().slice(0, 16).replace("T", " ");

async function lagSeksjon(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`E-posttest ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  return id;
}

test("kursbevis for 1.0, så ny hovedversjon: e-posten skal komme innen noen minutter", async () => {
  test.skip(Boolean(process.env.RYDD_KURS), "rydder");
  test.setTimeout(150_000);
  const a = await lagSeksjon("A");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`E-posttest ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const kursId = kurs.json.course.id as string;
  expect((await api("PUT", `/api/admin/content/courses/${kursId}/items`, { items: [{ type: "SECTION", sectionId: a }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${kursId}/publish`)).status).toBe(200);

  const vist = await api("GET", `/api/courses/${kursId}/sections/${a}`);
  expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${kursId}/sections/${a}/read`, { sectionVersionId: vist.json.sectionVersionId })).status);
  const bevis = await api("GET", "/api/courses/completions");
  expect((bevis.json.completions as Array<{ courseId: string }>).filter((c) => c.courseId === kursId)).toHaveLength(1);

  const b = await lagSeksjon("B");
  const lastet = (await api("GET", `/api/admin/content/courses/${kursId}`)).json.course as { contentRevision: number; majorEmailRecipients: number };
  expect(lastet.majorEmailRecipients).toBe(1);
  const lagret = await api("PUT", `/api/admin/content/courses/${kursId}/content`, {
    items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }],
    version: "major",
    confirmEmailRecipients: lastet.majorEmailRecipients,
    expectedRevision: lastet.contentRevision,
  });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);
  const etter = (await api("GET", `/api/admin/content/courses/${kursId}`)).json.course as { versionMajor: number };
  expect(etter.versionMajor).toBe(2);
  console.log(`kurs ${kursId}, hovedversjon 2 lagret ${new Date().toTimeString().slice(0, 8)}`);
});

test("rydder: arkiverer kurset når e-posten er sett", async () => {
  test.skip(!process.env.RYDD_KURS, "bare med RYDD_KURS");
  const id = process.env.RYDD_KURS!;
  expect((await api("POST", `/api/admin/content/courses/${id}/unpublish`)).status).toBe(200);
  expect((await arkiverKurs(api, id)).status).toBe(200);
});
