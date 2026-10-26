import { describe, expect, it } from "vitest";
import { checkExerciseCopies, readExercises } from "../../skills/a2-authoring-api/scripts/exercise-copy-check.mjs";

// #1121: en øvelse som besvares av teksten rett over, er en kopiøvelse. Grensene ble satt etter
// målingen på de 15 kursene på stage (5 treff av 27 øvelser, alle reelle).

const EKSEMPEL = "Jeg har brukt KI som støtte til å strukturere agendaen og teste alternative formuleringer av beslutningspunktene. Jeg har selv kontrollert beslutninger, ansvar og frister før jeg delte agendaen.";

describe("#1121 «skriv selv»", () => {
  it("eksempelsvaret er eksempelet over, nesten ordrett → funn", () => {
    const md = `Slik kan det lyde:\n\n> ${EKSEMPEL}\n\n:::skriv Skriv to setninger om hvordan du brukte KI.\n${EKSEMPEL.replace("agendaen.", "referatet.")}\n\n- [ ] hva KI ble brukt til?\n:::`;
    const funn = checkExerciseCopies(md);
    expect(funn.map((f) => f.kind)).toEqual(["skriv"]);
    expect(funn[0]!.line).toBe(5);
  });

  it("en annen situasjon, med egne ord → ingen funn", () => {
    const md = `Slik kan det lyde:\n\n> ${EKSEMPEL}\n\n:::skriv Skriv to setninger til kunden om hvordan KI ble brukt i tilbudet.\nKI laget første utkast til prisvedlegget. Tallene er sjekket mot kalkylen av prosjektlederen før tilbudet gikk ut.\n\n- [ ] hva KI gjorde?\n:::`;
    expect(checkExerciseCopies(md)).toEqual([]);
  });

  it("sjekklista teller ikke med — den kan godt bruke ordene over", () => {
    const md = `${EKSEMPEL}\n\n:::skriv Skriv om bruken.\nKI laget første utkast, og prosjektlederen gikk gjennom tallene.\n\n- [ ] Jeg har brukt KI som støtte til å strukturere agendaen og teste alternative formuleringer?\n:::`;
    expect(checkExerciseCopies(md)).toEqual([]);
  });
});

describe("#1121 «finn parene»", () => {
  const tabell = "| Markør | Betyr |\n|---|---|\n| KILDEBASERT | Direkte støttet av prosjektets kilder eller tidligere arbeidsfiler |\n| ANALYSE | Analyse eller sammenstilling basert på kildene |";
  it("forklaringene står i tabellen rett over → funn", () => {
    const md = `${tabell}\n\n:::par Koble markøren med det den betyr\n- KILDEBASERT = Direkte støttet av prosjektets kilder\n- ANALYSE = Analyse eller sammenstilling basert på kildene\n:::`;
    expect(checkExerciseCopies(md).map((f) => f.kind)).toEqual(["par"]);
  });
  it("forklart med andre ord → ingen funn", () => {
    const md = `${tabell}\n\n:::par Koble markøren med det den betyr\n- KILDEBASERT = Står slik i et dokument du har lagt inn\n- ANALYSE = KI har satt sammen eller tolket noe\n:::`;
    expect(checkExerciseCopies(md)).toEqual([]);
  });
});

describe("#1121 «sjekk deg selv»", () => {
  const tekst = "Når du trenger oppdaterte tall fra flere kilder, bruker du dyp forskning i en egen chat eller et eget prosjekt.";
  it("riktig svar gjentar teksten, de gale gjør det ikke → funn", () => {
    const md = `${tekst}\n\n:::sjekk Hva bruker du?\n- [ ] Vanlig chat\n- [x] Dyp forskning i en egen chat eller et eget prosjekt\n- [ ] Et bilde\n:::`;
    expect(checkExerciseCopies(md).map((f) => f.kind)).toEqual(["sjekk"]);
  });
  it("gjentar også et galt alternativ teksten, er ordlyden ikke et hint", () => {
    const md = `${tekst}\n\n:::sjekk Hva bruker du?\n- [ ] Når du trenger oppdaterte tall fra flere kilder, vanlig chat\n- [x] Dyp forskning i en egen chat eller et eget prosjekt\n:::`;
    expect(checkExerciseCopies(md)).toEqual([]);
  });
});

describe("#1121 lesingen", () => {
  it("en ramme i en kodeblokk er ikke en øvelse; engelske markører teller", () => {
    const md = "```\n:::skriv Ikke en øvelse\nx\n:::\n```\n\nTekst.\n\n:::write Write it.\nAnswer.\n:::\n\n:::pairs\n- A = B\n:::";
    expect(readExercises(md).map((e) => e.kind)).toEqual(["skriv", "par"]);
  });
  it("en øvelse øverst i seksjonen har ingen tekst over seg å kopiere fra", () => {
    expect(checkExerciseCopies(`:::skriv Skriv.\n${EKSEMPEL}\n:::`)).toEqual([]);
  });
});
