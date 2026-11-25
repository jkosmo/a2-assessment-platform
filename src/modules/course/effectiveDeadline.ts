// #1192 punkt 2, skive 2b (doc/design/PLAN_1192_BESTATT_OG_FRIST.md): DEN ENE regelen for hvilken frist som gjelder for én
// person i ett kurs. Før slo fire steder sammen fristene hver på sin måte (planlesingen, Codex HØY 1):
//   - Status (`cohortStatusService`) lot en individuell rad uten frist vinne, også en SELF-påmelding;
//   - påminnelsene (`courseReminderService`) filtrerte bort individuelle frister utenfor vinduet FØR klassefristene ble flettet
//     inn, så en individuell frist langt fram tapte mot en tidligere klassefrist;
//   - den ukentlige e-posten (`weeklyDigestContent`) brukte `??`, så en individuell rad uten frist tapte mot klassen;
//   - «Mine kurs»/`/enrollments` lot en SELF-påmelding skjule klassens frist.
// Samme person kunne dermed ha tre ulike frister på tre flater.
//
// Regelen:
//   1. En TILDELING til personen (`CourseEnrollment` med kilde INDIVIDUAL eller DEPARTMENT, ikke trukket tilbake) vinner, også
//      uten frist: den som tildelte, har sagt noe om akkurat denne personen.
//   2. En SELF-påmelding er ikke en tildeling og sier ingenting om frist (som den ukentlige e-posten alt regnet det).
//   3. Ellers den tidligste fristen fra AKTIVE klasser (arkiverte gir ikke frist, #1192 punkt 3). Ved lik dato følger det
//      seneste `dueSetAt` med, så en frist som er satt på nytt etter en ny hovedversjon, ikke skjules av en eldre med samme dato.
//   4. Ingen av delene: ingen frist.
//
// `dueSetAt` er når fristen sist ble satt eller endret (2a). `null` betyr «satt før feltet fantes», som regnes som gammelt
// (produkteier, svar B 2026-11-24).

export type DeadlineRow = { dueAt: Date | null; dueSetAt?: Date | null };
export type IndividualDeadlineRow = DeadlineRow & { source: string };
export type ClassDeadlineRow = DeadlineRow & { archived?: boolean };

export type EffectiveDeadline = {
  dueAt: Date | null;
  dueSetAt: Date | null;
  /** Hvor fristen kom fra: en tildeling til personen, en klasse, eller ingen av delene. */
  from: "individual" | "class" | "none";
};

/**
 * Prisma-vilkåret «den lagrede fristen er en annen enn `dueAt`», for skriverne (2a). `NOT { dueAt: x }` ville utelatt rader der
 * fristen er NULL (SQL: NULL = x er ukjent), derfor eksplisitt.
 */
export function dueAtDiffers(dueAt: Date | null): { dueAt: { not: null } } | { OR: Array<{ dueAt: null } | { dueAt: { not: Date } }> } {
  return dueAt === null ? { dueAt: { not: null } } : { OR: [{ dueAt: null }, { dueAt: { not: dueAt } }] };
}

/** Er raden en tildeling som avgjør fristen (ikke en SELF-påmelding)? */
export function isAssignmentRow(row: { source: string } | null | undefined): boolean {
  return row != null && row.source !== "SELF";
}

export function effectiveDeadline(input: { individual?: IndividualDeadlineRow | null; classes?: ClassDeadlineRow[] }): EffectiveDeadline {
  const individual = input.individual;
  if (individual && isAssignmentRow(individual)) {
    return { dueAt: individual.dueAt, dueSetAt: individual.dueAt ? (individual.dueSetAt ?? null) : null, from: "individual" };
  }
  let best: { dueAt: Date; dueSetAt: Date | null } | null = null;
  let anyClass = false;
  for (const row of input.classes ?? []) {
    if (row.archived) continue;
    anyClass = true;
    if (!row.dueAt) continue;
    const dueSetAt = row.dueSetAt ?? null;
    if (!best || row.dueAt.getTime() < best.dueAt.getTime()) {
      best = { dueAt: row.dueAt, dueSetAt };
    } else if (row.dueAt.getTime() === best.dueAt.getTime() && dueSetAt && (!best.dueSetAt || dueSetAt.getTime() > best.dueSetAt.getTime())) {
      best = { dueAt: row.dueAt, dueSetAt };
    }
  }
  if (best) return { dueAt: best.dueAt, dueSetAt: best.dueSetAt, from: "class" };
  return { dueAt: null, dueSetAt: null, from: anyClass ? "class" : "none" };
}
