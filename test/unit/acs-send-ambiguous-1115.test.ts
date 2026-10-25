import { describe, expect, it } from "vitest";
import { ExternalCallTimeoutError } from "../../src/clients/externalCall.js";
import { isCutOff } from "../../src/modules/certification/participantNotificationService.js";

// #1115: en sending vi sluttet å vente på, kan ha gått gjennom hos mottakeren. Den merkes «uvisst»
// (`ambiguous`), så utboksen ikke sender den igjen. En avvisning er sikker og kan prøves igjen.
//
// ⚠️ Testet som en ren funksjon. En test som kjørte sendViaAcs med en mocket ACS-klient, ga riktig
// svar (målt 2026-10-23: tidsavbrudd → ambiguous: true, avvisning → false), men vitest-arbeideren
// avsluttet ikke etterpå, og hele enhetskjøringen hang. Hvordan svaret brukes, testes i
// outbox-service.test.ts.

describe("isCutOff — sikkert feilet eller uvisst (#1115)", () => {
  it("vårt eget tidsavbrudd (ACS) er uvisst", () => {
    expect(isCutOff(new ExternalCallTimeoutError("acs_email_send", 30_000))).toBe(true);
  });

  it("en avbrutt webhook-forespørsel (AbortController) er uvisst", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(isCutOff(abort)).toBe(true);
  });

  it("en avvisning, en vanlig feil og noe som ikke er en feil, er sikkert", () => {
    expect(isCutOff(Object.assign(new Error("bad address"), { statusCode: 400, code: "InvalidRecipient" }))).toBe(false);
    expect(isCutOff(new Error("acs_email_send timed out after 30000ms"))).toBe(false);
    expect(isCutOff("timeout")).toBe(false);
    expect(isCutOff(undefined)).toBe(false);
  });
});
