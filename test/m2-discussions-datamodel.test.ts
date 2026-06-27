import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";

// #495/T-QA-1: datamodell + migrasjon for diskusjon/Q&A.
// Denne testen treffer DB-laget direkte (ingen API ennå — det er T-QA-2) og verifiserer
// at modellene, default-verdiene, unike constraints og soft-delete/cascade-oppførselen
// matcher doc/DISCUSSIONS_DESIGN.md. Alt opprettes med en kjøretids-tag og ryddes i afterAll.

const tag = `disc-${Date.now()}`;

describe("Discussions datamodel (#495/T-QA-1)", () => {
  const created = {
    threadIds: [] as string[],
    courseId: "",
    sectionId: "",
    courseItemId: "",
    userIds: [] as string[],
  };

  afterAll(async () => {
    // Soft-delete-rader er ekte rader — rydd dem eksplisitt. Tråder cascader til svar/abonnement.
    await prisma.discussionThread.deleteMany({ where: { id: { in: created.threadIds } } });
    if (created.courseItemId) {
      await prisma.courseItem.deleteMany({ where: { id: created.courseItemId } });
    }
    if (created.sectionId) {
      await prisma.courseSection.deleteMany({ where: { id: created.sectionId } });
    }
    if (created.courseId) {
      await prisma.course.deleteMany({ where: { id: created.courseId } });
    }
    if (created.userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    }
    await prisma.$disconnect();
  });

  async function makeUser(suffix: string) {
    const user = await prisma.user.create({
      data: {
        externalId: `${tag}-ext-${suffix}`,
        name: `Test User ${suffix}`,
        email: `${tag}-${suffix}@example.com`,
      },
    });
    created.userIds.push(user.id);
    return user;
  }

  it("setter discussionsEnabled = true som default på Course og CourseItem", async () => {
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": "C", nb: "C", nn: "C" }) },
    });
    created.courseId = course.id;
    expect(course.discussionsEnabled).toBe(true);

    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "S", nb: "S", nn: "S" }) },
    });
    created.sectionId = section.id;

    const item = await prisma.courseItem.create({
      data: { courseId: course.id, itemType: "SECTION", sortOrder: 0, sectionId: section.id },
    });
    created.courseItemId = item.id;
    expect(item.discussionsEnabled).toBe(true);
  });

  it("oppretter tråd med default kind=DISCUSSION og status=OPEN", async () => {
    const author = await makeUser("author1");
    const thread = await prisma.discussionThread.create({
      data: {
        courseId: created.courseId,
        authorId: author.id,
        title: "Hvordan tolke oppgave 3?",
        bodyMarkdown: "Jeg er usikker på **kravet** her.",
      },
    });
    created.threadIds.push(thread.id);
    expect(thread.kind).toBe("DISCUSSION");
    expect(thread.status).toBe("OPEN");
    expect(thread.courseItemId).toBeNull(); // kurs-nivå board
    expect(thread.acceptedReplyId).toBeNull();
    expect(thread.deletedAt).toBeNull();
  });

  it("støtter QUESTION-tråd med akseptert svar (acceptedReplyId, unikt)", async () => {
    const author = await makeUser("asker");
    const helper = await makeUser("helper");
    const thread = await prisma.discussionThread.create({
      data: {
        courseId: created.courseId,
        courseItemId: created.courseItemId,
        authorId: author.id,
        kind: "QUESTION",
        title: "Spørsmål med svar",
        bodyMarkdown: "Hva er riktig?",
      },
    });
    created.threadIds.push(thread.id);
    expect(thread.courseItemId).toBe(created.courseItemId);

    const reply = await prisma.discussionReply.create({
      data: { threadId: thread.id, authorId: helper.id, bodyMarkdown: "Slik gjør du det." },
    });

    const resolved = await prisma.discussionThread.update({
      where: { id: thread.id },
      data: { status: "RESOLVED", acceptedReplyId: reply.id },
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.acceptedReplyId).toBe(reply.id);

    // acceptedReplyId er @unique — kan ikke peke fra to tråder til samme svar.
    const other = await prisma.discussionThread.create({
      data: {
        courseId: created.courseId,
        authorId: author.id,
        title: "Annen tråd",
        bodyMarkdown: "x",
      },
    });
    created.threadIds.push(other.id);
    await expect(
      prisma.discussionThread.update({
        where: { id: other.id },
        data: { acceptedReplyId: reply.id },
      }),
    ).rejects.toThrow();
  });

  it("håndhever unik abonnement per (threadId, userId)", async () => {
    const author = await makeUser("subauthor");
    const thread = await prisma.discussionThread.create({
      data: { courseId: created.courseId, authorId: author.id, title: "Sub", bodyMarkdown: "x" },
    });
    created.threadIds.push(thread.id);

    await prisma.discussionSubscription.create({ data: { threadId: thread.id, userId: author.id } });
    await expect(
      prisma.discussionSubscription.create({ data: { threadId: thread.id, userId: author.id } }),
    ).rejects.toThrow();
  });

  it("soft-delete beholder raden (deletedAt/deletedById satt)", async () => {
    const author = await makeUser("softdel");
    const mod = await makeUser("moderator");
    const thread = await prisma.discussionThread.create({
      data: { courseId: created.courseId, authorId: author.id, title: "Slettes", bodyMarkdown: "x" },
    });
    created.threadIds.push(thread.id);
    const reply = await prisma.discussionReply.create({
      data: { threadId: thread.id, authorId: author.id, bodyMarkdown: "upassende" },
    });

    const deleted = await prisma.discussionReply.update({
      where: { id: reply.id },
      data: { deletedAt: new Date(), deletedById: mod.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedById).toBe(mod.id);

    // Raden finnes fortsatt (ikke hard-delete).
    const stillThere = await prisma.discussionReply.findUnique({ where: { id: reply.id } });
    expect(stillThere).not.toBeNull();
  });

  it("cascader svar og abonnement når en tråd hard-slettes", async () => {
    const author = await makeUser("cascade");
    const thread = await prisma.discussionThread.create({
      data: { courseId: created.courseId, authorId: author.id, title: "Cascade", bodyMarkdown: "x" },
    });
    const reply = await prisma.discussionReply.create({
      data: { threadId: thread.id, authorId: author.id, bodyMarkdown: "svar" },
    });
    await prisma.discussionSubscription.create({ data: { threadId: thread.id, userId: author.id } });

    await prisma.discussionThread.delete({ where: { id: thread.id } });

    expect(await prisma.discussionReply.findUnique({ where: { id: reply.id } })).toBeNull();
    expect(
      await prisma.discussionSubscription.findUnique({
        where: { threadId_userId: { threadId: thread.id, userId: author.id } },
      }),
    ).toBeNull();
  });
});
