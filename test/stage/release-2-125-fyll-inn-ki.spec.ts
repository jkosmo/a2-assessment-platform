import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.125.0 mot UTRULLET stage: #1077 leveranse 3b, KI lager «fyll inn ordet som mangler» — mot den EKTE
// modellen. Kilden med tall og begreper: høyst ett, med én lukke og skrivemåter av samme svar. Kilden med
// bare vurderinger: helst ingen, og da en begrunnelse. Revisjonen gjør om et spørsmål når forfatteren ber om det.
//
// Testen skriver ingenting på stage: den bruker bare genereringen og revisjonen.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`)
// og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.125.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

type Spørsmål = { questionType?: string; stem: string; options: string[]; correctAnswer: string };
const lukker = (stamme: string) => (stamme.match(/_{3,}/g) ?? []).length;

function sjekkFyllInn(spørsmål: Spørsmål[]) {
  const fyllInn = spørsmål.filter((q) => q.questionType === "fill");
  expect(fyllInn.length, "høyst ett «fyll inn»").toBeLessThanOrEqual(1);
  for (const q of fyllInn) {
    expect(lukker(q.stem), "én lukke").toBe(1);
    expect(q.options.length).toBeGreaterThanOrEqual(1);
    expect(q.options.length).toBeLessThanOrEqual(6);
    expect(q.correctAnswer).toBe(q.options[0]);
  }
  return fyllInn;
}

test("versjonen er 2.125.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.125.0");
});

test("KI-generering fra en kilde med frister og begreper: høyst ett «fyll inn», med én lukke — eller en begrunnelse", async () => {
  test.setTimeout(240_000);
  const kilde = [
    "Klagefristen etter forvaltningsloven er tre uker fra vedtaket ble mottatt.",
    "Klagen sendes til det organet som fattet vedtaket, kalt underinstansen.",
    "Opprettholder underinstansen vedtaket, sendes saken til klageinstansen.",
    "Den som klager, har rett til innsyn i sakens dokumenter.",
    "Klagen må være skriftlig, og den skal nevne vedtaket og endringen som ønskes.",
  ].join("\n");
  const svar = await api("POST", "/api/admin/content/generate/mcq", { sourceMaterial: kilde, certificationLevel: "basic", locale: "nb", questionCount: 5, optionCount: 4 });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const fyllInn = sjekkFyllInn(svar.json.questions);
  noter("KI: fyll inn (frister og begreper)", { antall: fyllInn.length, stamme: fyllInn[0]?.stem ?? null, svar: fyllInn[0]?.options ?? null, begrunnelse: svar.json.noFillReason ?? null });
  if (fyllInn.length === 0) expect(String(svar.json.noFillReason ?? "").trim(), "uten «fyll inn» skal KI si hvorfor").not.toBe("");
});

test("KI-generering fra en kilde med bare vurderinger: høyst ett — og uten, en begrunnelse", async () => {
  test.setTimeout(240_000);
  const kilde = [
    "God veiledning tar utgangspunkt i det brukeren faktisk trenger, ikke i det saksbehandleren vet.",
    "Det er bedre å spørre én gang for mye enn å bygge på en antakelse.",
    "Når saken er uklar, bør saksbehandleren forklare hva som er uklart og hvorfor det betyr noe for utfallet.",
    "En vurdering skal kunne etterprøves: skriv ned hvilke hensyn som ble vektlagt.",
  ].join("\n");
  const svar = await api("POST", "/api/admin/content/generate/mcq", { sourceMaterial: kilde, certificationLevel: "basic", locale: "nb", questionCount: 4, optionCount: 4 });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const fyllInn = sjekkFyllInn(svar.json.questions);
  noter("KI: fyll inn (vurderinger)", { antall: fyllInn.length, stamme: fyllInn[0]?.stem ?? null, svar: fyllInn[0]?.options ?? null, begrunnelse: svar.json.noFillReason ?? null });
  if (fyllInn.length === 0) expect(String(svar.json.noFillReason ?? "").trim(), "uten «fyll inn» skal KI si hvorfor").not.toBe("");
});

test("KI-revisjon: forfatteren ber om «fyll inn» på spørsmål 1, og får det med én lukke", async () => {
  test.setTimeout(240_000);
  const frist = { stem: "Hvor lang er klagefristen etter forvaltningsloven?", options: ["Tre uker", "Én uke", "Seks uker", "Tre måneder"], correctAnswer: "Tre uker", rationale: "Fristen er tre uker fra vedtaket ble mottatt." };
  const hvem = { stem: "Hvem skal klagen sendes til?", options: ["Organet som fattet vedtaket", "Klageinstansen direkte", "Statsforvalteren", "Sivilombudet"], correctAnswer: "Organet som fattet vedtaket", rationale: "Klagen sendes til underinstansen." };
  const svar = await api("POST", "/api/admin/content/generate/mcq/revise", {
    instruction: "Gjør spørsmål 1 om til et «fyll inn ordet som mangler»-spørsmål",
    locale: "nb",
    questions: [frist, hvem],
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const første = svar.json.questions[0] as Spørsmål;
  noter("KI-revisjon: gjort om til fyll inn", { type: første?.questionType, stamme: første?.stem, svar: første?.options });
  expect(første.questionType).toBe("fill");
  sjekkFyllInn(svar.json.questions);
  expect(svar.json.questions[1].questionType ?? null, "det andre spørsmålet er urørt").toBeNull();
});
