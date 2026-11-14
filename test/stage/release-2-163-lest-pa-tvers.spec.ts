import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.163.0 mot UTRULLET stage, med ekte data (#1156, lest seksjon teller i alle kurs deltakeren ser):
//
//   A. To åpne kurs, A og B, deler seksjonen S (hvert har også en egen seksjon, så ingen av dem blir fullført og ingen
//      kursbevis lages). Stage-kontoen leser S i A. «Mine kurs» viser «Seksjoner 1/2» i BEGGE kursene (før 2.163: 0/2 i B).
//      Kontroll: før lesingen står begge på 0/2.
//   B. Kurs A arkiveres og slettes. Lesingen blir stående (uten kurs) og teller fortsatt i B: 1/2.
//
// Det som ikke lar seg lage med stage-kontoen (begrenset kurs uten tildeling, kursbevis via utboksen, ny hovedversjon) er
// dekket av test/m2-section-read-across-courses-1156.test.ts. Det testen skriver på stage: to kurs og tre seksjoner
// («Stage-test 2.163.0 …»), og én lesing per seksjon for stage-kontoen. Alt slettes. ⚠️ Tokenet leses fra den gitignorerte
// `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.163.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  }).catch((feil: unknown) => {
    throw new Error(`${metode} ${sti.split("?")[0]} svarte ikke: ${feil instanceof Error ? feil.message : String(feil)}`);
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const navn = (hva: string) => `Stage-test 2.163.0 ${hva} ${stempel}`;

const tilstand: { felles?: string; egenA?: string; egenB?: string; kursA?: string; kursB?: string; slettet: Set<string> } = { slettet: new Set() };
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

async function lagSeksjon(hva: string): Promise<string> {
  const s = await api("POST", "/api/admin/content/sections", { title: L(navn(hva)), bodyMarkdown: L("Text.", "Tekst.") });
  expect(s.status, s.tekst.slice(0, 300)).toBe(201);
  const id = s.json.section.id as string;
  expect((await api("POST", `${seksjonssti(id)}/publish`)).status).toBe(200);
  return id;
}

async function lagKurs(hva: string, seksjoner: string[]): Promise<string> {
  const k = await api("POST", "/api/admin/content/courses", { title: L(navn(hva)), certificationLevel: "basic" });
  expect(k.status, k.tekst.slice(0, 300)).toBe(201);
  const id = k.json.course.id as string;
  expect((await api("PUT", `${kurssti(id)}/items`, { items: seksjoner.map((sectionId) => ({ type: "SECTION", sectionId })) })).status).toBe(204);
  const p = await api("POST", `${kurssti(id)}/publish`);
  expect(p.status, p.tekst.slice(0, 300)).toBe(200);
  return id;
}

/** «Seksjoner X/Y» for kurset i «Mine kurs». */
async function seksjonerIMineKurs(kursId: string) {
  const r = await api("GET", "/api/courses");
  expect(r.status).toBe(200);
  const kurs = (r.json.courses ?? []).find((c: { id: string }) => c.id === kursId);
  expect(kurs, `kurset ${kursId.slice(-6)} står ikke i «Mine kurs»`).toBeTruthy();
  return { lest: kurs.progress?.sectionCompleted, av: kurs.progress?.sectionTotal, status: kurs.progress?.courseStatus };
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const id of [tilstand.kursA, tilstand.kursB]) {
    if (!id || tilstand.slettet.has(id)) continue;
    await arkiverKurs(api, id);
    const s = await api("DELETE", kurssti(id));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs ${id.slice(-6)}: ${s.status} ${s.json.error ?? ""}`);
  }
  for (const id of [tilstand.felles, tilstand.egenA, tilstand.egenB]) {
    if (!id) continue;
    await api("POST", `${seksjonssti(id)}/archive`);
    const s = await api("DELETE", seksjonssti(id));
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon ${id.slice(-6)}: ${s.status} ${s.json.error ?? ""}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.163.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.163.0"));
});

test("A: en lesing av den delte seksjonen i kurs A teller også i kurs B i «Mine kurs»", async () => {
  test.setTimeout(300_000);
  tilstand.felles = await lagSeksjon("felles seksjon");
  tilstand.egenA = await lagSeksjon("seksjon bare i A");
  tilstand.egenB = await lagSeksjon("seksjon bare i B");
  tilstand.kursA = await lagKurs("kurs A", [tilstand.felles, tilstand.egenA]);
  tilstand.kursB = await lagKurs("kurs B", [tilstand.felles, tilstand.egenB]);

  const førA = await seksjonerIMineKurs(tilstand.kursA);
  const førB = await seksjonerIMineKurs(tilstand.kursB);
  noter("A, før lesingen", { A: førA, B: førB });
  expect([førA.lest, førA.av, førB.lest, førB.av]).toEqual([0, 2, 0, 2]);

  const vist = await api("GET", `/api/courses/${tilstand.kursA}/sections/${tilstand.felles}`);
  expect(vist.status, vist.tekst.slice(0, 300)).toBe(200);
  const lest = await api("POST", `/api/courses/${tilstand.kursA}/sections/${tilstand.felles}/read`, { sectionVersionId: vist.json.sectionVersionId });
  expect([200, 201, 204], lest.tekst.slice(0, 300)).toContain(lest.status);

  const etterA = await seksjonerIMineKurs(tilstand.kursA);
  const etterB = await seksjonerIMineKurs(tilstand.kursB);
  noter("A, etter lesingen i A", { A: etterA, B: etterB });
  expect([etterA.lest, etterA.av]).toEqual([1, 2]);
  expect([etterB.lest, etterB.av], "lesingen i A teller ikke i B (før 2.163: 0/2)").toEqual([1, 2]);

  const detalj = await api("GET", `/api/courses/${tilstand.kursB}`);
  noter("A, kursdetaljen for B", { status: detalj.status, tekst: detalj.tekst.includes(tilstand.felles) });
  expect(detalj.status).toBe(200);
});

test("B: kurs A slettes; lesingen blir stående og teller fortsatt i B", async () => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kursA || !tilstand.kursB, "kursene ble ikke laget");
  const arkivert = await arkiverKurs(api, tilstand.kursA!);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);
  const slett = await api("DELETE", kurssti(tilstand.kursA!));
  noter("B, slett kurs A", { status: slett.status, error: slett.json.error });
  expect(slett.status, slett.tekst.slice(0, 300)).toBeLessThan(300);
  tilstand.slettet.add(tilstand.kursA!);
  // Den egne seksjonen i A fulgte kurset inn i arkivet; den er fri nå og ryddes i afterAll.
  const etterB = await seksjonerIMineKurs(tilstand.kursB!);
  noter("B, B etter at A er slettet", etterB);
  expect([etterB.lest, etterB.av], "lesingen forsvant med kurs A").toEqual([1, 2]);
});
