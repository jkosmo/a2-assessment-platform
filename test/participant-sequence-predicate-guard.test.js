import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isEntryAvailable,
  isEntryDone,
  isEntryOutstanding,
  isEntryRequired,
} from "../public/participant-console-state.js";

// ─────────────────────────────────────────────────────────────────────────────
// #992: klientens sekvenspredikater — oppførselen, OG at ingen skriver sin egen kopi.
//
// Funnet var ikke at ett sted glemte `available`. Det var at FIRE steder hadde hver sin regel, og
// at tre av dem antok at enhver seksjon er tilgjengelig. Å rette de tre er en fiks; å hindre den
// fjerde i å oppstå er kuren. Derfor to deler her: predikatene testes for seg, og en dekningsvakt
// nekter nye håndskrevne varianter av de samme leddene i participant.js.
// ─────────────────────────────────────────────────────────────────────────────

describe("#992: sekvenspredikatene", () => {
  const section = (o) => ({ type: "SECTION", read: false, available: true, ...o });
  const mod = (o) => ({ type: "MODULE", moduleStatus: "NOT_STARTED", available: true, ...o });

  it("en utilgjengelig seksjon er ikke tilgjengelig — dette var hullet", () => {
    // `isSection || entry.available !== false` ga true her. Det er hele saken.
    expect(isEntryAvailable(section({ available: false }))).toBe(false);
  });

  it("en utilgjengelig modul er ikke tilgjengelig", () => {
    expect(isEntryAvailable(mod({ available: false }))).toBe(false);
  });

  it("KONTROLLCASE: tilgjengelig innhold er fortsatt tilgjengelig", () => {
    // Uten denne ville `return false` bestått begge testene over.
    expect(isEntryAvailable(section())).toBe(true);
    expect(isEntryAvailable(mod())).toBe(true);
  });

  it("manglende `available` betyr vis den, ikke skjul den", () => {
    // ⚠️ Bevisst. Feltet er påkrevd i DTO-en, så det mangler bare mot en eldre server. Tolket vi
    // `undefined` som utilgjengelig, ville en versjonsmismatch skjult hele kurset — verre enn
    // blindveien vi retter. Muter denne til `=== true` og se at det er DENNE som fanger det.
    expect(isEntryAvailable({ type: "SECTION", read: false })).toBe(true);
    expect(isEntryAvailable(undefined)).toBe(true);
  });

  it("«ferdig» er lest for seksjoner og bestått for moduler", () => {
    expect(isEntryDone(section({ read: true }))).toBe(true);
    expect(isEntryDone(section({ read: false }))).toBe(false);
    expect(isEntryDone(mod({ moduleStatus: "PASSED" }))).toBe(true);
    expect(isEntryDone(mod({ moduleStatus: "IN_PROGRESS" }))).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // #996: «utestående» henger på PÅKREVD, ikke på TILGJENGELIG.
  //
  // ⚠️ Disse testene sa tidligere at enhver utilgjengelig modul er ikke-utestående, og de var
  // grønne. QA-porten fant at det er feil: serverens bevisport filtrerer bare på `archivedAt`, så en
  // AVPUBLISERT modul teller fortsatt. Klienten tilbød «Avslutt kurset» i kurs serveren ikke ville
  // utstedt bevis for — klikket registrerte lesningen, og så skjedde ingenting.
  //
  // Testene under er derfor SNUDD på det ene tilfellet, og det er verdt å legge merke til: de
  // pinnet en oppførsel som var gal. En test kan bare fange det den ble skrevet for å fange.
  // ───────────────────────────────────────────────────────────────────────────

  it("en AVPUBLISERT modul ER utestående — den er nede, ikke fjernet", () => {
    // `available: false` uten `required: false`. Dette er tilstanden som ga blindveien.
    expect(isEntryOutstanding(mod({ moduleStatus: "NOT_STARTED", available: false, required: true }))).toBe(true);
  });

  it("en ARKIVERT modul er IKKE utestående — den er tatt ut av kurset", () => {
    // Ett felt forskjellig fra testen over, og det er hele skillet.
    expect(isEntryOutstanding(mod({ moduleStatus: "NOT_STARTED", available: false, required: false }))).toBe(false);
  });

  it("KONTROLLCASE: ulest tilgjengelig innhold ER utestående", () => {
    // Ellers måler vi ikke regelen, bare at funksjonen alltid sier nei — og da ville «Avslutt
    // kurset» dukket opp midt i et halvferdig kurs.
    expect(isEntryOutstanding(section({ read: false }))).toBe(true);
    expect(isEntryOutstanding(mod({ moduleStatus: "NOT_STARTED" }))).toBe(true);
  });

  it("KONTROLLCASE: ferdig innhold er aldri utestående, uansett flagg", () => {
    expect(isEntryOutstanding(section({ read: true }))).toBe(false);
    expect(isEntryOutstanding(mod({ moduleStatus: "PASSED", available: false, required: true }))).toBe(false);
  });

  it("manglende `required` betyr PÅKREVD — vi lover ikke et bevis som ikke kommer", () => {
    // ⚠️ Motsatt default av `isEntryAvailable`, og med vilje. Mangler feltet, snakker vi med en
    // eldre server; da er «still kravet» det trygge svaret. Å tilby «Avslutt kurset» og så ikke
    // utstede beviset er den stille blindveien #929 ble skrevet for å fjerne.
    expect(isEntryRequired({ type: "MODULE", moduleStatus: "NOT_STARTED" })).toBe(true);
    expect(isEntryRequired(undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: leddene skal ikke skrives for hånd på nytt i participant.js.
//
// Vakta leter etter de faktiske uttrykkene de fire stedene brukte. Den kan ikke se en helt ny
// formulering av samme tanke — ingen tekstvakt kan det — men den fanger den vanligste veien
// tilbake: at noen kopierer en linje som allerede finnes.
// ─────────────────────────────────────────────────────────────────────────────

const PARTICIPANT = fileURLToPath(new URL("../public/participant.js", import.meta.url));
const STATE = fileURLToPath(new URL("../public/participant-console-state.js", import.meta.url));

const CLAUSES = [
  { re: /\.available\s*!==\s*false/g, use: "isEntryAvailable(entry)" },
  { re: /moduleStatus\s*[!=]==\s*"PASSED"/g, use: "isEntryDone(entry) / isEntryOutstanding(entry)" },
  { re: /\.read\s*!==\s*true/g, use: "isEntryDone(entry)" },
  // #996: `required` er det nye leddet, og akkurat like lett å skrive for hånd som de tre over.
  { re: /\.required\s*!==\s*false/g, use: "isEntryRequired(entry) / isEntryOutstanding(entry)" },
];

describe("#992: participant.js skriver ikke sine egne sekvensledd", () => {
  it("ingen håndskrevne tilgjengelighets- eller ferdig-ledd", () => {
    const src = readFileSync(PARTICIPANT, "utf8");
    const hits = [];
    for (const { re, use } of CLAUSES) {
      for (const m of src.matchAll(re)) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`participant.js:${line}  «${m[0]}» — bruk ${use} i stedet.`);
      }
    }
    expect(hits, `\n${hits.join("\n")}\n`).toEqual([]);
  });

  it("KONTROLLASSERTION: predikatene finnes, og participant.js bruker dem", () => {
    // ⚠️ Uten denne blir forbudet over grønt av å måle NULL: sletter noen predikatene og all bruk
    // av dem, forsvinner også leddene vakta leter etter — og vakta ville sagt «bra jobba». Den
    // fella har gitt oss en falsk «47 av 47 er lokalisert» før.
    //
    // Første utkast sammenlignet leddene TEKSTLIG med modulen og var rød: `isEntryDone` skriver
    // `read === true`, ikke `.read !== true`. Det er riktig av modulen og feil av vakta — en
    // kontroll som krever at kuren staves som sykdommen måler ingenting.
    const state = readFileSync(STATE, "utf8");
    for (const name of ["isEntryAvailable", "isEntryDone", "isEntryRequired", "isEntryOutstanding"]) {
      expect(state, `${name} er ikke lenger eksportert fra participant-console-state.js`)
        .toContain(`export function ${name}(`);
    }
    const src = readFileSync(PARTICIPANT, "utf8");
    // ⚠️ `isEntryRequired` står med vilje IKKE i denne lista: den kalles av `isEntryOutstanding`
    // inne i modulen, ikke av `participant.js`. Å kreve at ruta importerer den ville presset fram
    // en ubrukt import bare for å gjøre vakta grønn — og en vakt man tilpasser seg er ikke en vakt.
    for (const name of ["isEntryAvailable", "isEntryDone", "isEntryOutstanding"]) {
      // Importlinje + minst ett kallsted. Bare importert = ingen som spør.
      const uses = [...src.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length;
      expect(uses, `${name} brukes ikke i participant.js (${uses} forekomster)`).toBeGreaterThan(1);
    }
  });
});
