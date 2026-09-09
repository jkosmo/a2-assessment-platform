import { describe, expect, it } from "vitest";
import { describeApiError } from "../../public/static/api-error.js";
import { translations } from "../../public/i18n/participant-translations.js";

// #983: en deltaker med bokmål som leverte to ganger raskt fikk «Too many submission requests.
// Retry in 60 seconds.» midt i et ellers norsk grensesnitt — og modul-lista ble TØMT og erstattet
// av den engelske setningen. Tomtilstand og feilmelding i ett, på feil språk.
//
// ⚠️ Roten var at deltakerkonsollet hadde sin egen feiloversetter som aldri slo opp
// `errors.api.<kode>`. Nøkkelen `rate_limited` fantes på tre språk hele tiden.

const t = (locale) => (key) => translations[locale]?.[key] ?? translations["en-GB"]?.[key] ?? null;

function rateLimited(seconds) {
  const body = {
    error: "rate_limited",
    message: "Too many submission requests. Retry in 60 seconds.",
    details: { retryAfterSeconds: seconds },
  };
  const err = new Error(`429: ${JSON.stringify(body)}`);
  err.body = body;
  return err;
}

describe("#983 — rate limiting på deltakerens språk", () => {
  it("bokmål får norsk setning, ikke serverens engelske", () => {
    const described = describeApiError(rateLimited(42), t("nb"));
    expect(described.code).toBe("rate_limited");
    expect(described.headline).toContain("For mange forespørsler");
    // ⚠️ Kjernen: serverens setning skal ikke stå i et norsk grensesnitt.
    expect(described.headline).not.toContain("Too many");
  });

  it("det EKTE antallet sekunder vises, ikke de 60 fra den engelske setningen", () => {
    // Serveren regner tallet fra når vinduet nullstilles. Den engelske prosaen sa alltid 60, som
    // var feil så snart noe av vinduet var brukt opp.
    expect(describeApiError(rateLimited(42), t("nb")).headline).toContain("42");
    expect(describeApiError(rateLimited(7), t("nb")).headline).toContain("7");
    expect(describeApiError(rateLimited(42), t("nb")).headline).not.toContain("60");
  });

  it("alle tre språk har setningen, og ingen lar plassholderen stå igjen", () => {
    for (const locale of ["en-GB", "nb", "nn"]) {
      const headline = describeApiError(rateLimited(15), t(locale)).headline;
      expect(headline, locale).toContain("15");
      expect(headline, locale).not.toContain("{retryAfterSeconds}");
    }
  });
});
