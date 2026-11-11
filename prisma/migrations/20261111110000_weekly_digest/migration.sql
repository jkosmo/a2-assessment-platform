-- #1139 skive 3 (doc/design/PLAN_1139.md, punkt 4): én rad per person og uke for den ukentlige e-posten. Ren utvidelse: ny
-- tabell, gammel kode ser den ikke.
CREATE TABLE "WeeklyDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "queuedAt" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeeklyDigest_userId_weekKey_key" ON "WeeklyDigest"("userId", "weekKey");

CREATE INDEX "WeeklyDigest_status_weekKey_idx" ON "WeeklyDigest"("status", "weekKey");

ALTER TABLE "WeeklyDigest" ADD CONSTRAINT "WeeklyDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
