-- #800: additive secondary indexes on hot assessment/course fact tables that previously had none.
-- These match hot query paths (load a submission's MCQ attempts/responses/LLM evaluations; course
-- completion counts by course; certification totals by module/status). Additive only — no data change,
-- no behavior change. Tables are small in current environments so a plain CREATE INDEX is instant; use
-- CREATE INDEX CONCURRENTLY in a future migration if any of these grows large enough to matter.

-- CreateIndex
CREATE INDEX "MCQAttempt_submissionId_completedAt_idx" ON "MCQAttempt"("submissionId", "completedAt");

-- CreateIndex
CREATE INDEX "MCQResponse_mcqAttemptId_idx" ON "MCQResponse"("mcqAttemptId");

-- CreateIndex
CREATE INDEX "LLMEvaluation_submissionId_createdAt_idx" ON "LLMEvaluation"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "CertificationStatus_moduleId_status_idx" ON "CertificationStatus"("moduleId", "status");

-- CreateIndex
CREATE INDEX "CourseCompletion_courseId_completedAt_idx" ON "CourseCompletion"("courseId", "completedAt");
