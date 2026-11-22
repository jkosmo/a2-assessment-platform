import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.165.0 mot UTRULLET stage, med ekte data (#1164):
//
//   A. Et nytt kurs uten valgt synlighet er BEGRENSET. Publisert vises det ikke i «Mine kurs» for stage-kontoen (som ikke er
//      tildelt). Kontroll: et kurs laget med `enrollmentPolicy: "OPEN"` er åpent og vises.
//   B. `GET …/publish-audience` sier hvem som ser kurset: begrenset uten tildelinger (0), åpent for det åpne.
//
// #1165 (lese andres kurs og moduler) og #1166 (klassesjekkene under låsen) krever to produsentkontoer eller samtidighet, og
// er dekket av integrasjonstestene (m2-content-read-by-producers-1165, m2-class-lifecycle-locks-1166). Det testen skriver:
// to kurs og én seksjon («Stage-test 2.165.0 …»), alt slettes. ⚠️ Tokenet leses fra den gitignorerte
// `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.165.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const navn = (hva: string) => `Stage-test 2.165.0 ${hva} ${stempel}`;
const tilstand: { seksjon?: string; begrenset?: string; aapent?: string } = {};
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const id of [tilstand.begrenset, tilstand.aapent]) {
    if (!id) continue;
    await arkiverKurs(api, id);
    const s = await api("DELETE", kurssti(id));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs: ${s.status} ${s.json.error ?? ""}`);
  }
  if (tilstand.seksjon) {
    await api("POST", `/api/admin/content/sections/${tilstand.seksjon}/archive`);
    const s = await api("DELETE", `/api/admin/content/sections/${tilstand.seksjon}`);
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon: ${s.status} ${s.json.error ?? ""}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.165.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.165.0"));
});

test("A og B: et nytt kurs er begrenset og vises ikke for den som ikke er tildelt; et åpent kurs vises; publiseringen sier hvem som ser det", async () => {
  test.setTimeout(300_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(navn("seksjon")), bodyMarkdown: L("Text.", "Tekst.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${tilstand.seksjon}/publish`)).status).toBe(200);

  // Uten valgt synlighet.
  const begrenset = await api("POST", "/api/admin/content/courses", { title: L(navn("kurs uten valg")), certificationLevel: "basic" });
  expect(begrenset.status, begrenset.tekst.slice(0, 300)).toBe(201);
  tilstand.begrenset = begrenset.json.course.id as string;
  // Kontroll: åpent valgt eksplisitt.
  const aapent = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "OPEN", title: L(navn("kurs åpent")), certificationLevel: "basic" });
  expect(aapent.status, aapent.tekst.slice(0, 300)).toBe(201);
  tilstand.aapent = aapent.json.course.id as string;

  for (const id of [tilstand.begrenset, tilstand.aapent]) {
    expect((await api("PUT", `${kurssti(id)}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }] })).status).toBe(204);
  }

  const detaljer = {
    begrenset: (await api("GET", kurssti(tilstand.begrenset))).json.course?.enrollmentPolicy,
    aapent: (await api("GET", kurssti(tilstand.aapent))).json.course?.enrollmentPolicy,
  };
  noter("A, synligheten", detaljer);
  expect(detaljer).toEqual({ begrenset: "RESTRICTED", aapent: "OPEN" });

  const publikumBegrenset = await api("GET", `${kurssti(tilstand.begrenset)}/publish-audience`);
  const publikumAapent = await api("GET", `${kurssti(tilstand.aapent)}/publish-audience`);
  noter("B, publish-audience", { begrenset: publikumBegrenset.json.audience, aapent: publikumAapent.json.audience });
  expect(publikumBegrenset.status, publikumBegrenset.tekst.slice(0, 300)).toBe(200);
  expect(publikumBegrenset.json.audience).toMatchObject({ policy: "RESTRICTED", individualCount: 0, totalCount: 0 });
  expect(publikumAapent.json.audience).toEqual({ policy: "OPEN" });

  for (const id of [tilstand.begrenset, tilstand.aapent]) {
    const p = await api("POST", `${kurssti(id)}/publish`);
    expect(p.status, p.tekst.slice(0, 300)).toBe(200);
  }
  const mine = await api("GET", "/api/courses");
  const ider = (mine.json.courses ?? []).map((c: { id: string }) => c.id);
  noter("A, «Mine kurs»", { begrensetSynlig: ider.includes(tilstand.begrenset), aapentSynlig: ider.includes(tilstand.aapent) });
  expect(ider.includes(tilstand.begrenset), "det begrensede kurset vises for en som ikke er tildelt").toBe(false);
  expect(ider.includes(tilstand.aapent), "det åpne kurset vises ikke").toBe(true);
});
