// #1152 skive 4a-2 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Etter gjennomlesingen», punkt 1 og 2; doc/DECISIONS.md,
// «Hva som holder et arkivert kurs igjen fra sletting»): HVA SOM HOLDER ET ARKIVERT KURS IGJEN.
//
// Tre grunner, i denne rekkefølgen (den første som slår til, er svaret fra «Slett»; kaskadens forhåndsvisning viser alle):
//   1. Kursbevis (`course_has_completions`). For alltid.
//   2. Noen har fullført kravet uten kursbevis (`course_has_completed_without_certificate`). Utstedelsen hopper over arkiverte
//      kurs, så beviset kommer først når kurset er gjenopprettet og publisert. Sies før grunn 3: den går ikke bort av seg selv.
//      Kan kravet ikke gjenskapes (det ble tomt fordi elementene ble arkivert senere), er grunnen i stedet at noen har bestått eller
//      lest noe av det som falt ut (`course_requirement_unclear`, 2.169.0). Tvil gir «beholdes».
//   3. En besvarelse i en av kursets moduler venter på vurdering, manuell behandling eller anke (`course_has_pending_reviews`). Går
//      bort av seg selv når sakene er avgjort. ALLE modulene i kursets elementliste teller her, uansett `archivedAt` og merker
//      (QA-porten 4a): en delt modul som ble arkivert for seg ETTER kurset, faller ut av kravet over, men en sak på den kan likevel
//      være det som gjør en deltaker ferdig. Tvil gir «beholdes».
//
// KRAVET MÅLES SLIK DET VAR DA KURSET BLE ARKIVERT, med reglene fra utstedelsen (`findCompletionToIssue`,
// courseCompletionService.ts): beståtte per kurs med kravet til hovedversjon (`findModuleProgress`), lesinger etter regelen for
// kursets nåværende hovedversjon, og et kurs uten krav gjør ingen fullført. Ett unntak fra utstedelsen, med vilje: det som ble
// arkivert SAMMEN med kurset, teller (`findCourseRequirementAsArchived`).
//
// ⚠️ Ikke `findCourseInProgressParticipants` (contentLifecycle.ts): den ser bort fra arkiverte moduler og seksjoner, og fra 2.159.0
// er kursets egne elementer arkivert med kurset. Kravet ville krympet til de delte elementene, og den som bare har bestått en delt
// modul, ville sett fullført ut. Den teller også «Mine kurs»-steg for arkiveringsdialogen, som skal være uendret.
//
// LÅSENE: et vedtak (`runLearnerWrite`) tar bare deltakerlåsen, ikke innholdslåsen. Uten deltakerlåsene kunne et vedtak commite
// mellom to spørringer i målingen: beståtte lest før vedtaket, ventende saker etter, og kurset ville sett slettbart ut.
// `lockCourseDeleteLearners` tar dem for alle som har levert på en av kursets moduler (samme sett som grunn 3, som omfatter kravets),
// sortert, før noe er skrevet i revisjonssporet.
// Lesing, innlevering og utstedelse tar innholdslåsen delt, og venter på slettingen.
import { prisma } from "../../db/prisma.js";
import { lockLearnersInContentWrite, type ContentWriteTx } from "../../db/contentLock.js";
import { DomainRuleError, type AppError } from "../../errors/AppError.js";
import { deleteRequiresArchivedError } from "../content/archivedGuard.js";
import type { DeleteCheck } from "../content/deleteCheck.js";
import { countPendingReviewsOnModules, type LifecycleReader } from "./contentLifecycle.js";
import { createCourseRepository } from "./courseRepository.js";
import { findSectionReadCredit } from "./sectionReadCredit.js";

/**
 * Kravet slik det var da kurset ble arkivert. `uncertain`: kravet ble tomt fordi elementene ble arkivert senere; da kan det ikke
 * gjenskapes, og dette er elementene som falt ut (se `findCourseRequirementAsArchived`).
 */
export type CourseRequirementAsArchived = { moduleIds: string[]; sectionIds: string[]; uncertain?: { moduleIds: string[]; sectionIds: string[] } };

export type CourseDeleteBlockCode =
  | "course_has_completions"
  | "course_has_completed_without_certificate"
  | "course_requirement_unclear"
  | "course_has_pending_reviews";

/** Én grunn til å beholde kurset: koden, tallet (`details.count`), feilen «Slett» kaster og teksten kaskadens forhåndsvisning viser. */
export type CourseDeleteBlock = { code: CourseDeleteBlockCode; count: number; error: AppError; reason: string };

