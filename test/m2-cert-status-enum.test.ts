import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";

// #820: CertificationStatus.status is now a Postgres enum, which is a DB-level CHECK. The whole point is
// that a raw-SQL / future untyped writer can no longer store a value outside the lifecycle set (which the
// old free-text String column would have accepted, and `!= 'NOT_CERTIFIED'` would then read as "passed").
describe("CertificationLifecycleStatus enum is a DB-level CHECK (#820)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a value outside the lifecycle set", async () => {
    await expect(
      prisma.$queryRawUnsafe(`SELECT 'CERTIFIED_TYPO'::"CertificationLifecycleStatus" AS s`),
    ).rejects.toThrow();
  });

  it("accepts every declared lifecycle value", async () => {
    for (const value of ["ACTIVE", "DUE_SOON", "DUE", "EXPIRED", "NOT_CERTIFIED"]) {
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT '${value}'::"CertificationLifecycleStatus" AS s`,
      )) as Array<{ s: string }>;
      expect(rows[0]?.s).toBe(value);
    }
  });
});
