import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";

// #787 slice 1: the ContentOwner table underpins the whole multi-owner model. No behavior reads it yet
// (guard/API/UI come in later slices), so this just pins the model + the two constraints the later
// slices rely on: one owner row per (contentType, contentId, userId), and cascade on user delete.
describe("ContentOwner model (#787 slice 1)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores an owner, enforces uniqueness per (type, content, user), and cascades on user delete", async () => {
    const tag = `co-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const user = await prisma.user.create({
      data: { externalId: tag, name: "Content Owner", email: `${tag}@x.test` },
      select: { id: true },
    });
    const contentId = `course-${tag}`;

    const owner = await prisma.contentOwner.create({
      data: { contentType: "COURSE", contentId, userId: user.id },
    });
    expect(owner.id).toBeTruthy();

    // One owner row per (contentType, contentId, userId): a duplicate is rejected.
    await expect(
      prisma.contentOwner.create({ data: { contentType: "COURSE", contentId, userId: user.id } }),
    ).rejects.toThrow();

    // The same user CAN own a different content object / type.
    await prisma.contentOwner.create({ data: { contentType: "MODULE", contentId, userId: user.id } });
    expect(await prisma.contentOwner.count({ where: { userId: user.id } })).toBe(2);

    // Cascade: deleting the user removes their ownership rows (userId FK onDelete: Cascade).
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.contentOwner.count({ where: { contentId } })).toBe(0);
  });
});
