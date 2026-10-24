import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.100.0 (#1077 leveranse 1b) mot UTRULLET stage, med den EKTE språkmodellen. Modellen svarer ikke
// likt hver gang, så testen krever bare de harde reglene — grensen holdes, hver fasit peker på
// alternativer som finnes, typen beholdes når ingen ba om annet — og NOTERER resten i rapporten
// (hvor mange «velg alle» modellen valgte, og hvilke) for et menneske å lese.
//
// Det testen skriver på stage: ingenting. Den kaller bare genererings- og revisjonsendepunktene.
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.100.0-ki", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(sti: string, body: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth!.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

type Q = { questionType?: string; stem: string; options: string[]; correctAnswer: string; correctAnswers?: string[] };

// De harde reglene for hvert spørsmål modellen gir tilbake.
function fasitenStemmer(questions: Q[]) {
  for (const [i, q] of questions.entries()) {
    if (q.questionType === "multiple") {
      expect(q.correctAnswers?.length ?? 0, `spørsmål ${i + 1}: «velg alle» uten riktige`).toBeGreaterThan(0);
      for (const a of q.correctAnswers ?? []) expect(q.options, `spørsmål ${i + 1}: riktig som ikke er et alternativ`).toContain(a);
      expect(q.correctAnswer).toBe(q.correctAnswers![0]);
    } else {
      expect(q.options, `spørsmål ${i + 1}: svaret er ikke et alternativ`).toContain(q.correctAnswer);
    }
  }
}
const antallFlere = (questions: Q[]) => questions.filter((q) => q.questionType === "multiple").length;
const oppsummer = (questions: Q[]) => questions.map((q, i) => `${i + 1}:${q.questionType === "multiple" ? `velg alle (${q.correctAnswers!.length}/${q.options.length})` : "ett"}`).join(" ");

// Kilden lister flere ting som alle stemmer — her ER «velg alle» naturlig.
const MED_LISTER = `Personvernforordningen artikkel 30 krever at den behandlingsansvarlige fører en protokoll over behandlingsaktivitetene. Protokollen skal inneholde: navn og kontaktopplysninger til den behandlingsansvarlige, formålene med behandlingen, en beskrivelse av kategoriene registrerte og personopplysninger, kategoriene mottakere, eventuelle overføringer til tredjeland, de planlagte fristene for sletting, og en generell beskrivelse av de tekniske og organisatoriske sikkerhetstiltakene.
Artikkel 5 fastsetter prinsippene for behandling: lovlighet, rettferdighet og åpenhet; formålsbegrensning; dataminimering; riktighet; lagringsbegrensning; integritet og konfidensialitet. I tillegg skal den behandlingsansvarlige kunne påvise at prinsippene overholdes (ansvarsprinsippet).
Protokollen skal ikke inneholde selve personopplysningene, og den skal ikke sendes til Datatilsynet uoppfordret, men gjøres tilgjengelig på forespørsel.`;

// Kilden er én sammenhengende vurdering uten lister — her er ett svar naturlig.
const UTEN_LISTER = `Når en ansatt slutter, skal tilgangen til e-postkassen stenges senest siste arbeidsdag. Arbeidsgiver kan bare åpne e-postkassen etterpå dersom det er nødvendig for å ivareta den daglige driften, og den tidligere ansatte skal som hovedregel varsles på forhånd og gis anledning til å være til stede. Innsynet skal begrenses til det som er nødvendig, og det skal dokumenteres hva som ble åpnet og hvorfor.`;

const generer = (sourceMaterial: string, questionCount: number) => api("/api/admin/content/generate/mcq", {
  sourceMaterial, certificationLevel: "intermediate", locale: "nb", generationMode: "ordinary", questionCount, optionCount: 4,
});

test("generering fra en kilde med lister: høyst hvert tredje «velg alle», og hver fasit stemmer", async () => {
  const svar = await generer(MED_LISTER, 6);
  expect(svar.status, svar.tekst).toBe(200);
  const questions = svar.json.questions as Q[];
  noter("med lister: typer", oppsummer(questions));
  noter("med lister: advarsler", svar.json.validation?.issues ?? []);
  fasitenStemmer(questions);
  // Taket er hvert tredje; over det gir tjeneren en advarsel, ikke et avslag. Advarselen skal da stå der.
  if (antallFlere(questions) > 2) expect(JSON.stringify(svar.json.validation?.issues ?? [])).toMatch(/select all that apply/);
  for (const q of questions.filter((x) => x.questionType === "multiple")) noter("med lister: «velg alle»", { stem: q.stem, options: q.options, riktige: q.correctAnswers });
});

test("generering fra en kilde uten lister: notert hvor mange «velg alle» modellen likevel lager", async () => {
  const svar = await generer(UTEN_LISTER, 3);
  expect(svar.status, svar.tekst).toBe(200);
  const questions = svar.json.questions as Q[];
  noter("uten lister: typer", oppsummer(questions));
  fasitenStemmer(questions);
  expect(antallFlere(questions), "3 spørsmål gir et tak på 1").toBeLessThanOrEqual(1);
});

const SETT: Q[] = [
  { questionType: "multiple", stem: "Hva skal protokollen etter artikkel 30 inneholde?", options: ["Formålene med behandlingen", "Selve personopplysningene", "Fristene for sletting", "Kopi av samtykkeskjemaene"], correctAnswer: "Formålene med behandlingen", correctAnswers: ["Formålene med behandlingen", "Fristene for sletting"] },
  { stem: "Hvem skal protokollen gjøres tilgjengelig for?", options: ["Datatilsynet på forespørsel", "Alle registrerte uoppfordret", "Databehandleren hvert år", "Ingen utenfor virksomheten"], correctAnswer: "Datatilsynet på forespørsel" },
  { stem: "Hva betyr dataminimering?", options: ["Ikke mer data enn nødvendig for formålet", "Data skal slettes etter ett år", "Data skal krypteres i ro", "Data skal lagres i Norge"], correctAnswer: "Ikke mer data enn nødvendig for formålet" },
  { stem: "Hva krever ansvarsprinsippet?", options: ["At virksomheten kan påvise etterlevelse", "At en jurist godkjenner behandlingen", "At den registrerte signerer", "At protokollen sendes inn årlig"], correctAnswer: "At virksomheten kan påvise etterlevelse" },
];
const revider = (instruction: string, questions: Q[] = SETT) => api("/api/admin/content/generate/mcq/revise", {
  questions: questions.map((q) => ({ ...q, rationale: "Artikkel 5 og 30." })), instruction, locale: "nb", questionCount: questions.length, optionCount: 4,
});

test("revisjon av noe annet enn typene: hver type beholdes", async () => {
  const svar = await revider("Gjør formuleringen i spørsmål 2 tydeligere.");
  expect(svar.status, svar.tekst).toBe(200);
  const questions = svar.json.questions as Q[];
  noter("målrettet revisjon: typer", oppsummer(questions));
  fasitenStemmer(questions);
  expect(questions.map((q) => q.questionType ?? "single")).toEqual(["multiple", "single", "single", "single"]);
});

test("«gjør testen vanskeligere»: modellen kan bruke «velg alle», men høyst halvparten", async () => {
  const svar = await revider("Gjør testen vanskeligere.");
  noter("vanskeligere: status", svar.status);
  // Et avslag over taket (etter nytt forsøk) er en lovlig utgang; et 500 av annen grunn er det ikke.
  if (svar.status !== 200) {
    expect(svar.tekst).toMatch(/at most 2 are allowed|answer key/);
    return;
  }
  const questions = svar.json.questions as Q[];
  noter("vanskeligere: typer", oppsummer(questions));
  fasitenStemmer(questions);
  expect(antallFlere(questions)).toBeLessThanOrEqual(2);
});
