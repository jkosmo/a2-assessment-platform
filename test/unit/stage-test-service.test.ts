import { describe, expect, it } from "vitest";
import { isAppOnlyToken, stageTestServicePrincipal } from "../../src/auth/stageTestService.js";

// 2.105.0: stage-testkontoen. Et token uten bruker godtas bare når alle tre vilkårene holder — på
// stage, fra den ene appen — og rollen er alltid fagansvarlig, uansett hva tokenet sier.

const APP = "11111111-2222-3333-4444-555555555555";
const appToken = (extra: Record<string, unknown> = {}) => ({ oid: "sp-oid", sub: "sp-oid", azp: APP, roles: ["ADMINISTRATOR"], ...extra });
const STAGE = { deployEnvironment: "staging", appId: APP };

describe("stage-testkontoen", () => {
  it("godtas på stage fra den ene appen, som fagansvarlig — rollen i tokenet leses ikke", () => {
    expect(stageTestServicePrincipal(appToken(), STAGE)).toEqual({
      externalId: `stage-test-service:${APP}`,
      email: "stage-testkonto@stage.invalid",
      name: "Stage-testkonto",
      tokenRoles: ["SUBJECT_MATTER_OWNER"],
      groupIds: [],
    });
    // v1-tokens har `appid` i stedet for `azp`.
    expect(stageTestServicePrincipal({ oid: "sp-oid", appid: APP }, STAGE).externalId).toBe(`stage-test-service:${APP}`);
  });

  it("avvises utenfor stage — også når appen er riktig", () => {
    for (const deployEnvironment of [undefined, "", "production", "Staging", "staging "]) {
      expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment, appId: APP })).toThrow();
    }
  });

  it("avvises fra en annen app, og når appen ikke er satt", () => {
    expect(() => stageTestServicePrincipal(appToken({ azp: "annen-app" }), STAGE)).toThrow();
    expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment: "staging", appId: undefined })).toThrow();
    expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment: "staging", appId: "  " })).toThrow();
    expect(() => stageTestServicePrincipal({ oid: "sp-oid" }, { deployEnvironment: "staging", appId: "" })).toThrow();
  });

  it("et brukertoken er ikke app-only, et token uten bruker er det", () => {
    expect(isAppOnlyToken({ oid: "u", scp: "access_as_user", preferred_username: "kari@a-2.no" })).toBe(false);
    expect(isAppOnlyToken({ oid: "u", preferred_username: "kari@a-2.no" })).toBe(false);
    expect(isAppOnlyToken({ oid: "u", scp: "access_as_user" })).toBe(false);
    expect(isAppOnlyToken(appToken())).toBe(true);
  });
});