/**
 * Kravet slik det var da kurset ble arkivert, lest gjennom kursets to dører (`findCourseItemsForParticipant` og
 * `findAllCourseItems`).
 *   - Modul: med når den ikke er arkivert (som utstedelsen), eller når den ble arkivert SAMMEN med kurset
 *     (`archivedWithCourseId` = kurset). En modul arkivert for seg, før eller etter kurset, er ikke med (men se «et krav som har
 *     blitt tomt» under).
 *   - Seksjon: med når deltakeren kan lese den nå (som utstedelsen), eller når den ble arkivert sammen med kurset OG hadde en
 *     publisert versjon (`activeVersionIdBeforeArchive`). Arkiveringen nullstiller `activeVersionId`, så døra for deltakere alene
 *     ville latt alle seksjonene falle ut. En seksjon som aldri ble publisert, er ikke med.
 * Er det uklart om et element var påkrevd, er det ikke med: tvil gjør flere «fullført», og det beholder kurset.
 * Et kurs arkivert før 2.159.0 har elementene sine aktive; de telles med av seg selv.
 *
 * ⚠️ ET KRAV SOM HAR BLITT TOMT (Codex, byggenotatet for 4c, 18.11.2026; produkteier valgte A 21.11.2026). Regelen over snur når
 * ingenting er igjen: et tomt krav gjør ingen fullført, og kurset ville blitt slettet. Det skjer når kravets elementer er arkivert
 * ETTER kurset uten å følge det: en delt modul som fulgte et ANNET kurs inn i arkivet, eller et element arkivert for seg. Hva kurset
 * krevde, kan da ikke gjenskapes: `archivedAt` er siste arkivering, ikke tilstanden da kurset ble arkivert (QA-porten 2.169.0: en
 * seksjon som aldri ble publisert, kan også ha falt ut). Elementene som falt ut, står derfor i `uncertain`, ikke i kravet, og
 * vakta beholder kurset hvis noen har bestått eller lest noe av dem (`course_requirement_unclear`). Tvil gir «beholdes».
 */
export async function findCourseRequirementAsArchived(courseId: string, reader: LifecycleReader = prisma): Promise<CourseRequirementAsArchived> {
  const repo = createCourseRepository(reader);
  const [forParticipant, all, course] = await Promise.all([
    repo.findCourseItemsForParticipant(courseId),
    repo.findAllCourseItems(courseId),
    reader.course.findUnique({ where: { id: courseId }, select: { archivedAt: true } }),
  ]);
  const moduleIds = new Set<string>();
  const sectionIds = new Set<string>();
  for (const item of forParticipant) {
    if (item.itemType === "MODULE" && item.moduleId && item.required) moduleIds.add(item.moduleId);
    if (item.itemType === "SECTION" && item.sectionId) sectionIds.add(item.sectionId);
  }
  for (const item of all) {
    const module = item.itemType === "MODULE" ? item.module : null;
    if (module?.archivedAt && module.archivedWithCourseId === courseId) moduleIds.add(module.id);
    const section = item.itemType === "SECTION" ? item.section : null;
    if (section?.archivedAt && section.archivedWithCourseId === courseId && section.activeVersionIdBeforeArchive) sectionIds.add(section.id);
  }
  const courseArchivedAt = course?.archivedAt;
  if (moduleIds.size === 0 && sectionIds.size === 0 && courseArchivedAt) {
    // STRENGT etter kurset: det som fulgte kurset inn i arkivet, har kursets eget tidspunkt (`now` i courseArchive.ts gis til hvert
    // element), er alt vurdert over og står utenfor her. Også en seksjon som fulgte uten publisert versjon.
    const fellOutLater = (row: { archivedAt: Date | null } | null | undefined) =>
      Boolean(row?.archivedAt && row.archivedAt.getTime() > courseArchivedAt.getTime());
    const uncertainModules = new Set<string>();
    const uncertainSections = new Set<string>();
    for (const item of all) {
      if (item.itemType === "MODULE" && item.module && fellOutLater(item.module)) uncertainModules.add(item.module.id);
      if (item.itemType === "SECTION" && item.section && fellOutLater(item.section)) uncertainSections.add(item.section.id);
    }
    if (uncertainModules.size > 0 || uncertainSections.size > 0) {
      return { moduleIds: [], sectionIds: [], uncertain: { moduleIds: [...uncertainModules], sectionIds: [...uncertainSections] } };
    }
  }
  return { moduleIds: [...moduleIds], sectionIds: [...sectionIds] };
}

