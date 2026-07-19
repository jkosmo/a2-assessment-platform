-- #787 slice 1: multi-owner content ownership table + backfill. ADDITIVE — nothing reads this table
-- yet (the guard/API/UI land in later slices), so there is no behavior change from this migration.

-- CreateEnum
CREATE TYPE "ContentOwnerType" AS ENUM ('COURSE', 'SECTION', 'CLASS', 'MODULE');

-- CreateTable
CREATE TABLE "ContentOwner" (
    "id" TEXT NOT NULL,
    "contentType" "ContentOwnerType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOwner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentOwner_contentType_contentId_userId_key" ON "ContentOwner"("contentType", "contentId", "userId");

-- CreateIndex
CREATE INDEX "ContentOwner_contentType_contentId_idx" ON "ContentOwner"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "ContentOwner_userId_idx" ON "ContentOwner"("userId");

-- AddForeignKey
ALTER TABLE "ContentOwner" ADD CONSTRAINT "ContentOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (Q3: creator = first owner). Class + Module have createdById → seed as first owner.
-- Course / CourseSection have no createdById, so they intentionally remain unowned → admin-managed
-- until an owner is assigned (the deliberate "no ingen-kan-røre limbo": unowned = admin-only, not frozen).
INSERT INTO "ContentOwner" ("id", "contentType", "contentId", "userId", "addedById", "addedAt")
SELECT gen_random_uuid()::text, 'CLASS'::"ContentOwnerType", "id", "createdById", NULL, CURRENT_TIMESTAMP
FROM "Class"
WHERE "createdById" IS NOT NULL;

INSERT INTO "ContentOwner" ("id", "contentType", "contentId", "userId", "addedById", "addedAt")
SELECT gen_random_uuid()::text, 'MODULE'::"ContentOwnerType", "id", "createdById", NULL, CURRENT_TIMESTAMP
FROM "Module"
WHERE "createdById" IS NOT NULL;
