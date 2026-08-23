import { describe, expect, it } from "vitest";
import { apiErrorCode, apiErrorCodeText, describeApiError } from "../../public/static/api-error.js";
import { translations as participantTranslations } from "../../public/i18n/participant-translations.js";
import { translations as adminContentTranslations } from "../../public/i18n/admin-content-translations.js";

// #972: den delte oversetteren. Regelen den håndhever står i doc/DECISIONS.md → «Feilkoden er
// kontrakten, ikke teksten»: backend sender en KODE, klienten slår den opp i sin egen tabell og
// rendrer på brukerens språk. Serverens `message` er en engelsk reserve for API-konsumenter.
//
// ⚠️ Hver «koden ble oversatt»-test har en makker som sender en UKJENT kode. Uten den vet vi ikke
// om vi målte oversettelsen eller bare at det finnes en streng: en implementasjon som returnerer
// `body.message` uendret ville bestått halvparten av testene under.

function tFor(locale) {
  return (key) => adminContentTranslations[locale]?.[key] ?? key;
}

// Slik apiFetch faktisk bygger feilen (api-client.js:167) — inkludert `.body` og `.status`.
function apiFetchError(status, body) {
  const error = new Error(`${status}: ${JSON.stringify(body)}`);
  error.status = status;
  error.body = body;
  return error;
}

describe("describeApiError — koden er kontrakten", () => {
  it("oversetter en kjent kode til brukerens språk, ikke serverens", () => {
    const error = apiFetchError(403, {
      error: "content_ownership",
      message: "You can only modify content you own.",
    });

    const nb = describeApiError(error, tFor("nb"));
    expect(nb.headline).toBe(adminContentTranslations.nb["errors.api.content_ownership"]);
    expect(nb.headline).toMatch(/du eier/i);

    // Samme feil, annet konsollspråk: teksten skal følge brukeren, ikke serveren.
    const nn = describeApiError(error, tFor("nn"));
    expect(nn.headline).toBe(adminContentTranslations.nn["errors.api.content_ownership"]);
    expect(nn.headline).not.toBe(nb.headline);

    // Serverens engelske setning skal ikke være det brukeren leser — i noen av språkene.
    for (const described of [nb, nn, describeApiError(error, tFor("en-GB"))]) {
      expect(described.headline).not.toContain("You can only modify content you own.");
      expect(described.headline).not.toContain("403:");
      expect(described.headline).not.toContain("{");
    }
  });

  it("KONTROLLCASE: en ukjent kode gir en lokalisert generisk setning med statuskoden", () => {
    // Uten denne ville testen over vært like grønn med `return body.message`.
    const error = apiFetchError(418, {
      error: "a_code_no_client_knows",
      message: "Some English sentence the server made up.",
    });

    const nb = describeApiError(error, tFor("nb"));
    expect(nb.headline).toBe(
      adminContentTranslations.nb["errors.apiGeneric"].replace("{status}", "418"),
    );
    expect(nb.headline).toContain("418");
    expect(nb.headline).not.toContain("Some English sentence");
    expect(nb.headline).not.toContain("a_code_no_client_knows");

    // ⚠️ Informasjonen kastes ikke — den flyttes til diagnostikken. Dette er FORFATTERflatens
    // kontrakt (doc/FEATURE_SURFACE_MAP §24): detaljene er der, men de er ikke overskriften.
    expect(nb.detail).toContain("a_code_no_client_knows");
    expect(nb.detail).toContain("Some English sentence the server made up.");
  });

  it("KONTROLLCASE: en kjent kode uten oversettelse i bunten faller til den generiske", () => {
    // En `t` som ikke kjenner noen nøkler i det hele tatt — slik en ny konsollside ville sett ut.
    // Den skal IKKE begynne å vise serverens tekst, og den skal ikke vise nøkkelnavnet heller.
    const error = apiFetchError(403, { error: "content_ownership", message: "English." });
    const described = describeApiError(error, (key) => key);
    expect(described.headline).not.toBe("errors.api.content_ownership");
    expect(described.headline).not.toContain("English.");
    expect(described.headline).toContain("403");
  });

  it("legger Zod-utdata i detaljfeltet, aldri i overskriften", () => {
    const error = apiFetchError(400, {
      error: "validation_error",
      issues: [{ code: "invalid_type", path: ["payload", "section", "bodyMarkdown"] }],
    });

    const described = describeApiError(error, tFor("nb"));
    expect(described.headline).toBe(adminContentTranslations.nb["errors.apiValidation"]);
    expect(described.headline).not.toContain("bodyMarkdown");
    // Detaljfeltet har `white-space: pre-wrap` og klippes ikke ved høyre kant slik overskriften gjør.
    expect(described.detail).toContain("bodyMarkdown");
  });

  it("en kjent kode får ikke serverens JSON med som «detalj» på kjøpet", () => {
    // Overskriften ER forklaringen. Å legge kroppen i detaljfeltet ville gitt tilbake nøyaktig det
    // vi fjernet fra overskriften.
    const error = apiFetchError(403, { error: "last_owner", message: "You cannot remove…" });
    expect(describeApiError(error, tFor("nb")).detail).toBeUndefined();
  });

  it("en feil klienten selv kastet beholder sin egen tekst", () => {
    // ⚠️ Ikke en server-konvolutt: verken status eller kropp. Teksten er skrevet av oss, på
    // brukerens språk. Å bytte den mot «Forespørselen kunne ikke fullføres (-)» ville kastet
    // informasjon uten å rette noe språkbrudd.
    const described = describeApiError(new Error("Eksport returnerte tom envelope."), tFor("nb"));
    expect(described.headline).toBe("Eksport returnerte tom envelope.");
    expect(described.code).toBeNull();
  });

  it("leser koden også når bare `message`-strengen er igjen", () => {
    // Noen kallsteder får feilen etter at `.body` er borte (f.eks. `new Error(String(err))`).
    const bare = new Error('403: {"error":"content_unowned","message":"No owner yet."}');
    expect(apiErrorCode(bare)).toBe("content_unowned");
    expect(describeApiError(bare, tFor("nb")).headline)
      .toBe(adminContentTranslations.nb["errors.api.content_unowned"]);
  });

  it("varianter lar klienten skille moduler fra seksjoner på samme kode (#980)", () => {
    // `item_archived` sendes for begge, med hver sin norske setning på serversiden. Bare klienten
    // vet hvilken rad den tegner.
    const t = tFor("nb");
    expect(apiErrorCodeText("item_archived", t, ["module"])).toBe(
      adminContentTranslations.nb["errors.api.item_archived.module"],
    );
    expect(apiErrorCodeText("item_archived", t, ["section"])).toBe(
      adminContentTranslations.nb["errors.api.item_archived.section"],
    );
    // KONTROLLCASE: uten variant får man den generelle setningen, ikke undefined og ikke nøkkelen.
    expect(apiErrorCodeText("item_archived", t, [])).toBe(
      adminContentTranslations.nb["errors.api.item_archived"],
    );
    // KONTROLLCASE: en variant som ikke finnes faller tilbake til den generelle, ikke til nøkkelen.
    expect(apiErrorCodeText("item_archived", t, ["kurs"])).toBe(
      adminContentTranslations.nb["errors.api.item_archived"],
    );
    expect(apiErrorCodeText("no_such_code", t, ["module"])).toBeNull();
  });
});

