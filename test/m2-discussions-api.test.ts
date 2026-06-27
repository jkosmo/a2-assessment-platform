import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #495/T-QA-2: backend-API for diskusjon/Q&A. Dekker flyt (opprett/list/svar/aksepter),
// authz (deltaker vs SMO/moderator), scope/lock-håndheving, UGC-sanitering og soft-delete.

const ts = Date.now();
const idPrefix = `disc-api-${ts}`;

function headers(suffix: string, roles: string) {
  return {
    "x-user-id": `${idPrefix}-${suffix}`,
    "x-user-email": `${idPrefix}-${suffix}@example.com`,
    "x-user-name": `User ${suffix}`,
    "x-user-roles": roles,
  };
}

const asker = headers("asker", "PARTICIPANT");
const helper = headers("helper", "PARTICIPANT");
const smo = headers("smo", "SUBJECT_MATTER_OWNER");

const createdCourseIds: string[] = [];
const createdSectionIds: string[] = [];

async function makeOpenCourse() {
  const course = await prisma.course.create({
    data: { title: JSON.stringify({ "en-GB": "C", nb: "C", nn: "C" }), publishedAt: new Date() },
    select: { id: true },
  });
  createdCourseIds.push(course.id);
  return course.id;
}

describe("Discussions API (#495/T-QA-2)", () => {
  afterAll(async () => {
    await prisma.discussionThread.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.courseItem.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.courseSection.deleteMany({ where: { id: { in: createdSectionIds } } });
    await prisma.user.deleteMany({ where: { externalId: { startsWith: idPrefix } } });
    await prisma.$disconnect();
  });

  it("oppretter kurs-nivå tråd, lister den, og auto-abonnerer forfatter", async () => {
    const courseId = await makeOpenCourse();
    const create = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "DISCUSSION", title: "Hei", bodyMarkdown: "**hallo**" });
    expect(create.status).toBe(201);
    expect(create.body.thread.kind).toBe("DISCUSSION");
    expect(create.body.thread.status).toBe("OPEN");
    expect(create.body.thread.courseItemId).toBeNull();
    expect(create.body.thread.isSubscribed).toBe(true);
    expect(create.body.thread.bodyHtml).toContain("<strong>hallo</strong>");

    const list = await request(app).get(`/api/courses/${courseId}/discussions`).set(asker);
    expect(list.status).toBe(200);
    expect(list.body.threads.some((t: { id: string }) => t.id === create.body.thread.id)).toBe(true);
  });

  it("QUESTION-flyt: svar + aksepter svar (av spørrer) → RESOLVED", async () => {
    const courseId = await makeOpenCourse();
    const q = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "QUESTION", title: "Hvordan?", bodyMarkdown: "Forklar" });
    const threadId = q.body.thread.id;

    const reply = await request(app)
      .post(`/api/courses/${courseId}/discussions/${threadId}/replies`)
      .set(helper)
      .send({ bodyMarkdown: "Slik gjør du det" });
    expect(reply.status).toBe(201);
    const replyId = reply.body.thread.replies[0].id;

    // Helper ble auto-abonnent ved å svare.
    const helperView = await request(app)
      .get(`/api/courses/${courseId}/discussions/${threadId}`)
      .set(helper);
    expect(helperView.body.thread.isSubscribed).toBe(true);

    // Helper (ikke spørrer, ikke moderator) kan ikke akseptere svar.
    const forbidden = await request(app)
      .patch(`/api/courses/${courseId}/discussions/${threadId}`)
      .set(helper)
      .send({ acceptedReplyId: replyId });
    expect(forbidden.status).toBe(403);

    // Spørrer aksepterer.
    const accept = await request(app)
      .patch(`/api/courses/${courseId}/discussions/${threadId}`)
      .set(asker)
      .send({ acceptedReplyId: replyId });
    expect(accept.status).toBe(200);
    expect(accept.body.thread.status).toBe("RESOLVED");
    expect(accept.body.thread.acceptedReplyId).toBe(replyId);
    expect(accept.body.thread.replies.find((r: { id: string }) => r.id === replyId).isAccepted).toBe(true);
  });

  it("moderering: deltaker kan ikke pinne/låse; SMO kan, og lås blokkerer svar", async () => {
    const courseId = await makeOpenCourse();
    const t = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "DISCUSSION", title: "T", bodyMarkdown: "x" });
    const threadId = t.body.thread.id;

    expect(
      (await request(app).patch(`/api/courses/${courseId}/discussions/${threadId}`).set(asker).send({ pinned: true })).status,
    ).toBe(403);

    const pin = await request(app)
      .patch(`/api/courses/${courseId}/discussions/${threadId}`)
      .set(smo)
      .send({ pinned: true });
    expect(pin.status).toBe(200);
    expect(pin.body.thread.pinned).toBe(true);

    const lock = await request(app)
      .patch(`/api/courses/${courseId}/discussions/${threadId}`)
      .set(smo)
      .send({ lock: true });
    expect(lock.body.thread.status).toBe("LOCKED");

    const blocked = await request(app)
      .post(`/api/courses/${courseId}/discussions/${threadId}/replies`)
      .set(helper)
      .send({ bodyMarkdown: "for sent" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("thread_locked");
  });

  it("soft-delete: SMO sletter andres tråd; raden består men innhold skjules", async () => {
    const courseId = await makeOpenCourse();
    const t = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "DISCUSSION", title: "Slett meg", bodyMarkdown: "hemmelig" });
    const threadId = t.body.thread.id;

    // Deltaker B kan ikke slette andres tråd.
    expect(
      (await request(app).delete(`/api/courses/${courseId}/discussions/${threadId}`).set(helper)).status,
    ).toBe(403);

    // SMO sletter (soft).
    expect(
      (await request(app).delete(`/api/courses/${courseId}/discussions/${threadId}`).set(smo)).status,
    ).toBe(204);

    const list = await request(app).get(`/api/courses/${courseId}/discussions`).set(asker);
    const row = list.body.threads.find((x: { id: string }) => x.id === threadId);
    expect(row).toBeTruthy();
    expect(row.deleted).toBe(true);
    expect(row.title).toBeNull();
  });

  it("scope-toggle: avskrudd diskusjon på kurset blokkerer ny tråd (403)", async () => {
    const courseId = await makeOpenCourse();
    await prisma.course.update({ where: { id: courseId }, data: { discussionsEnabled: false } });
    const res = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "DISCUSSION", title: "x", bodyMarkdown: "y" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("discussions_disabled");
  });

  it("per-item: tråd på CourseItem med avskrudd toggle gir 403; ukjent item gir 404", async () => {
    const courseId = await makeOpenCourse();
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "S", nb: "S", nn: "S" }) },
      select: { id: true },
    });
    createdSectionIds.push(section.id);
    const item = await prisma.courseItem.create({
      data: { courseId, itemType: "SECTION", sortOrder: 0, sectionId: section.id, discussionsEnabled: false },
      select: { id: true },
    });

    const disabled = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "QUESTION", title: "q", bodyMarkdown: "b", courseItemId: item.id });
    expect(disabled.status).toBe(403);
    expect(disabled.body.error).toBe("discussions_disabled");

    const unknown = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "QUESTION", title: "q", bodyMarkdown: "b", courseItemId: "nonexistent-item" });
    expect(unknown.status).toBe(404);
  });

  it("UGC-sanitering: script/iframe strippes, formatering beholdes", async () => {
    const courseId = await makeOpenCourse();
    const res = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({
        kind: "DISCUSSION",
        title: "XSS",
        bodyMarkdown: "**ok** <script>alert(1)</script> <iframe src='https://youtube.com'></iframe>",
      });
    expect(res.status).toBe(201);
    const html = res.body.thread.bodyHtml as string;
    expect(html).toContain("<strong>ok</strong>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("<iframe");
  });

  it("validering: tom body gir 400", async () => {
    const courseId = await makeOpenCourse();
    const res = await request(app)
      .post(`/api/courses/${courseId}/discussions`)
      .set(asker)
      .send({ kind: "DISCUSSION", title: "", bodyMarkdown: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("tilgang: RESTRICTED kurs uten enrolment gir 404 for deltaker", async () => {
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({ "en-GB": "R", nb: "R", nn: "R" }),
        publishedAt: new Date(),
        enrollmentPolicy: "RESTRICTED",
      },
      select: { id: true },
    });
    createdCourseIds.push(course.id);
    const res = await request(app)
      .get(`/api/courses/${course.id}/discussions`)
      .set(headers("outsider", "PARTICIPANT"));
    expect(res.status).toBe(404);

    // SMO har tilgang uavhengig av enrolment.
    const smoRes = await request(app).get(`/api/courses/${course.id}/discussions`).set(smo);
    expect(smoRes.status).toBe(200);
  });
});