/**
 * #1152 (produkteier, A, 21.11.2026): kravet kunne ikke gjenskapes (`uncertain`). Deltakerne uten kursbevis som har bestått minst én
 * av modulene som falt ut, eller lest minst én av seksjonene. Har noen det, beholdes kurset. Tvil gir «beholdes».
 *
 * ⚠️ BEVISST UTEN UTSTEDELSENS REGLER (QA-porten 2.169.0, runde 2). Utstedelsen teller lesinger i et arkivert kurs bare fram til
 * arkiveringen, og bestått per kurs med kravet til hovedversjon. Her er kravet ukjent, og det kan bli målt igjen om kurset gjenopprettes:
 * en seksjon lest via et ANNET kurs etter at dette ble arkivert, kan da telle. Derfor teller enhver gyldig bestått (`ModulePass` uten
 * `invalidatedAt`) og enhver lesing (`CourseSectionRead`) av elementene, i hvilket som helst kurs og når som helst.
 */
export async function findProgressOnUncertainRequirement(
  courseId: string,
  uncertain: NonNullable<CourseRequirementAsArchived["uncertain"]>,
  reader: LifecycleReader = prisma,
): Promise<string[]> {
  const { moduleIds, sectionIds } = uncertain;
  const [course, passes, reads] = await Promise.all([
    reader.course.findUnique({ where: { id: courseId }, select: { versionMajor: true } }),
    moduleIds.length > 0
      ? reader.modulePass.findMany({ where: { moduleId: { in: [...moduleIds] }, invalidatedAt: null }, select: { userId: true }, distinct: ["userId"] })
      : Promise.resolve([]),
    sectionIds.length > 0
      ? reader.courseSectionRead.findMany({ where: { sectionId: { in: [...sectionIds] } }, select: { userId: true }, distinct: ["userId"] })
      : Promise.resolve([]),
  ]);
  if (!course) return [];
  const candidates = [...new Set([...passes, ...reads].map((row) => row.userId))];
  if (candidates.length === 0) return [];
  const certificates = await reader.courseCompletion.findMany({
    where: { courseId, versionMajor: course.versionMajor, userId: { in: candidates } },
    select: { userId: true, source: true },
  });
  const certified = new Set(certificates.filter((row) => row.source !== "external").map((row) => row.userId));
  return candidates.filter((userId) => !certified.has(userId));
}

/**
 * ALLE modulene i kursets elementliste, uansett `archivedAt` og merker (gjennom døra for alt, `findAllCourseItems`). Grunn 3 og
 * deltakerlåsene spør her. Omfatter kravets moduler.
 */
export async function findAllCourseModuleIds(courseId: string, reader: LifecycleReader = prisma): Promise<string[]> {
  const items = await createCourseRepository(reader).findAllCourseItems(courseId);
  return [...new Set(items.flatMap((item) => (item.itemType === "MODULE" && item.moduleId ? [item.moduleId] : [])))];
}

/** Alle som har levert på modulene: et vedtak kan bare gjelde dem. */
async function findSubmitters(moduleIds: readonly string[], reader: LifecycleReader): Promise<string[]> {
  if (moduleIds.length === 0) return [];
  const rows = await reader.submission.findMany({ where: { moduleId: { in: [...moduleIds] } }, select: { userId: true }, distinct: ["userId"] });
  return rows.map((row) => row.userId);
}

/**
 * Deltakerne som har oppfylt kravet uten kursbevis for kursets nåværende hovedversjon. Samme regel som utstedelsen: alle modulene
 * bestått for dette kurset, og alle seksjonene lest; et bevis registrert utenfor plattformen (`external`) ville blitt oppgradert,
 * så det teller ikke som bevis her. Et krav uten moduler og seksjoner gjør ingen fullført (utstedelsen: «never completable»).
 */
