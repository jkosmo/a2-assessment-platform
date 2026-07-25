-- #794: one MCQ response per (attempt, question) as a DB invariant, so the delete+recreate finalization
-- (or a concurrent/retried submit) can never leave duplicate answers. Dedupe any pre-existing duplicates
-- (keep the oldest per pair) before adding the unique index.
DELETE FROM "MCQResponse"
  WHERE "id" IN (
    SELECT "id" FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "mcqAttemptId", "questionId" ORDER BY "createdAt" ASC) AS rn
      FROM "MCQResponse"
    ) ranked
    WHERE ranked.rn > 1
  );

CREATE UNIQUE INDEX "MCQResponse_mcqAttemptId_questionId_key" ON "MCQResponse" ("mcqAttemptId", "questionId");
