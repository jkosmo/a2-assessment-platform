import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

// #492 — read sections count toward course progress and are marked as read.
describe("Participant section read progress", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("marks a section read and counts it toward course progress", async () => {
    const course = await prisma.course.create({
      data: { title: `Read Course ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Read me" }) },
      select: { id: true },
    });
    const version = await prisma.courseSectionVersion.create({
      data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify({ "en-GB": "Body." }), publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 0 } });

    // Before reading: section shows read=false, progress 0/1.
    const before = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    expect(before.status).toBe(200);
    const sectionBefore = (before.body.course.items as Array<{ type: string; read?: boolean }>).find((i) => i.type === "SECTION");
    expect(sectionBefore?.read).toBe(false);
    // #714: per-type oppdeling — her 0 moduler, 1 seksjon (ulest).
    expect(before.body.course.progress).toMatchObject({ completed: 0, total: 1, moduleTotal: 0, sectionTotal: 1, sectionCompleted: 0 });

    // Mark read (idempotent).
    const mark1 = await request(app).post(`/api/courses/${course.id}/sections/${section.id}/read`).set(participantHeaders);
    expect(mark1.status).toBe(204);
    const mark2 = await request(app).post(`/api/courses/${course.id}/sections/${section.id}/read`).set(participantHeaders);
    expect(mark2.status).toBe(204);

    // After reading: read=true, progress 1/1, course COMPLETED.
    const after = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    const sectionAfter = (after.body.course.items as Array<{ type: string; read?: boolean }>).find((i) => i.type === "SECTION");
    expect(sectionAfter?.read).toBe(true);
    expect(after.body.course.progress).toMatchObject({ completed: 1, total: 1, courseStatus: "COMPLETED", sectionCompleted: 1, sectionTotal: 1 });

    // Reading the only section of a module-less course now issues a course completion (#580):
    // remove it first since CourseCompletion → Course is onDelete: Restrict.
    await prisma.courseCompletion.deleteMany({ where: { courseId: course.id } });
    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: section.id } });
    await prisma.courseSection.delete({ where: { id: section.id } });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// #944 — en seksjon uten aktiv versjon ga 200 med TOM SIDE, kunne markeres lest, og utløste
// kursbeviset. To helt ulike årsaker traff samme sti:
//
//   arkivert                        `archiveSection` nuller activeVersionId
//   holdt av oversettelsesgaten     versjonen lagres, activeVersionId settes ikke
//
// Derfor er dekningen ikke komplett før BEGGE årsakene er testet. En test på bare arkivering ville
// vært grønn mens den andre halvparten sto åpen — og det var nettopp den halvparten
// `contentImportService.ts:149-151` hadde beskrevet som oppdaget, uten at lesestien ble tettet.
// ──────────────────────────────────────────────────────────────────────────────

async function courseWithSection(opts: { archived?: boolean; withActiveVersion?: boolean }) {
  const course = await prisma.course.create({
    data: { title: `Gate Course ${Date.now()}-${Math.random()}`, publishedAt: new Date() },
    select: { id: true },
  });
  const section = await prisma.courseSection.create({
    data: {
      title: JSON.stringify({ "en-GB": "Gated" }),
      ...(opts.archived ? { archivedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  if (opts.withActiveVersion !== false) {
    const version = await prisma.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: JSON.stringify({ "en-GB": "Body." }),
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  }
  await prisma.courseItem.create({
    data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 0 },
  });
  return { courseId: course.id, sectionId: section.id };
}

describe("#944: en uleselig seksjon kan verken åpnes eller markeres lest", () => {
  it("en seksjon holdt tilbake av oversettelsesgaten gir 404, ikke tom side", async () => {
    // Versjonen finnes IKKE som aktiv — nøyaktig tilstanden gaten etterlater.
    const { courseId, sectionId } = await courseWithSection({ withActiveVersion: false });

    const read = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(participantHeaders);
    expect(read.status, JSON.stringify(read.body)).toBe(404);

    // ⚠️ Kjernen: markeringen skal heller ikke gå gjennom. Fram til nå var dette 204, lesningen ble
    // registrert, og kursbeviset utstedt for innhold som aldri ble publisert.
    const mark = await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(participantHeaders);
    expect(mark.status).toBe(404);

    const reads = await prisma.courseSectionRead.count({ where: { courseId, sectionId } });
    expect(reads, "ingen lesning skal være registrert").toBe(0);
  });

  it("en arkivert seksjon gir 404 — den andre årsaken, samme sti", async () => {
    const { courseId, sectionId } = await courseWithSection({ archived: true, withActiveVersion: false });

    expect((await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(participantHeaders)).status).toBe(404);
    expect((await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(participantHeaders)).status).toBe(404);
  });

  it("KONTROLLCASE: en publisert seksjon leses og markeres som før", async () => {
    // Uten denne vet vi ikke om vi målte tilgjengelighetsregelen eller bare knekte ruta. En
    // `return 404` uten betingelse ville bestått begge testene over.
    const { courseId, sectionId } = await courseWithSection({});

    const read = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(participantHeaders);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.html).toContain("Body.");

    const mark = await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(participantHeaders);
    expect(mark.status).toBe(204);
  });

  it("kurssekvensen merker uleselige seksjoner som utilgjengelige", async () => {
    const { courseId } = await courseWithSection({ withActiveVersion: false });
    const detail = await request(app).get(`/api/courses/${courseId}`).set(participantHeaders);
    const item = (detail.body.course.items as Array<{ type: string; available?: boolean }>).find((i) => i.type === "SECTION");

    // Seksjoner hadde ikke feltet i det hele tatt, så klienten satte det til true for alle — et
    // uleselig element så ut som et helt vanlig, klikkbart et.
    expect(item?.available).toBe(false);
  });

  it("#944/#938: en uleselig seksjon KREVES ikke for kursbeviset", async () => {
    // Produkteiers regel: et krav som aldri kan oppfylles er verre enn ikke noe krav. Deltakeren får
    // 404 på lesestien, så å kreve seksjonen ville gjort kurset umulig å fullføre — #945s form.
    const { courseId } = await courseWithSection({ withActiveVersion: false });

    const detail = await request(app).get(`/api/courses/${courseId}`).set(participantHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.course.progress.sectionTotal, "den uleselige skal ikke telle som krav").toBe(0);
  });
});
