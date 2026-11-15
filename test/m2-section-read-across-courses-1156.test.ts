import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { deliverOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";
import { eligibleAssignmentPairs } from "../src/modules/course/courseAssignmentNotice.js";
import { getWeeklyDigestContent } from "../src/modules/weeklyDigest/weeklyDigestContent.js";
import { assertSectionNotInIssuedCertificate } from "../src/modules/course/contentLifecycle.js";
import { checkCourseDelete } from "../src/modules/course/courseDeleteGuard.js";
import { findCourseInProgressParticipants } from "../src/modules/course/contentLifecycle.js";
import { SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "../src/modules/course/classRepository.js";
import { readSection } from "./support/participantFlow.js";
import { withRevision } from "./support/courseRevision.js";

// #1156 (doc/design/PLAN_1156_LEST_PA_TVERS.md, doc/DECISIONS.md «Lest seksjon teller i alle kurs deltakeren ser»): en lest
// seksjon teller i alle kurs som inneholder den, bare i kurs deltakeren ser. Gjennom rutene der det finnes en rute.
//
// Fiksturene: hver test lager sine egne kurs og seksjoner. Kurs A har alltid en seksjon til (T), så A ikke blir fullført og
// utsteder et bevis som kunne fått deltakeren inn i en rapport på en annen vei.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `lest1156 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `admin-1156-${RUN}`, "x-user-email": `admin.1156.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

afterAll(async () => {
  await prisma.$disconnect();
});

type Learner = { userId: string; email: string; headers: Record<string, string> };

async function learner(): Promise<Learner> {
  const externalId = `lest1156-p-${RUN}-${seq++}`;
  const email = `${externalId}@x.test`;
  const user = await prisma.user.create({ data: { externalId, name: "Deltaker", email }, select: { id: true } });
  return { userId: user.id, email, headers: { "x-user-id": externalId, "x-user-email": email, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" } };
}

async function section(): Promise<{ id: string; versionId: string }> {
  const created = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const version = await prisma.courseSectionVersion.create({
    data: { sectionId: created.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: created.id }, data: { activeVersionId: version.id } });
  return { id: created.id, versionId: version.id };
}

async function course(sectionIds: string[], options: { policy?: "OPEN" | "RESTRICTED"; archivedAt?: Date } = {}): Promise<string> {
  const created = await prisma.course.create({
    data: {
      title: L(tag("kurs")),
      enrollmentPolicy: options.policy ?? "OPEN",
      publishedAt: new Date(),
      archivedAt: options.archivedAt ?? null,
      items: { create: sectionIds.map((sectionId, sortOrder) => ({ itemType: "SECTION" as const, sectionId, sortOrder })) },
    },
    select: { id: true },
  });
  return created.id;
}

async function read(who: Learner, courseId: string, sectionId: string) {
  const response = await readSection(app, who.headers, courseId, sectionId);
  expect(response.status, JSON.stringify(response.body)).toBe(204);
}

async function myCourse(who: Learner, courseId: string) {
  const response = await request(app).get("/api/courses").set(who.headers);
  expect(response.status).toBe(200);
  return (response.body.courses as Array<{ id: string; progress: { sectionCompleted: number; sectionTotal: number; courseStatus: string } }>).find(
    (c) => c.id === courseId,
  );
}

async function detailReadFlags(who: Learner, courseId: string) {
  const response = await request(app).get(`/api/courses/${courseId}`).set(who.headers);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const items = response.body.course.items as Array<{ type: string; sectionId?: string; read?: boolean }>;
  return Object.fromEntries(items.filter((i) => i.type === "SECTION").map((i) => [i.sectionId!, i.read]));
}

async function reportRow(courseId: string, email: string) {
  const response = await request(app).get("/api/reports/courses/details").query({ selectedCourseId: courseId }).set(admin);
  expect(response.status).toBe(200);
  return (response.body.rows as Array<{ participantEmail: string; readSections: number; totalSections: number; status: string }>).find(
    (r) => r.participantEmail === email,
  );
}

async function csvRow(courseId: string, email: string) {
  const response = await request(app).get("/api/reports/export").query({ type: "course-learners", format: "csv", courseId }).set(admin);
  expect(response.status).toBe(200);
  const [header, ...lines] = (response.text as string).split("\n");
  const columns = header!.split(",");
  const line = lines.find((l) => l.includes(email));
  if (!line) return undefined;
  const cells = line.split(",");
  return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
}

async function enrollmentStatus(who: Learner, courseId: string) {
  const response = await request(app).get("/api/courses/enrollments").set(who.headers);
  expect(response.status).toBe(200);
  return (response.body.enrollments as Array<{ courseId: string; status: string }>).find((e) => e.courseId === courseId)?.status;
}

async function sectionReadEvents(userId: string) {
  const rows = await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.sectionReadCompletionCheck }, orderBy: { createdAt: "asc" } });
  return rows.filter((row) => (JSON.parse(row.payloadJson) as { userId: string }).userId === userId);
}

async function deliverSectionReadEvents(userId: string) {
  for (const event of await sectionReadEvents(userId)) {
    await deliverOutboxEvent({ type: event.type, payloadJson: event.payloadJson });
  }
}

const certificates = (userId: string, courseId: string) => prisma.courseCompletion.count({ where: { userId, courseId } });

describe("#1156: lest i ett kurs teller i de andre kursene med seksjonen", () => {
  it("lest i A → lest i B i «Mine kurs», kursdetaljen, rapporten, CSV og «påbegynt»; KONTROLL: før lesingen er B ikke startet", async () => {
    const s = await section();
    const t = await section();
    const u = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id, u.id]);
    const who = await learner();
    const untouched = await learner();

    expect((await myCourse(who, B))?.progress).toMatchObject({ sectionCompleted: 0, sectionTotal: 2, courseStatus: "NOT_STARTED" });
    expect(await reportRow(B, who.email)).toBeUndefined();

    await read(who, A, s.id);

    expect((await myCourse(who, B))?.progress).toMatchObject({ sectionCompleted: 1, sectionTotal: 2, courseStatus: "IN_PROGRESS" });
    expect(await detailReadFlags(who, B)).toEqual({ [s.id]: true, [u.id]: false });
    expect(await reportRow(B, who.email)).toMatchObject({ readSections: 1, totalSections: 2, status: "IN_PROGRESS" });
    expect(await csvRow(B, who.email)).toMatchObject({ readSections: "1", totalSections: "2", status: "IN_PROGRESS" });
    // «Midt i kurset» (arkiveringsdialogen og G3) er det samme som «Mine kurs».
    expect((await findCourseInProgressParticipants(B)).userIds).toContain(who.userId);

    // «Påbegynt» i påmeldingen følger fremdriften. KONTROLL: en påmeldt som ikke har lest noe, er bare tildelt.
    for (const learnerRow of [who, untouched]) {
      await prisma.courseEnrollment.create({ data: { userId: learnerRow.userId, courseId: B, source: "INDIVIDUAL" } });
    }
    expect(await enrollmentStatus(who, B)).toBe("IN_PROGRESS");
    expect(await enrollmentStatus(untouched, B)).toBe("ASSIGNED");
  });

  it("et begrenset kurs deltakeren ikke er tildelt, teller ikke lesingen, heller ikke for kursbevis eller rapporten; KONTROLL: tildelt → teller", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const R = await course([s.id], { policy: "RESTRICTED" });
    const outsider = await learner();
    const assigned = await learner();
    await prisma.courseEnrollment.create({ data: { userId: assigned.userId, courseId: R, source: "INDIVIDUAL" } });

    await read(outsider, A, s.id);
    await read(assigned, A, s.id);
    await deliverSectionReadEvents(outsider.userId);
    await deliverSectionReadEvents(assigned.userId);

    expect(await certificates(outsider.userId, R)).toBe(0);
    expect(await certificates(assigned.userId, R)).toBe(1);
    // Avstemmingen («Mine kurs» → kursbevis) utsteder heller ikke i et kurs deltakeren ikke ser.
    expect((await request(app).get("/api/courses/completions").set(outsider.headers)).status).toBe(200);
    expect(await certificates(outsider.userId, R)).toBe(0);
    expect(await reportRow(R, outsider.email)).toBeUndefined();
    expect(await reportRow(R, assigned.email)).toMatchObject({ status: "COMPLETED" });
  });

  it("synligheten regnes fra innloggingen der ruta har den: et begrenset kurs for «Alle deltakere» teller lesingen i «Mine kurs», kursdetaljen og avstemmingen", async () => {
    // Rollen kommer fra innloggingen (her: hodet i mock-modus), ikke fra databasen. Uten innloggingen ville kurset sett usynlig ut.
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const u = await section();
    const B = await course([s.id], { policy: "RESTRICTED" });
    const B2 = await course([s.id, u.id], { policy: "RESTRICTED" });
    const who = await learner();
    expect(await prisma.roleAssignment.count({ where: { userId: who.userId } })).toBe(0);
    await prisma.courseGroupAssignment.createMany({ data: [B, B2].map((courseId) => ({ classId: SYSTEM_ALL_PARTICIPANTS_CLASS_ID, courseId })) });
    try {
      await read(who, A, s.id);
      expect((await myCourse(who, B))?.progress).toMatchObject({ sectionCompleted: 1, sectionTotal: 1 });
      expect(await detailReadFlags(who, B)).toEqual({ [s.id]: true });
      expect((await request(app).get("/api/courses/completions").set(who.headers)).status).toBe(200);
      expect(await certificates(who.userId, B)).toBe(1);
      // Siste seksjon lest i B2: beviset utstedes i lesingens egen transaksjon, med lesingen fra A.
      await read(who, B2, u.id);
      expect(await certificates(who.userId, B2)).toBe(1);
    } finally {
      await prisma.courseGroupAssignment.deleteMany({ where: { classId: SYSTEM_ALL_PARTICIPANTS_CLASS_ID, courseId: { in: [B, B2] } } });
    }
  });

  it("en seksjon endret i B sin nye hovedversjon må leses på nytt i B, ikke i A; en ny lesing i A teller da i B (markSectionRead sjekker alle kurs)", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id, t.id]);
    const who = await learner();
    await read(who, A, s.id);

    // B tar i bruk en ny hovedversjon der seksjonen er endret. A har ingen hovedversjon (alle lesinger teller der).
    const v2 = await prisma.courseSectionVersion.create({
      data: { sectionId: s.id, versionNo: 2, bodyMarkdown: L("Ny tekst."), publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.courseSection.update({ where: { id: s.id }, data: { activeVersionId: v2.id } });
    const firstRead = await prisma.courseSectionRead.findFirstOrThrow({ where: { userId: who.userId, courseId: A, sectionId: s.id } });
    const majorAt = new Date(Math.max(Date.now(), firstRead.readAt.getTime() + 1));
    await prisma.courseVersion.createMany({
      data: [
        { courseId: B, versionMajor: 1, publishedAt: new Date(Date.now() - 86_400_000), sectionVersionsJson: JSON.stringify({ [s.id]: s.versionId, [t.id]: t.versionId }) },
        // Etter lesingen, også om klokka skulle ha hoppet: ett mutasjonsløp så én gang lesingen telle i B her (ikke gjenskapt).
        { courseId: B, versionMajor: 2, publishedAt: majorAt, sectionVersionsJson: JSON.stringify({ [s.id]: v2.id, [t.id]: t.versionId }) },
      ],
    });
    await prisma.course.update({ where: { id: B }, data: { versionMajor: 2 } });

    expect((await detailReadFlags(who, B))[s.id]).toBe(false);
    expect((await detailReadFlags(who, A))[s.id]).toBe(true);

    const eventsBefore = (await sectionReadEvents(who.userId)).length;
    await read(who, A, s.id);
    expect((await detailReadFlags(who, B))[s.id]).toBe(true);
    // Lesingen fikk nytt tidspunkt, så kursbevisene i de andre kursene sjekkes.
    expect((await sectionReadEvents(who.userId)).length).toBe(eventsBefore + 1);
    // KONTROLL: lest igjen når den alt teller overalt: ingen ny hendelse, og tidspunktet står.
    const row = await prisma.courseSectionRead.findFirstOrThrow({ where: { userId: who.userId, courseId: A, sectionId: s.id } });
    await read(who, A, s.id);
    expect((await sectionReadEvents(who.userId)).length).toBe(eventsBefore + 1);
    expect((await prisma.courseSectionRead.findFirstOrThrow({ where: { id: row.id } })).readAt).toEqual(row.readAt);
  });

  it("lest i A fullfører B → kursbeviset for B utstedes via utboksen, og fristen i B står som fullført (påminnelsene stopper)", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id]);
    const who = await learner();
    await prisma.courseEnrollment.create({ data: { userId: who.userId, courseId: B, source: "INDIVIDUAL", dueAt: new Date(Date.now() - 86_400_000) } });
    expect(await enrollmentStatus(who, B)).toBe("OVERDUE");

    await read(who, A, s.id);
    // Beviset for B utstedes etter commit, ikke i lesingens transaksjon.
    expect(await certificates(who.userId, B)).toBe(0);
    const events = await sectionReadEvents(who.userId);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payloadJson)).toEqual({ userId: who.userId, sectionId: s.id, readInCourseId: A });

    await deliverSectionReadEvents(who.userId);
    expect(await certificates(who.userId, B)).toBe(1);
    expect(await certificates(who.userId, A)).toBe(0);
    // Påminnelsene hopper over «fullført» (`deriveStatus`, courseReminderService.ts).
    expect(await enrollmentStatus(who, B)).toBe("COMPLETED");
    // Levert på nytt: ingen dobbelt bevis.
    await deliverSectionReadEvents(who.userId);
    expect(await certificates(who.userId, B)).toBe(1);
  });

  it("kurs A slettes → lesingene står uten kurs og teller fortsatt i B; aktiviteten viser lesingen uten kursnavn; vakta for gamle kursbevis tåler den", async () => {
    const s = await section();
    const t = await section();
    const u = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id, u.id]);
    const who = await learner();
    await read(who, A, s.id);

    await prisma.course.delete({ where: { id: A } });
    const rows = await prisma.courseSectionRead.findMany({ where: { userId: who.userId, sectionId: s.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.courseId).toBeNull();
    expect(await detailReadFlags(who, B)).toEqual({ [s.id]: true, [u.id]: false });

    const recent = await request(app).get(`/api/reports/activity/users/${who.userId}/recent`).set(admin);
    expect(recent.status, JSON.stringify(recent.body)).toBe(200);
    const readEvents = (recent.body.events as Array<{ type: string; courseTitle: string | null }>).filter((e) => e.type === "read");
    expect(readEvents).toHaveLength(1);
    expect(readEvents[0]!.courseTitle).toBeNull();

    // Et gammelt bevis (før 2.23.0) i B, etter lesingen: lesingen uten kurs var ikke grunnlaget for det.
    await prisma.courseCompletion.create({ data: { userId: who.userId, courseId: B, moduleSnapshotJson: "[]", sectionSnapshotJson: null, completedAt: new Date() } });
    await expect(assertSectionNotInIssuedCertificate(s.id, "slettes")).resolves.toBeUndefined();
    // KONTROLL: en lesing gjort i B før et gammelt bevis i B holder seksjonen igjen.
    const other = await learner();
    await read(other, B, s.id);
    await prisma.courseCompletion.create({ data: { userId: other.userId, courseId: B, moduleSnapshotJson: "[]", sectionSnapshotJson: null, completedAt: new Date(Date.now() + 60_000) } });
    await expect(assertSectionNotInIssuedCertificate(s.id, "slettes")).rejects.toMatchObject({ code: "content_in_legacy_certificate" });
  });

  it("et arkivert kurs teller bare lesinger fram til arkiveringen (#1152-vakta); KONTROLL: en lesing før arkiveringen holder kurset igjen", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const archivedAt = new Date(Date.now() - 86_400_000);
    const C = await course([s.id], { archivedAt });
    const after = await learner();
    await read(after, A, s.id);
    expect(await checkCourseDelete(C)).toMatchObject({ status: "deletable" });

    const before = await learner();
    await read(before, A, s.id);
    await prisma.courseSectionRead.updateMany({ where: { userId: before.userId, sectionId: s.id }, data: { readAt: new Date(archivedAt.getTime() - 60_000) } });
    const blocked = await checkCourseDelete(C);
    expect(blocked.status).toBe("blocked");
    expect(blocked.status === "blocked" ? blocked.error.code : null).toBe("course_has_completed_without_certificate");
  });
});

