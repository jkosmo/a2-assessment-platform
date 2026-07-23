-- #820: promote CertificationStatus.status from free-text String to a real Postgres enum, which is a
-- DB-level CHECK that rejects any value outside the certification lifecycle set. Existing rows are all
-- valid — the sole writer (upsertCertificationStatus) is TypeScript-union-typed to exactly these five
-- values — so the in-place USING cast can never fail. No data is dropped.

-- CreateEnum
CREATE TYPE "CertificationLifecycleStatus" AS ENUM ('ACTIVE', 'DUE_SOON', 'DUE', 'EXPIRED', 'NOT_CERTIFIED');

-- AlterTable: convert the column in place, casting existing text values to the enum.
ALTER TABLE "CertificationStatus"
  ALTER COLUMN "status" TYPE "CertificationLifecycleStatus"
  USING "status"::"CertificationLifecycleStatus";
