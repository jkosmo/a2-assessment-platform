-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeletionTrigger" AS ENUM ('USER_REQUEST', 'OFFBOARDING', 'INACTIVITY');

-- AlterTable: add GDPR fields to User
ALTER TABLE "User"
  ADD COLUMN "lastLoginAt"   TIMESTAMP(3),
  ADD COLUMN "isAnonymized"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "anonymizedAt"  TIMESTAMP(3);

-- CreateTable: UserConsent
CREATE TABLE "UserConsent" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "acceptedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DeletionRequest
CREATE TABLE "DeletionRequest" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "requestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt"  TIMESTAMP(3),
    "status"       "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "trigger"      "DeletionTrigger"       NOT NULL DEFAULT 'USER_REQUEST',
    "anonymizedAt" TIMESTAMP(3),
    "cancelledAt"  TIMESTAMP(3),

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PlatformConfig
CREATE TABLE "PlatformConfig" (
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex: UserConsent unique + index
CREATE UNIQUE INDEX "UserConsent_userId_consentVersion_key" ON "UserConsent"("userId", "consentVersion");
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

-- CreateIndex: DeletionRequest indexes
CREATE INDEX "DeletionRequest_status_effectiveAt_idx" ON "DeletionRequest"("status", "effectiveAt");
CREATE INDEX "DeletionRequest_userId_status_idx" ON "DeletionRequest"("userId", "status");

-- AddForeignKey: UserConsent -> User (cascade delete)
ALTER TABLE "UserConsent"
  ADD CONSTRAINT "UserConsent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DeletionRequest -> User (restrict delete)
ALTER TABLE "DeletionRequest"
  ADD CONSTRAINT "DeletionRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
