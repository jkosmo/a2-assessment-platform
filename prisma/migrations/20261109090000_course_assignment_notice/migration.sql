-- #1142 skive 1: e-post når en deltaker får nye kurs (doc/design/PLAN_1142.md, punkt 2).
--
-- Utvidelse, trygg under rullering: én ny tabell. Ingen gammel container leser eller skriver den. Ingen rader lages
-- her — `baseline` for det folk har fra før kommer i en egen migrering i skive 3, i samme versjon som jobben, så par
-- laget mellom skive 1 og skive 3 ikke får både den gamle e-posten og den nye.
CREATE TABLE "CourseAssignmentNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "batchId" TEXT,
    "reason" TEXT,
    "queuedAt" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAssignmentNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseAssignmentNotice_userId_courseId_key" ON "CourseAssignmentNotice"("userId", "courseId");

CREATE INDEX "CourseAssignmentNotice_status_userId_createdAt_idx" ON "CourseAssignmentNotice"("status", "userId", "createdAt");

CREATE INDEX "CourseAssignmentNotice_batchId_idx" ON "CourseAssignmentNotice"("batchId");

ALTER TABLE "CourseAssignmentNotice" ADD CONSTRAINT "CourseAssignmentNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseAssignmentNotice" ADD CONSTRAINT "CourseAssignmentNotice_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
