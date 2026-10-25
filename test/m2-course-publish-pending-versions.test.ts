// 2.101.0: «publiser alle nye versjoner» i et kurs, med ETT svar på revisjonsspørsmålet.
//
// Produkteier, 2026-10-25: etter en kursoppdatering (#1095) ligger hver ny versjon klar som utkast,
// og forfatteren måtte inn i hver modul for å publisere. Nå: ett spørsmål for alle, og «Er dette en
// revisjon?» besvares samlet.
//
// Det testen måler, og hvorfor:
//   - Nye versjoner på LEVENDE elementer er med. Kaskaden for kurspublisering (#734) så bare
//     elementer som aldri var publisert — det var hullet.
//   - Revisjonssvaret kreves når noen har bestått, og gjelder alle modulene.
//   - Det forfatteren så, er det som publiseres (409 ellers).
//   - Alt eller ingenting: et element som mangler et språk, stopper alle.
//   - Andres elementer publiseres ikke herfra.
//   - Kaskadens forhåndsvisning er uendret: levende elementer med en ny versjon er ikke «upubliserte».

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const L = (s: string) => JSON.stringify({ "en-GB": s, nb: s, nn: s });
const bareBokmaal = (s: string) => JSON.stringify({ nb: s });
let seq = 0;

async function smoUser(stamp: string) {
  const externalId = `smo-pending-${stamp}`;
  const user = await prisma.user.create({
    data: { externalId, email: `${externalId}@company.com`, name: "Fagansvarlig" },
    select: { id: true },
  });
  const headers = { "x-user-id": externalId, "x-user-email": `${externalId}@company.com`, "x-user-name": "Fagansvarlig", "x-user-roles": "SUBJECT_MATTER_OWNER" };
  return { id: user.id, headers };
}

/** En levende seksjon (v1) med en nyere versjon (v2) lagt klar. */
async function sectionWithPendingVersion(stamp: string, v2Body: string) {
  const section = await prisma.courseSection.create({ data: { title: L(`Seksjon ${stamp}`) }, select: { id: true } });
  const v1 = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("v1"), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: v1.id } });
  const v2 = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 2, bodyMarkdown: v2Body }, select: { id: true } });
  return { sectionId: section.id, v1Id: v1.id, v2Id: v2.id };
}

/** En levende modul (v1) med en nyere versjon (v2) lagt klar, og eventuelt én deltaker som har bestått v1. */
async function moduleWithPendingVersion(stamp: string, opts: { passed?: boolean } = {}) {
  const module = await prisma.module.create({ data: { title: L(`Modul ${stamp}`) }, select: { id: true } });
  const v1 = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date(), taskText: L("v1") },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: v1.id } });
  const v2 = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 2, assessmentMode: "MCQ_ONLY", taskText: L("v2 — justert") },
    select: { id: true },
  });
  let certificationId: string | null = null;
  if (opts.passed) {
    const user = await prisma.user.create({ data: { externalId: `part-${stamp}`, email: `part-${stamp}@company.com`, name: "Deltaker" }, select: { id: true } });
    const submission = await prisma.submission.create({
      data: { userId: user.id, moduleId: module.id, moduleVersionId: v1.id, submissionStatus: "COMPLETED", deliveryType: "text", responseJson: "{}", submittedAt: new Date() },
      select: { id: true },
    });
    const decision = await prisma.assessmentDecision.create({
      data: { submissionId: submission.id, moduleVersionId: v1.id, decisionType: "AUTOMATIC", passFailTotal: true, totalScore: 90, mcqScaledScore: 30, practicalScaledScore: 60, decisionReason: "Pass", redFlagsJson: "[]", finalisedAt: new Date() },
      select: { id: true },
    });
    const cert = await prisma.certificationStatus.create({
      data: { userId: user.id, moduleId: module.id, latestDecisionId: decision.id, status: "ACTIVE", passedAt: new Date() },
      select: { id: true },
    });
    certificationId = cert.id;
  }
  return { moduleId: module.id, v1Id: v1.id, v2Id: v2.id, certificationId };
}

