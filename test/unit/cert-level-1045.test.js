import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { certLevelKey, localizeCertLevel } from "../../public/static/cert-level.js";
import { translations as base } from "../../public/i18n/participant-translations.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1045: sertifiseringsnivået er en NØKKEL, og skal vises likt overalt.
//
// ⚠️ MÅLT MOT EKTE STAGE-DATA. `/api/courses/completions` returnerte `[null, "basic",
// "intermediate"]`. En norsk deltaker så «basic» på profilsiden, mens admin så «Grunnleggende».
//
// ⚠️ OG DE SOM OVERSATTE, VAR UENIGE. Fire flater, tre nøkkelfamilier: deltakerkonsollet sa
// «Middels» der kursbeviset sa «Videregående» — for samme nivå, for samme deltaker. Én delt hjelper
// og én familie i basen. De eldre familiene står inntil videre; vakta under holder dem enige.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const t = (locale) => (key) => base[locale]?.[key] ?? key;

describe("#1045 — certLevelKey normaliserer det databasen faktisk inneholder", () => {
  it("⚠️ en nøkkel, uansett bokstavstørrelse", () => {
    expect(certLevelKey("basic")).toBe("basic");
    expect(certLevelKey("Intermediate")).toBe("intermediate");
    expect(certLevelKey(" ADVANCED ")).toBe("advanced");
  });

  it("⚠️ et språkkart der verdiene er nøkkelen — den andre formen kolonnen har", () => {
    expect(certLevelKey({ nb: "basic", "en-GB": "basic" })).toBe("basic");
  });

  it("⚠️ arv gir null, ikke en gjetning — kontrollcase", () => {
    // «Nivå 1» og «Viderekommen» er noen forfatters ord fra da feltet var fritekst. De skal vises
    // som de er, ikke tvinges inn i en av tre bokser de ikke hører hjemme i.
    expect(certLevelKey("Nivå 1")).toBeNull();
    expect(certLevelKey({ nb: "Viderekommen" })).toBeNull();
    expect(certLevelKey(null)).toBeNull();
    expect(certLevelKey("")).toBeNull();
  });
});

describe("#1045 — localizeCertLevel viser riktig ord på riktig språk", () => {
  it("⚠️ en nøkkel blir til det norske ordet", () => {
    expect(localizeCertLevel("basic", t("nb"))).toBe("Grunnleggende");
    expect(localizeCertLevel("intermediate", t("nb"))).toBe("Videregående");
    expect(localizeCertLevel("intermediate", t("nn"))).toBe("Vidaregåande");
    expect(localizeCertLevel("advanced", t("en-GB"))).toBe("Advanced");
  });

  it("⚠️ arv vises som den er — ikke som nøkkelen, ikke som tom", () => {
    expect(localizeCertLevel("Nivå 1", t("nb"))).toBe("Nivå 1");
    expect(localizeCertLevel({ nb: "Viderekommen" }, t("nb"))).toBe("Viderekommen");
  });

  it("tomt gir tankestrek, og den kan overstyres", () => {
    expect(localizeCertLevel(null, t("nb"))).toBe("—");
    expect(localizeCertLevel(null, t("nb"), { empty: "-" })).toBe("-");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VAKT: de eldre nøkkelfamiliene skal si det samme som basen — inntil de er slettet.
//
// ⚠️ DETTE ER GRUNNEN TIL AT SAKEN VAR MER ENN «profilen mangler oversettelse». Tre familier for
// samme tre ord GLIR. De hadde allerede gjort det. Vakta gjør neste glidning til en rød test i
// stedet for til et ord deltakeren ser annerledes på to skjermer.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1045 — de tre eldre nøkkelfamiliene er enige med basen", () => {
  const NIVÅER = ["basic", "intermediate", "advanced"];
  const SPRÅK = ["en-GB", "nb", "nn"];

  function ordene(kilde, prefiks, locale) {
    // Leser tabellfila som tekst og henter den aktuelle språkblokkas verdier for prefikset.
    // Enkelt og bevisst: en regex per nøkkel, innenfor hele fila, teller alle forekomster.
    const ut = {};
    for (const n of NIVÅER) {
      const re = new RegExp(`"${prefiks}${n}":\\s*"([^"]+)"`, "g");
      ut[n] = [...kilde.matchAll(re)].map((m) => m[1]);
    }
    return ut;
  }

  it("⚠️ admin (shell.certLevel.*) sier det samme som basen", () => {
    const admin = les("../../public/i18n/admin-content-translations.js");
    const funn = ordene(admin, "shell.certLevel.", null);
    for (const n of NIVÅER) {
      const forventet = SPRÅK.map((l) => base[l][`certLevel.${n}`]);
      // nb og nn deler «Avansert» med rette — sammenlign hele lista, ikke settet.
      expect(funn[n].sort(), `shell.certLevel.${n}`).toEqual([...forventet].sort());
    }
  });

  it("⚠️ kursbeviset (certLevel.*, egen fil) sier det samme som basen", () => {
    const cert = les("../../public/i18n/certificate-translations.js");
    const funn = ordene(cert, "certLevel.", null);
    for (const n of NIVÅER) {
      const forventet = SPRÅK.map((l) => base[l][`certLevel.${n}`]);
      expect(funn[n].sort(), `certLevel.${n} i kursbeviset`).toEqual([...forventet].sort());
    }
  });

  it("⚠️ deltakerkonsollets badge (modules.levelBadge.*) sier det samme som basen", () => {
    // Denne var den som sa «Middels». Badgen bruker nå den delte hjelperen, men nøklene står
    // igjen i tabellen — og skal ikke få lov til å være uenige mens de gjør det.
    for (const l of SPRÅK) {
      for (const n of NIVÅER) {
        expect(base[l][`modules.levelBadge.${n}`], `modules.levelBadge.${n} (${l})`)
          .toBe(base[l][`certLevel.${n}`]);
      }
    }
  });

  it("⚠️ ingen flate bygger sitt eget oppslag lenger", () => {
    // Fire flater hadde hver sin. Er én tilbake, er vi på vei mot fire igjen.
    const filer = ["../../public/profile.js", "../../public/participant.js", "../../public/participant-completed.js", "../../public/certificate.js"];
    const avvik = [];
    for (const f of filer) {
      const kilde = les(f);
      if (!kilde.includes('from "/static/cert-level.js"')) avvik.push(`${f.split("/").pop()}: importerer ikke den delte hjelperen`);
      if (/t\(`modules\.levelBadge\.\$\{/.test(kilde)) avvik.push(`${f.split("/").pop()}: eget levelBadge-oppslag`);
    }
    expect(avvik.join("\n")).toBe("");
  });
});
