import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildWorkerDatasourceUrl } from "../src/db/workerDatasource.js";

// #866 integration (real Postgres): prove that the statement_timeout applied to the WORKER connection
// via the connection-string `options` param actually aborts a long-running query end-to-end — i.e.
// Prisma 6 honours it. This is the mechanism that lets a wedged claim/scan query abort (tick
// fails+retries) instead of hanging /healthz for ~10–20 min. lock_timeout is delivered by the exact
// same `options` param, so proving statement_timeout takes effect proves the mechanism for both.

const baseUrl = process.env.DATABASE_URL as string;

describe("worker DB statement_timeout (#866)", () => {
  // A throwaway client with a tiny 500ms statement_timeout (the real worker uses 30s). Independent of
  // the shared prisma client so we don't perturb other suites.
  const client = new PrismaClient({
    datasourceUrl: buildWorkerDatasourceUrl(baseUrl, { statementTimeoutMs: 500, lockTimeoutMs: 500 }),
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("aborts a statement that runs past statement_timeout", async () => {
    // pg_sleep(2) far exceeds the 500ms statement_timeout → Postgres cancels the statement.
    await expect(client.$queryRawUnsafe("SELECT pg_sleep(2)")).rejects.toThrow(
      /statement timeout|canceling statement/i,
    );
  });

  it("still runs a fast query fine under the timeout", async () => {
    const rows = await client.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 as ok");
    expect(Number(rows[0].ok)).toBe(1);
  });
});