async function publishedCourse(stamp: string, items: Array<{ type: "SECTION"; id: string } | { type: "MODULE"; id: string }>) {
  const course = await prisma.course.create({ data: { title: L(`Kurs ${stamp}`), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseItem.createMany({
    data: items.map((item, index) => ({
      courseId: course.id,
      itemType: item.type,
      sortOrder: index,
      ...(item.type === "SECTION" ? { sectionId: item.id } : { moduleId: item.id }),
    })),
  });
  return course.id;
}

async function own(userId: string, contentType: "COURSE" | "SECTION" | "MODULE", contentId: string) {
  await prisma.contentOwner.create({ data: { contentType, contentId, userId } });
}

async function activeSectionVersion(sectionId: string) {
  return (await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } })).activeVersionId;
}
async function activeModuleVersion(moduleId: string) {
  return (await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionId: true } })).activeVersionId;
}

describe("2.101.0 — publiser alle nye versjoner i et kurs", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function scenario() {
    const stamp = `pending-${Date.now()}-${seq++}`;
    const smo = await smoUser(stamp);
    const section = await sectionWithPendingVersion(`${stamp}-s`, L("v2 — justert seksjon"));
    const tested = await moduleWithPendingVersion(`${stamp}-a`, { passed: true });
    const untested = await moduleWithPendingVersion(`${stamp}-b`);
    const foreign = await moduleWithPendingVersion(`${stamp}-c`);
    const courseId = await publishedCourse(stamp, [
      { type: "SECTION", id: section.sectionId },
      { type: "MODULE", id: tested.moduleId },
      { type: "MODULE", id: untested.moduleId },
      { type: "MODULE", id: foreign.moduleId },
    ]);
    await own(smo.id, "COURSE", courseId);
    await own(smo.id, "SECTION", section.sectionId);
    await own(smo.id, "MODULE", tested.moduleId);
    await own(smo.id, "MODULE", untested.moduleId);
    // `foreign` eies av ingen andre enn administrator — en annens modul i kurset.
    return { smo, section, tested, untested, foreign, courseId };
  }

  it("lista viser nye versjoner på levende elementer, tallet for revisjonsspørsmålet, og andres elementer for seg", async () => {
    const { smo, section, tested, untested, foreign, courseId } = await scenario();

    const res = await request(app).get(`/api/admin/content/courses/${courseId}/pending-versions`).set(smo.headers);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items.map((i: { id: string; versionId: string; isNew: boolean }) => [i.id, i.versionId, i.isNew])).toEqual([
      [section.sectionId, section.v2Id, false],
      [tested.moduleId, tested.v2Id, false],
      [untested.moduleId, untested.v2Id, false],
    ]);
    expect(res.body.notOwnedItems.map((i: { id: string }) => i.id)).toEqual([foreign.moduleId]);
    expect(res.body).toMatchObject({ publishable: true, passedTotal: 1, modulesWithPasses: 1 });

    // Kaskadens forhåndsvisning er uendret: kurset er publisert, og levende elementer er ikke «upubliserte».
    const preview = await request(app).get(`/api/admin/content/courses/${courseId}/publish-preview`).set(smo.headers);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ allPublished: true, unpublishedItems: [] });
  });

  it("revisjonssvaret kreves når noen har bestått — uten det publiseres ingenting", async () => {
    const { smo, section, tested, untested, courseId } = await scenario();
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish-pending`)
      .set(smo.headers)
      .send({ versionIds: [section.v2Id, tested.v2Id, untested.v2Id] });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe("revision_answer_required");
    expect(await activeSectionVersion(section.sectionId)).toBe(section.v1Id);
    expect(await activeModuleVersion(tested.moduleId)).toBe(tested.v1Id);
  });

  it("et annet sett enn det forfatteren så, gir 409 og publiserer ingenting", async () => {
    const { smo, section, tested, courseId } = await scenario();
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish-pending`)
      .set(smo.headers)
      .send({ versionIds: [section.v2Id, tested.v2Id], supersedesEarlierPasses: false });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe("pending_versions_changed");
    expect(await activeSectionVersion(section.sectionId)).toBe(section.v1Id);
  });

  it("«nei, ikke en revisjon»: alt eget publiseres, beståtten står, andres modul er urørt", async () => {
    const { smo, section, tested, untested, foreign, courseId } = await scenario();
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish-pending`)
      .set(smo.headers)
      .send({ versionIds: [section.v2Id, tested.v2Id, untested.v2Id], supersedesEarlierPasses: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.publishedItems).toHaveLength(3);
    expect(await activeSectionVersion(section.sectionId)).toBe(section.v2Id);
    expect(await activeModuleVersion(tested.moduleId)).toBe(tested.v2Id);
    expect(await activeModuleVersion(untested.moduleId)).toBe(untested.v2Id);
    expect(await activeModuleVersion(foreign.moduleId)).toBe(foreign.v1Id);
    const cert = await prisma.certificationStatus.findUniqueOrThrow({ where: { id: tested.certificationId! }, select: { status: true } });
    expect(cert.status).toBe("ACTIVE");

    // Ingenting igjen å publisere for denne forfatteren.
    const after = await request(app).get(`/api/admin/content/courses/${courseId}/pending-versions`).set(smo.headers);
    expect(after.body.items).toEqual([]);
  });

  it("«ja, en revisjon»: ett svar gjelder alle modulene — beståtten erstattes og deltakeren varsles", async () => {
    const { smo, section, tested, untested, courseId } = await scenario();
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish-pending`)
      .set(smo.headers)
      .send({ versionIds: [section.v2Id, tested.v2Id, untested.v2Id], supersedesEarlierPasses: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cert = await prisma.certificationStatus.findUniqueOrThrow({ where: { id: tested.certificationId! }, select: { status: true } });
    expect(cert.status).toBe("SUPERSEDED");
    const events = (await prisma.outboxEvent.findMany({ where: { type: "module_revised_notification" } }))
      .map((row) => JSON.parse(row.payloadJson) as Record<string, unknown>)
      .filter((payload) => payload.moduleId === tested.moduleId || payload.moduleId === untested.moduleId);
    expect(events.map((e) => e.moduleVersionId)).toEqual([tested.v2Id]);
    // Varselet navngir kurset beståtten gjaldt (produkteier 2026-10-25).
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { title: true } });
    expect(events[0]!.courseTitles).toEqual([JSON.parse(course.title).nb]);
  });

  it("alt eller ingenting: en seksjon som mangler et språk, stopper alle", async () => {
    const stamp = `pending-blocked-${Date.now()}-${seq++}`;
    const smo = await smoUser(stamp);
    const section = await sectionWithPendingVersion(`${stamp}-s`, bareBokmaal("v2 bare på bokmål"));
    const module = await moduleWithPendingVersion(`${stamp}-a`);
    const courseId = await publishedCourse(stamp, [{ type: "SECTION", id: section.sectionId }, { type: "MODULE", id: module.moduleId }]);
    await own(smo.id, "COURSE", courseId);
    await own(smo.id, "SECTION", section.sectionId);
    await own(smo.id, "MODULE", module.moduleId);

    const list = await request(app).get(`/api/admin/content/courses/${courseId}/pending-versions`).set(smo.headers);
    expect(list.body.publishable).toBe(false);
    const blocked = list.body.items.find((i: { id: string }) => i.id === section.sectionId);
    expect(blocked.publishable).toBe(false);
    expect(blocked.blockers[0]).toMatchObject({ code: "translation_incomplete" });

    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish-pending`)
      .set(smo.headers)
      .send({ versionIds: [section.v2Id, module.v2Id] });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toBe("course_pending_blocked");
    expect(await activeSectionVersion(section.sectionId)).toBe(section.v1Id);
    expect(await activeModuleVersion(module.moduleId)).toBe(module.v1Id);
  });

  it("bare kursets eier: en annen fagansvarlig får 403 både på lista og publiseringen", async () => {
    const { section, tested, untested, courseId } = await scenario();
    const stranger = await smoUser(`stranger-${Date.now()}-${seq++}`);
    const list = await request(app).get(`/api/admin/content/courses/${courseId}/pending-versions`).set(stranger.headers);
    expect(list.status).toBe(403);
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish-pending`)
      .set(stranger.headers)
      .send({ versionIds: [section.v2Id, tested.v2Id, untested.v2Id], supersedesEarlierPasses: false });
    expect(res.status).toBe(403);
  });
});
