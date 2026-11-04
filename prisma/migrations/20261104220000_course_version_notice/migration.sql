-- #934 skive 4b: e-post ved ny hovedversjon (doc/DESIGN_934.md, «4b»).
--
-- Utvidelse, trygg under rullering: én ny tabell og én ny kolonne med NULL som standard. Ingen gammel container
-- leser eller skriver dem. Ingen rader lages her — radene lages når en hovedversjon lages, fra 2.132.0.
ALTER TABLE "CourseVersion" ADD COLUMN "changedItemCount" INTEGER;

CREATE TABLE "CourseVersionNotice" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionMajor" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "reason" TEXT,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseVersionNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseVersionNotice_courseId_versionMajor_userId_key" ON "CourseVersionNotice"("courseId", "versionMajor", "userId");

CREATE INDEX "CourseVersionNotice_status_createdAt_idx" ON "CourseVersionNotice"("status", "createdAt");

ALTER TABLE "CourseVersionNotice" ADD CONSTRAINT "CourseVersionNotice_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseVersionNotice" ADD CONSTRAINT "CourseVersionNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
