import { prisma } from "../../db/prisma.js";
import { createCourseRepository } from "./courseRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { AppError } from "../../errors/AppError.js";
import { runContentReadForLearner, type LearnerContentTx } from "../../db/contentLock.js";

type CourseRepo = ReturnType<typeof createCourseRepository>;

// #934 skive 5a-1: det som står i kursbeviset, målt i ett øyeblikk. #1145: `upgradeCompletionId` når det for denne hovedversjonen
// bare finnes et bevis registrert for et kurs tatt utenfor plattformen; det oppgraderes i stedet for at et nytt lages.
type CompletionGate = { moduleIds: string[]; requiredSectionIds: string[]; upgradeCompletionId?: string };

/**
 * Is a new certificate due for this course? Certification requires BOTH: all modules passed AND all
 * learning sections read (#525/#476). Only reads; `null` means nothing to issue.
 */
async function findCompletionToIssue(
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
    // #934: PÅKREVD, som `module.archivedAt` over. Beviset utstedes for kursets nåværende versjon; en
    // vei inn som glemte den, skal ikke kompilere — ellers ville et nytt bevis stille fått versjon 1.
    versionMajor: number;
    versionMinor: number;
  },
): Promise<CompletionGate | null> {
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
  if (!course.publishedAt || course.archivedAt) return null;

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
  // #944/#938/#958: kravet er de seksjonene deltakeren FAKTISK KAN LESE — og porten spør nå den
  // SAMME døra som lesestien og kursdetaljen. Sto tidligere som `archivedAt == null` alene, og
  // fanget derfor ikke en seksjon oversettelsesgaten hadde holdt tilbake; deretter som et eget
  // predikatkall her, som var riktig men fortsatt en fjerde kopi av setningen.
  //
  // ⚠️ Produkteiers regel (doc/DECISIONS.md): arkivert innhold teller ikke i kravet, fordi et krav
  // som ALDRI kan oppfylles er verre enn ikke noe krav. Nøyaktig samme argument gjelder en
  // tilbakeholdt seksjon: deltakeren får 404 på lesestien, så å kreve den er en blindvei.
  const courseItems = await repo.findCourseItemsForParticipant(course.id);
  const requiredSectionIds = courseItems
    .filter((item) => item.itemType === "SECTION" && item.sectionId != null)
    .map((item) => item.sectionId as string);

  // Truly empty course (no modules AND no sections) is never completable.
  if (moduleIds.length === 0 && requiredSectionIds.length === 0) return null;

  // #934 skive 5a-3: regelen velges der, ut fra bryteren. I den låste veien er bryteren og beståttene lest i samme transaksjon.
  if (moduleIds.length > 0) {
    const progress = await repo.findModuleProgress({ userIds: [userId], courses: [{ courseId: course.id, moduleIds }] });
    if (progress.passedModuleIds(userId, course.id).size < moduleIds.length) return null;
  }

  if (requiredSectionIds.length > 0) {
    const readSectionIds = new Set(await repo.findReadSectionIds(userId, course.id));
    const allSectionsRead = requiredSectionIds.every((id) => readSectionIds.has(id));
    if (!allSectionsRead) return null;
  }

  // #934: ett bevis per hovedversjon. Har deltakeren bevis for en eldre hovedversjon, står det —
  // og et nytt utstedes for denne når kravet er oppfylt (produkteier 2026-11-01).
  const existing = await repo.findCourseCompletion(userId, course.id, course.versionMajor);
  // #1145: et registrert bevis (tatt utenfor plattformen) blokkerer ikke et ekte: kravet er nå målt, og beviset oppgraderes.
  if (existing && existing.source === "external") return { moduleIds, requiredSectionIds, upgradeCompletionId: existing.id };
  if (existing) return null;

  return { moduleIds, requiredSectionIds };
}

