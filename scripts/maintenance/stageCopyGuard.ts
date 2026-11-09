/**
 * #1142: sperren for `npm run stage-copy:neutralize-email` (QA-porten 2026-11-09). Skriptet setter ventende e-post til
 * terminale tilstander. Kjøres det ved en feil mot prod, forsvinner ekte e-post for godt. Derfor, FØR noe skrives:
 *   1. vertsnavnet i DATABASE_URL må ikke se ut som prod (inneholder «-prd-» eller «prod»). Nektes alltid, også med
 *      bekreftelse;
 *   2. CONFIRM_STAGE_COPY må være lik databasenavnet i DATABASE_URL, så den som kjører, har sett hvilken database det gjelder.
 * Meldingene skriver aldri ut passordet eller hele adressen. Ren funksjon uten database, så den testes som enhetstest
 * (test/unit/stage-copy-guard-1142.test.ts). Repoet er offentlig: bare mønsteret står her, ingen ekte vertsnavn.
 */

/** Deler av vertsnavnet som betyr prod. Sammenlignes uten hensyn til store og små bokstaver. */
export const PROD_HOST_PATTERNS = ["-prd-", "prod"] as const;

export type StageCopyGuardResult =
  | { ok: true; databaseName: string }
  | { ok: false; reason: "missing_database_url" | "unreadable_database_url" | "missing_database_name" | "prod_host" | "missing_confirmation" | "wrong_confirmation"; message: string };

export function checkStageCopyTarget(databaseUrl: string | undefined, confirmation: string | undefined): StageCopyGuardResult {
  if (!databaseUrl?.trim()) {
    return { ok: false, reason: "missing_database_url", message: "DATABASE_URL er ikke satt. Velg miljøet med vilje: dotenv -e .env.<stage-kopi> -- …" };
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl.trim());
  } catch {
    // Ikke skriv ut adressen: den kan inneholde passordet.
    return { ok: false, reason: "unreadable_database_url", message: "DATABASE_URL kan ikke leses som en adresse. Avbrutt uten å skrive noe." };
  }

  const host = parsed.hostname.toLowerCase();
  if (PROD_HOST_PATTERNS.some((pattern) => host.includes(pattern))) {
    return {
      ok: false,
      reason: "prod_host",
      message: `Vertsnavnet i DATABASE_URL ser ut som prod (inneholder ${PROD_HOST_PATTERNS.map((p) => `«${p}»`).join(" eller ")}). Skriptet kjøres aldri mot prod, heller ikke med bekreftelse. Avbrutt uten å skrive noe.`,
    };
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    databaseName = "";
  }
  if (!databaseName) {
    return { ok: false, reason: "missing_database_name", message: "DATABASE_URL har ikke noe databasenavn. Avbrutt uten å skrive noe." };
  }

  if (!confirmation?.trim()) {
    return {
      ok: false,
      reason: "missing_confirmation",
      message: `CONFIRM_STAGE_COPY mangler. Sett den lik databasenavnet («${databaseName}») for å bekrefte at dette er stage-kopien. Avbrutt uten å skrive noe.`,
    };
  }
  if (confirmation.trim() !== databaseName) {
    return {
      ok: false,
      reason: "wrong_confirmation",
      message: `CONFIRM_STAGE_COPY er ikke lik databasenavnet i DATABASE_URL («${databaseName}»). Avbrutt uten å skrive noe.`,
    };
  }
  return { ok: true, databaseName };
}
