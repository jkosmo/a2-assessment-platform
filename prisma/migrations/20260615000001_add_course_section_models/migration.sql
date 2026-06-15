-- CreateTable
CREATE TABLE "CourseSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSectionVersion" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSectionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseSectionVersion_sectionId_versionNo_key" ON "CourseSectionVersion"("sectionId", "versionNo");

-- CreateIndex
CREATE INDEX "CourseSectionVersion_sectionId_publishedAt_idx" ON "CourseSectionVersion"("sectionId", "publishedAt");

-- AddForeignKey
ALTER TABLE "CourseSection" ADD CONSTRAINT "CourseSection_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "CourseSectionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSectionVersion" ADD CONSTRAINT "CourseSectionVersion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
