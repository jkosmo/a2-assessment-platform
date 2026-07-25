import { describe, it, expect } from "vitest";
import { buildWorkerDatasourceUrl } from "../../src/db/workerDatasource.js";

// #866: the worker connection string gets Postgres statement_timeout + lock_timeout appended so a
// blocked claim/scan query aborts (tick fails+retries) instead of wedging /healthz.
describe("buildWorkerDatasourceUrl (#866)", () => {
  const opts = { statementTimeoutMs: 30000, lockTimeoutMs: 10000 };

  it("appends the libpq options with & when the URL already has query params", () => {
    const out = buildWorkerDatasourceUrl(
      "postgresql://u:p@h:5432/db?schema=public&sslmode=require",
      opts,
    );
    expect(out.startsWith("postgresql://u:p@h:5432/db?schema=public&sslmode=require&options=")).toBe(true);
    const optionsValue = decodeURIComponent(out.split("options=")[1]);
    expect(optionsValue).toBe("-c statement_timeout=30000 -c lock_timeout=10000");
  });

  it("appends with ? when the URL has no query params", () => {
    const out = buildWorkerDatasourceUrl("postgresql://u:p@h:5432/db", opts);
    expect(out.startsWith("postgresql://u:p@h:5432/db?options=")).toBe(true);
    expect(decodeURIComponent(out.split("options=")[1])).toBe(
      "-c statement_timeout=30000 -c lock_timeout=10000",
    );
  });

  it("encodes spaces as %20 (not +) so libpq parses the -c pairs", () => {
    const out = buildWorkerDatasourceUrl("postgresql://u:p@h/db", opts);
    expect(out).toContain("%20");
    // A raw + would be decoded as a literal plus by libpq, breaking the option list.
    expect(out.split("options=")[1]).not.toContain("+");
  });

  it("reflects custom timeout values", () => {
    const out = buildWorkerDatasourceUrl("postgresql://u:p@h/db", {
      statementTimeoutMs: 5000,
      lockTimeoutMs: 2500,
    });
    expect(decodeURIComponent(out.split("options=")[1])).toBe(
      "-c statement_timeout=5000 -c lock_timeout=2500",
    );
  });

  it("returns an empty base string unchanged (never breaks startup)", () => {
    expect(buildWorkerDatasourceUrl("", opts)).toBe("");
  });
});
