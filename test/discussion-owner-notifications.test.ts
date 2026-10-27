import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { findQuestionRecipients } from "../src/modules/discussion/discussionNotificationService.js";

// 2.119.0: nytt spørsmål i diskusjonen varsler KURSETS EIERE — ikke alle fagansvarlige på plattformen —
// og eierne kan slå det av per kurs. Uten eier som kan nås, går det til administratorene.

const ts = Date.now();
const idPrefix = `disc-owner-${ts}`;

function headers(suffix: string, roles: string) {
  return {
    "x-user-id": `${idPrefix}-${suffix}`,
    "x-user-email": `${idPrefix}-${suffix}@example.com`,
    "x-user-name": `User ${suffix}`,
    "x-user-roles": roles,
  };
}

const owner = headers("owner", "SUBJECT_MATTER_OWNER");
const asker = headers("asker", "PARTICIPANT");

const createdCourseIds: string[] = [];
const users: Record<string, string> = {};

async function makeUser(suffix: string, opts: { role?: "SUBJECT_MATTER_OWNER" | "ADMINISTRATOR"; activeStatus?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      externalId: `${idPrefix}-${suffix}`,
      name: `User ${suffix}`,
      email: `${idPrefix}-${suffix}@example.com`,
      activeStatus: opts.activeStatus ?? true,
      ...(opts.role ? { roleAssignments: { create: { appRole: opts.role, validFrom: new Date("2020-01-01") } } } : {}),
    },
    select: { id: true },
  });
  users[suffix] = user.id;
  return user.id;
}

async function makeCourse(ownerIds: string[], data: { discussionOwnerNotifications?: boolean } = {}) {
  const course = await prisma.course.create({
    data: { title: JSON.stringify({ "en-GB": "C", nb: "C", nn: "C" }), publishedAt: new Date(), ...data },
    select: { id: true },
  });
  createdCourseIds.push(course.id);
  for (const userId of ownerIds) {
    await prisma.contentOwner.create({ data: { contentType: "COURSE", contentId: course.id, userId } });
  }
  return course.id;
}

const ids = (recipients: Array<{ id: string }>) => recipients.map((r) => r.id).sort();

describe("2.119.0: varsel om nytt spørsmål går til kursets eiere", () => {
  beforeAll(async () => {
    await makeUser("owner", { role: "SUBJECT_MATTER_OWNER" });
    await makeUser("co-owner", { role: "SUBJECT_MATTER_OWNER" });
    await makeUser("gone-owner", { role: "SUBJECT_MATTER_OWNER", activeStatus: false });
    await makeUser("other-smo", { role: "SUBJECT_MATTER_OWNER" });
    await makeUser("admin", { role: "ADMINISTRATOR" });
    await makeUser("asker");
  });

  afterAll(async () => {
    await prisma.contentOwner.deleteMany({ where: { contentId: { in: createdCourseIds } } });
    await prisma.discussionSubscription.deleteMany({ where: { thread: { courseId: { in: createdCourseIds } } } });
    await prisma.discussionThread.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.user.deleteMany({ where: { externalId: { startsWith: idPrefix } } });
    await prisma.$disconnect();
  });

  it("bare eierne som kan nås — ikke andre fagansvarlige, ikke en eier som har sluttet", async () => {
    const courseId = await makeCourse([users.owner, users["co-owner"], users["gone-owner"]]);
    const { recipients } = await findQuestionRecipients(courseId, users.asker);
    expect(ids(recipients)).toEqual([users.owner, users["co-owner"]].sort());
  });

  it("en eier som selv stiller spørsmålet, varsles ikke", async () => {
    const courseId = await makeCourse([users.owner, users["co-owner"]]);
    const { recipients } = await findQuestionRecipients(courseId, users.owner);
    expect(ids(recipients)).toEqual([users["co-owner"]]);
  });

  it("er eneste eier den som spør, går det ikke videre til administratorene", async () => {
    const courseId = await makeCourse([users.owner]);
    const { recipients } = await findQuestionRecipients(courseId, users.owner);
    expect(recipients).toEqual([]);
  });

  it("slått av på kurset: ingen mottakere, heller ikke administratorene", async () => {
    const courseId = await makeCourse([users.owner], { discussionOwnerNotifications: false });
    expect((await findQuestionRecipients(courseId, users.asker)).recipients).toEqual([]);
    const ownerless = await makeCourse([], { discussionOwnerNotifications: false });
    expect((await findQuestionRecipients(ownerless, users.asker)).recipients).toEqual([]);
  });

  it("uten eier: administratorene, ikke fagansvarlige", async () => {
    const courseId = await makeCourse([]);
    const got = ids((await findQuestionRecipients(courseId, users.asker)).recipients);
    expect(got).toContain(users.admin);
    expect(got).not.toContain(users["other-smo"]);
    expect(got).not.toContain(users.owner);
  });

  it("bare eiere som har sluttet: administratorene", async () => {
    const courseId = await makeCourse([users["gone-owner"]]);
    const got = ids((await findQuestionRecipients(courseId, users.asker)).recipients);
    expect(got).toContain(users.admin);
    expect(got).not.toContain(users["gone-owner"]);
  });

  it("bryteren lagres og leses gjennom admin-ruta (opprett og endre)", async () => {
    const title = { "en-GB": `Owner notify ${ts}`, nb: "Varsel", nn: "Varsel" };
    const create = await request(app).post("/api/admin/content/courses").set(owner).send({ title, discussionOwnerNotifications: false });
    expect(create.status).toBe(201);
    const id = create.body.course.id as string;
    createdCourseIds.push(id);

    const off = await request(app).get(`/api/admin/content/courses/${id}`).set(owner);
    expect(off.body.course.discussionOwnerNotifications).toBe(false);

    const update = await request(app).put(`/api/admin/content/courses/${id}`).set(owner).send({ title, discussionOwnerNotifications: true });
    expect(update.status).toBe(200);
    const on = await request(app).get(`/api/admin/content/courses/${id}`).set(owner);
    expect(on.body.course.discussionOwnerNotifications).toBe(true);

    // Utelatt = urørt; et kurs uten feltet starter på.
    await request(app).put(`/api/admin/content/courses/${id}`).set(owner).send({ title });
    const still = await request(app).get(`/api/admin/content/courses/${id}`).set(owner);
    expect(still.body.course.discussionOwnerNotifications).toBe(true);
  });

  it("et spørsmål gjennom ruta varsler eieren — og ingen når bryteren er av", async () => {
    const onCourse = await makeCourse([users.owner]);
    const on = await request(app).post(`/api/courses/${onCourse}/discussions`).set(asker).send({ kind: "QUESTION", title: "Hjelp", bodyMarkdown: "?" });
    expect(on.status).toBe(201);
    const sent = await prisma.auditEvent.findMany({ where: { entityId: on.body.thread.id, action: "participant_notification_sent" } });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].metadataJson)).toMatchObject({ notificationType: "discussion_question_created", recipientCount: 1 });

    const offCourse = await makeCourse([users.owner], { discussionOwnerNotifications: false });
    const off = await request(app).post(`/api/courses/${offCourse}/discussions`).set(asker).send({ kind: "QUESTION", title: "Hjelp", bodyMarkdown: "?" });
    expect(off.status).toBe(201);
    const none = await prisma.auditEvent.findMany({ where: { entityId: off.body.thread.id, action: { in: ["participant_notification_sent", "participant_notification_failed"] } } });
    expect(none).toHaveLength(0);
  });
});
