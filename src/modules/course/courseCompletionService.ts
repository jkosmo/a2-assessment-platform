import { isSectionAvailableToParticipant } from "./sectionAvailability.js";
import { prisma } from "../../db/prisma.js";
import { createCourseRepository } from "./courseRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import type { DbTransactionClient } from "../../db/transaction.js";

type CompletionTxClient = Pick<
  DbTransactionClient,
  "course" | "courseItem" | "courseCompletion" | "courseSectionRead" | "certificationStatus" | "auditEvent" | "submission"
>;

type CourseRepo = ReturnType<typeof createCourseRepository>;

/**
 * Evaluates and (if newly satisfied) issues a course completion for one course.
 * Certification requires BOTH: all modules passed AND all learning sections read (#525/#476).
 */
async function evaluateCourseCompletion(
  repo: CourseRepo,
  userId: string,
  // #945: `module.archivedAt` er PÅKREVD i typen, ikke valgfri. Alle tre repository-veiene bærer
  // det nå, og en fjerde kaller som glemmer det skal ikke kompilere — da ville arkivfilteret under
  // stille ha sluppet gjennom alt.
  course: {
    id: string;
    modules: { moduleId: string; module: { archivedAt: Date | null } | null }[];
    publishedAt?: Date | null;
    archivedAt?: Date | null;
  },
  tx?: CompletionTxClient,
): Promise<void> {
  // #933 (produkteier 2026-08-19): «Utstedelse av bestått skal kun skje hvis kurset er publisert.»
  //
  // Alle tre inngangene filtrerte allerede på publisert — `findPublishedCoursesContainingModule`,
  // en eksplisitt sjekk i `checkCourseCompletionForCourse`, og `findPublishedCourses`. Vakten sto
  // altså tre steder og null steder: en fjerde kaller ville hatt ingenting å treffe.
  //
  // Dette er repoets vanligste feilklasse — «riktig regel, ufullstendig flate». Regelen hører
  // hjemme i den ene funksjonen alle tre passerer, ikke hos hver enkelt kaller. De andre sjekkene
  // står igjen: de sparer en rundtur, og de er nå redundante på den trygge måten.
  //
  // ⚠️ Verifisert ved mutasjon: å fjerne denne linja gjør INGEN test rød, fordi ingen nåværende
  // sti kan levere et upublisert kurs hit. Den er ren dybdeforsvar mot en fjerde kaller, og det er
  // skrevet her framfor å late som en test dekker den. Skulle noen legge til en kaller som ikke
  // forhåndsfiltrerer, er dette linja som redder det — og DA blir den testbar.
  if (!course.publishedAt || course.archivedAt) return;

  // #945: arkiverte moduler filtreres nå bort, slik arkiverte seksjoner alltid har vært. Asymmetrien
  // var utilsiktet og hadde en levende konsekvens: en arkivert modul i et publisert kurs blokkerte
  // fullføring FOR ALLTID — deltakeren kom aldri over 4/5, fikk aldri bevis, og så ingen feilmelding.
  // Bekreftet på stage 2026-08-21: kurset «Samfunnsvitere» hadde nøyaktig den tilstanden.
  const moduleIds = course.modules.filter((m) => m.module?.archivedAt == null).map((m) => m.moduleId);

  // A course can be pure-reading (no assessment modules) — the LMS Tier 2 markdown-first
  // courses (#476). For those, reading every learning section is the only certification gate,
  // so we must NOT bail on `moduleIds.length === 0`. Gates are computed over BOTH modules and
  // sections, exactly matching the "completed" definition the progress view uses
  // (passed === all modules AND read === all sections). The old `if (total === 0) return` only
  // counted modules, so reading-only courses showed "Fullført" in the list yet never issued a
  // certificate (#580 follow-up).
  const courseItems = await repo.findCourseItems(course.id);
  // #944/#938: kravet er de seksjonene deltakeren FAKTISK KAN LESE — samme predikat som lesestien
  // og DTO-en bruker. Sto tidligere som `archivedAt == null` alene, og fanget derfor ikke en
  // seksjon oversettelsesgaten hadde holdt tilbake.
  //
  // ⚠️ Produkteiers regel (doc/DECISIONS.md): arkivert innhold teller ikke i kravet, fordi et krav
  // som ALDRI kan oppfylles er verre enn ikke noe krav. Nøyaktig samme argument gjelder en
  // tilbakeholdt seksjon: deltakeren får 404 på lesestien, så å kreve den er en blindvei.
  const requiredSectionIds = courseItems
    .filter((item) => item.itemType === "SECTION" && item.section != null && isSectionAvailableToParticipant(item.section))
    .map((item) => item.section!.id);

  // Truly empty course (no modules AND no sections) is never completable.
  if (moduleIds.length === 0 && requiredSectionIds.length === 0) return;

  if (moduleIds.length > 0) {
    const passedCount = await repo.countPassedModulesForUser(userId, moduleIds);
    if (passedCount < moduleIds.length) return;
  }

  if (requiredSectionIds.length > 0) {
    const readSectionIds = new Set(await repo.findReadSectionIds(userId, course.id));
    const allSectionsRead = requiredSectionIds.every((id) => readSectionIds.has(id));
    if (!allSectionsRead) return;
  }

  const existing = await repo.findCourseCompletion(userId, course.id);
  if (existing) return;

  // #933: begge halvdelene av regelen lagres nå. `requiredSectionIds` er nettopp «seksjonene kurset
  // inneholdt på det tidspunkt» — den lista gaten akkurat målte mot, ikke en ny utledning.
  const completion = await repo.createCourseCompletion(
    userId,
    course.id,
    JSON.stringify(moduleIds),
    JSON.stringify(requiredSectionIds),
  );

  await recordAuditEvent(
    {
      entityType: auditEntityTypes.course,
      entityId: course.id,
      action: auditActions.course.completionIssued,
      actorId: userId,
      metadata: { userId, courseId: course.id, certificateId: completion.certificateId },
    },
    tx,
  );
}

