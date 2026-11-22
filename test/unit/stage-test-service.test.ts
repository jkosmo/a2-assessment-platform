import { describe, expect, it } from "vitest";
import { isAppOnlyToken, stageTestServicePrincipal } from "../../src/auth/stageTestService.js";

// 2.105.0: stage-testkontoen. Et token uten bruker godtas bare når alle tre vilkårene holder — på
// stage, fra den ene appen — og rollen er alltid fagansvarlig, uansett hva tokenet sier.
// 2.154.1: med hodet `x-stage-test-role: PARTICIPANT` er den en egen deltakerbruker. Hodet er en
// hviteliste med én verdi; alt annet avvises.

const APP = "11111111-2222-3333-4444-555555555555";
const appToken = (extra: Record<string, unknown> = {}) => ({ oid: "sp-oid", sub: "sp-oid", azp: APP, roles: ["ADMINISTRATOR"], ...extra });
const STAGE = { deployEnvironment: "staging", appId: APP };
const UTELATT = undefined;

describe("stage-testkontoen", () => {
  it("godtas på stage fra den ene appen, som fagansvarlig — rollen i tokenet leses ikke", () => {
    expect(stageTestServicePrincipal(appToken(), STAGE, UTELATT)).toEqual({
      externalId: `stage-test-service:${APP}`,
      email: "stage-testkonto@stage.invalid",
      name: "Stage-testkonto",
      tokenRoles: ["SUBJECT_MATTER_OWNER"],
      groupIds: [],
    });
    // v1-tokens har `appid` i stedet for `azp`.
    expect(stageTestServicePrincipal({ oid: "sp-oid", appid: APP }, STAGE, UTELATT).externalId).toBe(`stage-test-service:${APP}`);
  });

  it("avvises utenfor stage — også når appen er riktig", () => {
    for (const deployEnvironment of [undefined, "", "production", "Staging", "staging "]) {
      expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment, appId: APP }, UTELATT)).toThrow();
    }
  });

  it("avvises fra en annen app, og når appen ikke er satt", () => {
    expect(() => stageTestServicePrincipal(appToken({ azp: "annen-app" }), STAGE, UTELATT)).toThrow();
    expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment: "staging", appId: undefined }, UTELATT)).toThrow();
    expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment: "staging", appId: "  " }, UTELATT)).toThrow();
    expect(() => stageTestServicePrincipal({ oid: "sp-oid" }, { deployEnvironment: "staging", appId: "" }, UTELATT)).toThrow();
  });

  it("et brukertoken er ikke app-only, et token uten bruker er det", () => {
    expect(isAppOnlyToken({ oid: "u", scp: "access_as_user", preferred_username: "kari@a-2.no" })).toBe(false);
    expect(isAppOnlyToken({ oid: "u", preferred_username: "kari@a-2.no" })).toBe(false);
    expect(isAppOnlyToken({ oid: "u", scp: "access_as_user" })).toBe(false);
    expect(isAppOnlyToken(appToken())).toBe(true);
  });
});

describe("stage-testkontoen som deltaker (2.154.1)", () => {
  it("nøyaktig PARTICIPANT gir en EGEN bruker med bare deltakerrollen — rollen i tokenet leses fortsatt ikke", () => {
    expect(stageTestServicePrincipal(appToken(), STAGE, "PARTICIPANT")).toEqual({
      externalId: `stage-test-service-participant:${APP}`,
      email: "stage-testkonto-deltaker@stage.invalid",
      name: "Stage-testkonto (deltaker)",
      tokenRoles: ["PARTICIPANT"],
      groupIds: [],
    });
    // Kontroll: uten hodet er det fortsatt fagansvarlig, og de to er ikke samme bruker.
    const fagansvarlig = stageTestServicePrincipal(appToken(), STAGE, UTELATT);
    const deltaker = stageTestServicePrincipal(appToken(), STAGE, "PARTICIPANT");
    expect(deltaker.externalId).not.toBe(fagansvarlig.externalId);
    expect(deltaker.email).not.toBe(fagansvarlig.email);
  });

  it("enhver annen verdi avvises — ingen stille tilbakefall til fagansvarlig", () => {
    for (const verdi of ["", " ", "participant", "Participant", " PARTICIPANT", "PARTICIPANT ", "PARTICIPANT, PARTICIPANT",
      "SUBJECT_MATTER_OWNER", "ADMINISTRATOR", "PARTICIPANT,ADMINISTRATOR", "REVIEWER"]) {
      expect(() => stageTestServicePrincipal(appToken(), STAGE, verdi), `verdi «${verdi}»`).toThrow();
    }
  });

  it("hodet hjelper ikke utenfor stage eller fra en annen app", () => {
    for (const deployEnvironment of [undefined, "", "production", "Staging", "staging "]) {
      expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment, appId: APP }, "PARTICIPANT")).toThrow();
    }
    expect(() => stageTestServicePrincipal(appToken({ azp: "annen-app" }), STAGE, "PARTICIPANT")).toThrow();
    expect(() => stageTestServicePrincipal(appToken(), { deployEnvironment: "staging", appId: undefined }, "PARTICIPANT")).toThrow();
    expect(() => stageTestServicePrincipal({ oid: "sp-oid" }, { deployEnvironment: "staging", appId: "" }, "PARTICIPANT")).toThrow();
  });
});
