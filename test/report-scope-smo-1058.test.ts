import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1058: SUBJECT_MATTER_OWNER ser Resultater for egne kurs — også på personnivå. Administrator og
// rapportleser ser alt. Analyse på tvers av organisasjonen (appeals, mcq-quality …) er fortsatt
// bare for dem.
//
// Fiksturen: to publiserte kurs, ett med SMO som eier (A) og ett uten (B), hver med sin modul og
// én innlevering. Alt SMO får se skal handle om A; B skal være som om det ikke fantes — tom
// rapport, ikke 403.
//
// ⚠️ Kursfilteret (courseId) gjaldt før BARE kursrapporten; modultabellene ignorerte det. Testen
// nederst låser at «Kurs: A» også avgrenser modulene for en rapportleser.
// ─────────────────────────────────────────────────────────────────────────────

const stamp = `${Date.now()}-${Math.round(performance.now())}`;
const smo = {
  "x-user-id": `smo-1058-${stamp}`,
  "x-user-email": `smo-1058-${stamp}@company.com`,
  "x-user-name": "Fagansvarlig",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};
const rapportleser = {
  "x-user-id": `rr-1058-${stamp}`,
  "x-user-email": `rr-1058-${stamp}@company.com`,
  "x-user-name": "Rapportleser",
  "x-user-roles": "REPORT_READER",
};
const deltaker = {
  "x-user-id": `p-1058-${stamp}`,
  "x-user-email": `p-1058-${stamp}@company.com`,
  "x-user-name": "Deltaker",
  "x-user-roles": "PARTICIPANT",
};

let courseA = "";
let courseB = "";
let moduleA = "";
let moduleB = "";
let smoUserId = "";
let deltakerUserId = "";

// Hodene bærer ekstern id; databasen bruker sin egen. Brukerne lages først, så fremmednøklene holder.
async function lagBruker(h: Record<string, string>) {
  const u = await prisma.user.create({
    data: { externalId: h["x-user-id"], name: h["x-user-name"], email: h["x-user-email"] },
    select: { id: true },
  });
  return u.id;
}

async function lagKursMedModul(navn: string) {
  const course = await prisma.course.create({
    data: { title: JSON.stringify({ nb: navn }), publishedAt: new Date(), enrollmentPolicy: "OPEN" },
    select: { id: true },
  });
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  const module = await prisma.module.create({ data: { title: JSON.stringify({ nb: `${navn} modul` }) }, select: { id: true } });
  const version = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: "Oppgave",
      assessorExpectedContent: "Veiledning",
      rubricVersionId: source!.rubricVersionId,
      promptTemplateVersionId: source!.promptTemplateVersionId,
      assessmentMode: "FREETEXT_ONLY",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId: module.id, sortOrder: 1 } });
  await prisma.submission.create({
    data: {
      userId: deltakerUserId,
      moduleId: module.id,
      moduleVersionId: version.id,
      deliveryType: "text",
      responseJson: JSON.stringify({ response: "Svar" }),
      submissionStatus: "COMPLETED",
    },
  });
  return { courseId: course.id, moduleId: module.id };
}

