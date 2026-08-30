import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: klienten skal ikke velge språk for lagret innhold.
//
// Serveren eier spørsmålet «hvilket språk viser vi», og svarer på det når data HENTES (#1027).
// Klienten skal vise strengen den får.
//
// Det vakta ser etter er ikke `JSON.parse` — det er RESERVEKJEDEN:
//
//     parsed[currentLocale] ?? parsed["en-GB"] ?? …
//     obj.nb || obj["en-GB"] || obj.nn || …
//
// ⚠️ Det er kjeden som gir drift, ikke tolkningen. Hver kopi har sin egen rekkefølge, og de blir
// uenige. #1022 er beviset: klientens kjede falt tilbake på `nb`, serverens på første tilgjengelige.
// De to var uenige om hva en delvis oversatt tittel skulle vise, og ingen merket det.
//
// ⚠️ OG DE ER STILLE. Når serveren begynner å sende ferdige strenger, får parseren ingenting å
// tolke og gjør ingenting — men den ser ut som om den gjør jobben sin. Slik sluttet profilsidens
// nivåkolonne å følge språkbyttet uten at én test ble rød (#1027, QA-runde 4).
//
// ─────────────────────────────────────────────────────────────────────────────
// HVA SOM ER LOVLIG
//
// Forfatterflaten SKAL tolke lagringsformatet. `admin-content-*` er en redigerer for flerspråklig
// innhold: den må lese hele kartet for å kunne vise «dette mangler på nynorsk», og skrive det
// tilbake. Å telle all tolkning ville gjort vakta rød på riktig kode fra dag én — og en vakt som
// er rød fra dag én blir slått av.
//
// Skillet er VISNING mot REDIGERING. Å plukke ETT språk ut av kartet for å vise det, er visning.
// ─────────────────────────────────────────────────────────────────────────────
// RATSJ, IKKE FORBUDSLISTE
//
// Baselinen er 2, ikke 0 — gjelden finnes (#1038 og admin-content-courses). Nye forekomster
// feiler, og FJERNER man en, feiler den også, med beskjed om å sette tallet ned.
//
// Et tall som bare kan stå stille er ikke en ratsj. Da låser man gjelden fast i stedet for å
// presse den ned.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

// Fil -> antall kjente språkvalg på klienten.
const BASELINE = {
  // #1038: kurstittelen i klasselista. Serveren sender lagringsformatet her ennå, så denne kan
  // ikke bare slettes — ruta må lokalisere først.
  "static/admin-content-classes.js": 1,
  // Forfatterkonsollets egne visningshjelpere, to av dem.
  "static/admin-content-courses.js": 2,
  // Tittelvisning i seksjonslista.
  "static/admin-content-sections.js": 1,
};
// 4 til sammen, per 2026-08-30.
//
// ⚠️ Mitt eget håndsveip før denne vakta sa 2. Det var halvparten. Grep med noen linjers kontekst
// fant ikke kjedene som sto alene på en linje — verdien var allerede tolket lenger opp, så det sto
// ingen `JSON.parse` i nærheten å søke etter. Vakta finner dem fordi den leter etter KJEDEN, ikke
// etter tolkningen.
//
// Det er hele poenget med en ratsj framfor en opprydding: den teller uten å bli lei.
//
// Fire slike ble fjernet i #1027:
//   localizeTitle (results.js), localizeContentValue (profile.js),
//   humanizeApiError (participant.js, #983), klientside tittelvalg (review.js, #1022).

// Vendorkode er ikke vår. `localizedTextCodec`-speilet på klienten er den ENE delte
// implementasjonen, på samme måte som `api-error.js` er det for feilmeldinger.
const EXEMPT = [
  "static/vendor/",
  "static/localized-text.js",
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : entry.endsWith(".js") ? [full] : [];
  });
}

function relativeFiles() {
  return walk(PUBLIC)
    .map((file) => ({
      rel: file.slice(PUBLIC.length + 1).replace(/\\/g, "/"),
      src: readFileSync(file, "utf8"),
    }))
    .filter(({ rel }) => !EXEMPT.some((prefix) => rel.startsWith(prefix)));
}

