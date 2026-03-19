-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('PARTICIPANT', 'SUBJECT_MATTER_OWNER', 'ADMINISTRATOR', 'APPEAL_HANDLER', 'REPORT_READER', 'REVIEWER');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'SCORED', 'UNDER_REVIEW', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('AUTOMATIC', 'MANUAL_OVERRIDE', 'APPEAL_RESOLUTION');

-- CreateEnum
CREATE TYPE "AssessmentJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT,
    "manager" TEXT,
    "activeStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appRole" "AppRole" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "certificationLevel" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleVersion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "taskText" TEXT NOT NULL,
    "guidanceText" TEXT,
    "rubricVersionId" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "mcqSetVersionId" TEXT NOT NULL,
    "submissionSchemaJson" TEXT,
    "assessmentPolicyJson" TEXT,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-GB',
    "deliveryType" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL DEFAULT '{}',
    "attachmentUri" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionStatus" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MCQSetVersion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MCQSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MCQQuestion" (
    "id" TEXT NOT NULL,
    "mcqSetVersionId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "optionsJson" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "rationale" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MCQQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MCQAttempt" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "mcqSetVersionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "rawScore" INTEGER,
    "scaledScore" DOUBLE PRECISION,
    "percentScore" DOUBLE PRECISION,
    "passFailMcq" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MCQAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MCQResponse" (
    "id" TEXT NOT NULL,
    "mcqAttemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedAnswer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MCQResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricVersion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "scalingRuleJson" TEXT NOT NULL,
    "passRuleJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RubricVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplateVersion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "examplesJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMEvaluation" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "rubricTotal" INTEGER NOT NULL,
    "practicalScoreScaled" DOUBLE PRECISION NOT NULL,
    "passFailPractical" BOOLEAN NOT NULL,
    "manualReviewRecommended" BOOLEAN NOT NULL,
    "confidenceNote" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentDecision" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "moduleVersionId" TEXT NOT NULL,
    "rubricVersionId" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "mcqScaledScore" DOUBLE PRECISION NOT NULL,
    "practicalScaledScore" DOUBLE PRECISION NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "redFlagsJson" TEXT NOT NULL,
    "passFailTotal" BOOLEAN NOT NULL,
    "decisionType" "DecisionType" NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "finalisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalisedById" TEXT,
    "parentDecisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "appealedById" TEXT NOT NULL,
    "appealReason" TEXT NOT NULL,
    "appealStatus" "AppealStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualReview" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedAt" TIMESTAMP(3),
    "overrideDecision" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "latestDecisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "passedAt" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "recertificationDueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadHash" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentJob" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" "AssessmentJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentJob_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "Appeal_appealStatus_claimedAt_idx" ON "Appeal"("appealStatus", "claimedAt");

-- CreateIndex
CREATE INDEX "ManualReview_reviewStatus_createdAt_idx" ON "ManualReview"("reviewStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationStatus_userId_moduleId_key" ON "CertificationStatus"("userId", "moduleId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_timestamp_idx" ON "AuditEvent"("entityType", "entityId", "timestamp");

-- CreateIndex
CREATE INDEX "AssessmentJob_status_availableAt_idx" ON "AssessmentJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "AssessmentJob_submissionId_createdAt_idx" ON "AssessmentJob"("submissionId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "ModuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleVersion" ADD CONSTRAINT "ModuleVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleVersion" ADD CONSTRAINT "ModuleVersion_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleVersion" ADD CONSTRAINT "ModuleVersion_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleVersion" ADD CONSTRAINT "ModuleVersion_mcqSetVersionId_fkey" FOREIGN KEY ("mcqSetVersionId") REFERENCES "MCQSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQSetVersion" ADD CONSTRAINT "MCQSetVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQQuestion" ADD CONSTRAINT "MCQQuestion_mcqSetVersionId_fkey" FOREIGN KEY ("mcqSetVersionId") REFERENCES "MCQSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQQuestion" ADD CONSTRAINT "MCQQuestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQAttempt" ADD CONSTRAINT "MCQAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQAttempt" ADD CONSTRAINT "MCQAttempt_mcqSetVersionId_fkey" FOREIGN KEY ("mcqSetVersionId") REFERENCES "MCQSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQResponse" ADD CONSTRAINT "MCQResponse_mcqAttemptId_fkey" FOREIGN KEY ("mcqAttemptId") REFERENCES "MCQAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCQResponse" ADD CONSTRAINT "MCQResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MCQQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMEvaluation" ADD CONSTRAINT "LLMEvaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMEvaluation" ADD CONSTRAINT "LLMEvaluation_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMEvaluation" ADD CONSTRAINT "LLMEvaluation_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDecision" ADD CONSTRAINT "AssessmentDecision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDecision" ADD CONSTRAINT "AssessmentDecision_moduleVersionId_fkey" FOREIGN KEY ("moduleVersionId") REFERENCES "ModuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDecision" ADD CONSTRAINT "AssessmentDecision_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDecision" ADD CONSTRAINT "AssessmentDecision_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDecision" ADD CONSTRAINT "AssessmentDecision_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDecision" ADD CONSTRAINT "AssessmentDecision_parentDecisionId_fkey" FOREIGN KEY ("parentDecisionId") REFERENCES "AssessmentDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_appealedById_fkey" FOREIGN KEY ("appealedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationStatus" ADD CONSTRAINT "CertificationStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationStatus" ADD CONSTRAINT "CertificationStatus_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationStatus" ADD CONSTRAINT "CertificationStatus_latestDecisionId_fkey" FOREIGN KEY ("latestDecisionId") REFERENCES "AssessmentDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentJob" ADD CONSTRAINT "AssessmentJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

