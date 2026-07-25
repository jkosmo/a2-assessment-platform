-- #793: at most ONE active (PENDING/RUNNING) assessment job per submission, as a DB invariant. The app
-- enqueue was findFirst-then-create, so two concurrent submits could both create a job → duplicate LLM
-- spend / decisions / emails. A partial unique index makes the DB reject the second; the app catches the
-- P2002 and returns the existing job.

-- First resolve any pre-existing duplicate active jobs so the unique index can be built: keep the oldest
-- active job per submission, fail the rest (they are indistinguishable duplicates of the same work).
UPDATE "AssessmentJob"
  SET "status" = 'FAILED', "errorMessage" = 'superseded_duplicate_active_job'
  WHERE "id" IN (
    SELECT "id" FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "submissionId" ORDER BY "createdAt" ASC) AS rn
      FROM "AssessmentJob"
      WHERE "status" IN ('PENDING', 'RUNNING')
    ) ranked
    WHERE ranked.rn > 1
  );

CREATE UNIQUE INDEX "AssessmentJob_active_submission_uniq"
  ON "AssessmentJob" ("submissionId")
  WHERE "status" IN ('PENDING', 'RUNNING');
