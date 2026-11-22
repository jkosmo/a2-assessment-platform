// @vitest-environment node
//
// 2.120.0: en deltaker havnet på forfattersiden (/admin-content/courses) fra deltakerlenka og fikk
// «Du har ikke tilgang» uten vei videre. Sperren sender den som bare er deltaker til «Mine kurs».

import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — public/api-client.js is a browser ES module (no .d.ts).
import { sendParticipantsHome } from "../../public/api-client.js";

function meResponse(roles: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => ({ user: { roles } }) }));
}

async function run(pathname: string, fetchImpl: ReturnType<typeof vi.fn>, token: string | null = "tok") {
  const replace = vi.fn();
  const sent = await sendParticipantsHome({ pathname, getToken: async () => token, fetchImpl, replace });
  return { sent, replace };
}

describe("sendParticipantsHome", () => {
  it("en ren deltaker på en forfatterside sendes til «Mine kurs»", async () => {
    const fetchImpl = meResponse(["PARTICIPANT"]);
    const { sent, replace } = await run("/admin-content/courses", fetchImpl);
    expect(sent).toBe(true);
    expect(replace).toHaveBeenCalledWith("/participant");
    expect(fetchImpl).toHaveBeenCalledWith("/api/me", { headers: { Authorization: "Bearer tok" } });
  });

  it("uten roller i det hele tatt (rollen er ikke registrert ennå): også til «Mine kurs»", async () => {
    const { replace } = await run("/admin-content", meResponse([]));
    expect(replace).toHaveBeenCalledWith("/participant");
  });

  it("alle forfattersider er dekket, også modularbeidsflaten og kalibreringen", async () => {
    for (const path of ["/admin-content", "/admin-content/sections", "/admin-content/themes", "/admin-content/calibration", "/admin-content/module/m1/conversation"]) {
      const { replace } = await run(path, meResponse(["PARTICIPANT"]));
      expect(replace, path).toHaveBeenCalledWith("/participant");
    }
  });

  it("en hvilken som helst ansattrolle beholder siden", async () => {
    for (const role of ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR", "REVIEWER", "APPEAL_HANDLER", "REPORT_READER"]) {
      const { sent, replace } = await run("/admin-content/courses", meResponse(["PARTICIPANT", role]));
      expect(sent, role).toBe(false);
      expect(replace, role).not.toHaveBeenCalled();
    }
  });

  it("andre sider røres ikke, og /api/me spørres ikke", async () => {
    const fetchImpl = meResponse(["PARTICIPANT"]);
    for (const path of ["/participant", "/profile", "/deltakere/klasser", "/review"]) {
      const { replace } = await run(path, fetchImpl);
      expect(replace, path).not.toHaveBeenCalled();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("feiler oppslaget, eller mangler svaret rollene, skjer ingenting", async () => {
    expect((await run("/admin-content/courses", meResponse(["PARTICIPANT"], false))).replace).not.toHaveBeenCalled();
    expect((await run("/admin-content/courses", meResponse(undefined))).replace).not.toHaveBeenCalled();
    expect((await run("/admin-content/courses", vi.fn(async () => { throw new Error("nett"); }))).replace).not.toHaveBeenCalled();
    expect((await run("/admin-content/courses", meResponse(["PARTICIPANT"]), null)).replace).not.toHaveBeenCalled();
  });
});
