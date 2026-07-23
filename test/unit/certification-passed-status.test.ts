import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_PASSED_STATUSES,
  isCertificationPassed,
} from "../../src/modules/certification/certificationRepository.js";

// #820: "passed a module" = any lifecycle state except NOT_CERTIFIED, listed explicitly.
describe("isCertificationPassed (#820)", () => {
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
});
