import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.129.0 mot UTRULLET stage: #934 skive 3 — forfatteren velger mindre versjon eller hovedversjon, og for
// første gang kan hovedversjon 2 lages. Testen går gjennom det en innholdsansvarlig og en deltaker gjør:
//   - et lesekurs publiseres (1.0), testkontoen leser det og får kursbevis for versjon 1;
//   - en seksjon legges til som HOVEDVERSJON → 2.0. De to seksjonene som var der, står som lest; den nye
//     gjenstår. Beviset for versjon 1 står, men er ikke lenger gjeldende;
//   - den nye leses → bevis for versjon 2, og det gamle står fortsatt;
//   - en flytting UTEN svar fra kursskjemaet (markøren) avvises når noen har kursbevis; med svaret «mindre»
//     → 2.1, og kursbevisene er urørt.
//
// Det testen skriver på stage: tre seksjoner og ett kurs («Stage-test 2.129 …»), og to kursbevis for
// testkontoen. Kurset arkiveres etterpå. ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller
// `.stage-service-auth.json`) og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.129.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

type Bevis = { courseId: string; certificateId: string; versionMajor: number; versionMinor: number; current: boolean };

async function lagSeksjon(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.129 ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  return id;
}

async function bevisForKurset(): Promise<Bevis[]> {
  const liste = await api("GET", "/api/courses/completions");
  expect(liste.status, liste.tekst.slice(0, 300)).toBe(200);
  return (liste.json.completions as Bevis[])
    .filter((c) => c.courseId === tilstand.kursId)
    .sort((a, b) => a.versionMajor - b.versionMajor);
}

async function versjon() {
  const detalj = await api("GET", `/api/admin/content/courses/${tilstand.kursId}`);
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  const { versionMajor, versionMinor, certificateHolders } = detalj.json.course;
  return { versionMajor, versionMinor, certificateHolders };
}

async function lest(): Promise<Record<string, boolean>> {
  const detalj = await api("GET", `/api/courses/${tilstand.kursId}`);
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  return Object.fromEntries(
    (detalj.json.course.items as Array<{ type: string; sectionId: string; read: boolean }>)
      .filter((i) => i.type === "SECTION")
      .map((i) => [i.sectionId, i.read]),
  );
}

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
});

test("versjonen er 2.129.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.129.0");
});

test("et lesekurs publiseres som 1.0, og den som har lest alt, får kursbevis for versjon 1", async () => {
  test.setTimeout(150_000);
  const a = await lagSeksjon("A");
  const b = await lagSeksjon("B");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.129 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);
  expect(await versjon()).toEqual({ versionMajor: 1, versionMinor: 0, certificateHolders: 0 });

  for (const id of [a, b]) expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${id}/read`, { sectionVersionId: (await api("GET", `/api/courses/${tilstand.kursId}/sections/${id}`)).json.sectionVersionId })).status);
  const bevis = await bevisForKurset();
  noter("bevis etter versjon 1", bevis.map((c) => `${c.versionMajor}.${c.versionMinor}:${c.current}`));
  expect(bevis.map((c) => [c.versionMajor, c.current])).toEqual([[1, true]]);
  expect(await versjon()).toEqual({ versionMajor: 1, versionMinor: 0, certificateHolders: 1 });
});

test("en seksjon lagt til som HOVEDVERSJON: 2.0 — det leste står, det nye gjenstår, beviset for 1 står", async () => {
  test.setTimeout(150_000);
  const [a, b] = tilstand.seksjoner;
  const c = await lagSeksjon("C");
  const lagret = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, {
    items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }, { type: "SECTION", sectionId: c }],
    version: "major",
  });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(204);
  expect(await versjon()).toEqual({ versionMajor: 2, versionMinor: 0, certificateHolders: 0 });

  const etter = await lest();
  noter("lest etter hovedversjon", etter);
  expect(etter).toEqual({ [a]: true, [b]: true, [c]: false });
  const bevis = await bevisForKurset();
  expect(bevis.map((x) => [x.versionMajor, x.current])).toEqual([[1, false]]);

  expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${c}/read`, { sectionVersionId: (await api("GET", `/api/courses/${tilstand.kursId}/sections/${c}`)).json.sectionVersionId })).status);
  const nå = await bevisForKurset();
  noter("bevis etter at det nye er lest", nå.map((x) => `${x.versionMajor}.${x.versionMinor}:${x.current}`));
  expect(nå.map((x) => [x.versionMajor, x.current])).toEqual([[1, false], [2, true]]);
  expect(nå[0].certificateId).toBe(bevis[0].certificateId);
});

test("en flytting uten svar avvises når noen har kursbevis; som mindre versjon blir det 2.1, og kursbevisene er urørt", async () => {
  const [a, b, c] = tilstand.seksjoner;
  const før = await bevisForKurset();
  const items = [{ type: "SECTION", sectionId: c }, { type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }];
  const uten = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items, versionAware: true });
  noter("flytting uten svar", uten.status);
  expect(uten.status, uten.tekst.slice(0, 300)).toBe(400);
  expect(uten.json.error).toBe("course_version_required");
  const lagret = await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items, versionAware: true, version: "minor" });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(204);
  expect(await versjon()).toEqual({ versionMajor: 2, versionMinor: 1, certificateHolders: 1 });
  expect(await lest()).toEqual({ [a]: true, [b]: true, [c]: true });
  const etter = await bevisForKurset();
  expect(etter.map((x) => x.certificateId)).toEqual(før.map((x) => x.certificateId));
});