export async function findCompletedWithoutCertificate(
  courseId: string,
  requirement: CourseRequirementAsArchived,
  reader: LifecycleReader = prisma,
): Promise<string[]> {
  const { moduleIds, sectionIds } = requirement;
  if (moduleIds.length === 0 && sectionIds.length === 0) return [];
  // Kandidatene: den som har bestått en modul, har levert på den; den som har lest, har en lesing som teller her.
  // #1152 skive 4b: kurset og kandidatene leses samtidig (lista over arkiverte måler mange kurs).
  // #1156: lesinger fra alle kurs med seksjonene (`findSectionReadCredit`), mot ALLE kursets elementer (lista `all`: også
  // seksjoner arkivert sammen med kurset), avgrenset til kravet under. Et arkivert kurs teller bare lesinger fram til arkiveringen,
  // og en lesing gjort et annet sted bare når deltakeren ser kurset. Lesingene står når et kurs slettes; de tilhører seksjonen.
  const [course, submitters, readCredit] = await Promise.all([
    reader.course.findUnique({ where: { id: courseId }, select: { versionMajor: true } }),
    findSubmitters(moduleIds, reader),
    sectionIds.length > 0
      ? findSectionReadCredit(reader, { courseIds: [courseId], items: "all", onlySectionIds: sectionIds })
      : Promise.resolve(null),
  ]);
  if (!course) return [];
  const readsByUser = new Map<string, Set<string>>();
  for (const row of readCredit?.rows ?? []) {
    if (row.counts) readsByUser.set(row.userId, (readsByUser.get(row.userId) ?? new Set()).add(row.sectionId));
  }
  const candidates = [...new Set([...submitters, ...readsByUser.keys()])];
  if (candidates.length === 0) return [];

  const repo = createCourseRepository(reader);
  const [progress, certificates] = await Promise.all([
    repo.findModuleProgress({ userIds: candidates, courses: [{ courseId, moduleIds }] }),
    reader.courseCompletion.findMany({ where: { courseId, versionMajor: course.versionMajor, userId: { in: candidates } }, select: { userId: true, source: true } }),
  ]);
  const certified = new Set(certificates.filter((row) => row.source !== "external").map((row) => row.userId));

  return candidates.filter((userId) => {
    if (certified.has(userId)) return false;
    const passed = progress.passedModuleIds(userId, courseId);
    const read = readsByUser.get(userId) ?? new Set<string>();
    return moduleIds.every((id) => passed.has(id)) && sectionIds.every((id) => read.has(id));
  });
}

/**
 * Under innholdslåsen: deltakerlåsene for alle som har levert på en av kursets moduler (alle, ikke bare kravets: samme sett som
 * «venter på vurdering»), sortert, før noe skrives i revisjonssporet (`lockLearnersInContentWrite` stopper ellers). Kaskaden kaller
 * den først, så analysen og slettingen måler det samme.
 */
export async function lockCourseDeleteLearners(tx: ContentWriteTx, courseId: string): Promise<void> {
  await lockLearnersInContentWrite(tx, await findSubmitters(await findAllCourseModuleIds(courseId, tx), tx));
}

function completionsBlock(count: number): CourseDeleteBlock {
  return {
    code: "course_has_completions",
    count,
    // ⚠️ ANTALLET SOM FELT, ikke som interpolert prosa: klienten sier «3 kursbevis» på brukerens språk.
    error: new DomainRuleError(
      "course_has_completions",
      `Cannot delete a course that has ${count} completion${count === 1 ? "" : "s"} (issued certificates). The course stays archived and keeps the completion records.`,
      { count },
    ),
    reason: `Kurset har ${count} fullføring${count === 1 ? "" : "er"} (utstedte bevis). Det blir stående arkivert, med fullføringene.`,
  };
}

function completedWithoutCertificateBlock(count: number): CourseDeleteBlock {
  return {
    code: "course_has_completed_without_certificate",
    count,
    error: new DomainRuleError(
      "course_has_completed_without_certificate",
      `Cannot delete the course: ${count} participant${count === 1 ? " has" : "s have"} completed the requirement without a certificate. ` +
        `Restore and publish the course so they get the certificate.`,
      { count },
    ),
    reason:
      `${count === 1 ? "1 deltaker" : `${count} deltakere`} har fullført kravet uten kursbevis. ` +
      `Kurset må gjenopprettes og publiseres for at de skal få kursbeviset.`,
  };
}

function requirementUnclearBlock(count: number): CourseDeleteBlock {
  return {
    code: "course_requirement_unclear",
    count,
    error: new DomainRuleError(
      "course_requirement_unclear",
      `Cannot delete the course: it is unclear what it required when it was archived, and ${count} participant${count === 1 ? " has" : "s have"} ` +
        `passed or read part of it. The course stays archived.`,
      { count },
    ),
    reason:
      `Det er uklart hva kurset krevde da det ble arkivert, og ${count === 1 ? "1 deltaker" : `${count} deltakere`} har bestått eller lest ` +
      `noe av det. Kurset blir stående arkivert.`,
  };
}

