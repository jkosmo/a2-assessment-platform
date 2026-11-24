import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1192 punkt 1 (produkteier 2026-11-24): modulrapportene følger regelen fra kurset. En bestått står til modulen revideres, og
// et senere stryk tar den ikke bort. Et pass bare på en eldre hovedversjon av modulen er «Må ta ny versjon» (svar A: modulens
// nyeste hovedversjon, også når et kurs ikke krever den), og et gammelt bestått-vedtak gir det ikke tilbake. Med ett valgt kurs
// gjelder kursets krav. Gjennom rutene, mot ekte Postgres: ståstedet leses fra `ModulePass`, og «siste forsøk» fra sorteringen.

const stamp = `${Date.now()}-${Math.round(performance.now())}`;
const reader = {
  "x-user-id": `standing-1192-reader-${stamp}`,
  "x-user-email": `standing-1192-reader-${stamp}@x.test`,
  "x-user-name": "Standing Reader",
  "x-user-roles": "REPORT_READER",
};
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const L = (text: string) => JSON.stringify({ nb: text, "en-GB": text });

const made = { users: [] as string[], submissions: [] as string[], modules: [] as string[], courses: [] as string[] };

/** En modul med publiserte hovedversjoner 1 og (valgfritt) 2. */
async function moduleWith(majors: number[]) {
  const module = await prisma.module.create({ data: { title: L(`1192 modul ${stamp}-${made.modules.length}`) }, select: { id: true } });
  made.modules.push(module.id);
  const versions: Record<number, string> = {};
  for (const [index, major] of majors.entries()) {
    versions[major] = (await prisma.moduleVersion.create({
      data: { moduleId: module.id, versionNo: index + 1, versionMajor: major, versionMinor: 0, assessmentMode: "MCQ_ONLY", publishedAt: ago(10 - index) },
      select: { id: true },
    })).id;
  }
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: versions[Math.max(...majors)] } });
  return { moduleId: module.id, versions };
}

async function person(tag: string) {
  const user = await prisma.user.create({
    data: { externalId: `st1192-${tag}-${stamp}`, name: `ST ${tag}`, email: `st1192-${tag}-${stamp}@x.test`, activeStatus: true },
    select: { id: true },
  });
  made.users.push(user.id);
  return user.id;
}

/** Et forsøk med vedtak; et bestått får sin `ModulePass`, slik `recordModulePassFromDecision` lager den. */
async function attempt(userId: string, moduleId: string, moduleVersionId: string, daysAgo: number, passed: boolean | null): Promise<string | null> {
  const submission = await prisma.submission.create({
    data: { userId, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: passed === null ? "UNDER_REVIEW" : "COMPLETED", submittedAt: ago(daysAgo) },
    select: { id: true },
  });
  made.submissions.push(submission.id);
  if (passed === null) return null;
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: passed ? 1 : 0,
      redFlagsJson: "[]", passFailTotal: passed, decisionType: "AUTOMATIC", decisionReason: "Fikstur #1192.", finalisedAt: ago(daysAgo),
    },
    select: { id: true },
  });
  if (passed) {
    await prisma.modulePass.create({ data: { userId, moduleId, submissionId: submission.id, decisionId: decision.id, moduleVersionId, passedAt: ago(daysAgo) } });
  }
  return decision.id;
}

const detailsStatus = async (moduleId: string, userId: string, query = "") => {
  const response = await request(app).get(`/api/reports/completion/details?selectedModuleId=${moduleId}${query}`).set(reader);
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
  return (response.body.rows as Array<{ participantId: string; status: string }>).find((row) => row.participantId === userId)?.status;
};

