import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translations } from "../public/i18n/admin-content-translations.js";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#914): hver kode publiseringsgaten kan sende, må ha en nøkkel på ALLE tre språk.
//
// ⚠️ HVA SOM VAR GALT. Gaten sendte ferdigskrevne setninger på SERVERENS språk — og de to gatene
// skrev hvert sitt: `contentValidationService` hardkodet ENGELSK, `coursePublishService` hardkodet
// NORSK. En engelsk forfatter fikk dermed norsk tekst fra den ene, og en norsk forfatter engelsk
// fra den andre, avhengig av hvilken gate som fyrte.
//
// ⚠️ HVORFOR EN VAKT OG IKKE BARE EN OPPRYDDING. Uten den bærer neste kode som legges til engelsk
// tekst igjen, og ingenting blir rødt. Det er nøyaktig slik de tolv kodene oppsto: én om gangen,
// hver med en fornuftig setning skrevet der og da.
//
// Vakta leser kodene fra KILDEN, ikke fra en liste her. En liste ville måttet vedlikeholdes, og en
// glemt oppdatering ville gjort vakta stille.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Kodene slik de faktisk står i kilden. */
function koderFra(kilde) {
  const ut = new Set();
  for (const m of kilde.matchAll(/\bcode:\s*"([A-Za-z_][\w]*)"/g)) ut.add(m[1]);
  return ut;
}

const valideringKilde = les("../src/modules/adminContent/contentValidationService.ts");
const publiseringKilde = les("../src/modules/course/coursePublishService.ts");
const validering = koderFra(valideringKilde);
const publisering = koderFra(publiseringKilde);

// `translation_incomplete` bygges av `field` + `missingLocales` og har sin egen visning.
const EGEN_VISNING = new Set(["translation_incomplete"]);
// `item_archived` slås opp med `.module` / `.section`, fordi den brukes for begge med ulik tekst.
const MED_VARIANT = { item_archived: ["module", "section"] };
// `itemType` er ikke en plassholder — den VELGER varianten (`…item_archived.module`). Den skal
// derfor hverken finnes i teksten eller mangle fra den.
const VARIANTVELGER = new Set(["itemType"]);

const SPRÅK = ["en-GB", "nb", "nn"];

function nøklerFor(kode) {
  const varianter = MED_VARIANT[kode];
  return varianter
    ? varianter.map((v) => `errors.api.${kode}.${v}`)
    : [`errors.api.${kode}`];
}

/** Navnene på dataene kilden faktisk sender med koden — fra BEGGE tjenestene. */
function paramsFor(kode) {
  // ⚠️ To fallgruver, begge gjorde vakta stille:
  //   1. `params` står på SAMME linje for publiseringskodene og på neste for valideringskodene.
  //      Et mønster som krevde linjeskift så aldri publiseringssiden i det hele tatt.
  //   2. `{ suggested: n, actual, percent: x }` — `actual` er FORKORTET. Et mønster som krevde
  //      kolon hoppet over den, så `{actual}` ble aldri sjekket i noen retning.
  const m = new RegExp(`code:\\s*"${kode}"[\\s\\S]{0,240}?params:\\s*\\{([^}]*)\\}`).exec(
    `${valideringKilde}\n${publiseringKilde}`,
  );
  if (!m) return [];
  return m[1]
    .split(",")
    .map((del) => del.split(":")[0].trim())
    .filter((navn) => /^\w+$/.test(navn) && !VARIANTVELGER.has(navn));
}