describe("errors.api.*-tabellen", () => {
  const locales = ["en-GB", "nb", "nn"];

  it("har hver kode i alle tre språk", () => {
    const keys = Object.keys(participantTranslations["en-GB"]).filter((k) => k.startsWith("errors.api."));
    // Kontrollassertion: fant vi tabellen i det hele tatt?
    expect(keys.length).toBeGreaterThan(20);

    for (const locale of locales) {
      const missing = keys.filter((k) => typeof participantTranslations[locale]?.[k] !== "string");
      expect(missing, `${locale} mangler:\n${missing.join("\n")}`).toEqual([]);
    }
  });

  it("fyller ikke alle tre språk med samme kildetekst (#892/#981)", () => {
    // ⚠️ Tre like strenger er ikke tre oversettelser — det er én tekst kopiert tre ganger, og det
    // ødelegger informasjonen om hva som faktisk ER oversatt. Noen få kodenavn-frie setninger kan
    // sammenfalle mellom nb og nn; en-GB skal alltid skille seg fra begge.
    const keys = Object.keys(participantTranslations["en-GB"]).filter((k) => k.startsWith("errors.api."));
    const copied = keys.filter((k) => {
      const en = participantTranslations["en-GB"][k];
      return participantTranslations.nb[k] === en || participantTranslations.nn[k] === en;
    });
    expect(copied, `Uoversatt (kildeteksten står i nb eller nn):\n${copied.join("\n")}`).toEqual([]);
  });

  it("er tilgjengelig i forfatterkonsollets bunt, ikke bare i deltakerens", () => {
    // Tabellen bor i participant-bunten fordi åtte andre bunter sprer den inn. Hvis den spredningen
    // ryker, faller alle admin-flatene tilbake til den generiske setningen uten at noe annet feiler.
    for (const locale of locales) {
      expect(adminContentTranslations[locale]["errors.api.content_ownership"]).toBe(
        participantTranslations[locale]["errors.api.content_ownership"],
      );
    }
  });
});
