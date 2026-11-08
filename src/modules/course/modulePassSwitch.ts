// #934 skive 5a-3 (doc/DESIGN_934.md, «5a-3»): bryteren for regelen om beståtte per kurs.
//
// Bryteren er en rad i `PlatformConfig`. Den har vært på i prod og på stage siden 2026-11-06.
//
// Fast regel: den slås aldri av igjen, og det rulles aldri tilbake til kode som ikke leser den (eldre enn 2.135.0). Den gamle
// regelen (bryteren av) er fjernet fra koden 2026-11-08: regelen om beståtte per kurs gjelder alltid, og INGENTING i `src/` leser
// raden lenger. Raden står, og `npm run module-credit:switch-on` skriver den, så en utrulling eller en tilbakerulling til
// 2.135.0–2.145.0 (som leser raden) gir samme regel. Slett den ikke. `test/content-lock-write-guard.test.js` nekter nye lesere.
import type { DbTransactionClient } from "../../db/transaction.js";
import { ConflictError } from "../../errors/AppError.js";

export const MODULE_PASS_SWITCH_KEY = "module_pass_per_course";

export type SwitchReader = Pick<DbTransactionClient, "platformConfig">;

/** Står raden på? Bare for skriptet som slår den på (`scripts/maintenance/switch-on-module-pass.ts`). Koden leser den ikke. */
export async function isModulePassPerCourseOn(client: SwitchReader): Promise<boolean> {
  const row = await client.platformConfig.findUnique({ where: { key: MODULE_PASS_SWITCH_KEY }, select: { value: true } });
  return row?.value === "on";
}

/**
 * En gammel klient mot regelen om beståtte per kurs: det den sender, sier ingenting om kursene og kan ikke oversettes trygt.
 * Samme kode som en utdatert deltakerfane: siden må lastes på nytt. Ingenting er skrevet.
 */
export function clientOutdatedForVersionChoice(details?: Record<string, unknown>) {
  return new ConflictError(
    "client_outdated",
    "This page is out of date: it cannot say which courses a new major version applies to. Reload the page. Nothing was published.",
    details,
  );
}
