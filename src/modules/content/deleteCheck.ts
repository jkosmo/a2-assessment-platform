// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Etter gjennomlesingen», punkt 5 og 7): «kan dette slettes?»
// har ÉN utregning per type, og både «Slett» og lista spør den.
//
//   checkCourseDelete                          (courseDeleteGuard.ts)     ← deleteCourseInTx, og lista (archivedRetention.ts)
//   checkModuleDelete / checkModuleDeletes     (adminContentCommands.ts)  ← deleteModuleInTx / lista; reglene i `moduleDeleteRules`
//   checkSectionDelete / checkSectionDeletes   (sectionCommands.ts)       ← deleteSectionInTx / lista; reglene i `sectionDeleteRules`
//
// Slettingen kaster feilen den får; lista viser koden som «Beholdes: …». Så lenge begge går hit, kan lista ikke si «slettes» om noe
// «Slett» nekter, eller omvendt. For moduler og seksjoner leser lista dataene for mange elementer i én omgang (kostnaden, planens
// punkt 9), men reglene er den samme funksjonen. Vaktene er de samme som før (contentLifecycle.ts, courseDeleteGuard.ts), i samme
// rekkefølge: den første som slår til, er svaret.
import { AppError } from "../../errors/AppError.js";
import type { CourseUse } from "../course/contentLifecycle.js";

/**
 * Svaret fra en sjekk. `archivedAt` følger med når elementet kan slettes: fristen regnes fra den. `Extra` er det slettingen trenger
 * fra samme lesing (seksjonens tittel til revisjonsloggen). `heldBy`: når en modul eller seksjon holdes igjen av kurs, hvilke
 * (lista over arkiverte ser om de selv slettes først).
 */
export type DeleteCheck<Extra extends object = object> =
  | { status: "not_found" }
  | { status: "blocked"; error: AppError; heldBy?: CourseUse[] }
  | ({ status: "deletable"; archivedAt: Date } & Extra);

/**
 * Kjører vaktene i rekkefølge. Den første som kaster en domenefeil (`AppError`), er svaret; ingen feil gir `null`. Andre feil
 * (databasen er borte) kastes videre: de er ikke et svar på spørsmålet.
 */
export async function firstDeleteBlock(guards: ReadonlyArray<() => Promise<unknown>>): Promise<AppError | null> {
  for (const guard of guards) {
    try {
      await guard();
    } catch (error) {
      if (error instanceof AppError) return error;
      throw error;
    }
  }
  return null;
}
