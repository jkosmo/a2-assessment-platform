-- #1140 etappe 2 (doc/design/PLAN_1140_E2.md): utkastet til et publisert kurs. Ren utvidelse: ny tabell, gammel kode ser den
-- ikke. Ny kode leser den i kursdetaljen (har kurset et utkast?) også med bryteren `course_drafts` av; låsen leser den bare
-- med bryteren på.
CREATE TABLE "CourseDraft" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "payloadText" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'form',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseDraft_courseId_key" ON "CourseDraft"("courseId");

ALTER TABLE "CourseDraft" ADD CONSTRAINT "CourseDraft_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