// #934 skive 5a-1 (doc/DESIGN_934.md, «5a-1»): den ENE veien til et kursbevis. Kurset, kravet, beståtte og lesinger
// leses inne i transaksjonen som holder innholdslåsen delt og deltakerlåsen, og beviset skrives i samme transaksjon.
//   - Innholdslåsen: en ny versjon av kurset står enten ferdig, og da gjelder beviset den, eller venter til beviset er
//     skrevet, og da teller den personen som mottaker av e-posten.
//   - Deltakerlåsen: en anke eller en lesing kan ikke komme midt i målingen. Bestått og lest var oppfylt samtidig.
async function evaluateCourseCompletionLocked(locked: LearnerContentTx, userId: string, courseId: string): Promise<void> {
  const repo = createCourseRepository(locked);
  const course = await repo.findCourseById(courseId);
  if (!course) return;
  const gate = await findCompletionToIssue(repo, userId, course);
  if (!gate) return;

  if (gate.upgradeCompletionId) {
    const upgraded = await repo.upgradeExternalCourseCompletion(locked, {
      completionId: gate.upgradeCompletionId,
      version: { major: course.versionMajor, minor: course.versionMinor },
      moduleSnapshotJson: JSON.stringify(gate.moduleIds),
      sectionSnapshotJson: JSON.stringify(gate.requiredSectionIds),
    });
    if (upgraded.count === 0) return;
    const row = await repo.findCourseCompletion(userId, course.id, course.versionMajor);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: course.id,
        action: auditActions.course.completionIssued,
        actorId: userId,
        metadata: { userId, courseId: course.id, certificateId: row?.certificateId ?? "", upgradedFrom: "external" },
      },
      locked,
    );
    return;
  }

  // #933: begge halvdelene av regelen lagres nå. `requiredSectionIds` er nettopp «seksjonene kurset
  // inneholdt på det tidspunkt» — den lista gaten akkurat målte mot, ikke en ny utledning.
  const completion = await repo.createCourseCompletion(
    locked,
    userId,
    course.id,
    { major: course.versionMajor, minor: course.versionMinor },
    JSON.stringify(gate.moduleIds),
    JSON.stringify(gate.requiredSectionIds),
  );

  await recordAuditEvent(
    {
      entityType: auditEntityTypes.course,
      entityId: course.id,
      action: auditActions.course.completionIssued,
      actorId: userId,
      metadata: { userId, courseId: course.id, certificateId: completion.certificateId },
    },
    locked,
  );
}

/**
 * Re-check completion for every published course containing the module that was just passed.
 * #934 skive 5a-1: én kort transaksjon per kurs. Lista er bare et forslag; alt sjekkes på nytt under låsene. Får
 * ett kurs ikke låsen, kaster den (503), og outboxen prøver hele hendelsen igjen; utstedelsen tåler det.
 */
export async function checkAndIssueCourseCompletions(input: { userId: string; moduleId: string }) {
  const courses = await createCourseRepository(prisma).findPublishedCoursesContainingModule(input.moduleId);
  for (const course of courses) {
    await runContentReadForLearner(input.userId, (tx) => evaluateCourseCompletionLocked(tx, input.userId, course.id));
  }
}

/**
 * Re-check completion for a single course — called after a section is marked read (#476), since
 * reading the final section can be the last gate even when all modules are already passed.
 * #934 skive 5a-1: i lesingens egen låste transaksjon, så lesingen og beviset commiter sammen (#946).
 */
export async function checkCourseCompletionForCourse(input: { userId: string; courseId: string }, tx: LearnerContentTx) {
  await evaluateCourseCompletionLocked(tx, input.userId, input.courseId);
}

/**
 * Idempotent reconciliation across ALL published courses for a user. Completion + certificate
 * issuance is event-driven (fired when the last module passes or the last section is read); if that
 * event was ever missed — data created before the logic existed, a dropped fire-and-forget, or a
 * completion path that didn't trigger it — a course can show "completed" in the progress view yet
 * have no certificate. This sweep, run when the user opens their certificates page, backfills any
 * completion whose gates (all modules passed + all sections read) are now satisfied.
 */
export async function reconcileCourseCompletionsForUser(userId: string) {
  const repo = createCourseRepository(prisma);

  const courses = await repo.findPublishedCourses();
  for (const course of courses) {
    // Per-course isolation: a single malformed course must never blank the user's entire
    // certificate list (or 500 the page that triggers this sweep). Backfill is best-effort.
    try {
      // #934 skive 5a-1: siden åpnes ofte, og det er sjelden noe å gjøre. Først en sjekk uten låser; bare et kurs der
      // det ser ut til å mangle et bevis, får en låst transaksjon, og der måles alt på nytt.
      if (!(await findCompletionToIssue(repo, userId, course))) continue;
      await runContentReadForLearner(userId, (tx) => evaluateCourseCompletionLocked(tx, userId, course.id));
    } catch (error) {
      // Noen skriver innhold: det gjelder alle kursene, og hvert av dem ville ventet sine 3 sekunder. Lista vises nå;
      // beviset kommer neste gang siden åpnes.
      if (error instanceof AppError && error.code === "content_busy") return;
      console.warn(
        `[course-completion] reconcile skipped course ${course.id} for user ${userId}:`,
        error,
      );
    }
  }
}
