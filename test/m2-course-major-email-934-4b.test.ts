import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite } from "../src/db/contentLock.js";
import { withRevision } from "./support/courseRevision.js";
import { createMajorVersionNotices, findMajorVersionRecipients } from "../src/modules/course/courseVersioning.js";
import {
  COURSE_MAJOR_EMAIL_SPACING_MS,
  COURSE_MAJOR_EMAIL_STUCK_SENDING_MS,
  deliverCourseMajorVersionNotice,
  queueNotice,
  runCourseMajorEmailSchedule,
  type CourseMajorVersionSend,
} from "../src/modules/course/courseMajorVersionEmail.js";
import { deliverOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";

// #934 skive 4b (doc/DESIGN_934.md, «4b»): e-post til deltakerne når et kurs får en ny hovedversjon. Gjennom rutene
// forfatteren bruker, og så jobben og behandleren slik workeren kjører dem. COURSE_MAJOR_EMAIL_ENABLED er av i
// testene — radene lages likevel (ingen e-post skal gå tapt fordi jobben var av).
//
// Jobben kjøres avgrenset til testens kurs (`onlyCourseIds`): databasen deles med andre tester, og uten avgrensning
// ville denne testen lagt deres rader i køen.

const admin = {
  "x-user-id": "v934-4b-admin",
  "x-user-email": "v934.4b.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const stamp = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUsers(tag: string, count: number, extra: { activeStatus?: boolean; isAnonymized?: boolean; preferredLocale?: string } = {}) {
  const s = stamp();
  const data = Array.from({ length: count }, (_, i) => ({
    externalId: `v934-4b-${tag}-${s}-${i}`,
    email: `v934.4b.${tag}.${s}.${i}@company.com`,
    name: `Deltaker ${i}`,
    ...extra,
  }));
  await prisma.user.createMany({ data });
  const users = await prisma.user.findMany({ where: { externalId: { in: data.map((d) => d.externalId) } }, select: { id: true } });
  return users.map((u) => u.id);
}

async function giveCertificates(courseId: string, userIds: string[], versionMajor = 1) {
  if (userIds.length === 0) return;
  await prisma.courseCompletion.createMany({
    data: userIds.map((userId) => ({ userId, courseId, moduleSnapshotJson: "[]", sectionSnapshotJson: "[]", versionMajor })),
  });
}

async function createPublishedSection(tag: string) {
  const section = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 4b seksjon ${tag} ${stamp()}`)) }, select: { id: true } });
  const v1 = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Første tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: v1.id } });
  return { id: section.id, versionId: v1.id };
}

/**
 * Et publisert kurs med én seksjon, og kursbevis for 1.0: `holders` aktive deltakere, pluss én inaktiv og én
 * anonymisert med bevis, og én aktiv uten bevis — de tre skal aldri få e-post.
 */
async function courseWithHolders(tag: string, holders: number) {
  const seksjon = await createPublishedSection(tag);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(`934 4b ${tag} ${stamp()}`)),
      publishedAt: new Date(),
      slug: `v934-4b-${tag}-${stamp()}`,
      items: { create: [{ itemType: "SECTION", sectionId: seksjon.id, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  const active = await createUsers(`${tag}-aktiv`, holders);
  const [inactive] = await createUsers(`${tag}-inaktiv`, 1, { activeStatus: false });
  const [anonymized] = await createUsers(`${tag}-anonym`, 1, { isAnonymized: true });
  const [withoutCertificate] = await createUsers(`${tag}-uten`, 1);
  await giveCertificates(course.id, [...active, inactive, anonymized]);
  return { courseId: course.id, seksjon, active, inactive, anonymized, withoutCertificate };
}

async function notices(courseId: string) {
  return prisma.courseVersionNotice.findMany({ where: { courseId }, orderBy: [{ versionMajor: "asc" }, { userId: "asc" }] });
}

async function version(courseId: string) {
  return prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { versionMajor: true, versionMinor: true } });
}

async function outboxEventsFor(noticeIds: string[]) {
  const rows = await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.courseMajorVersionNotification }, orderBy: { availableAt: "asc" } });
  return rows.filter((row) => noticeIds.includes((JSON.parse(row.payloadJson) as { noticeId: string }).noticeId));
}

/** En hovedversjon gjennom kursskjemaets ene kall: en ny seksjon lagt til, svaret «major». */
async function majorViaForm(courseId: string, extra: Record<string, unknown> = {}) {
  const items = await prisma.courseItem.findMany({ where: { courseId }, orderBy: { sortOrder: "asc" } });
  const ny = await createPublishedSection("form");
  const body = await withRevision(courseId, {
    items: [
      ...items.map((i) => (i.itemType === "SECTION" ? { type: "SECTION", sectionId: i.sectionId } : { type: "MODULE", moduleId: i.moduleId })),
      { type: "SECTION", sectionId: ny.id },
    ],
    version: "major",
    ...extra,
  });
  return request(app).put(`/api/admin/content/courses/${courseId}/content`).set(admin).send(body);
}

const sorted = (ids: string[]) => [...ids].sort();

describe("#934 skive 4b — én rad per mottaker, fra alle veier til en hovedversjon", () => {
  it("kursskjemaet: én rad per aktiv deltaker med kursbevis; inaktive, anonymiserte og dem uten bevis er utelatt", async () => {
    const f = await courseWithHolders("skjema", 2);
    const detalj = await request(app).get(`/api/admin/content/courses/${f.courseId}`).set(admin);
    expect(detalj.status).toBe(200);
    // Dialogen viser tallet fra den samme funksjonen som lager radene. Kursbevisene for 1.0 er fire.
    expect(detalj.body.course).toMatchObject({ certificateHolders: 4, majorEmailRecipients: 2 });

    const svar = await majorViaForm(f.courseId);
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(await version(f.courseId)).toEqual({ versionMajor: 2, versionMinor: 0 });

    const rader = await notices(f.courseId);
    expect(sorted(rader.map((r) => r.userId))).toEqual(sorted(f.active));
    expect(rader.every((r) => r.status === "waiting" && r.versionMajor === 2)).toBe(true);
    expect(rader).toHaveLength(detalj.body.course.majorEmailRecipients);
    // Hva som er nytt: én seksjon lagt til.
    const v2 = await prisma.courseVersion.findUniqueOrThrow({ where: { courseId_versionMajor: { courseId: f.courseId, versionMajor: 2 } } });
    expect(v2.changedItemCount).toBe(1);
    const hendelse = await prisma.auditEvent.findFirst({ where: { entityId: f.courseId, action: "course_version_changed" }, orderBy: { timestamp: "desc" } });
    expect(JSON.parse(hendelse!.metadataJson)).toMatchObject({ kind: "major", emailRecipients: 2 });
  });

  it("en mindre versjon lager ingen rader", async () => {
    const f = await courseWithHolders("mindre", 2);
    const items = await prisma.courseItem.findMany({ where: { courseId: f.courseId } });
    const ny = await createPublishedSection("mindre");
    const svar = await request(app).put(`/api/admin/content/courses/${f.courseId}/content`).set(admin).send(
      await withRevision(f.courseId, {
        items: [...items.map((i) => ({ type: "SECTION", sectionId: i.sectionId })), { type: "SECTION", sectionId: ny.id }],
        version: "minor",
      }),
    );
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(await version(f.courseId)).toEqual({ versionMajor: 1, versionMinor: 1 });
    expect(await notices(f.courseId)).toEqual([]);
  });

  it("«Publiser nye versjoner»: tallet i dialogen, og radene", async () => {
    const f = await courseWithHolders("pending", 3);
    const v2 = await prisma.courseSectionVersion.create({ data: { sectionId: f.seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")) }, select: { id: true } });
    const klar = await request(app).get(`/api/admin/content/courses/${f.courseId}/pending-versions`).set(admin);
    expect(klar.status).toBe(200);
    expect(klar.body.course).toEqual({ published: true, versionMajor: 1, versionMinor: 0, certificateHolders: 5, majorEmailRecipients: 3 });

    const svar = await request(app).post(`/api/admin/content/courses/${f.courseId}/publish-pending`).set(admin).send({ versionIds: [v2.id], courseVersion: "major" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(sorted((await notices(f.courseId)).map((r) => r.userId))).toEqual(sorted(f.active));
    // Seksjonen fikk ny versjon: ett element endret.
    expect((await prisma.courseVersion.findUniqueOrThrow({ where: { courseId_versionMajor: { courseId: f.courseId, versionMajor: 2 } } })).changedItemCount).toBe(1);
  });

  it("«Publiser kurs» med nytt innhold: tallet i forhåndsvisningen, og radene", async () => {
    const f = await courseWithHolders("kaskade", 2);
    const utkast = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 4b utkast ${stamp()}`)) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: utkast.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    await prisma.courseItem.create({ data: { courseId: f.courseId, itemType: "SECTION", sectionId: utkast.id, sortOrder: 1 } });
    await prisma.course.update({ where: { id: f.courseId }, data: { publishedAt: null } });

    const forhånd = await request(app).get(`/api/admin/content/courses/${f.courseId}/publish-preview`).set(admin);
    expect(forhånd.body.course).toMatchObject({ published: false, certificateHolders: 4, majorEmailRecipients: 2 });
    const svar = await request(app).post(`/api/admin/content/courses/${f.courseId}/publish`).set(admin).send({ publishItems: true, courseVersion: "major" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(sorted((await notices(f.courseId)).map((r) => r.userId))).toEqual(sorted(f.active));
  });

  it("import med replaceExisting og svaret «major»: radene", async () => {
    const f = await courseWithHolders("import", 2);
    const ut = await request(app).get(`/api/admin/content/courses/${f.courseId}/export-package`).set(admin);
    expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
    const fil = JSON.parse(JSON.stringify(ut.body.envelope ?? ut.body));
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "replaceExisting", targetId: f.courseId, version: "major" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(201);
    expect(await version(f.courseId)).toEqual({ versionMajor: 2, versionMinor: 0 });
    expect(sorted((await notices(f.courseId)).map((r) => r.userId))).toEqual(sorted(f.active));
  });

  it("én rad per person, også med kursbevis for flere hovedversjoner", async () => {
    const f = await courseWithHolders("flere", 1);
    // Kurset er på 2.0, og deltakeren har bevis for både 1 og 2.
    await prisma.course.update({ where: { id: f.courseId }, data: { versionMajor: 2 } });
    await giveCertificates(f.courseId, f.active, 2);
    expect(await findMajorVersionRecipients(prisma, f.courseId)).toEqual(f.active);
    const svar = await majorViaForm(f.courseId);
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    const rader = await notices(f.courseId);
    expect(rader.map((r) => [r.userId, r.versionMajor])).toEqual([[f.active[0], 3]]);
  });

  it("et nytt forsøk på samme hovedversjon lager ingen nye rader (unik nøkkel)", async () => {
    const f = await courseWithHolders("gjentak", 2);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    const før = await notices(f.courseId);
    const laget = await runContentWrite((tx) => createMajorVersionNotices(tx, f.courseId, 2, [...f.active, f.withoutCertificate]));
    // Bare den som ikke hadde rad fra før, får en; de to som hadde, er urørt.
    expect(laget).toBe(1);
    const etter = await notices(f.courseId);
    expect(etter).toHaveLength(3);
    for (const rad of før) expect(etter.find((r) => r.id === rad.id)).toMatchObject({ status: rad.status, userId: rad.userId });
  });
});