describe("#1156: e-post og synlighet krever aktivitet i kurset selv", () => {
  it("vilkår 9 i tildelings-e-posten: en lesing i et annet kurs gjør ikke kurset påbegynt; KONTROLL: en lesing i kurset selv gjør det", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id, t.id]);
    const klasse = await prisma.class.create({ data: { name: tag("klasse") }, select: { id: true } });
    await prisma.courseGroupAssignment.create({ data: { classId: klasse.id, courseId: B } });
    const elsewhere = await learner();
    const here = await learner();
    for (const who of [elsewhere, here]) await prisma.classMember.create({ data: { classId: klasse.id, userId: who.userId } });

    await read(elsewhere, A, s.id);
    await read(here, B, s.id);
    expect(await eligibleAssignmentPairs(prisma, { userId: elsewhere.userId, courseIds: [B] })).toHaveLength(1);
    expect(await eligibleAssignmentPairs(prisma, { userId: here.userId, courseIds: [B] })).toHaveLength(0);
  });

  it("den ukentlige e-posten: «i gang» krever en lesing i kurset selv; KONTROLL: lest i kurset selv er i gang", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id, t.id]);
    const elsewhere = await learner();
    const here = await learner();
    await read(elsewhere, A, s.id);
    await read(here, B, s.id);

    // Fremdriften i «Mine kurs» teller på tvers ...
    expect((await myCourse(elsewhere, B))?.progress.courseStatus).toBe("IN_PROGRESS");
    // ... men e-posten tar ikke med et kurs personen aldri har valgt.
    const digest = await getWeeklyDigestContent({ userId: elsewhere.userId, roles: ["PARTICIPANT"], locale: "nb", now: new Date() });
    expect((digest?.inProgress ?? []).map((c) => c.courseId)).not.toContain(B);
    expect((digest?.inProgress ?? []).map((c) => c.courseId)).toContain(A);
    const control = await getWeeklyDigestContent({ userId: here.userId, roles: ["PARTICIPANT"], locale: "nb", now: new Date() });
    expect((control?.inProgress ?? []).map((c) => c.courseId)).toContain(B);
  });

  it("kurs fra en arkivert klasse: en lesing i et annet kurs gjør det ikke synlig igjen; KONTROLL: en lesing i kurset selv gjør det", async () => {
    const s = await section();
    const t = await section();
    const A = await course([s.id, t.id]);
    const B = await course([s.id, t.id], { policy: "RESTRICTED" });
    const klasse = await prisma.class.create({ data: { name: tag("klasse") }, select: { id: true } });
    await prisma.courseGroupAssignment.create({ data: { classId: klasse.id, courseId: B } });
    const elsewhere = await learner();
    const here = await learner();
    for (const who of [elsewhere, here]) await prisma.classMember.create({ data: { classId: klasse.id, userId: who.userId } });
    await read(elsewhere, A, s.id);
    await read(here, B, s.id);
    // Mens klassen er aktiv, ser begge B, og lesingen i A teller der.
    expect((await myCourse(elsewhere, B))?.progress.sectionCompleted).toBe(1);

    await prisma.class.update({ where: { id: klasse.id }, data: { archivedAt: new Date() } });
    expect(await myCourse(elsewhere, B)).toBeUndefined();
    expect(await myCourse(here, B)).toBeDefined();
  });
});

