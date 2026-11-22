import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.166.0 mot UTRULLET stage, med ekte data (#1163, skive 1): «Lagre» på en seksjon lager et utkast.
//
//   A. En publisert seksjon i et publisert, åpent kurs får ny tittel og tekst med den nye lagringen (PUT …/sections/:id).
//      Deltakeren ser fortsatt den gamle tittelen og teksten, både i leseren og i kursdetaljen.
//   B. En lagring med utdatert versjon svarer 409 `section_changed`, og ingenting skrives (kontroll: riktig versjon lagret i A).
//   C. Publisering med versjonen forfatteren så: deltakeren ser den nye tittelen og teksten, og en ny versjon-id.
//
// Det testen skriver: ett kurs og én seksjon («Stage-test 2.166.0 …»), alt slettes. ⚠️ Tokenet leses fra den gitignorerte
// `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.166.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const navn = (hva: string) => `Stage-test 2.166.0 ${hva} ${stempel}`;
const GAMMEL = { tittel: navn("seksjon gammel"), tekst: `Gammel tekst ${stempel}.` };
const NY = { tittel: navn("seksjon ny"), tekst: `Ny tekst ${stempel}.` };
const tilstand: { seksjon?: string; kurs?: string; versjonIdFor?: string; lagretVersjon?: number } = {};
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

async function deltakerSer() {
  const leser = await api("GET", `/api/courses/${tilstand.kurs}/sections/${tilstand.seksjon}`);
  expect(leser.status, leser.tekst.slice(0, 300)).toBe(200);
  const detalj = await api("GET", `/api/courses/${tilstand.kurs}`);
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  return {
    tittel: leser.json.title as string,
    gammelTekst: (leser.json.html as string).includes(GAMMEL.tekst),
    nyTekst: (leser.json.html as string).includes(NY.tekst),
    versjonId: leser.json.sectionVersionId as string,
    kursdetaljGammelTittel: detalj.tekst.includes(GAMMEL.tittel),
    kursdetaljNyTittel: detalj.tekst.includes(NY.tittel),
  };
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kurs) {
    await arkiverKurs(api, tilstand.kurs);
    const s = await api("DELETE", kurssti(tilstand.kurs));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs: ${s.status} ${s.json.error ?? ""}`);
  }
  if (tilstand.seksjon) {
    await api("POST", `${seksjonssti(tilstand.seksjon)}/archive`);
    const s = await api("DELETE", seksjonssti(tilstand.seksjon));
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon: ${s.status} ${s.json.error ?? ""}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.166.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.166.0"));
});

test("A: lagring av en publisert seksjon lager et utkast; deltakeren ser fortsatt det gamle", async () => {
  test.setTimeout(300_000);
  const s = await api("POST", "/api/admin/content/sections", { title: L(GAMMEL.tittel), bodyMarkdown: L(GAMMEL.tekst) });
  expect(s.status, s.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = s.json.section.id as string;
  expect((await api("POST", `${seksjonssti(tilstand.seksjon)}/publish`)).status).toBe(200);

  const k = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "OPEN", title: L(navn("kurs")), certificationLevel: "basic" });
  expect(k.status, k.tekst.slice(0, 300)).toBe(201);
  tilstand.kurs = k.json.course.id as string;
  expect((await api("PUT", `${kurssti(tilstand.kurs)}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }] })).status).toBe(204);
  const p = await api("POST", `${kurssti(tilstand.kurs)}/publish`);
  expect(p.status, p.tekst.slice(0, 300)).toBe(200);

  const før = await deltakerSer();
  noter("A, deltakeren før lagring", før);
  expect([før.tittel, før.gammelTekst, før.kursdetaljGammelTittel]).toEqual([GAMMEL.tittel, true, true]);
  tilstand.versjonIdFor = før.versjonId;

  const detalj = await api("GET", seksjonssti(tilstand.seksjon));
  expect(detalj.status).toBe(200);
  const lagret = await api("PUT", seksjonssti(tilstand.seksjon), {
    title: L(NY.tittel),
    bodyMarkdown: L(NY.tekst),
    expectedVersionNo: detalj.json.section.versionNo,
    expectedTitle: detalj.json.section.title,
  });
  noter("A, lagringen", { status: lagret.status, versjon: lagret.json.section?.versionNo, publisert: lagret.json.section?.publishedVersionNo, utkast: lagret.json.section?.hasUnpublishedChanges });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);
  expect(lagret.json.section.hasUnpublishedChanges).toBe(true);
  expect(lagret.json.section.publishedVersionNo).toBe(detalj.json.section.versionNo);
  tilstand.lagretVersjon = lagret.json.section.versionNo as number;

  const etter = await deltakerSer();
  noter("A, deltakeren etter lagring", etter);
  expect(etter).toMatchObject({ tittel: GAMMEL.tittel, gammelTekst: true, nyTekst: false, versjonId: før.versjonId, kursdetaljNyTittel: false });
});

test("B: lagring med utdatert versjon svarer 409 og skriver ingenting", async () => {
  test.skip(!tilstand.lagretVersjon, "A ble ikke fullført");
  const utdatert = await api("PUT", seksjonssti(tilstand.seksjon!), {
    title: L(navn("seksjon fra gammel fane")),
    bodyMarkdown: L("Fra en gammel fane."),
    expectedVersionNo: tilstand.lagretVersjon! - 1,
    expectedTitle: JSON.stringify(L(GAMMEL.tittel)),
  });
  noter("B, utdatert lagring", { status: utdatert.status, error: utdatert.json.error });
  expect(utdatert.status).toBe(409);
  expect(utdatert.json.error).toBe("section_changed");
  const detalj = await api("GET", seksjonssti(tilstand.seksjon!));
  expect(detalj.json.section.versionNo, "en avvist lagring lager ingen versjon").toBe(tilstand.lagretVersjon);
});

test("C: publisering med versjonen forfatteren så viser det nye til deltakeren", async () => {
  test.skip(!tilstand.lagretVersjon, "A ble ikke fullført");
  const p = await api("POST", `${seksjonssti(tilstand.seksjon!)}/publish`, { expectedVersionNo: tilstand.lagretVersjon });
  noter("C, publiseringen", { status: p.status, publisert: p.json.section?.publishedVersionNo });
  expect(p.status, p.tekst.slice(0, 300)).toBe(200);
  const etter = await deltakerSer();
  noter("C, deltakeren etter publisering", etter);
  expect(etter).toMatchObject({ tittel: NY.tittel, nyTekst: true, gammelTekst: false, kursdetaljNyTittel: true });
  expect(etter.versjonId).not.toBe(tilstand.versjonIdFor);
});