describe("#1058 — SMO ser Resultater for egne kurs", () => {
  beforeAll(async () => {
    smoUserId = await lagBruker(smo);
    deltakerUserId = await lagBruker(deltaker);
    const a = await lagKursMedModul(`Eget kurs ${stamp}`);
    const b = await lagKursMedModul(`Andres kurs ${stamp}`);
    courseA = a.courseId; moduleA = a.moduleId;
    courseB = b.courseId; moduleB = b.moduleId;
    await prisma.contentOwner.create({
      data: { contentType: "COURSE", contentId: courseA, userId: smoUserId },
    });
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const moduleIds = (rows: Array<{ moduleId: string }>) => rows.map((r) => r.moduleId).filter((id) => id === moduleA || id === moduleB);
  const courseIds = (rows: Array<{ courseId: string }>) => rows.map((r) => r.courseId).filter((id) => id === courseA || id === courseB);

  it("kursvelgeren: SMO får bare egne kurs, rapportleser får begge", async () => {
    const forSmo = await request(app).get("/api/reports/courses/options").set(smo);
    expect(forSmo.status).toBe(200);
    const smoIds = (forSmo.body.courses as Array<{ id: string }>).map((c) => c.id);
    expect(smoIds).toContain(courseA);
    expect(smoIds).not.toContain(courseB);

    const forRr = await request(app).get("/api/reports/courses/options").set(rapportleser);
    expect(forRr.status).toBe(200);
    const rrIds = (forRr.body.courses as Array<{ id: string }>).map((c) => c.id);
    expect(rrIds).toEqual(expect.arrayContaining([courseA, courseB]));
  });

  it("modulrapportene: SMO ser modulen i eget kurs, ikke den andre", async () => {
    for (const path of ["/api/reports/completion", "/api/reports/pass-rates"]) {
      const res = await request(app).get(path).set(smo);
      expect(res.status, path).toBe(200);
      expect(moduleIds(res.body.rows), path).toEqual([moduleA]);
    }
    const detaljA = await request(app).get(`/api/reports/completion/details?selectedModuleId=${moduleA}`).set(smo);
    expect(detaljA.status).toBe(200);
    expect(detaljA.body.rows).toHaveLength(1);
    expect(detaljA.body.rows[0].participantEmail).toBe(deltaker["x-user-email"]);

    // Utenfor egne kurs: tom, ikke 403 — SMO skal ikke få vite at modulen finnes.
    const detaljB = await request(app).get(`/api/reports/completion/details?selectedModuleId=${moduleB}`).set(smo);
    expect(detaljB.status).toBe(200);
    expect(detaljB.body.rows).toHaveLength(0);
  });

  it("kursrapportene: SMO ser eget kurs; det andre er tomt", async () => {
    const kurs = await request(app).get("/api/reports/courses").set(smo);
    expect(kurs.status).toBe(200);
    expect(courseIds(kurs.body.rows)).toEqual([courseA]);

    const detaljB = await request(app).get(`/api/reports/courses/details?selectedCourseId=${courseB}`).set(smo);
    expect(detaljB.status).toBe(200);
    expect(detaljB.body.rows).toHaveLength(0);

    // Å be om det andre kurset eksplisitt gir også tomt — ikke B.
    const filtrert = await request(app).get(`/api/reports/completion?courseId=${courseB}`).set(smo);
    expect(filtrert.status).toBe(200);
    expect(moduleIds(filtrert.body.rows)).toEqual([]);
  });

  it("eksport: de seks Resultater-typene følger avgrensningen; resten er 403 for SMO", async () => {
    const csv = await request(app).get("/api/reports/export?type=completion&format=csv").set(smo);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(moduleA);
    expect(csv.text).not.toContain(moduleB);

    const learners = await request(app).get(`/api/reports/export?type=course-learners&format=csv&courseId=${courseB}`).set(smo);
    expect(learners.status).toBe(200);
    expect(learners.text).not.toContain(deltaker["x-user-email"]);

    const appeals = await request(app).get("/api/reports/export?type=appeals&format=csv").set(smo);
    expect(appeals.status).toBe(403);
  });

  it("analyse på tvers av organisasjonen er fortsatt bare for administrator og rapportleser", async () => {
    for (const path of ["/api/reports/appeals", "/api/reports/mcq-quality", "/api/reports/manual-review-queue", "/api/reports/analytics/trends"]) {
      const res = await request(app).get(path).set(smo);
      expect(res.status, path).toBe(403);
    }
    const rr = await request(app).get("/api/reports/appeals").set(rapportleser);
    expect(rr.status).toBe(200);
  });

  it("rapportleser ser alt — og «Kurs: A» avgrenser også modultabellen", async () => {
    const alt = await request(app).get("/api/reports/completion").set(rapportleser);
    expect(alt.status).toBe(200);
    expect(moduleIds(alt.body.rows).sort()).toEqual([moduleA, moduleB].sort());

    const bareA = await request(app).get(`/api/reports/completion?courseId=${courseA}`).set(rapportleser);
    expect(bareA.status).toBe(200);
    expect(moduleIds(bareA.body.rows)).toEqual([moduleA]);
  });
});
