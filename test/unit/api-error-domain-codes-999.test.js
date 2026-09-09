import { describe, expect, it } from "vitest";
import { describeApiError, apiErrorCodeText, fillErrorPlaceholders } from "../../public/static/api-error.js";
import { translations } from "../../public/i18n/participant-translations.js";

// #999: domenevaktene bar norsk prosa i `message`, og klienten viste den ordrett fordi den ikke
// kunne skille «Zod avviste formen» fra «en domeneregel sa nei».
//
// ⚠️ Skaden var konkret: sett forfattergrensesnittet til en-GB og prøv å arkivere en modul som
// ligger i et kurs. Serveren komponerte «Modulen kan ikke arkiveres fordi den er i bruk i 2 kurs
// …», og setningen sto ordrett i det engelske grensesnittet.
//
// Nå har vaktene egne koder, og klienten formulerer setningen selv.

const t = (locale) => (key) => translations[locale]?.[key] ?? translations["en-GB"]?.[key] ?? null;

/** Feilen slik `apiFetch` henger den på, med koden og dataene serveren nå sender. */
function serverError(code, details, message) {
  const err = new Error(`400: ${JSON.stringify({ error: code, message, details })}`);
  err.body = { error: code, message, details };
  return err;
}

describe("#999 — domenevaktenes feilkoder", () => {
  it("innhold i bruk vises på brukerens språk, ikke serverens", () => {
    const norwegianProse = "Modulen kan ikke arkiveres fordi den er i bruk i 2 kurs: «A», «B».";
    const error = serverError("content_in_use", { count: 2, courseTitles: ["A", "B"] }, norwegianProse);

    const en = describeApiError(error, t("en-GB"));
    expect(en.headline).toContain("used in 2 course");
    expect(en.headline).toContain("A, B");
    // ⚠️ Kjernen i saken: serverens norske setning skal IKKE stå i det engelske grensesnittet.
    expect(en.headline).not.toContain("kan ikke arkiveres");

    const nb = describeApiError(error, t("nb"));
    expect(nb.headline).toContain("i bruk i 2 kurs");
    expect(nb.headline).toContain("A, B");
  });

  it("de tre andre vaktene har også egne setninger", () => {
    const cases = [
      ["content_in_issued_certificate", { count: 3 }, /3/],
      ["content_in_legacy_certificate", { count: 1 }, /1/],
      ["course_has_active_participants", { count: 5 }, /5/],
    ];
    for (const [code, details, expected] of cases) {
      const en = describeApiError(serverError(code, details, "norsk prosa fra serveren"), t("en-GB"));
      expect(en.code, code).toBe(code);
      expect(en.headline, code).toMatch(expected);
      expect(en.headline, code).not.toContain("norsk prosa");
    }
  });

  // Motprøven. Uten den ville «vis alltid den generiske setningen» også vært grønt, og da hadde
  // forfatteren fått «noe i skjemaet er feil utfylt» for en regel som faktisk forklarte seg.
  it("en domeneregel UTEN kode viser fortsatt serverens setning", () => {
    const err = new Error("400: x");
    err.body = { error: "validation_error", message: "Cannot assign an archived course." };
    const en = describeApiError(err, t("en-GB"));
    expect(en.headline).toBe("Cannot assign an archived course.");
  });

  // Og at Zod-veien er urørt: med `issues` er serverens message IKKE forklaringen.
  it("en formfeil fra Zod viser fortsatt den generiske setningen", () => {
    const err = new Error("400: x");
    err.body = { error: "validation_error", message: "Invalid", issues: [{ path: ["title"] }] };
    const en = describeApiError(err, t("en-GB"));
    expect(en.headline).not.toBe("Invalid");
    expect(en.detail).toContain("title");
  });

  it("utfyllingen legger aldri igjen en plassholder på skjermen", () => {
    expect(fillErrorPlaceholders("{count} kurs", { count: 2 })).toBe("2 kurs");
    expect(apiErrorCodeText("content_in_use", t("nb"), [], { count: 1, courseTitles: ["X"] }))
      .toContain("1 kurs: X");

    // ⚠️ Denne påstanden sto tidligere som «plassholderen blir stående». Det viste seg å være feil
    // oppførsel, ikke en egenskap: to håndrullede 429-svar sendte ikke tallet, og forfatteren fikk
    // «Prøv igjen om {retryAfterSeconds} sekunder» ordrett på skjermen.
    //
    // Mangler dataene setningen krever, er den oversatte teksten ØDELAGT. Da er `null` riktig svar
    // — kalleren faller tilbake på den generiske, lokaliserte setningen.
    expect(fillErrorPlaceholders("{count} kurs", null)).toBeNull();
    expect(fillErrorPlaceholders("{count} kurs", {})).toBeNull();
    expect(apiErrorCodeText("content_in_use", t("nb"), [], null)).toBeNull();
  });

  // Og at fallbacken faktisk brukes: en 429 uten tallet skal gi en lokalisert generisk setning,
  // ikke en ødelagt en.
  it("en kode uten dataene sine faller tilbake på den generiske setningen", () => {
    const err = new Error("429: x");
    err.body = { error: "rate_limited", message: "Too many requests." };
    const nb = describeApiError(err, t("nb"));
    expect(nb.headline).not.toContain("{retryAfterSeconds}");
    expect(nb.headline).not.toContain("Too many requests.");
  });
});