describe("#1192 punkt 1: modulrapportene følger ståstedet, ikke bare siste forsøk", () => {
  let revidert: { moduleId: string; versions: Record<number, string> };
  let enkel: { moduleId: string; versions: Record<number, string> };
  const u: Record<string, string> = {};
  let courseId = "";

  beforeAll(async () => {
    enkel = await moduleWith([1]);
    revidert = await moduleWith([1, 2]);
    // Bestått, så et senere stryk: bestått står.
    u.bestodStrok = await person("bestod-strok");
    await attempt(u.bestodStrok, enkel.moduleId, enkel.versions[1], 5, true);
    await attempt(u.bestodStrok, enkel.moduleId, enkel.versions[1], 2, false);
    // Bestått, så et nytt forsøk under vurdering: bestått står.
    u.bestodVenter = await person("bestod-venter");
    await attempt(u.bestodVenter, enkel.moduleId, enkel.versions[1], 5, true);
    await attempt(u.bestodVenter, enkel.moduleId, enkel.versions[1], 1, null);
    // Kontroll: aldri bestått, strøk.
    u.strok = await person("strok");
    await attempt(u.strok, enkel.moduleId, enkel.versions[1], 2, false);
    // Bestått hovedversjon 1 av en modul som nå er på 2, og har ikke prøvd igjen: må ta ny versjon.
    u.gammel = await person("gammel");
    await attempt(u.gammel, revidert.moduleId, revidert.versions[1], 6, true);
    // Kontroll: bestått hovedversjon 2.
    u.ny = await person("ny");
    await attempt(u.ny, revidert.moduleId, revidert.versions[2], 3, true);

    // Et kurs som har valgt å ikke kreve hovedversjon 2 (kravet står på 1).
    const course = await prisma.course.create({ data: { title: L(`1192 kurs ${stamp}`), slug: `st1192-${stamp}`, publishedAt: new Date() }, select: { id: true } });
    courseId = course.id;
    made.courses.push(courseId);
    await prisma.courseItem.create({ data: { courseId, itemType: "MODULE", moduleId: revidert.moduleId, sortOrder: 0 } });
    await prisma.courseModuleRequirement.create({ data: { courseId, moduleId: revidert.moduleId, minModuleMajor: 1 } });
  });

  afterAll(async () => {
    await prisma.certificationStatus.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.modulePass.deleteMany({ where: { submissionId: { in: made.submissions } } });
    await prisma.assessmentDecision.deleteMany({ where: { submissionId: { in: made.submissions } } });
    await prisma.submission.deleteMany({ where: { id: { in: made.submissions } } });
    await prisma.courseModuleRequirement.deleteMany({ where: { courseId: { in: made.courses } } });
    await prisma.courseItem.deleteMany({ where: { courseId: { in: made.courses } } });
    await prisma.course.deleteMany({ where: { id: { in: made.courses } } });
    await prisma.module.updateMany({ where: { id: { in: made.modules } }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: made.modules } } });
    await prisma.module.deleteMany({ where: { id: { in: made.modules } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  });

  it("detaljen: et senere stryk eller et forsøk under vurdering tar ikke bort en bestått; kontrollen uten pass er strøket", async () => {
    expect(await detailsStatus(enkel.moduleId, u.bestodStrok)).toBe("PASSED");
    expect(await detailsStatus(enkel.moduleId, u.bestodVenter)).toBe("PASSED");
    expect(await detailsStatus(enkel.moduleId, u.strok)).toBe("FAILED");
  });

  it("detaljen: et pass bare på en eldre hovedversjon er «Må ta ny versjon»; et pass på den nyeste er bestått", async () => {
    expect(await detailsStatus(revidert.moduleId, u.gammel)).toBe("NEEDS_NEW_VERSION");
    expect(await detailsStatus(revidert.moduleId, u.ny)).toBe("PASSED");
  });

  it("med ett valgt kurs gjelder kursets krav: kurset krever bare hovedversjon 1, så det gamle passet er bestått der", async () => {
    expect(await detailsStatus(revidert.moduleId, u.gammel, `&courseId=${courseId}`)).toBe("PASSED");
  });

  it("profilen («Moduler bestått»): en modul bestått bare på en eldre hovedversjon står ikke der; en bestått på den nyeste gjør", async () => {
    const as = (tag: string) => ({
      "x-user-id": `st1192-${tag}-${stamp}`,
      "x-user-email": `st1192-${tag}-${stamp}@x.test`,
      "x-user-name": `ST ${tag}`,
      "x-user-roles": "PARTICIPANT",
    });
    const gammel = await request(app).get("/api/me/stats").set(as("gammel"));
    expect(gammel.status, JSON.stringify(gammel.body).slice(0, 300)).toBe(200);
    expect((gammel.body.passedModules as Array<{ moduleId: string }>).map((m) => m.moduleId)).not.toContain(revidert.moduleId);
    expect(gammel.body.totals.modulesPassed).toBe(0);
    // Kontroll: den som besto hovedversjon 2, har modulen i lista.
    const ny = await request(app).get("/api/me/stats").set(as("ny"));
    expect((ny.body.passedModules as Array<{ moduleId: string }>).map((m) => m.moduleId)).toContain(revidert.moduleId);
    // Bestått, så et senere stryk: modulen står fortsatt (pass på et annet forsøk).
    const bestodStrok = await request(app).get("/api/me/stats").set(as("bestod-strok"));
    expect((bestodStrok.body.passedModules as Array<{ moduleId: string }>).map((m) => m.moduleId)).toContain(enkel.moduleId);
  });

  it("tallet før en publisering (`/passed-count`): de som har bestått modulen nå, på modulens nyeste hovedversjon", async () => {
    const admin = { "x-user-id": `st1192-admin-${stamp}`, "x-user-email": `st1192-admin-${stamp}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };
    const count = async (moduleId: string) => {
      const response = await request(app).get(`/api/admin/content/modules/${moduleId}/passed-count`).set(admin);
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
      return response.body.passedCount;
    };
    // bestod-strok og bestod-venter; ikke den som strøk.
    expect(await count(enkel.moduleId)).toBe(2);
    // Bare den som besto hovedversjon 2; den som besto 1, teller ikke.
    expect(await count(revidert.moduleId)).toBe(1);
  });

  it("resertifiseringsrapporten: statusen kommer fra beståttene, ikke fra `CertificationStatus`-raden", async () => {
    const latestDecision = async (userId: string, moduleId: string) =>
      (await prisma.assessmentDecision.findFirstOrThrow({ where: { submission: { userId, moduleId } }, orderBy: { finalisedAt: "desc" }, select: { id: true } })).id;
    const row = async (userId: string, moduleId: string, status: "ACTIVE" | "NOT_CERTIFIED") =>
      prisma.certificationStatus.create({ data: { userId, moduleId, latestDecisionId: await latestDecision(userId, moduleId), status, passedAt: status === "ACTIVE" ? ago(6) : null } });
    // Slik den gamle vakta etterlot radene: et senere stryk ga NOT_CERTIFIED, og et pass på en eldre versjon sto som ACTIVE.
    await row(u.bestodStrok, enkel.moduleId, "NOT_CERTIFIED");
    await row(u.strok, enkel.moduleId, "NOT_CERTIFIED");
    await row(u.gammel, revidert.moduleId, "ACTIVE");
    // Et bestått som er omgjort i en anke: ingen `ModulePass` lenger, men raden sto som ACTIVE (DESIGN_934 mangel 41).
    // Egen modul, så tallene i de andre testene står.
    const egen = await moduleWith([1]);
    u.anket = await person("anket");
    await attempt(u.anket, egen.moduleId, egen.versions[1], 4, false);
    await row(u.anket, egen.moduleId, "ACTIVE");

    const statusOf = async (moduleId: string, userId: string) => {
      const response = await request(app).get(`/api/reports/recertification?moduleId=${moduleId}`).set(reader);
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
      return (response.body.rows as Array<{ userId: string; status: string }>).find((r) => r.userId === userId)?.status;
    };
    expect(await statusOf(enkel.moduleId, u.bestodStrok)).toBe("ACTIVE");
    expect(await statusOf(revidert.moduleId, u.gammel)).toBe("SUPERSEDED");
    expect(await statusOf(egen.moduleId, u.anket)).toBe("NOT_CERTIFIED");
    // Kontroll: aldri bestått.
    expect(await statusOf(enkel.moduleId, u.strok)).toBe("NOT_CERTIFIED");
  });

  it("bestått-andelen og fullføringen: samme regel, og den reviderte er verken bestått eller strøket", async () => {
    const pass = await request(app).get(`/api/reports/pass-rates?moduleId=${enkel.moduleId}`).set(reader);
    expect(pass.status).toBe(200);
    expect(pass.body.rows[0]).toMatchObject({ totalSubmissions: 3, passCount: 2, failCount: 1, underReviewCount: 0, revisedCount: 0 });
    const passRevised = await request(app).get(`/api/reports/pass-rates?moduleId=${revidert.moduleId}`).set(reader);
    expect(passRevised.body.rows[0]).toMatchObject({ totalSubmissions: 2, passCount: 1, failCount: 0, revisedCount: 1, decisionCount: 1, passRate: 1 });

    const completion = await request(app).get(`/api/reports/completion?moduleId=${enkel.moduleId}`).set(reader);
    expect(completion.status).toBe(200);
    // bestod-venter: siste forsøk er under vurdering, men bestått står, så hen er fullført (ikke «under vurdering»).
    expect(completion.body.rows[0]).toMatchObject({ totalSubmissions: 3, completedSubmissions: 3, underReviewSubmissions: 0 });
    const completionRevised = await request(app).get(`/api/reports/completion?moduleId=${revidert.moduleId}`).set(reader);
    expect(completionRevised.body.rows[0]).toMatchObject({ totalSubmissions: 2, completedSubmissions: 1 });
  });
});