/** Re-check completion for every published course containing the module that was just passed. */
export async function checkAndIssueCourseCompletions(
  input: { userId: string; moduleId: string },
  tx?: CompletionTxClient,
) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const courses = await repo.findPublishedCoursesContainingModule(input.moduleId);
  if (courses.length === 0) return;

  for (const course of courses) {
    await evaluateCourseCompletion(repo, input.userId, course, tx);
  }
}

/**
 * Re-check completion for a single course — called after a section is marked read (#476), since
 * reading the final section can be the last gate even when all modules are already passed.
 */
export async function checkCourseCompletionForCourse(
  input: { userId: string; courseId: string },
  tx?: CompletionTxClient,
) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const course = await repo.findCourseById(input.courseId);
  if (!course || !course.publishedAt || course.archivedAt) return;

  await evaluateCourseCompletion(repo, input.userId, course, tx);
}

/**
 * Idempotent reconciliation across ALL published courses for a user. Completion + certificate
 * issuance is event-driven (fired when the last module passes or the last section is read); if that
 * event was ever missed — data created before the logic existed, a dropped fire-and-forget, or a
 * completion path that didn't trigger it — a course can show "completed" in the progress view yet
 * have no certificate. This sweep, run when the user opens their certificates page, backfills any
 * completion whose gates (all modules passed + all sections read) are now satisfied.
 */
export async function reconcileCourseCompletionsForUser(userId: string, tx?: CompletionTxClient) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const courses = await repo.findPublishedCourses();
  for (const course of courses) {
    // Per-course isolation: a single malformed course must never blank the user's entire
    // certificate list (or 500 the page that triggers this sweep). Backfill is best-effort.
    try {
      await evaluateCourseCompletion(repo, userId, course, tx);
    } catch (error) {
      console.warn(
        `[course-completion] reconcile skipped course ${course.id} for user ${userId}:`,
        error,
      );
    }
  }
}