describe("#1156: «Oppdater kurs» kopierer den seneste lesingen fra alle kurs til kopien", () => {
  const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
  const smo = { "x-user-id": `smo-1156-${RUN}`, "x-user-email": `smo.1156.${RUN}@x.test`, "x-user-name": "Fagansvarlig", "x-user-roles": "SUBJECT_MATTER_OWNER" };
  const adminContent = admin;

  async function publishedSection(name: string) {
    const created = await request(app).post("/api/admin/content/sections").set(adminContent).send({ title: tre(tag(name)), bodyMarkdown: tre("Administratorens tekst.") });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const id = created.body.section.id as string;
    expect((await request(app).post(`/api/admin/content/sections/${id}/publish`).set(adminContent)).status).toBe(200);
    return id;
  }

  async function publishedCourse(headers: Record<string, string>, sectionIds: string[]) {
    // #1164: et nytt kurs er begrenset som standard; fiksturen trenger et åpent kurs og sier det.
    const created = await request(app).post("/api/admin/content/courses").set(headers).send({ title: tre(tag("kurs")), enrollmentPolicy: "OPEN" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const id = created.body.course.id as string;
    const items = await request(app).put(`/api/admin/content/courses/${id}/items`).set(headers).send(await withRevision(id, { items: sectionIds.map((sectionId) => ({ type: "SECTION", sectionId })) }));
    expect(items.status, JSON.stringify(items.body).slice(0, 300)).toBe(204);
    const published = await request(app).post(`/api/admin/content/courses/${id}/publish`).set(headers);
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
    return id;
  }

  it("lest i et annet kurs og i kurset selv følger med til kopien, med kurset lesingen ble gjort i; en lesing i et begrenset kurs deltakeren ikke ser, gjør ikke", async () => {
    const delt = await publishedSection("delt");
    const annen = await publishedSection("annen");
    const other = await publishedCourse(adminContent, [delt, annen]);
    const smoCourse = await publishedCourse(smo, [delt, annen]);
    await prisma.course.update({ where: { id: smoCourse }, data: { enrollmentPolicy: "RESTRICTED" } });

    const readElsewhere = await learner();
    const readHere = await learner();
    const notAssigned = await learner();
    for (const who of [readElsewhere, readHere]) await prisma.courseEnrollment.create({ data: { userId: who.userId, courseId: smoCourse, source: "INDIVIDUAL" } });
    await read(readElsewhere, other, delt);
    await read(notAssigned, other, delt);
    await read(readHere, smoCourse, delt);
    const elsewhereAt = (await prisma.courseSectionRead.findFirstOrThrow({ where: { userId: readElsewhere.userId, courseId: other, sectionId: delt } })).readAt;

    const exported = await request(app).get(`/api/admin/content/courses/${smoCourse}/export-package`).set(smo);
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const file = JSON.parse(JSON.stringify(exported.body.envelope ?? exported.body));
    const item = (file.course.course.items as Array<{ origin?: { sectionId?: string }; section: { bodyMarkdown: unknown } }>).find((i) => i.origin?.sectionId === delt)!;
    item.section.bodyMarkdown = tre("Justert av fagansvarlig.");
    const imported = await request(app).post("/api/admin/content/courses/import").set(smo).send({ payload: file, mode: "updateExisting", targetId: smoCourse });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 400)).toBe(201);
    const replaced = (imported.body.summary.replacedUnownedIds as Array<{ oldId: string; newId: string }>).find((r) => r.oldId === delt)!;
    expect(replaced).toBeDefined();

    const copies = await prisma.courseSectionRead.findMany({ where: { sectionId: replaced.newId }, select: { userId: true, courseId: true, readAt: true } });
    const byUser = new Map(copies.map((c) => [c.userId, c]));
    // Kopien er den samme lesingen: kurset den ble gjort i, og tidspunktet.
    expect(byUser.get(readElsewhere.userId)).toEqual({ userId: readElsewhere.userId, courseId: other, readAt: elsewhereAt });
    expect(byUser.get(readHere.userId)?.courseId).toBe(smoCourse);
    expect(byUser.has(notAssigned.userId)).toBe(false);
    expect(copies).toHaveLength(2);
    // Kopien teller i kurset: den som leste i det andre kurset, ser kopien som lest.
    expect(await detailReadFlags(readElsewhere, smoCourse)).toMatchObject({ [replaced.newId]: true });
    // Den gamle seksjonen står i det andre kurset, med lesingene.
    expect(await prisma.courseSectionRead.count({ where: { sectionId: delt } })).toBe(3);
  });
});
