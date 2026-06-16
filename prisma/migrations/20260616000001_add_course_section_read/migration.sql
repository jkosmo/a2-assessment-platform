-- CreateTable
CREATE TABLE "CourseSectionRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSectionRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseSectionRead_userId_courseId_idx" ON "CourseSectionRead"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSectionRead_userId_courseId_sectionId_key" ON "CourseSectionRead"("userId", "courseId", "sectionId");

-- AddForeignKey
ALTER TABLE "CourseSectionRead" ADD CONSTRAINT "CourseSectionRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSectionRead" ADD CONSTRAINT "CourseSectionRead_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSectionRead" ADD CONSTRAINT "CourseSectionRead_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
