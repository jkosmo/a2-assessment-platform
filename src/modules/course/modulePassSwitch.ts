// #934 skive 5a-3 (doc/DESIGN_934.md, «5a-3»): bryteren for regelen om beståtte per kurs.
//
// Bryteren er en rad i `PlatformConfig`, ikke en miljøinnstilling. To miljøinnstillinger kunne vært ulike på app og worker, og
// da kunne workeren utstedt kursbevis etter den gamle regelen. Raden leses HVER gang, på samme klient som avgjørelsen, altså i
// samme transaksjon der avgjørelsen skjer i en. Her skal det aldri stå noen mellomlagring: da kunne app og worker bli uenige.
//
// Fast regel: når bryteren er slått på, rulles det aldri tilbake til kode som ikke leser den, og den slås ikke av igjen etter at
// første krav er hevet. Da ville den gamle regelen telt beståtte som ikke lenger gjelder. Feil rettes framover.
import type { DbTransactionClient } from "../../db/transaction.js";
import { ConflictError } from "../../errors/AppError.js";

export const MODULE_PASS_SWITCH_KEY = "module_pass_per_course";

export type SwitchReader = Pick<DbTransactionClient, "platformConfig">;

/** Er regelen om beståtte per kurs slått på? Kun verdien `on` slår den på. Alt annet, og ingen rad, er den gamle regelen. */
export async function isModulePassPerCourseOn(client: SwitchReader): Promise<boolean> {
  const row = await client.platformConfig.findUnique({ where: { key: MODULE_PASS_SWITCH_KEY }, select: { value: true } });
  return row?.value === "on";
}

/** De nye endepunktene før bryteren: ingenting skrives. En gammel server svarer 404, så ny klient kan skille de to. */
export async function assertModuleVersioningActive(client: SwitchReader): Promise<void> {
  if (!(await isModulePassPerCourseOn(client))) {
    throw new ConflictError(
      "module_versioning_not_active",
      "Publishing with a choice per course is not switched on yet. Nothing was published.",
    );
  }
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
