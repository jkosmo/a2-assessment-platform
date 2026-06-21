-- AlterEnum: add the FREETEXT_ONLY assessment mode (#578) — free-text + LLM assessment, no MCQ.
ALTER TYPE "AssessmentMode" ADD VALUE 'FREETEXT_ONLY';

-- AlterTable: FREETEXT_ONLY module versions have no MCQ set, so mcqSetVersionId becomes nullable.
-- Expand-contract: existing rows keep their value; FREETEXT_PLUS_MCQ/MCQ_ONLY still require it at
-- the application layer (moduleVersionBodySchema refine).
ALTER TABLE "ModuleVersion" ALTER COLUMN "mcqSetVersionId" DROP NOT NULL;
