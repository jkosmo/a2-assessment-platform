-- CreateEnum
CREATE TYPE "AssessmentMode" AS ENUM ('FREETEXT_PLUS_MCQ', 'MCQ_ONLY');

-- AlterTable
ALTER TABLE "ModuleVersion" ADD COLUMN     "assessmentMode" "AssessmentMode" NOT NULL DEFAULT 'FREETEXT_PLUS_MCQ',
ALTER COLUMN "taskText" DROP NOT NULL,
ALTER COLUMN "rubricVersionId" DROP NOT NULL,
ALTER COLUMN "promptTemplateVersionId" DROP NOT NULL;