describe("#934 skive 4b — over 200 mottakere kreves et bekreftet tall", () => {
  it("200 går uten; 201 avvises uten bekreftelse (gammel klient), og med et lavere tall — og ingenting er skrevet; med tallet går det", async () => {
    const f = await courseWithHolders("grense", 200);
    // Nøyaktig 200: ingen bekreftelse trengs. (Det er også slik en gammel klient sender — uten feltet.)
    const første = await majorViaForm(f.courseId);
    expect(første.status, JSON.stringify(første.body).slice(0, 300)).toBe(200);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 2 } })).toBe(200);

    // Én til får kursbevis for 2.0: nå er mottakerne 201.
    const [ny] = await createUsers("grense-ny", 1);
    await giveCertificates(f.courseId, [ny], 2);
    const detalj = await request(app).get(`/api/admin/content/courses/${f.courseId}`).set(admin);
    expect(detalj.body.course.majorEmailRecipients).toBe(201);

    const items = await prisma.courseItem.findMany({ where: { courseId: f.courseId }, orderBy: { sortOrder: "asc" } });
    const ekstra = await createPublishedSection("grense");
    const nyeItems = [...items.map((i) => ({ type: "SECTION", sectionId: i.sectionId })), { type: "SECTION", sectionId: ekstra.id }];
    const før = { version: await version(f.courseId), items: items.map((i) => i.sectionId), revision: (await prisma.course.findUniqueOrThrow({ where: { id: f.courseId } })).contentRevision };
    const ingenting = async () => {
      expect(await version(f.courseId)).toEqual(før.version);
      expect((await prisma.courseItem.findMany({ where: { courseId: f.courseId }, orderBy: { sortOrder: "asc" } })).map((i) => i.sectionId)).toEqual(før.items);
      expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 3 } })).toBe(0);
      expect(await prisma.courseVersion.count({ where: { courseId: f.courseId, versionMajor: 3 } })).toBe(0);
      expect((await prisma.course.findUniqueOrThrow({ where: { id: f.courseId } })).contentRevision).toBe(før.revision);
    };

    // Gammel klient (sender aldri feltet): avvist, med tallet.
    const uten = await request(app).put(`/api/admin/content/courses/${f.courseId}/items`).set(admin).send(await withRevision(f.courseId, { items: nyeItems, version: "major" }));
    expect(uten.status, JSON.stringify(uten.body).slice(0, 300)).toBe(409);
    expect(uten.body.error).toBe("major_email_confirm_required");
    expect(uten.body.details).toMatchObject({ majorEmailRecipients: 201 });
    await ingenting();

    // Bekreftet et lavere tall (dialogen viste 200): avvist.
    const lavere = await request(app).put(`/api/admin/content/courses/${f.courseId}/items`).set(admin).send(await withRevision(f.courseId, { items: nyeItems, version: "major", confirmEmailRecipients: 200 }));
    expect(lavere.status).toBe(409);
    expect(lavere.body.error).toBe("major_email_confirm_required");
    await ingenting();

    // Kursskjemaet og «Publiser nye versjoner» følger samme regel.
    const skjema = await majorViaForm(f.courseId);
    expect(skjema.status).toBe(409);
    expect(skjema.body.error).toBe("major_email_confirm_required");
    const v2 = await prisma.courseSectionVersion.create({ data: { sectionId: f.seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")) }, select: { id: true } });
    const pending = await request(app).post(`/api/admin/content/courses/${f.courseId}/publish-pending`).set(admin).send({ versionIds: [v2.id], courseVersion: "major" });
    expect(pending.status).toBe(409);
    expect(pending.body.error).toBe("major_email_confirm_required");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: f.seksjon.id } })).activeVersionId).toBe(f.seksjon.versionId);
    await prisma.courseSectionVersion.delete({ where: { id: v2.id } });
    await ingenting();

    // Med tallet dialogen viste: går, og radene er nøyaktig så mange — gjennom hver av de tre veiene. (Etter hver
    // hovedversjon får `ny` bevis for den, så den neste gjelder noen.)
    const skjemaMed = await majorViaForm(f.courseId, { confirmEmailRecipients: 201 });
    expect(skjemaMed.status, JSON.stringify(skjemaMed.body).slice(0, 300)).toBe(200);
    expect(await version(f.courseId)).toEqual({ versionMajor: 3, versionMinor: 0 });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 3 } })).toBe(201);

    await giveCertificates(f.courseId, [ny], 3);
    const nå = await prisma.courseItem.findMany({ where: { courseId: f.courseId }, orderBy: { sortOrder: "asc" } });
    const enTil = await createPublishedSection("grense-items");
    const med = await request(app).put(`/api/admin/content/courses/${f.courseId}/items`).set(admin).send(
      await withRevision(f.courseId, {
        items: [...nå.map((i) => ({ type: "SECTION", sectionId: i.sectionId })), { type: "SECTION", sectionId: enTil.id }],
        version: "major",
        confirmEmailRecipients: 201,
      }),
    );
    expect(med.status, JSON.stringify(med.body).slice(0, 300)).toBe(204);
    expect(await version(f.courseId)).toEqual({ versionMajor: 4, versionMinor: 0 });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 4 } })).toBe(201);

    await giveCertificates(f.courseId, [ny], 4);
    const v3 = await prisma.courseSectionVersion.create({ data: { sectionId: f.seksjon.id, versionNo: 3, bodyMarkdown: JSON.stringify(L("Nyere tekst.")) }, select: { id: true } });
    const pendingMed = await request(app).post(`/api/admin/content/courses/${f.courseId}/publish-pending`).set(admin).send({ versionIds: [v3.id], courseVersion: "major", confirmEmailRecipients: 201 });
    expect(pendingMed.status, JSON.stringify(pendingMed.body).slice(0, 300)).toBe(200);
    expect(await version(f.courseId)).toEqual({ versionMajor: 5, versionMinor: 0 });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 5 } })).toBe(201);
  }, 60_000);

  it("«Publiser kurs» og importen avviser også over 200 uten bekreftelse", async () => {
    const f = await courseWithHolders("grense-kaskade", 201);
    const ut = await request(app).get(`/api/admin/content/courses/${f.courseId}/export-package`).set(admin);
    const fil = JSON.parse(JSON.stringify(ut.body.envelope ?? ut.body));
    const imp = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "replaceExisting", targetId: f.courseId, version: "major" });
    expect(imp.status, JSON.stringify(imp.body).slice(0, 300)).toBe(409);
    expect(imp.body.error).toBe("major_email_confirm_required");
    expect(await version(f.courseId)).toEqual({ versionMajor: 1, versionMinor: 0 });
    const impMed = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "replaceExisting", targetId: f.courseId, version: "major", confirmEmailRecipients: 201 });
    expect(impMed.status, JSON.stringify(impMed.body).slice(0, 300)).toBe(201);
    expect(await version(f.courseId)).toEqual({ versionMajor: 2, versionMinor: 0 });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 2 } })).toBe(201);
    // Så en hovedversjon gjelder noen igjen.
    await giveCertificates(f.courseId, [f.active[0]], 2);
    if (!(await prisma.course.findUniqueOrThrow({ where: { id: f.courseId } })).publishedAt) {
      await prisma.course.update({ where: { id: f.courseId }, data: { publishedAt: new Date() } });
    }

    const utkast = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 4b grense utkast ${stamp()}`)) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: utkast.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    await prisma.courseItem.create({ data: { courseId: f.courseId, itemType: "SECTION", sectionId: utkast.id, sortOrder: 99 } });
    await prisma.course.update({ where: { id: f.courseId }, data: { publishedAt: null } });
    const kaskade = await request(app).post(`/api/admin/content/courses/${f.courseId}/publish`).set(admin).send({ publishItems: true, courseVersion: "major" });
    expect(kaskade.status).toBe(409);
    expect(kaskade.body.error).toBe("major_email_confirm_required");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: utkast.id } })).activeVersionId).toBeNull();
    expect((await prisma.course.findUniqueOrThrow({ where: { id: f.courseId } })).publishedAt).toBeNull();
    expect(await version(f.courseId)).toEqual({ versionMajor: 2, versionMinor: 0 });

    const med = await request(app).post(`/api/admin/content/courses/${f.courseId}/publish`).set(admin).send({ publishItems: true, courseVersion: "major", confirmEmailRecipients: 201 });
    expect(med.status, JSON.stringify(med.body).slice(0, 300)).toBe(200);
    expect(await version(f.courseId)).toEqual({ versionMajor: 3, versionMinor: 0 });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, versionMajor: 3 } })).toBe(201);
  }, 60_000);
});

describe("#934 skive 4b — jobben i workeren", () => {
  it("legger ventende rader i outboxen (`queued` og én hendelse hver, i samme transaksjon), spredt med tre sekunder", async () => {
    const f = await courseWithHolders("jobb", 3);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    const now = new Date();
    const runde = await runCourseMajorEmailSchedule({ now, onlyCourseIds: [f.courseId] });
    expect(runde).toMatchObject({ queued: 3, skipped: 0 });
    const rader = await notices(f.courseId);
    expect(rader.every((r) => r.status === "queued" && r.queuedAt !== null)).toBe(true);
    const hendelser = await outboxEventsFor(rader.map((r) => r.id));
    expect(hendelser).toHaveLength(3);
    expect(hendelser.map((h) => h.availableAt.getTime() - now.getTime())).toEqual([0, COURSE_MAJOR_EMAIL_SPACING_MS, 2 * COURSE_MAJOR_EMAIL_SPACING_MS]);
    // En runde til legger ingenting inn to ganger.
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ queued: 0 });
    expect(await outboxEventsFor(rader.map((r) => r.id))).toHaveLength(3);
  });

  it("to runder samtidig (to workere) legger hver rad inn én gang", async () => {
    const f = await courseWithHolders("to-runder", 4);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    const [a, b] = await Promise.all([
      runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] }),
      runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] }),
    ]);
    expect(a.queued + b.queued).toBe(4);
    const rader = await notices(f.courseId);
    expect(await outboxEventsFor(rader.map((r) => r.id))).toHaveLength(4);
    // Kappløpet over avhenger av tidspunktene; dette gjør det ikke: en runde som så raden før en annen la den inn,
    // legger den ikke inn igjen.
    expect(await queueNotice(rader[0].id, new Date(), new Date())).toBe(false);
    expect(await outboxEventsFor([rader[0].id])).toHaveLength(1);
  });

  it("høyst 20 per runde; resten venter til neste", async () => {
    const f = await courseWithHolders("tak", 23);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ queued: 20, deferred: 3 });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: f.courseId, status: "waiting" } })).toBe(3);
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ queued: 3, deferred: 0 });
  });

  it("avpublisert kurs: raden venter; publisert igjen: den legges i køen", async () => {
    const f = await courseWithHolders("avpublisert", 1);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    expect((await request(app).post(`/api/admin/content/courses/${f.courseId}/unpublish`).set(admin)).status).toBe(200);
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ queued: 0, skipped: 0 });
    expect((await notices(f.courseId)).map((r) => r.status)).toEqual(["waiting"]);
    expect((await request(app).post(`/api/admin/content/courses/${f.courseId}/publish`).set(admin).send({})).status).toBe(200);
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ queued: 1 });
  });

  it("to hovedversjoner etter hverandre: bare den nyeste sendes; den eldre blir `skipped`", async () => {
    const f = await courseWithHolders("to", 2);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    // Noen får bevis for 2.0, så en ny hovedversjon gjelder noen; 3.0.
    await giveCertificates(f.courseId, [f.active[0]], 2);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    expect(await version(f.courseId)).toEqual({ versionMajor: 3, versionMinor: 0 });
    const runde = await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] });
    expect(runde).toMatchObject({ queued: 2, skipped: 2 });
    const rader = await notices(f.courseId);
    expect(rader.filter((r) => r.versionMajor === 2).map((r) => [r.status, r.reason])).toEqual([["skipped", "newer_version"], ["skipped", "newer_version"]]);
    expect(rader.filter((r) => r.versionMajor === 3).map((r) => r.status)).toEqual(["queued", "queued"]);
  });

  it("en som er inaktiv eller anonymisert når jobben kjører, blir `skipped`", async () => {
    const f = await courseWithHolders("borte", 2);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    await prisma.user.update({ where: { id: f.active[0] }, data: { activeStatus: false } });
    await prisma.user.update({ where: { id: f.active[1] }, data: { isAnonymized: true } });
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ queued: 0, skipped: 2 });
    expect((await notices(f.courseId)).map((r) => r.reason)).toEqual(["recipient_unreachable", "recipient_unreachable"]);
  });

  it("en rad som har stått i `sending` i over en halvtime, blir `uncertain`", async () => {
    const f = await courseWithHolders("henger", 1);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    // Raden har ventet lenge (kurset var avpublisert i timevis). Når den så tas til sending, er det tidspunktet for
    // `sending` som teller — ellers ville feiingen tatt en sending som pågår nå.
    await prisma.$executeRaw`UPDATE "CourseVersionNotice" SET "updatedAt" = now() - interval '2 hours' WHERE "courseId" = ${f.courseId}`;
    await prisma.courseVersionNotice.updateMany({ where: { courseId: f.courseId }, data: { status: "sending" } });
    expect(await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] })).toMatchObject({ uncertain: 0 });
    const senere = new Date(Date.now() + COURSE_MAJOR_EMAIL_STUCK_SENDING_MS + 60_000);
    expect(await runCourseMajorEmailSchedule({ now: senere, onlyCourseIds: [f.courseId] })).toMatchObject({ uncertain: 1 });
    expect((await notices(f.courseId)).map((r) => [r.status, r.reason])).toEqual([["uncertain", "interrupted"]]);
  });
});

describe("#934 skive 4b — behandleren i outboxen", () => {
  async function queuedNotices(tag: string, holders: number) {
    const f = await courseWithHolders(tag, holders);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    await runCourseMajorEmailSchedule({ onlyCourseIds: [f.courseId] });
    return { ...f, rader: await notices(f.courseId) };
  }

  function okSend() {
    return vi.fn<CourseMajorVersionSend>(async (input) => ({ delivered: true, channel: "log", subject: input.courseTitle, nextStepGuidance: "" }));
  }

  it("gjennom outboxen: sendt, på mottakerens språk; samme hendelse levert to ganger sender én gang", async () => {
    const f = await queuedNotices("send", 1);
    await prisma.user.update({ where: { id: f.active[0] }, data: { preferredLocale: "nn" } });
    const [hendelse] = await outboxEventsFor(f.rader.map((r) => r.id));
    await deliverOutboxEvent({ type: hendelse.type, payloadJson: hendelse.payloadJson, attempts: 0, maxAttempts: 5 });
    const [rad] = await notices(f.courseId);
    expect(rad).toMatchObject({ status: "sent" });
    expect(rad.sentAt).not.toBeNull();

    const send = okSend();
    await deliverCourseMajorVersionNotice(rad.id, { send });
    expect(send).not.toHaveBeenCalled();

    // Teksten: riktig språk og versjon (kanalen `log` i testene sender ingenting ut).
    const språk = okSend();
    await prisma.courseVersionNotice.update({ where: { id: rad.id }, data: { status: "queued" } });
    await deliverCourseMajorVersionNotice(rad.id, { send: språk });
    expect(språk).toHaveBeenCalledWith(expect.objectContaining({ locale: "nn", versionMajor: 2, changedItemCount: 1, recipientEmail: expect.stringContaining("@company.com") }));
  });

  it("en rad som står i `sending`, ble avbrutt: den blir `uncertain` og sendes ikke", async () => {
    const f = await queuedNotices("avbrutt", 1);
    await prisma.courseVersionNotice.updateMany({ where: { courseId: f.courseId }, data: { status: "sending" } });
    const send = okSend();
    await deliverCourseMajorVersionNotice(f.rader[0].id, { send });
    expect(send).not.toHaveBeenCalled();
    expect((await notices(f.courseId)).map((r) => [r.status, r.reason])).toEqual([["uncertain", "interrupted"]]);
  });

  it("sjekker på nytt: nyere hovedversjon mens raden sto i køen → `skipped`; avpublisert → tilbake til `waiting`; personen sluttet → `skipped`", async () => {
    const f = await queuedNotices("igjen", 3);
    const send = okSend();
    const [a, b, c] = f.rader;

    // Avpublisert mens den sto i køen: tilbake til `waiting`, og jobben legger den inn igjen når kurset er ute.
    await prisma.course.update({ where: { id: f.courseId }, data: { publishedAt: null } });
    await deliverCourseMajorVersionNotice(a.id, { send });
    expect((await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("waiting");
    await prisma.course.update({ where: { id: f.courseId }, data: { publishedAt: new Date() } });

    // Personen sluttet mens den sto i køen.
    await prisma.user.update({ where: { id: b.userId }, data: { activeStatus: false } });
    await deliverCourseMajorVersionNotice(b.id, { send });
    expect(await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "skipped", reason: "recipient_unreachable" });

    // En nyere hovedversjon mens den sto i køen.
    await giveCertificates(f.courseId, [c.userId], 2);
    expect((await majorViaForm(f.courseId)).status).toBe(200);
    await deliverCourseMajorVersionNotice(c.id, { send });
    expect(await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "skipped", reason: "newer_version" });

    expect(send).not.toHaveBeenCalled();
  });

  it("utfallet av sendingen: avbrutt underveis → `uncertain`; sikker feil → `queued` og nytt forsøk; siste forsøk → `failed`", async () => {
    const f = await queuedNotices("utfall", 3);
    const [a, b, c] = f.rader;

    const avbrutt = vi.fn<CourseMajorVersionSend>(async () => ({ delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "timeout", ambiguous: true }));
    await deliverCourseMajorVersionNotice(a.id, { send: avbrutt });
    expect(await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "uncertain", reason: "timeout" });

    const avvist = vi.fn<CourseMajorVersionSend>(async () => ({ delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "acs_400" }));
    await expect(deliverCourseMajorVersionNotice(b.id, { send: avvist })).rejects.toThrow(/not delivered: acs_400/);
    expect(await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "queued", reason: "acs_400" });
    // Nytt forsøk går.
    await deliverCourseMajorVersionNotice(b.id, { send: okSend() });
    expect((await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("sent");

    await expect(deliverCourseMajorVersionNotice(c.id, { send: avvist, lastAttempt: true })).rejects.toThrow();
    expect(await prisma.courseVersionNotice.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "failed", reason: "acs_400" });
  });

  it("varselkanalen er slått av: ingenting sendt, raden venter til den er på igjen", async () => {
    const f = await queuedNotices("kanal-av", 1);
    const av = vi.fn<CourseMajorVersionSend>(async () => ({ delivered: false, channel: "disabled", subject: "", nextStepGuidance: "", failureReason: "channel_disabled" }));
    await deliverCourseMajorVersionNotice(f.rader[0].id, { send: av });
    expect((await notices(f.courseId)).map((r) => [r.status, r.queuedAt])).toEqual([["waiting", null]]);
  });

  it("en kurstittel med en adresse: e-posten sendes aldri, raden blir `failed`", async () => {
    const f = await queuedNotices("lenke", 1);
    await prisma.course.update({ where: { id: f.courseId }, data: { title: JSON.stringify(L("Se www.a-2.no")) } });
    await deliverCourseMajorVersionNotice(f.rader[0].id);
    expect((await notices(f.courseId)).map((r) => [r.status, r.reason])).toEqual([["failed", "contains_link"]]);
  });

  it("to forsøk samtidig på samme rad: e-posten sendes én gang", async () => {
    const f = await queuedNotices("samtidig", 1);
    let calls = 0;
    const treg = vi.fn<CourseMajorVersionSend>(async (input) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { delivered: true, channel: "log", subject: input.courseTitle, nextStepGuidance: "" };
    });
    await Promise.all([deliverCourseMajorVersionNotice(f.rader[0].id, { send: treg }), deliverCourseMajorVersionNotice(f.rader[0].id, { send: treg })]);
    expect(calls).toBe(1);
    expect(["sent", "uncertain"]).toContain((await notices(f.courseId))[0].status);
  });
});
