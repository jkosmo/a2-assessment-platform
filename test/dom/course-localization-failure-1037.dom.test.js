import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// #1037: feiler oversettelsen under kurslagring, skal KUN kildespråket lagres.
//
// ⚠️ LØGNEN BLE FORTALT NÅR NOE ALLEREDE HADDE GÅTT GALT. Klienten fylte kildeteksten inn i alle
// tre språk — én gang via `|| sourceTitle` når svaret manglet feltet, og én gang i `catch` ved
// nettverksfeil. Forfatteren så en feilmelding om noe annet, mens kartet stille påsto at kurset var
// oversatt.
//
// Nedstrøms trodde publiseringsgaten at kurset var ferdig, oversettelsesstatusen i lista viste det
// som komplett, og en nynorskdeltaker fikk bokmål servert som nynorsk.
//
// ⚠️ #930 DEKKET IKKE DETTE. Den sørget for at innhold skrevet i ETT språk bærer hvilket. Denne
// stien skriver TRE.
//
// ⚠️ OG STILLHET ER HALVE FEILEN. Å slutte å fylle inn kildetekst er ikke nok: uten en beskjed tror
// forfatteren fortsatt at kurset er ferdig, bare med tomme felt. Derfor måles begge deler.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ jsdom gir ikke import.meta.url som en file:-URL, så stien løses fra prosessens katalog.
const kilde = readFileSync(path.resolve("public/static/admin-content-courses.js"), "utf8");

const funksjon = (() => {
  const start = kilde.indexOf("async function localizeCourseCopyAcrossLocales");
  expect(start, "fant ikke lokaliseringsfunksjonen — kontrollcase").toBeGreaterThan(0);
  const slutt = kilde.indexOf("\n}\n", start);
  // ⚠️ KOMMENTARER STRIPPES. Første utgave av denne vakta sto rød på sin egen forklaring: koden var
  // riktig, men kommentaren «INGEN || sourceTitle HER» inneholdt den forbudte strengen. En vakt som
  // leser prosa måler ikke oppførsel, og en rød test som skyldes en kommentar er verre enn ingen
  // test — den lærer oss å se bort fra utslaget.
  return kilde
    .slice(start, slutt)
    .split("\n")
    .filter((linje) => {
      const t = linje.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
})();

describe("#1037 — kurslagring fyller ikke tre språk med kildeteksten", () => {
  it("⚠️ ingen gren skriver kildeteksten inn i et mållokale", () => {
    // De to konkrete formene saken navnga. En regresjon her ser harmløs ut i en diff — `|| sourceTitle`
    // leses som «fornuftig fallback» — og det er nettopp derfor den må måles.
    const forbudt = [
      "|| sourceTitle",
      "|| sourceDescription",
      "localized.title[targetLocale] = sourceTitle",
      "localized.description[targetLocale] = sourceDescription",
    ];
    const funnet = forbudt.filter((f) => funksjon.includes(f));
    expect(
      funnet.join("\n"),
      "En oversettelse som ikke kom skal se ut som en oversettelse som ikke kom (#982/#905).\n" +
        "Fylles mållokalet med kildeteksten, påstår kartet at innholdet ER oversatt — og\n" +
        "publiseringsgaten, oversettelsesstatusen og deltakeren tror på det.",
    ).toBe("");
  });

  it("⚠️ funksjonen fører opp hvilke lokaler som feilet", () => {
    // Kontrollcase for testen over: uten dette kunne noen fjernet fallbacken og latt lokalen stå
    // tom UTEN å si fra — teknisk sant, men forfatteren ville trodd kurset var ferdig oversatt.
    expect(funksjon, "failedLocales må finnes i returverdien").toContain("failedLocales");
    expect(funksjon, "og faktisk fylles").toContain("failedLocales.push");
  });

  it("⚠️ BEGGE kallerne viser beskjeden — ikke bare den ene", () => {
    // Samme regel på N steder, håndhevet på N−1, er feilklassen som har truffet oss sju ganger.
    // Funksjonen har to kallere: opprettelse fra samtalen, og lagring fra detaljsiden.
    const kallere = kilde.split("await localizeCourseCopyAcrossLocales(").length - 1;
    expect(kallere, "ventet to kallesteder — endres det, må denne testen oppdateres").toBe(2);

    const varsler = kilde.split("meldFeiledeLokaler(").length - 1;
    // Én definisjon + ett kall per kaller.
    expect(
      varsler,
      "hver kaller må si fra. Stillhet gjør den halve rettingen til ingen retting:\n" +
        "feltet blir tomt i stedet for feilmerket, og forfatteren merker det like lite.",
    ).toBe(kallere + 1);
  });

  it("preserveExisting beholdes — en eksisterende oversettelse er ikke en løgn", () => {
    // ⚠️ Grensen mot testene over. Redigerer man et kurs som ALLEREDE har en oversettelse, skal den
    // stå når en ny ikke kom: teksten er oversatt, bare ikke på nytt. Uten denne kunne rettingen
    // blitt for bred og tømt ekte oversettelser ved første nettverksfeil.
    expect(funksjon).toContain("preserveExisting");
  });
});