describe("#914 — publiseringsgatens meldinger finnes på alle tre språk", () => {
  const alle = [...new Set([...validering, ...publisering])].filter((k) => !EGEN_VISNING.has(k)).sort();

  it("finner kodene i kilden — kontrollcase", () => {
    // ⚠️ Uten denne er hele vakta grønn hvis regexet slutter å treffe eller stien blir feil.
    // «Null koder å sjekke» og «alle koder er i orden» ser identiske ut nedenfra.
    expect(alle.length, "skal finne kodene i de to tjenestene").toBeGreaterThanOrEqual(12);
  });

  it("hver kode har en nøkkel på alle tre språk", () => {
    const mangler = [];
    for (const kode of alle) {
      for (const nøkkel of nøklerFor(kode)) {
        for (const språk of SPRÅK) {
          const verdi = translations[språk]?.[nøkkel];
          if (typeof verdi !== "string" || verdi.trim() === "") {
            mangler.push(`${språk}: ${nøkkel}`);
          }
        }
      }
    }
    expect(
      mangler.join("\n"),
      "Publiseringsgatens meldinger skal komme fra en nøkkel, ikke fra serverens `message`.\n" +
        "Legger du til en ny kode, legg til nøkkelen i alle tre språk i\n" +
        "`public/i18n/participant-translations.js` (errors.api.*) — ellers får forfatteren serverens språk.",
    ).toBe("");
  });

  it("nb og nn er FAKTISK oversatt, ikke arvet fra den engelske basen", () => {
    // ⚠️ Denne fantes ikke i første utgave, og fraværet var alvorlig.
    //
    // `nb` og `nn` bygges som OVERSTYRINGER oppå den engelske basen:
    //     nb: { ...adminContentBase, ...nbOverrides }
    //
    // En glemt oversettelse faller derfor stille tilbake til engelsk. Nøkkelen FINNES — testen over
    // er grønn — men forfatteren ser engelsk tekst. Det er nøyaktig feilen #914 handler om.
    //
    // Oppdaget ved mutasjonstesting: jeg fjernet nynorsk-nøkkelen for én kode, og vakta forble
    // grønn. En vakt som ikke kan bli rød for feilen den er skrevet mot, er ingen vakt.
    const arvet = [];
    for (const kode of alle) {
      for (const nøkkel of nøklerFor(kode)) {
        const en = translations["en-GB"]?.[nøkkel];
        for (const språk of ["nb", "nn"]) {
          if (translations[språk]?.[nøkkel] === en) arvet.push(`${språk}: ${nøkkel}`);
        }
      }
    }
    expect(
      arvet.join("\n"),
      "Disse er identiske med den engelske teksten — altså arvet fra basen, ikke oversatt.\n" +
        "Forfatteren ser engelsk i et norsk grensesnitt, og ingenting sier fra.",
    ).toBe("");
  });

  it("ingen oversettelse mangler en plassholder kilden faktisk sender", () => {
    // ⚠️ Den motsatte feilen, og den er stille: nøkkelen finnes, men mangler `{count}`, så tallet
    // forfatteren trenger forsvinner. `fillErrorPlaceholders` fanger bare det MOTSATTE — en
    // plassholder uten data.
    const feil = [];
    for (const kode of alle) {
      const navn = paramsFor(kode);
      if (navn.length === 0) continue;
      for (const nøkkel of nøklerFor(kode)) {
        for (const språk of SPRÅK) {
          const tekst = translations[språk]?.[nøkkel] ?? "";
          for (const n of navn) {
            if (!tekst.includes(`{${n}}`)) feil.push(`${språk} ${nøkkel}: mangler {${n}}`);
          }
        }
      }
    }
    expect(feil.join("\n"), "Serveren sender data setningen ikke bruker — tallet forsvinner.").toBe("");
  });

  it("ingen setning har en plassholder kilden ikke sender", () => {
    // ⚠️ Den motsatte retningen av testen over, og den er STILLERE enn den ser ut.
    //
    // `fillErrorPlaceholders` gir `null` når en plassholder overlever — teksten er da ødelagt, og
    // «Planen foreslo {suggested} spørsmål» er verre enn ingenting. Men `apiErrorCodeText` sender
    // `null` videre, og både shell og courses faller tilbake på serverens rå `message`. Forfatteren
    // ser altså ENGELSK igjen, uten at noe blir rødt: feilen #914 retter, gjenoppstått.
    //
    // Oppdaget ved mutasjonstesting: jeg fjernet `params` fra MCQ_COUNT_FAR_BELOW_BLUEPRINT i
    // kilden, og alle fire testene forble grønne.
    const feil = [];
    for (const kode of alle) {
      const sender = new Set(paramsFor(kode));
      for (const nøkkel of nøklerFor(kode)) {
        for (const språk of SPRÅK) {
          const tekst = translations[språk]?.[nøkkel] ?? "";
          for (const m of tekst.matchAll(/\{(\w+)\}/g)) {
            if (!sender.has(m[1])) feil.push(`${språk} ${nøkkel}: {${m[1]}} sendes ikke av kilden`);
          }
        }
      }
    }
    expect(
      feil.join("\n"),
      "Setningen ber om data koden ikke sender. Da forkastes hele oversettelsen,\n" +
        "og forfatteren får serverens engelske tekst i stedet — stille.",
    ).toBe("");
  });

  it("koder med variant sender velgeren i HVER forekomst", () => {
    // ⚠️ `item_archived` slås opp som `.module` / `.section`. Uten `params.itemType` finner
    // shell-veien ingen nøkkel — `errors.api.item_archived` uten variant finnes ikke — og faller
    // tilbake på serverens `message`, som er hardkodet NORSK. En engelsk forfatter fikk da norsk
    // tekst for arkiverte moduler, mens resten av skjermen var oversatt.
    //
    // Kursvisningen tok varianten fra RADEN og var derfor riktig hele tiden. Feilen fantes i én
    // av to veier — derfor sier testen HVER forekomst, ikke bare den første.
    //
    // Oppdaget ved mutasjonstesting: jeg tømte `params` for én av de to `item_archived`, og alle
    // fem testene forble grønne.
    const kilde = `${valideringKilde}\n${publiseringKilde}`;
    const mangler = [];
    for (const [kode, varianter] of Object.entries(MED_VARIANT)) {
      const velger = [...VARIANTVELGER][0];
      const blokker = [
        ...kilde.matchAll(new RegExp(`code:\\s*"${kode}"[\\s\\S]{0,240}?params:\\s*\\{([^}]*)\\}`, "g")),
      ].map((m) => m[1]);
      expect(blokker.length, `${kode} skal finnes i kilden — kontrollcase`).toBeGreaterThanOrEqual(varianter.length);
      blokker.forEach((blokk, i) => {
        if (!blokk.includes(`${velger}:`)) mangler.push(`${kode} #${i + 1}: mangler ${velger}`);
      });
    }
    expect(
      mangler.join("\n"),
      "Uten velgeren finnes ingen nøkkel, og teksten faller tilbake på serverens språk.",
    ).toBe("");
  });
});