function pendingReviewsBlock(count: number): CourseDeleteBlock {
  return {
    code: "course_has_pending_reviews",
    count,
    error: new DomainRuleError(
      "course_has_pending_reviews",
      `Cannot delete the course yet: ${count} submission${count === 1 ? "" : "s"} in its modules await${count === 1 ? "s" : ""} assessment, manual review or appeal. ` +
        `The course can be deleted when they are resolved.`,
      { count },
    ),
    reason:
      `${count === 1 ? "1 besvarelse" : `${count} besvarelser`} i kursets moduler venter på vurdering, manuell behandling eller anke. ` +
      `Kurset kan slettes når de er avgjort.`,
  };
}

/**
 * #1152 skive 4b: «kan kurset slettes?», ÉN utregning for «Slett» (`deleteCourseInTx`) og lista over arkiverte
 * (archivedRetention.ts). Leser kurset på nytt, krever at det er arkivert, og svarer med den første grunnen til å beholde det
 * (`measureCourseDeleteBlocks`). `beforeMeasure` kjøres mellom «arkivert» og målingen: slettingen tar deltakerlåsene der
 * (`lockCourseDeleteLearners`). Lista tar ingen lås; den viser et forslag, og slettingen måler på nytt under låsene.
 */
export async function checkCourseDelete(
  courseId: string,
  reader: LifecycleReader = prisma,
  options: { beforeMeasure?: () => Promise<void> } = {},
): Promise<DeleteCheck> {
  const course = await reader.course.findUnique({ where: { id: courseId }, select: { id: true, archivedAt: true } });
  if (!course) return { status: "not_found" };
  // #1151 (G4): bare et arkivert kurs kan slettes.
  if (!course.archivedAt) return { status: "blocked", error: deleteRequiresArchivedError({ type: "COURSE", id: courseId }) };
  await options.beforeMeasure?.();
  const [blocked] = await measureCourseDeleteBlocks(courseId, reader, { stopAtFirst: true });
  return blocked ? { status: "blocked", error: blocked.error } : { status: "deletable", archivedAt: course.archivedAt };
}

/**
 * Alle grunnene til å beholde kurset, i rekkefølgen over. Tom liste: kurset kan slettes. Leser bare; holder ingen lås.
 * «Slett» kaller den under innholdslåsen og etter `lockCourseDeleteLearners` (gjennom `checkCourseDelete`), og kaster den første.
 * Kaskaden viser alle.
 */
export async function measureCourseDeleteBlocks(
  courseId: string,
  reader: LifecycleReader = prisma,
  // #1152 skive 4b: «Slett» og lista over arkiverte bruker bare den første grunnen, og slipper å måle resten (planens punkt 9).
  options: { stopAtFirst?: boolean } = {},
): Promise<CourseDeleteBlock[]> {
  const blocks: CourseDeleteBlock[] = [];
  // #1152 skive 4b: det som ikke avhenger av hverandre, leses samtidig (lista over arkiverte måler mange kurs). Grunnene og
  // rekkefølgen er de samme.
  const [completions, requirement, allModuleIds] = await Promise.all([
    reader.courseCompletion.count({ where: { courseId } }),
    findCourseRequirementAsArchived(courseId, reader),
    // Alle kursets moduler, ikke bare kravets (se grunn 3 øverst).
    findAllCourseModuleIds(courseId, reader),
  ]);
  if (completions > 0) blocks.push(completionsBlock(completions));
  if (options.stopAtFirst && blocks.length > 0) return blocks;
  // Kravet kunne ikke gjenskapes (`uncertain`): da er kravet selv tomt, og «fullført» er ingen. I stedet teller fremgangen på det som
  // falt ut (A, 21.11.2026). Begge går ikke bort av seg selv, og sies før det som venter.
  const [completed, unclear, pending] = await Promise.all([
    findCompletedWithoutCertificate(courseId, requirement, reader),
    requirement.uncertain ? findProgressOnUncertainRequirement(courseId, requirement.uncertain, reader) : Promise.resolve([]),
    countPendingReviewsOnModules(allModuleIds, undefined, reader),
  ]);
  if (completed.length > 0) blocks.push(completedWithoutCertificateBlock(completed.length));
  if (unclear.length > 0) blocks.push(requirementUnclearBlock(unclear.length));
  if (options.stopAtFirst && blocks.length > 0) return blocks;
  if (pending > 0) blocks.push(pendingReviewsBlock(pending));
  return blocks;
}
