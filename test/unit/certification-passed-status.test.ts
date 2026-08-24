import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_PASSED_STATUSES,
  isCertificationPassed,
} from "../../src/modules/certification/certificationRepository.js";

// #820: "passed a module" = any lifecycle state except NOT_CERTIFIED, listed explicitly.
//
// #989: bare ACTIVE og NOT_CERTIFIED skrives nå. Settet er likevel IKKE trivielt — det leser
// historiske rader, og de kan stå med DUE_SOON/DUE/EXPIRED fordi kolonnene ikke er migrert bort.
// Denne fila er pinnet som sier at «bestått» betyr det samme for kursbevisporten etter fjerningen
// som før. Makkeren, som viser det gjennom den ekte porten, er
// `course-certificate-gate-invariant.test.ts`.
describe("isCertificationPassed (#820/#989)", () => {
  it("treats every non-NOT_CERTIFIED lifecycle state as passed", () => {
    for (const status of CERTIFICATION_PASSED_STATUSES) {
      expect(isCertificationPassed(status)).toBe(true);
    }
  });

  it("treats NOT_CERTIFIED and absent status as not passed", () => {
    expect(isCertificationPassed("NOT_CERTIFIED")).toBe(false);
    expect(isCertificationPassed(null)).toBe(false);
    expect(isCertificationPassed(undefined)).toBe(false);
  });

  it("does not include NOT_CERTIFIED in the passing set", () => {
    expect((CERTIFICATION_PASSED_STATUSES as string[])).not.toContain("NOT_CERTIFIED");
    expect(CERTIFICATION_PASSED_STATUSES).toEqual(["ACTIVE", "DUE_SOON", "DUE", "EXPIRED"]);
  });

  // #989: de tre legacy-tilstandene skrives aldri mer, men må fortsatt telle som bestått. Å fjerne
  // dem ville endret en bestått-avgjørelse for eksisterende rader — det motsatte av hensikten.
  it("teller fortsatt de tre livssyklustilstandene ingenting lenger skriver", () => {
    expect(isCertificationPassed("DUE_SOON")).toBe(true);
    expect(isCertificationPassed("DUE")).toBe(true);
    expect(isCertificationPassed("EXPIRED")).toBe(true);
  });
});
