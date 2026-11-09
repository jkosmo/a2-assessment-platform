import { describe, expect, it } from "vitest";
import { checkStageCopyTarget } from "../../scripts/maintenance/stageCopyGuard.js";

// #1142, QA-porten 2026-11-09: `npm run stage-copy:neutralize-email` setter ventende e-post til terminale tilstander. Mot prod
// ville ekte e-post forsvinne for godt. Sperren kjører før noe skrives (scripts/maintenance/stageCopyGuard.ts). Vertsnavnene
// under er laget for testen; repoet er offentlig, så bare mønsteret står her.

const PASSWORD = "hemmelig-passord-123";
const url = (host: string, database = "a2_stage_copy") => `postgresql://a2admin:${PASSWORD}@${host}:5432/${database}?sslmode=require`;
const STAGE_HOST = "eksempel-stg-pg.postgres.database.azure.com";

/** Meldingen skal aldri ha med passordet eller hele adressen. */
function expectNoSecrets(message: string, databaseUrl: string) {
  expect(message).not.toContain(PASSWORD);
  expect(message).not.toContain(databaseUrl);
  expect(message).not.toContain("postgresql://");
}

describe("#1142 — sperren for stage-kopiskriptet", () => {
  it("manglende bekreftelse: nektes, og meldingen sier hva som mangler", () => {
    const databaseUrl = url(STAGE_HOST);
    for (const confirmation of [undefined, "", "   "]) {
      const result = checkStageCopyTarget(databaseUrl, confirmation);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("missing_confirmation");
      expect(result.message).toContain("CONFIRM_STAGE_COPY");
      expect(result.message).toContain("a2_stage_copy");
      expectNoSecrets(result.message, databaseUrl);
    }
  });

  it("feil bekreftelse: nektes", () => {
    const databaseUrl = url(STAGE_HOST);
    for (const confirmation of ["a2_stage", "A2_STAGE_COPY", "ja", PASSWORD]) {
      const result = checkStageCopyTarget(databaseUrl, confirmation);
      expect(result.ok, confirmation).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("wrong_confirmation");
      expectNoSecrets(result.message, databaseUrl);
    }
  });

  it("prod-mønster i vertsnavnet: nektes alltid, også med riktig bekreftelse", () => {
    for (const host of ["eksempel-prd-pg.postgres.database.azure.com", "db.prod.eksempel.test", "EKSEMPEL-PRD-PG.postgres.database.azure.com", "eksempelprod01"]) {
      const databaseUrl = url(host);
      const result = checkStageCopyTarget(databaseUrl, "a2_stage_copy");
      expect(result.ok, host).toBe(false);
      if (result.ok) continue;
      expect(result.reason, host).toBe("prod_host");
      expectNoSecrets(result.message, databaseUrl);
      expect(result.message).not.toContain(host);
    }
  });

  it("stage-mønster med riktig bekreftelse: godtas", () => {
    expect(checkStageCopyTarget(url(STAGE_HOST), "a2_stage_copy")).toEqual({ ok: true, databaseName: "a2_stage_copy" });
    expect(checkStageCopyTarget(url(STAGE_HOST, "a2_kopi"), " a2_kopi ")).toEqual({ ok: true, databaseName: "a2_kopi" });
  });

  // QA-porten runde 2: en tunnel eller et alias til prod har ingen prod-mønstre, og databasenavnet er likt i begge miljøene.
  it("tunnel, IP-adresse eller alias uten stage-mønster: nektes, også med riktig bekreftelse", () => {
    for (const host of ["127.0.0.1", "localhost", "10.1.2.3", "db.eksempel.test", "eksempel-pg.postgres.database.azure.com"]) {
      const databaseUrl = url(host, "a2assessment");
      const result = checkStageCopyTarget(databaseUrl, "a2assessment");
      expect(result.ok, host).toBe(false);
      if (result.ok) continue;
      expect(result.reason, host).toBe("not_stage_host");
      expectNoSecrets(result.message, databaseUrl);
    }
  });

  it("uten DATABASE_URL, med en adresse som ikke kan leses, eller uten databasenavn: nektes uten å skrive ut adressen", () => {
    expect(checkStageCopyTarget(undefined, "x")).toMatchObject({ ok: false, reason: "missing_database_url" });
    const unreadable = `ikke en adresse ${PASSWORD}`;
    const result = checkStageCopyTarget(unreadable, "x");
    expect(result).toMatchObject({ ok: false, reason: "unreadable_database_url" });
    if (!result.ok) expect(result.message).not.toContain(PASSWORD);
    expect(checkStageCopyTarget(`postgresql://a2admin:${PASSWORD}@${STAGE_HOST}:5432/`, "")).toMatchObject({ ok: false, reason: "missing_database_name" });
  });
});
