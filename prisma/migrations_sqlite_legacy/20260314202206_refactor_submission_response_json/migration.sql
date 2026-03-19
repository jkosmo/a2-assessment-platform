/*
  Warnings:

  - You are about to drop the column `promptExcerpt` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `rawText` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `reflectionText` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `responsibilityAcknowledged` on the `Submission` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-GB',
    "deliveryType" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL DEFAULT '{}',
    "attachmentUri" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionStatus" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("attachmentUri", "createdAt", "deliveryType", "id", "locale", "moduleId", "moduleVersionId", "submissionStatus", "submittedAt", "updatedAt", "userId") SELECT "attachmentUri", "createdAt", "deliveryType", "id", "locale", "moduleId", "moduleVersionId", "submissionStatus", "submittedAt", "updatedAt", "userId" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_userId_submittedAt_idx" ON "Submission"("userId", "submittedAt");
CREATE INDEX "Submission_moduleId_submittedAt_idx" ON "Submission"("moduleId", "submittedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
