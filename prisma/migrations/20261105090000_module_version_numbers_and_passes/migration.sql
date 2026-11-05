-- #934 skive 5a-2: versjonsnummer på modulversjoner, beståtte per innlevering, og kravet per kurs og modul
-- (doc/DESIGN_934.md, «5a-2»).
--
-- Utvidelse, trygg under rullering: to tomme kolonner og to nye tabeller. Gammel kode leser dem ikke, og fremmednøklene
-- står med CASCADE, så ingen sletting i gammel kode stoppes av dem. Den unike nøkkelen treffer ikke gammel kode: den
-- skriver ikke kolonnene, og tomme verdier regnes som ulike. Ingen rader fylles her; det gjør
-- `npm run module-credit:backfill`, som et eget steg.
ALTER TABLE "ModuleVersion" ADD COLUMN "versionMajor" INTEGER;
ALTER TABLE "ModuleVersion" ADD COLUMN "versionMinor" INTEGER;

CREATE UNIQUE INDEX "ModuleVersion_moduleId_versionMajor_versionMinor_key" ON "ModuleVersion"("moduleId", "versionMajor", "versionMinor");

CREATE TABLE "ModulePass" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "passedAt" TIMESTAMP(3) NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModulePass_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModulePass_submissionId_key" ON "ModulePass"("submissionId");

CREATE INDEX "ModulePass_userId_moduleId_idx" ON "ModulePass"("userId", "moduleId");

CREATE INDEX "ModulePass_moduleId_idx" ON "ModulePass"("moduleId");

CREATE INDEX "ModulePass_moduleVersionId_idx" ON "ModulePass"("moduleVersionId");

CREATE INDEX "ModulePass_decisionId_idx" ON "ModulePass"("decisionId");

ALTER TABLE "ModulePass" ADD CONSTRAINT "ModulePass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModulePass" ADD CONSTRAINT "ModulePass_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModulePass" ADD CONSTRAINT "ModulePass_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModulePass" ADD CONSTRAINT "ModulePass_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AssessmentDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModulePass" ADD CONSTRAINT "ModulePass_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CourseModuleRequirement" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "minModuleMajor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseModuleRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseModuleRequirement_courseId_moduleId_key" ON "CourseModuleRequirement"("courseId", "moduleId");

CREATE INDEX "CourseModuleRequirement_moduleId_idx" ON "CourseModuleRequirement"("moduleId");

ALTER TABLE "CourseModuleRequirement" ADD CONSTRAINT "CourseModuleRequirement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseModuleRequirement" ADD CONSTRAINT "CourseModuleRequirement_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
