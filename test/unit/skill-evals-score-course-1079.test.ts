import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatScore, readCourse, scoreCourse, type EvalCase } from "../../skills/a2-authoring-api-evals/score-course.mjs";

// #1079: testtilfellene for skillet (skills/a2-authoring-api-evals). Anthropic anbefaler at et
// skill har testtilfeller FØR instruksjonene skrives om, og at de kan telles. Tellingen gjøres av
// `score-course.mjs`: gitt et testtilfelle og et ferdig kurs, hva ble det av hvert lysark i kilden?
//
// Denne testen vokter tellingen — ikke skillet. Et telleverk som teller feil, gir tall som ser ut
// som framgang eller tilbakegang uten å være det.

const b64 = (tekst: string) => Buffer.from(tekst, "utf8").toString("base64");
const tre = (tekst: string) => ({ nb: tekst, nn: tekst, "en-GB": tekst });

// En flyt slik tegneskriptet lager den: etikettene er delt i <tspan>, og ett ord er delt med bindestrek.
const FLYT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><title>Arbeidsflyt</title><style>.steg{fill:#eee}</style>
  <circle class="steg s1" cx="40" cy="40" r="20"/><text x="40" y="80"><tspan x="40">Klargjør</tspan><tspan x="40" dy="14">kilder</tspan></text>
  <circle class="steg s2" cx="140" cy="40" r="20"/><text x="140" y="80"><tspan x="140">Lag analyse-</tspan><tspan x="140" dy="14">grunnlag</tspan></text>
  <circle class="steg s3" cx="240" cy="40" r="20"/><text x="240" y="80">Kvalitetssikre</text></svg>`;
const TIDSLINJE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" data-figur="tidslinje"><path d="M0 0h10"/><text x="1" y="1">Uke 1</text><text x="9" y="1">Innlevering</text></svg>`;

const tilfelle: EvalCase = {
  navn: "Prøvekurs",
  ikonerIKilden: 12,
  lysark: [
    { nr: 1, form: "flyt", forventet: ["figur"], nøkkelord: ["Klargjør kilder", "analysegrunnlag", "Kvalitetssikre"] },
    { nr: 2, form: "kort", forventet: ["innholdsblokk"], nøkkelord: ["Chat", "Lerret", "Prosjekt"] },
    { nr: 3, form: "skjermbilde-prompt", forventet: ["prompt-som-tekst"], nøkkelord: [], bildetekst: ["Hjelp meg å forberede et møte", "ønsket utfall per punkt"] },
    { nr: 4, form: "skjermbilde-grensesnitt", forventet: ["bilde"], nøkkelord: ["Møtealternativer", "transkripsjon"] },
    { nr: 5, form: "liste", forventet: ["tekst"], nøkkelord: ["tunge filformat", "ny KI-tråd"] },
    { nr: 6, form: "kort", forventet: ["innholdsblokk"], nøkkelord: ["Dette står ingen steder", "heller ikke dette"] },
    // Ett av fire ord står i kurset («Chat», som er et vanlig ord). Det er ikke nok til å si at lysarket er med.
    { nr: 7, form: "liste", forventet: ["tekst"], nøkkelord: ["Chat", "kontekstvindu", "Grundig tenkemodus", "Lerretet"] },
    { nr: 9, form: "tidslinje", forventet: ["utelatt", "figur"], valgfri: true, nøkkelord: ["Sertifisering"] },
  ],
};

const seksjoner = [
  {
    title: tre("Arbeidsflyten"),
    bodyMarkdown: tre("# Arbeidsflyten\n\n![Arbeidsflyt](asset:flyt)\n\n| Arbeidsform | Når |\n|---|---|\n| **Chat** | raskt |\n| Lerret | over tid |\n| Prosjekt | mange kilder |\n"),
    assets: [{ sourceId: "flyt", filename: "flyt.svg", mimeType: "image/svg+xml", sizeBytes: FLYT.length, contentBase64: b64(FLYT), layoutVariants: [{ layout: "narrow", contentBase64: b64(FLYT) }] }],
  },
  {
    title: tre("Før møtet"),
    bodyMarkdown: tre("Skriv for eksempel: «Hjelp meg å forberede et møte. Foreslå en stram agenda med ønsket utfall per punkt.»\n\n![Møtealternativer i Teams](asset:teams)\n\nUnngå tunge   filformat, og lag en *ny KI-tråd* når samtalen blir lang."),
    assets: [{ sourceId: "teams", filename: "teams.png", mimeType: "image/png", sizeBytes: 410 * 1024, contentBase64: b64("ikke-et-ekte-bilde") }],
  },
];
const eksport = { envelope: { exportFormat: "a2-content-export/v1", course: { course: { title: tre("Prøvekurs"), items: [
  { type: "SECTION", section: seksjoner[0] },
  { type: "SECTION", section: seksjoner[1] },
  { type: "MODULE", module: { module: { title: tre("Test") }, activeVersion: { taskText: tre(""), mcqSet: { questions: [{ stem: tre("Hva gjør du først?"), options: [tre("Leser"), tre("Skriver")] }] } } } },
] } } } };
const forfatterpakke = { packageFormat: "a2-authoring-package/v1", objects: [
  { clientRef: "s1", type: "section", payload: seksjoner[0] },
  { clientRef: "s2", type: "section", payload: seksjoner[1] },
  { clientRef: "m1", type: "module", payload: { title: tre("Test"), mcqSet: { questions: [{ stem: tre("Hva gjør du først?"), options: [tre("Leser"), tre("Skriver")] }] } } },
] };

describe("score-course — hva ble det av hvert lysark?", () => {
  const r = scoreCourse(tilfelle, eksport);
  const ark = (nr: number) => r.lysark.find((l) => l.nr === nr)!;

  it("en figur kjennes igjen på etikettene, også når de er delt i <tspan> og med bindestrek", () => {
    expect(ark(1)).toMatchObject({ funnet: "figur", somForventet: true, nøkkelord: "3/3", figur: { fil: "flyt.svg", form: "flyt" } });
    // Kontroll: «Klargjør kilder» står i to <tspan>, og den FØRSTE må være lest.
    expect(readCourse(eksport).figurer[0]!.tekst).toContain("klargjør kilder");
    expect(readCourse(eksport).figurer[0]!.tekst).toContain("analysegrunnlag");
  });

  it("kort som er blitt en tabell: innholdet er med, men ikke i forventet form", () => {
    expect(ark(2)).toMatchObject({ funnet: "tabell", somForventet: false, innholdMed: true });
  });

  it("en prompt som bare sto i et skjermbilde, og som står som tekst i kurset", () => {
    expect(ark(3)).toMatchObject({ funnet: "prompt-som-tekst", somForventet: true, bildetekst: "2/2" });
    expect(r.sum.tekstFraBilder).toBe("2/2");
  });

  it("et skjermbilde som er tatt med som bilde, kjennes igjen på bildeteksten", () => {
    expect(ark(4)).toMatchObject({ funnet: "bilde", somForventet: true });
  });

  it("tekst finnes selv om kurset har andre mellomrom og utheving", () => {
    expect(ark(5)).toMatchObject({ funnet: "tekst", somForventet: true, nøkkelord: "2/2" });
  });

  it("et lysark som ikke er i kurset, er borte — og teller som en mangel", () => {
    expect(ark(6)).toMatchObject({ funnet: "borte", somForventet: false, innholdMed: false });
  });

  it("ett treff av fire er ikke nok: lysarket regnes som borte", () => {
    expect(ark(7)).toMatchObject({ funnet: "borte", somForventet: false, innholdMed: false, nøkkelord: "1/4" });
  });

  it("et valgfritt lysark teller ikke med i summene, heller ikke når det er utelatt", () => {
    expect(ark(9)).toMatchObject({ funnet: "borte", somForventet: true, valgfri: true });
    expect(r.sum.lysarkMedInnhold).toBe(7);
  });

  it("summene", () => {
    expect(r.sum).toMatchObject({
      innholdMed: 5,
      somForventet: 4,
      // Lysark 2 og 6 venter begge på innholdsblokker; bare ett av dem har innholdet med.
      venterPåInnholdsblokker: 2,
      figurer: 1,
      figurformer: ["flyt"],
      figurerMedSmaltOppsett: 1,
      figurerMedTegning: 0,
      ikonerIKilden: 12,
      tabeller: 1,
      rasterbilder: 1,
      rasterKB: 410,
      tungeBilder: ["teams.png (410 kB)"],
      seksjoner: 2,
      moduler: 1,
    });
  });

  it("de to pakkeformatene gir samme svar", () => {
    expect(scoreCourse(tilfelle, forfatterpakke)).toEqual(r);
  });

  it("en figur som sier selv hva den er (data-figur), telles som den formen — og en tegning telles", () => {
    const med = structuredClone(forfatterpakke);
    (med.objects[0]!.payload as typeof seksjoner[0]).assets.push({ sourceId: "tid", filename: "tid.svg", mimeType: "image/svg+xml", sizeBytes: TIDSLINJE.length, contentBase64: b64(TIDSLINJE), layoutVariants: [] });
    const s = scoreCourse(tilfelle, med).sum;
    expect(s.figurformer).toEqual(["flyt", "tidslinje"]);
    expect(s.figurerMedTegning).toBe(1);
    expect(s.figurerMedSmaltOppsett).toBe(1);
  });

  it("importfila skillet leverer (konvolutten selv, uten { envelope } rundt) leses som eksporten", () => {
    // Prøvekjøringen 2026-10-05: fila fra produce-course ga «0 av 9» fordi bare eksportsvaret
    // fra plattformen ble kjent igjen.
    expect(scoreCourse(tilfelle, eksport.envelope).sum).toEqual(r.sum);
  });

  describe("innholdsblokker i formen skillet skriver dem", () => {
    const blokktilfelle = { navn: "Blokker", lysark: [
      { nr: 1, form: "kort", forventet: ["innholdsblokk"], nøkkelord: ["Sakliste", "Egne notater", "Opptak"] },
      { nr: 2, form: "stripe", forventet: ["innholdsblokk"], nøkkelord: ["Du står ansvarlig", "bare utkastet"] },
      { nr: 3, form: "prompt", forventet: ["innholdsblokk"], nøkkelord: ["Du skal skrive et møtereferat", "Bruk bare det som står"] },
      { nr: 4, form: "kort", forventet: ["innholdsblokk"], nøkkelord: ["Ensom overskrift", "med punkter under"] },
      { nr: 5, form: "kort", forventet: ["innholdsblokk"], nøkkelord: ["Et vanlig sitat", "uten merkelapp"] },
    ] } as unknown as EvalCase;
    const gjerde = "```";
    const medBlokker = (markdown: string) => ({ exportFormat: "a2-content-export/v1", course: { course: { items: [{ type: "SECTION", section: { title: tre("S"), bodyMarkdown: tre(markdown) } }] } } });
    const kurs = medBlokker([
      "### Sakliste", "- gir rekkefølgen", "### Egne notater", "- fanger vedtak", "### Opptak", "- ordrett",
      "## Ny del", "### Ensom overskrift", "med punkter under",
      "> **Husk:** Du står ansvarlig. KI lager bare utkastet.",
      "", "> Et vanlig sitat", "> uten merkelapp",
      "", `${gjerde}prompt`, "Du skal skrive et møtereferat.", "Bruk bare det som står i notatene.", gjerde,
    ].join("\n"));
    const funnet = (nr: number) => scoreCourse(blokktilfelle, kurs).lysark.find((l) => l.nr === nr)!.funnet;

    it("kort (minst to underoverskrifter under samme del), uthevet boks og prompt-boks kjennes igjen", () => {
      expect([funnet(1), funnet(2), funnet(3)]).toEqual(["innholdsblokk", "innholdsblokk", "innholdsblokk"]);
    });

    it("én underoverskrift alene er ikke kort, og et sitat uten fet merkelapp er ikke en uthevet boks", () => {
      expect([funnet(4), funnet(5)]).toEqual(["tekst", "tekst"]);
    });

    it("de samme ordene som løpende tekst er tekst — tellingen gir ikke blokker bort", () => {
      const flatt = medBlokker("Sakliste, Egne notater og Opptak. Du står ansvarlig. KI lager bare utkastet. Du skal skrive et møtereferat. Bruk bare det som står i notatene.");
      expect(scoreCourse(blokktilfelle, flatt).lysark.slice(0, 3).map((l) => l.funnet)).toEqual(["tekst", "tekst", "tekst"]);
    });
  });

  it("et tomt kurs gir null, ikke en feil", () => {
    const tomt = scoreCourse(tilfelle, { packageFormat: "a2-authoring-package/v1", objects: [] });
    expect(tomt.sum).toMatchObject({ innholdMed: 0, somForventet: 0, figurer: 0, figurformer: [], ord: 0 });
    expect(tomt.lysark.filter((l) => l.funnet !== "borte")).toEqual([]);
  });

  it("utskriften sier det samme som tallene", () => {
    const tekst = formatScore(r);
    expect(tekst).toContain("Lysark med innholdet i kurset:       5 av 7");
    expect(tekst).toContain("Lysark som fikk forventet behandling: 4 av 7");
    expect(tekst).toContain("FOR TUNGE: teams.png (410 kB)");
  });
});

// Testtilfellene ligger i repoet, og repoet er offentlig. De beskriver presentasjoner som ligger
// UTENFOR repoet, og skal ikke ta med seg noe derfra som ikke hører hjemme her.
describe("testtilfellene — formen holder, og ingenting personlig er med", () => {
  const mappe = "skills/a2-authoring-api-evals/cases";
  const filer = readdirSync(mappe).filter((f) => f.endsWith(".json"));
  const BEHANDLINGER = ["figur", "innholdsblokk", "tabell", "bilde", "prompt-som-tekst", "tekst", "læringsmål", "oppgave", "struktur", "utelatt"];

  it("kontroll: det finnes minst tre tilfeller (Anthropics råd for skills)", () => {
    expect(filer.length).toBeGreaterThanOrEqual(3);
  });

  it.each(filer)("%s: hvert lysark har nummer, form, gyldige behandlinger og noe å kjenne det igjen på", (fil) => {
    const t = JSON.parse(readFileSync(`${mappe}/${fil}`, "utf8")) as EvalCase;
    expect(t.navn.length).toBeGreaterThan(3);
    expect(t.lysark.length).toBeGreaterThanOrEqual(5);
    expect(new Set(t.lysark.map((l) => l.nr)).size, "hvert lysark står én gang").toBe(t.lysark.length);
    for (const l of t.lysark) {
      expect(l.forventet.length, `lysark ${l.nr}`).toBeGreaterThan(0);
      for (const b of l.forventet) expect(BEHANDLINGER, `lysark ${l.nr}: «${b}»`).toContain(b);
      expect((l.nøkkelord ?? []).length + (l.bildetekst ?? []).length, `lysark ${l.nr} har ingenting å kjennes igjen på`).toBeGreaterThan(0);
    }
    // Et tomt kurs skal gi null på hvert tilfelle — ellers gir tilfellet poeng for ingenting.
    const tomt = scoreCourse(t, { objects: [] });
    expect(tomt.sum.innholdMed).toBe(0);
    expect(tomt.lysark.filter((l) => !l.valgfri && l.somForventet)).toEqual([]);
  });

  it.each(filer)("%s: ingen e-postadresser, nettadresser eller filnavn på dokumenter fra skjermbildene", (fil) => {
    const tekst = readFileSync(`${mappe}/${fil}`, "utf8");
    expect(tekst).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(tekst).not.toMatch(/https?:\/\//i);
    expect(tekst).not.toMatch(/\.(docx|pdf|xlsx)\b/i);
  });
});
