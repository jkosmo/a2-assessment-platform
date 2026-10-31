import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.123.0 mot UTRULLET stage: #1077 leveranse 3, «fyll inn ordet som mangler». Lagres med typen og de
// godkjente svarene, avvises uten lukke, eksporteres med typen, leveres UTEN de godkjente svarene, rettes
// (store bokstaver, tegnsetting, et annet språk, én skrivefeil i et langt ord), og gjennomgangen viser de
// godkjente svarene. Mot den ekte modellen: KI-revisjon og -oversettelse beholder typen og lukka.
//
// Det testen skriver på stage: én modul med navn som begynner på «Stage-test», slettet eller arkivert
// til slutt. ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`)
// og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.123.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
// Hvert godkjent svar har alle tre språk, som etter oversettelsen i redigeringen — ellers stopper publiseringen.
const SVAR = [L("three", "tre"), L("3", "3")];
const fyllInn = { questionType: "fill", stem: L("The deadline for an appeal is ___ weeks.", "Fristen for å klage er ___ uker."), options: SVAR, rationale: L("Three weeks.", "Tre uker.") };
const begrep = { questionType: "fill", stem: L("The legal basis when the person agrees is ___.", "Grunnlaget når personen sier ja, er ___."), options: [L("consent", "samtykke")], rationale: L("Consent.", "Samtykke.") };
const tilstand: { moduleId?: string; versionId?: string } = {};

test("versjonen er 2.123.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.123.0");
});

test("lagres med typen; uten lukke avvises; eksporten har typen og de godkjente svarene", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 1077 fill ${Date.now()}`, `Stage-test 1077 fyll inn ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;

  const utenLukke = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [{ ...fyllInn, stem: L("The deadline is three weeks.", "Fristen er tre uker.") }] });
  noter("uten lukke avvises", utenLukke.status);
  expect(utenLukke.status).toBe(400);

  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [fyllInn, begrep] });
  expect(sett.status, sett.tekst).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst).toBe(201);
  tilstand.versionId = versjon.json.moduleVersion.id;

  const eksport = await api("GET", `/api/admin/content/modules/${tilstand.moduleId}/export-package`);
  expect(eksport.status, eksport.tekst).toBe(200);
  const spørsmål = eksport.json.envelope.module.activeVersion.mcqSet.questions[0];
  noter("eksportert type", spørsmål.questionType);
  expect(spørsmål).toMatchObject({ questionType: "fill", options: SVAR });
});

test("leveres uten de godkjente svarene, rettes, og gjennomgangen viser dem", async () => {
  test.setTimeout(180_000);
  const publisert = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${tilstand.versionId}/publish`, {});
  noter("publisering", { status: publisert.status, svar: publisert.tekst.slice(0, 600) });
  expect([200, 201], publisert.tekst.slice(0, 600)).toContain(publisert.status);

  const forsøk = async (svar: [string, string]) => {
    const innlevering = await api("POST", "/api/submissions", { moduleId: tilstand.moduleId, deliveryType: "text", responseJson: {} });
    expect(innlevering.status, innlevering.tekst).toBe(201);
    const submissionId = innlevering.json.submission.id as string;
    const start = await api("GET", `/api/modules/${tilstand.moduleId}/mcq/start?submissionId=${submissionId}`);
    expect(start.status, start.tekst).toBe(200);
    for (const q of start.json.questions) {
      expect(q.questionType).toBe("fill");
      expect(q.options, "de godkjente svarene er fasiten").toEqual([]);
    }
    for (const hemmelig of ["\"tre\"", "\"three\"", "\"samtykke\"", "\"consent\""]) expect(start.tekst).not.toContain(hemmelig);
    const levert = await api("POST", `/api/modules/${tilstand.moduleId}/mcq/submit`, {
      submissionId,
      attemptId: start.json.attemptId,
      responses: start.json.questions.map((q: { id: string }, i: number) => ({ questionId: q.id, textAnswer: svar[i] })),
    });
    expect(levert.status, levert.tekst).toBe(200);
    const gjennomgang = await api("GET", `/api/submissions/${submissionId}/mcq-review`);
    expect(gjennomgang.status, gjennomgang.tekst).toBe(200);
    return { prosent: levert.json.percentScore as number, rader: gjennomgang.json.questions };
  };

  const riktig = await forsøk(["Tre.", "Samtyke"]);
  noter("store bokstaver, punktum og én skrivefeil i et langt ord", riktig.prosent);
  expect(riktig.prosent).toBe(100);
  const engelsk = await forsøk(["3", "consent"]);
  noter("et annet språk og en annen skrivemåte", engelsk.prosent);
  expect(engelsk.prosent).toBe(100);
  const feil = await forsøk(["tro", "avtale"]);
  noter("kort ord med skrivefeil og et annet ord", feil.prosent);
  expect(feil.prosent).toBe(0);
  expect(feil.rader[0]).toMatchObject({ questionType: "fill", isCorrect: false, selectedAnswer: "tro", acceptedAnswers: ["tre", "3"], options: [] });
});

test("KI-revisjon beholder «fyll inn» og lukka når instruksen ikke handler om det", async () => {
  test.setTimeout(240_000);
  const enkelt = { stem: "Hvem skal klagen sendes til?", options: ["Vedtaksorganet", "Klageinstansen direkte", "Statsforvalteren", "Ombudet"], correctAnswer: "Vedtaksorganet", rationale: "Klagen sendes til det organet som fattet vedtaket." };
  const svar = await api("POST", "/api/admin/content/generate/mcq/revise", {
    instruction: "Gjør spørsmål 2 vanskeligere",
    locale: "nb",
    questions: [{ questionType: "fill", stem: "Fristen for å klage er ___ uker.", options: ["tre", "3"], correctAnswer: "tre", rationale: "Forskriften sier tre uker." }, enkelt],
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const første = svar.json.questions[0];
  noter("KI-revisjon: fyll inn", { type: første?.questionType, stamme: første?.stem, svar: første?.options });
  expect(første.questionType).toBe("fill");
  expect((String(første.stem).match(/_{3,}/g) ?? []).length).toBe(1);
});

test("KI-oversettelse beholder én lukke og oversetter de godkjente svarene", async () => {
  test.setTimeout(240_000);
  const svar = await api("POST", "/api/admin/content/generate/mcq/localize", {
    sourceLocale: "nb",
    targetLocale: "en-GB",
    questions: [{ stem: "Fristen for å klage er ___ uker.", options: ["tre", "3"], correctAnswer: "tre", rationale: "Forskriften sier tre uker." }],
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const q = svar.json.questions[0];
  noter("KI-oversettelse: fyll inn", { stamme: q?.stem, svar: q?.options });
  expect((String(q.stem).match(/_{3,}/g) ?? []).length).toBe(1);
  expect(q.options).toHaveLength(2);
  expect(q.options[1]).toBe("3");
});

test.afterAll(async () => {
  if (!tilstand.moduleId) return;
  const slettet = await api("DELETE", `/api/admin/content/modules/${tilstand.moduleId}`);
  noter("slett testmodul", slettet.status);
  if (slettet.status !== 200) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`, {})).status);
});
