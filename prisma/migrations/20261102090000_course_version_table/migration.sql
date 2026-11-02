-- #934 skive 3: én rad per hovedversjon av et kurs, for regelen om endrede seksjoner (doc/DESIGN_934.md).
--
-- Utvidelse, trygg under rullering: en ny tabell som ingen gammel container leser. Ingen rader lages her —
-- alle kurs er 1.x, og et kurs uten rader har ingen slik regel (alle lesinger teller, som før).
CREATE TABLE "CourseVersion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionMajor" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sectionVersionsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseVersion_courseId_versionMajor_key" ON "CourseVersion"("courseId", "versionMajor");

ALTER TABLE "CourseVersion" ADD CONSTRAINT "CourseVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
