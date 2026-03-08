ALTER TABLE "Submission"
ADD COLUMN "responsibilityAcknowledged" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AssessmentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AssessmentJob_status_availableAt_idx" ON "AssessmentJob"("status", "availableAt");
CREATE INDEX "AssessmentJob_submissionId_createdAt_idx" ON "AssessmentJob"("submissionId", "createdAt");

