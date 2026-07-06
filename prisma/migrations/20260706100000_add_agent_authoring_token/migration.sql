-- AA-3 (#651): short-lived agent authoring tokens (hash only; the secret is never stored).
-- CreateTable
CREATE TABLE "AgentAuthoringToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AgentAuthoringToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentAuthoringToken_tokenHash_key" ON "AgentAuthoringToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentAuthoringToken_userId_idx" ON "AgentAuthoringToken"("userId");

-- AddForeignKey
ALTER TABLE "AgentAuthoringToken" ADD CONSTRAINT "AgentAuthoringToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
