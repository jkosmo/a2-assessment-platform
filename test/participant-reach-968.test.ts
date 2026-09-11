import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

// Tildelings-e-post måles ved senderen; loggkanalen er stille i test.
const sendteTildelinger: string[] = [];
vi.mock("../src/modules/certification/participantNotificationService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/certification/participantNotificationService.js")>();
  return {
    ...original,
    sendCourseAssignmentNotification: async (input: { recipientEmail: string }) => {
      sendteTildelinger.push(input.recipientEmail);
      return { delivered: true, channel: "log", subject: "", nextStepGuidance: "" };
    },
  };
});

import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resolveCourseAudience } from "../src/modules/course/cohortStatusService.js";

// ─────────────────────────────────────────────────────────────────────────────
// #968: én regel for «kan deltakeren nås», håndhevet likt uansett vei inn.
//
// To ansatte har sluttet (activeStatus=false). Den ene var meldt inn individuelt, den andre via
// klasse. Før: klassemedlemmet ble filtrert bort fra publikummet, den individuelle ikke — og begge
// fikk tildelings-e-post ved ny kurstildeling. Dashbordet lot SMO «purre» på en som
// påminnelsesjobben hoppet over; purringen kom aldri, og tallet sto fast.
//
// ⚠️ To veier inn, to påstander. En test med bare klassemedlemmet var grønn FØR fiksen.
// ─────────────────────────────────────────────────────────────────────────────

const adminHeaders = {
  "x-user-id": "reach-admin-968",
  "x-user-email": "reach-admin-968@company.com",
  "x-user-name": "Reach Admin",
  "x-user-roles": "ADMINISTRATOR",
};

describe("#968 — deaktiverte og anonymiserte deltakere er utenfor publikummet, uansett vei inn", () => {
  const stamp = `${Date.now()}-${Math.round(performance.now())}`;
  const mk = async (tag: string, data: { activeStatus?: boolean; isAnonymized?: boolean } = {}) =>
    (await prisma.user.create({
      data: { externalId: `re-${tag}-${stamp}`, name: `RE ${tag}`, email: `re-${tag}-${stamp}@x.test`, ...data },
      select: { id: true, email: true },
    }));

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ individuell innmelding: en som har sluttet teller ikke — som klassemedlemmet aldri gjorde", async () => {
    const course = await prisma.course.create({ data: { title: `Reach ${stamp}`, publishedAt: new Date() }, select: { id: true } });
    const aktivInd = await mk("aktiv-ind");
    const sluttetInd = await mk("sluttet-ind", { activeStatus: false });
    const anonymInd = await mk("anonym-ind", { isAnonymized: true });
    const aktivKlasse = await mk("aktiv-klasse");
    const sluttetKlasse = await mk("sluttet-klasse", { activeStatus: false });
    for (const u of [aktivInd, sluttetInd, anonymInd]) {
      await prisma.courseEnrollment.create({ data: { userId: u.id, courseId: course.id, source: "INDIVIDUAL" } });
    }
    const klass = await prisma.class.create({
      data: { name: `Reach-kull ${stamp}`, kind: "MANUAL", members: { create: [{ userId: aktivKlasse.id }, { userId: sluttetKlasse.id }] } },
      select: { id: true },
    });
    await prisma.courseGroupAssignment.create({ data: { courseId: course.id, classId: klass.id, dueAt: null } });

    const publikum = new Set((await resolveCourseAudience(course.id)).map((m) => m.userId));
    expect(publikum.has(aktivInd.id), "aktiv individuell").toBe(true);
    expect(publikum.has(aktivKlasse.id), "aktiv klasse").toBe(true);
    expect(publikum.has(sluttetInd.id), "sluttet, individuell — talte FØR").toBe(false);
    expect(publikum.has(anonymInd.id), "anonymisert, individuell — talte FØR").toBe(false);
    expect(publikum.has(sluttetKlasse.id), "sluttet, klasse — kontroll").toBe(false);

    // Dashbordet: fire rader var det gamle svaret (2 aktive + sluttet-ind + anonym-ind).
    const res = await request(app).get(`/api/cohort-status/course/${course.id}`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it("⚠️ tildelings-e-post går ikke til en som har sluttet — den ble bare filtrert på at adressen fantes", async () => {
    const course = await prisma.course.create({ data: { title: `Reach-epost ${stamp}`, publishedAt: new Date() }, select: { id: true } });
    const aktiv = await mk("epost-aktiv");
    const sluttet = await mk("epost-sluttet", { activeStatus: false });
    const anonym = await mk("epost-anonym", { isAnonymized: true });
    const created = await request(app).post("/api/admin/content/classes").set(adminHeaders).send({ name: `Epost-kull ${stamp}` });
    expect(created.status).toBe(201);
    const classId = created.body.class.id as string;
    for (const u of [aktiv, sluttet, anonym]) {
      expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(adminHeaders).send({ userId: u.id })).status).toBe(201);
    }
    sendteTildelinger.length = 0;
    const assigned = await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(adminHeaders).send({ courseId: course.id });
    expect(assigned.status).toBe(201);
    // Varslingen er fire-and-forget etter svaret; gi den et øyeblikk.
    await new Promise((r) => setTimeout(r, 300));

    expect(sendteTildelinger).toContain(aktiv.email);
    expect(sendteTildelinger).not.toContain(sluttet.email);
    expect(sendteTildelinger).not.toContain(anonym.email);
  });
});
