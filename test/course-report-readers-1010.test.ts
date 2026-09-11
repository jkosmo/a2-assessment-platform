import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1010: den som bare har LEST i kurset, teller med.
//
// Et OPEN-kurs (standarden) kan leses uten innmeldingsrad — synligheten krever ingen — og klienten
// kaller aldri selv-innmelding. Rapportens nevner var «tildelt ∪ fullført ∪ har levert». En deltaker
// som hadde lest tre seksjoner uten å levere noe, fantes ikke: verken i kursraden eller i
// drilldownen. #966 slo fast at lesing er aktivitet; nevneren må mene det samme.
//
// ⚠️ Fiksturen har med vilje INGEN innmelding, INGEN klasse og INGEN modul — og TO seksjoner, der
// bare én leses. Første utgave hadde én seksjon: da var kurset fullført i det den ble lest, beviset
// ble utstedt, og deltakeren kom inn i nevneren via «fullført». Mutasjonstesten (fjerde kilde
// fjernet) var grønn. Alt som kan få deltakeren inn på en annen vei, må være borte — ellers måler
// testen ikke den fjerde kilden, den måler at unionen har fire ledd.
// ─────────────────────────────────────────────────────────────────────────────

const stamp = `${Date.now()}-${Math.round(performance.now())}`;
const leser = {
  "x-user-id": `leser-1010-${stamp}`,
  "x-user-email": `leser-1010-${stamp}@company.com`,
  "x-user-name": "Bare leser",
  "x-user-roles": "PARTICIPANT",
};
const rapportleser = {
  "x-user-id": `rapport-1010-${stamp}`,
  "x-user-email": `rapport-1010-${stamp}@company.com`,
  "x-user-name": "Rapportleser",
  "x-user-roles": "REPORT_READER",
};

describe("#1010 — kursrapporten teller den som bare har lest", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ OPEN-kurs, ingen innmelding, ingen innlevering — én lest seksjon gir én rad", async () => {
    const course = await prisma.course.create({
      data: { title: `Lesekurs ${stamp}`, publishedAt: new Date(), enrollmentPolicy: "OPEN" },
      select: { id: true },
    });
    const lagSeksjon = async (sortOrder: number) => {
      const section = await prisma.courseSection.create({ data: { title: JSON.stringify({ nb: `Les meg ${sortOrder}` }) }, select: { id: true } });
      const version = await prisma.courseSectionVersion.create({
        data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify({ nb: "Innhold." }), publishedAt: new Date() },
        select: { id: true },
      });
      await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
      await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder } });
      return section;
    };
    const section = await lagSeksjon(1);
    await lagSeksjon(2); // ulest — så kurset IKKE fullføres og beviset ikke utstedes

    const rader = async () => {
      const res = await request(app)
        .get(`/api/reports/courses/details?selectedCourseId=${encodeURIComponent(course.id)}`)
        .set(rapportleser);
      expect(res.status).toBe(200);
      return (res.body.rows as Array<{ participantEmail: string; readSections: number; totalSections: number; status: string }>)
        .filter((r) => r.participantEmail === leser["x-user-email"]);
    };
    const kursrad = async () => {
      const res = await request(app).get("/api/reports/courses").set(rapportleser);
      expect(res.status).toBe(200);
      return (res.body.rows as Array<{ courseId: string; enrolledParticipants: number }>).find((r) => r.courseId === course.id);
    };

    // Før lesing: ingen rad, og kursraden teller 0.
    expect(await rader()).toHaveLength(0);
    expect((await kursrad())?.enrolledParticipants ?? 0).toBe(0);

    // Deltakeren leser — via den ekte ruta, uten å være meldt inn.
    const les = await request(app).post(`/api/courses/${course.id}/sections/${section.id}/read`).set(leser);
    expect(les.status).toBeLessThan(300);
    expect(await prisma.courseEnrollment.count({ where: { courseId: course.id } }), "kontroll: fortsatt ingen innmelding").toBe(0);
    expect(await prisma.courseCompletion.count({ where: { courseId: course.id } }), "kontroll: ingen fullføring — ellers kommer hen inn den veien").toBe(0);

    const etter = await rader();
    expect(etter).toHaveLength(1);
    expect(etter[0].readSections).toBe(1);
    expect(etter[0].totalSections).toBe(2);
    expect(etter[0].status).not.toBe("COMPLETED");
    expect((await kursrad())?.enrolledParticipants).toBe(1);
  });
});