// Reservekjeden, i de to formene den faktisk opptrer i:
//
//   x[currentLocale] ?? x["en-GB"]        — nullish, den vanligste
//   x.nb || x["en-GB"]                    — eller-kjede med bokmål først
//
// ⚠️ Kravet om at BEGGE ledd finnes er med vilje. Et enkelt `map[locale]` er ikke en reservekjede
// — det kan være et helt vanlig oppslag i en oversettelsestabell, og å telle det ville gitt en
// vakt full av falske treff. Det er nettopp når man legger på en RESERVE at man har skrevet sin
// egen mening om hva som skal vises når språket mangler.
const CHAIN = [
  /\[\s*currentLocale\s*\]\s*(\?\?|\|\|)\s*[\w.[\]"'-]*\[\s*["']en-GB["']\s*\]/,
  /\[\s*locale\s*\]\s*(\?\?|\|\|)\s*[\w.[\]"'-]*\[\s*["']en-GB["']\s*\]/,
  /\.nb\s*(\?\?|\|\|)\s*[\w.[\]"'-]*\[\s*["']en-GB["']\s*\]/,
  /\[\s*["']nb["']\s*\]\s*(\?\?|\|\|)\s*[\w.[\]"'-]*\[\s*["']en-GB["']\s*\]/,
];

// ⚠️ Grensesnittets EGEN oversettelsestabell er ikke lagret innhold. `adminContentTranslations` og
// `TOAST_CLOSE_LABELS` er statiske kart i klienten, og et oppslag med reserve der er helt riktig —
// det er slik grensesnittet finner sin egen tekst.
//
// Første utgave av vakta talte dem med. Den ville altså bedt noen om å «la serveren eie språket»
// for en tabell serveren aldri har sett. En vakt som roper på riktig kode blir slått av.
const UI_TABLE = /\b(\w*[Tt]ranslations|\w*LABELS)\s*\[/;

function localeChoices(src) {
  return src
    .split("\n")
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => CHAIN.some((pattern) => pattern.test(text)) && !UI_TABLE.test(text));
}

describe("klienten velger ikke språk for lagret innhold (#1027)", () => {
  const files = relativeFiles();

  it("finner filene den skal skanne", () => {
    // ⚠️ Uten denne er hele vakta grønn hvis stien er feil eller mappa er tom. En skanning som
    // ikke fant noe, og en skanning som fant null treff, ser identiske ut nedenfra.
    expect(files.length).toBeGreaterThan(20);
  });

  it("ingen NYE språkvalg på klienten", () => {
    const brudd = [];
    for (const { rel, src } of files) {
      const funn = localeChoices(src);
      const tillatt = BASELINE[rel] ?? 0;
      if (funn.length > tillatt) {
        brudd.push(
          `${rel}: ${funn.length} språkvalg, baseline ${tillatt}\n` +
            funn.map((f) => `    linje ${f.line}: ${f.text.trim().slice(0, 110)}`).join("\n"),
        );
      }
    }

    expect(
      brudd.join("\n"),
      "Serveren eier hvilket språk som vises, og svarer på det når data HENTES (#1027).\n" +
        "Klienten skal vise strengen den får.\n\n" +
        "Trenger ruta di ferdig tekst? Legg `localizeContentText(locale, …)` i ruta, ikke en\n" +
        "reservekjede her. Trenger du HELE kartet for redigering, er det lovlig — men da skal du\n" +
        "ikke velge ett språk ut av det.",
    ).toBe("");
  });

  it("ingen FÆRRE enn baselinen — sett tallet ned når du har ryddet", () => {
    const ryddet = [];
    for (const [rel, forventet] of Object.entries(BASELINE)) {
      const fil = files.find((f) => f.rel === rel);
      // Forsvinner fila helt, er det også en rydding — da skal linja ut av baselinen.
      const faktisk = fil ? localeChoices(fil.src).length : 0;
      if (faktisk < forventet) {
        ryddet.push(`${rel}: ${faktisk} igjen, baseline sier ${forventet}`);
      }
    }

    expect(
      ryddet.join("\n"),
      "Færre språkvalg enn baselinen: sett tallet ned i BASELINE. Bra jobba.\n\n" +
        "⚠️ Denne retningen er ikke pynt. Et tall som bare kan stå stille låser gjelden fast\n" +
        "i stedet for å presse den ned.",
    ).toBe("");
  });
});
