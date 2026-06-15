-- CreateEnum
CREATE TYPE "CourseItemType" AS ENUM ('MODULE', 'SECTION');

-- CreateTable
CREATE TABLE "CourseItem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "itemType" "CourseItemType" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "moduleId" TEXT,
    "sectionId" TEXT,

    CONSTRAINT "CourseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseItem_courseId_sortOrder_idx" ON "CourseItem"("courseId", "sortOrder");

-- CreateIndex
CREATE INDEX "CourseItem_moduleId_idx" ON "CourseItem"("moduleId");

-- CreateIndex
CREATE INDEX "CourseItem_sectionId_idx" ON "CourseItem"("sectionId");

-- AddForeignKey
ALTER TABLE "CourseItem" ADD CONSTRAINT "CourseItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseItem" ADD CONSTRAINT "CourseItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseItem" ADD CONSTRAINT "CourseItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce that exactly one polymorphic target is set, matching itemType.
ALTER TABLE "CourseItem" ADD CONSTRAINT "CourseItem_target_xor_chk" CHECK (
    ("itemType" = 'MODULE' AND "moduleId" IS NOT NULL AND "sectionId" IS NULL)
    OR ("itemType" = 'SECTION' AND "sectionId" IS NOT NULL AND "moduleId" IS NULL)
);

-- Backfill: every existing CourseModule row becomes a MODULE CourseItem with the
-- same ordering. gen_random_uuid() is built in on PostgreSQL 13+ (Azure Flexible
-- Server) so no extension is required.
INSERT INTO "CourseItem" ("id", "courseId", "itemType", "sortOrder", "moduleId")
SELECT gen_random_uuid()::text, "courseId", 'MODULE', "sortOrder", "moduleId"
FROM "CourseModule";
