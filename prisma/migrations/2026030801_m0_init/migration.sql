-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT,
    "manager" TEXT,
    "activeStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "appRole" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "certificationLevel" TEXT,
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "activeVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Module_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "ModuleVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "taskText" TEXT NOT NULL,
    "guidanceText" TEXT,
    "rubricVersionId" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "mcqSetVersionId" TEXT NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModuleVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModuleVersion_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModuleVersion_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModuleVersion_mcqSetVersionId_fkey" FOREIGN KEY ("mcqSetVersionId") REFERENCES "MCQSetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "deliveryType" TEXT NOT NULL,
    "rawText" TEXT,
    "reflectionText" TEXT NOT NULL,
    "promptExcerpt" TEXT NOT NULL,
    "attachmentUri" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionStatus" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MCQSetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MCQSetVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MCQQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mcqSetVersionId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "optionsJson" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "rationale" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MCQQuestion_mcqSetVersionId_fkey" FOREIGN KEY ("mcqSetVersionId") REFERENCES "MCQSetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MCQQuestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MCQAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "mcqSetVersionId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "rawScore" INTEGER,
    "scaledScore" REAL,
    "percentScore" REAL,
    "passFailMcq" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MCQAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MCQAttempt_mcqSetVersionId_fkey" FOREIGN KEY ("mcqSetVersionId") REFERENCES "MCQSetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MCQResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mcqAttemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedAnswer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MCQResponse_mcqAttemptId_fkey" FOREIGN KEY ("mcqAttemptId") REFERENCES "MCQAttempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MCQResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MCQQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RubricVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "scalingRuleJson" TEXT NOT NULL,
    "passRuleJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RubricVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptTemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "examplesJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptTemplateVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LLMEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "rubricTotal" INTEGER NOT NULL,
    "practicalScoreScaled" REAL NOT NULL,
    "passFailPractical" BOOLEAN NOT NULL,
    "manualReviewRecommended" BOOLEAN NOT NULL,
    "confidenceNote" TEXT,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LLMEvaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LLMEvaluation_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LLMEvaluation_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "rubricVersionId" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "mcqScaledScore" REAL NOT NULL,
    "practicalScaledScore" REAL NOT NULL,
    "totalScore" REAL NOT NULL,
    "redFlagsJson" TEXT NOT NULL,
    "passFailTotal" BOOLEAN NOT NULL,
    "decisionType" TEXT NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "finalisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalisedById" TEXT,
    "parentDecisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssessmentDecision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentDecision_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentDecision_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentDecision_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentDecision_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssessmentDecision_parentDecisionId_fkey" FOREIGN KEY ("parentDecisionId") REFERENCES "AssessmentDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "appealedById" TEXT NOT NULL,
    "appealReason" TEXT NOT NULL,
    "appealStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    CONSTRAINT "Appeal_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appeal_appealedById_fkey" FOREIGN KEY ("appealedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appeal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManualReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewedAt" DATETIME,
    "overrideDecision" TEXT,
    "overrideReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManualReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CertificationStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "latestDecisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "passedAt" DATETIME,
    "expiryDate" DATETIME,
    "recertificationDueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CertificationStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CertificationStatus_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CertificationStatus_latestDecisionId_fkey" FOREIGN KEY ("latestDecisionId") REFERENCES "AssessmentDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadHash" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RoleAssignment_userId_validFrom_validTo_idx" ON "RoleAssignment"("userId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "ModuleVersion_moduleId_publishedAt_idx" ON "ModuleVersion"("moduleId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleVersion_moduleId_versionNo_key" ON "ModuleVersion"("moduleId", "versionNo");

-- CreateIndex
CREATE INDEX "Submission_userId_submittedAt_idx" ON "Submission"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "Submission_moduleId_submittedAt_idx" ON "Submission"("moduleId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MCQSetVersion_moduleId_versionNo_key" ON "MCQSetVersion"("moduleId", "versionNo");

-- CreateIndex
CREATE INDEX "MCQQuestion_mcqSetVersionId_active_idx" ON "MCQQuestion"("mcqSetVersionId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RubricVersion_moduleId_versionNo_key" ON "RubricVersion"("moduleId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateVersion_moduleId_versionNo_key" ON "PromptTemplateVersion"("moduleId", "versionNo");

-- CreateIndex
CREATE INDEX "AssessmentDecision_submissionId_finalisedAt_idx" ON "AssessmentDecision"("submissionId", "finalisedAt");

-- CreateIndex
CREATE INDEX "Appeal_appealStatus_createdAt_idx" ON "Appeal"("appealStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ManualReview_reviewStatus_createdAt_idx" ON "ManualReview"("reviewStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationStatus_userId_moduleId_key" ON "CertificationStatus"("userId", "moduleId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_timestamp_idx" ON "AuditEvent"("entityType", "entityId", "timestamp");

