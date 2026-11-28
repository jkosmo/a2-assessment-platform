import { prisma } from "../../db/prisma.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { DomainRuleError, NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { hasAnyRole, PARTICIPANTS } from "../../auth/roleSets.js";
import { classRepository, createClassRepository, SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "./classRepository.js";
import { isClassEntraLinkingEnabled } from "./classConfig.js";
import { addContentOwner } from "../content/contentOwnershipService.js";
import { findStartedOrCompletedPairs, pairKey } from "./learnerVisibility.js";
import { effectiveDeadline, type ClassDeadlineRow, type EffectiveDeadline } from "./effectiveDeadline.js";

// #645/CL-2: class (cohort) business logic — CRUD + membership + course assignment + dynamic
// membership evaluation. Course→class assignment is dynamic: a participant is assigned a course if
// they belong to an assigned class, evaluated at read time (never materialised to CourseEnrollment).

async function requireClass(classId: string) {
  const klass = await classRepository.findClassById(classId);
  if (!klass) throw new NotFoundError("Class", "class_not_found", "Class not found.");
  return klass;
}

/**
 * Produkteier 2026-11-08: «Man bør ikke kunne legge til folk i en arkivert klasse», og heller ikke tildele kurs til den.
 *
 * Klassen leses i SAMME transaksjon som skrivingen, og raden låses (`FOR SHARE`). En arkivering som kommer samtidig, er en
 * UPDATE på samme rad og venter derfor til denne transaksjonen er ferdig; en arkivering som kom først, sees her. Uten låsen
 * kunne klassen blitt arkivert mellom sjekken og skrivingen. (Fremmednøkkelen fra medlemsraden låser bare nøkkelen, ikke
 * `archivedAt`, så den er ikke nok.)
 *
 * Gjenoppretting (`restoreClass`) setter `archivedAt` tilbake til null, og da går det igjen.
 */
async function assertClassWritable(tx: DbTransactionClient, classId: string, action: "add_member" | "assign_course"): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`SELECT "archivedAt" FROM "Class" WHERE "id" = ${classId} FOR SHARE`;
  if (rows.length === 0) throw new NotFoundError("Class", "class_not_found", "Class not found.");
  if (rows[0].archivedAt) {
    throw new DomainRuleError(
      "class_archived",
      action === "add_member"
        ? "The class is archived. Restore it before adding participants."
        : "The class is archived. Restore it before assigning courses.",
      { action, classId },
    );
  }
}

/**
 * #688: et arkivert kurs kan ikke tildeles en klasse. #1166: lest og sjekket i tildelingens transaksjon, med kursets rad låst
 * (`FOR SHARE`). En arkivering (`archiveCourse`, en UPDATE på samme rad) som kommer samtidig, venter til tildelingen er ferdig;
 * en som kom først, sees her.
 */
async function assertCourseAssignable(tx: DbTransactionClient, courseId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`SELECT "archivedAt" FROM "Course" WHERE "id" = ${courseId} FOR SHARE`;
  if (rows.length === 0) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  if (rows[0].archivedAt) {
    throw new DomainRuleError("course_archived", "Cannot assign an archived course.");
  }
}

export async function createClass(input: { name: string; description?: string | null }, actorId: string | null) {
  const name = input.name?.trim();
  // ⚠️ #999: DENNE SKAL IKKE HA KODE — den er UNÅBAR fra API-et.
  //
  // Ruta validerer med Zod FØR tjenesten kalles, og Zod avviser dette tilfellet selv. Målt mot
  // stage 2026-09-10: svaret er `validation_error` med `issues`, som er riktig oppførsel etter
  // #996. Vakta her er en forsvarlig dublett for en framtidig andre kaller — ikke en beskjed noen
  // bruker får.
  //
  // En feilkode er et løfte om at klienten kan vise den på brukerens språk. Gir vi en kode til noe
  // som aldri når en klient, lyver koden om sin egen rekkevidde, og neste leser tror den er
  // brukervendt.
  if (!name) throw new ValidationError("Class name is required.");
  const created = await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const klass = await repo.createClass({ name, description: input.description ?? null });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: klass.id,
        action: auditActions.class.created,
        actorId: actorId ?? undefined,
        metadata: { classId: klass.id, name },
      },
      tx,
    );
    // #787 slice 4a: creator becomes sole initial owner.
    // #963: INNE i transaksjonen, som for modul, kurs og seksjon. Dette var det ene av fire stedene
    // som lå utenfor: klassen var alt lagret når eierraden ble skrevet, og feilet den, sto klassen
    // igjen som «unowned» — 403 mot skaperen selv, permanent, til en administrator grep inn.
    if (actorId) {
      await addContentOwner({ contentType: "CLASS", contentId: klass.id, ownerUserId: actorId, actorUserId: actorId }, tx);
    }
    return klass;
  });
  return created;
}

export async function archiveClass(classId: string, actorId: string | null) {
  const klass = await requireClass(classId);
  if (klass.isSystem) {
    // ⚠️ #999: samme regel som ved gjenoppretting under, men ULIK handling. Koden er felles og
    // handlingen følger som felt — ellers ville klienten trengt to koder for én regel, eller
    // mistet hvilken handling som ble avvist.
    throw new DomainRuleError(
      "system_class_immutable",
      "System classes cannot be archived.",
      { action: "archive" },
    );
  }
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    await repo.archiveClass(classId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.archived,
        actorId: actorId ?? undefined,
        metadata: { classId },
      },
      tx,
    );
  });
}

// #1046 D3: sletting for godt — bare av en klasse som alt er arkivert. Regelen er den samme som
// listene viser for modul, kurs og seksjon («Slett» finnes bare på arkiverte rader), men her er den
// også håndhevet på tjenersiden: `DELETE /:classId` arkiverte før, og en gammel klient som fortsatt
// sender DELETE for «Arkiver» skal få et avslag, ikke en sletting.
//
// #1166: «arkivert» sjekkes i slettetransaksjonen, etter at klassens rad er låst (`FOR UPDATE`), som `courseArchive.ts` gjør
// med kurset. Før ble klassen lest og sjekket før transaksjonen: en gjenoppretting som kom imellom, gjorde klassen aktiv, og
// slettingen gikk likevel. Nå venter slettingen på gjenopprettingen, og ser at klassen er aktiv.
export async function deleteClass(classId: string, actorId: string | null) {
  await runInTransaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ name: string; isSystem: boolean; archivedAt: Date | null }>>`SELECT "name", "isSystem", "archivedAt" FROM "Class" WHERE "id" = ${classId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError("Class", "class_not_found", "Class not found.");
    const klass = rows[0];
    if (klass.isSystem) {
      throw new DomainRuleError(
        "system_class_immutable",
        "System classes cannot be deleted.",
        { action: "delete" },
      );
    }
    if (!klass.archivedAt) {
      throw new DomainRuleError(
        "class_not_archived",
        "Archive the class before deleting it.",
        { action: "delete" },
      );
    }
    const repo = createClassRepository(tx);
    await repo.deleteClass(classId);
    // Eierradene har ingen fremmednøkkel til klassen (ContentOwner peker på innhold av fire typer),
    // så de må ryddes her — ellers blir de liggende som eierskap til noe som ikke finnes.
    await tx.contentOwner.deleteMany({ where: { contentType: "CLASS", contentId: classId } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.deleted,
        actorId: actorId ?? undefined,
        metadata: { classId, name: klass.name },
      },
      tx,
    );
  });
}

export async function restoreClass(classId: string, actorId: string | null) {
  const klass = await requireClass(classId);
  if (klass.isSystem) {
    throw new DomainRuleError(
      "system_class_immutable",
      "System classes are never archived.",
      { action: "restore" },
    );
  }
  if (!klass.archivedAt) return; // already active — idempotent no-op
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    await repo.restoreClass(classId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.restored,
        actorId: actorId ?? undefined,
        metadata: { classId },
      },
      tx,
    );
  });
}

// #1046 nivå to (2a): klassen har et skjema med Lagre — navn og beskrivelse endres her, ikke bare ved
// opprettelse. Medlemmer og kurstildelinger er operasjoner og går sine egne veier.
export async function getClass(classId: string) {
  return requireClass(classId);
}

export async function updateClass(
  classId: string,
  input: { name?: string; description?: string | null },
  actorId: string | null,
) {
  const klass = await requireClass(classId);
  if (klass.isSystem) {
    throw new DomainRuleError("system_class_immutable", "System classes cannot be edited.", { action: "update" });
  }
  const data: { name?: string; description?: string | null } = {};
  // Tomt navn stoppes av rutas Zod-skjema (min(1)) før tjenesten kalles — ingen egen vakt her (#999:
  // en kode uten klient som kan vise den, lover mer enn den holder).
  if (input.name !== undefined && input.name.trim()) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  const fields = Object.keys(data);
  if (fields.length === 0) return klass;
  return runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const updated = await repo.updateClass(classId, data);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.updated,
        actorId: actorId ?? undefined,
        metadata: { classId, fields },
      },
      tx,
    );
    return updated;
  });
}

export async function addMember(classId: string, userId: string, actorId: string | null) {
  const klass = await requireClass(classId);
  if (klass.isSystem || klass.kind !== "MANUAL") {
    throw new DomainRuleError(
      "system_class_immutable",
      "Members can only be managed on manual (non-system) classes.",
      { action: "manage_members" },
    );
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  // ⚠️ Id-en som felt: klienten skal kunne navngi HVEM som mangler uten å parse en setning.
  if (!user) throw new DomainRuleError("unknown_user", `Unknown user id: ${userId}.`, { userId });
  await runInTransaction(async (tx) => {
    await assertClassWritable(tx, classId, "add_member");
    const repo = createClassRepository(tx);
    await repo.addMember(classId, userId, actorId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.memberAdded,
        actorId: actorId ?? undefined,
        metadata: { classId, userId },
      },
      tx,
    );
  });
}

export async function removeMember(classId: string, userId: string, actorId: string | null) {
  await requireClass(classId);
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const result = await repo.removeMember(classId, userId);
    if (result.count > 0) {
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.class,
          entityId: classId,
          action: auditActions.class.memberRemoved,
          actorId: actorId ?? undefined,
          metadata: { classId, userId },
        },
        tx,
      );
    }
  });
}

export async function listClasses() {
  return classRepository.listClasses();
}

export async function listClassMembers(classId: string) {
  await requireClass(classId);
  const members = await classRepository.listMembers(classId);
  return members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, addedAt: m.addedAt.toISOString() }));
}

export async function listClassCourseAssignments(classId: string, locale: SupportedLocale) {
  await requireClass(classId);
  const rows = await classRepository.listCourseAssignmentsForClass(classId);
  return rows.map((r) => ({
    courseId: r.courseId,
    // #1038: serveren eier «hvilket språk viser vi» (#1027). Klasseskjermen tolket lagringsformatet
    // selv, med sin egen reservekjede (nb → en-GB → nn → første) — en annen enn serverens. Ingen søker
    // i tittelen på den skjermen, så variantene trenger ikke følge med som for køene.
    title: localizeContentText(locale, r.course.title) ?? r.course.title,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    // #967: en tildeling til et kurs deltakeren ikke kan aapne er ikke feil i seg selv — men den
    // forklarer hvorfor ingen i klassen beveger seg, og det skal ikke kreve detektivarbeid.
    coursePublished: r.course.publishedAt !== null,
    courseArchived: r.course.archivedAt !== null,
    // #1192: klasseskjermen varsler at en ny frist på et kurs i versjon 2 eller høyere krever den nye versjonen av den som har
    // kursbevis for en eldre.
    courseVersionMajor: r.course.versionMajor,
  }));
}

// #1142: tildelingen sender ingen e-post selv. Jobben i workeren ser det nye paret (person, kurs) i neste runde, og
// medlemmene får én samlet e-post om nye kurs et kvarter etter siste endring (courseAssignmentNotice.ts). Den gamle e-posten
// per kurs herfra (#684, fire-and-forget) er fjernet; jobben dekker også veiene den ikke så (nytt medlem, publisering).
//
// #1166: kursets arkivtilstand sjekkes i transaksjonen, etter at kursets rad er låst (`FOR SHARE`), slik klassen alt var
// (`assertClassWritable`). Før ble kurset lest før transaksjonen, og bare klassen ble låst: en arkivering av kurset som kom
// imellom, gjorde sjekken ugyldig, og tildelingen gikk til et arkivert kurs. Fremmednøkkelen fra tildelingen låser bare
// kursets nøkkel, og en arkivering endrer ikke nøkkelen; derfor den egne låsen. Låseorden: klassen, så kurset.
//
// ⚠️ Kursets EIERSKAP sjekkes ikke her, med vilje: se `CLASS_OWNER_ASSIGNS_ANY_COURSE` (adminClasses.ts).
export async function assignCourseToClass(courseId: string, classId: string, dueAt: Date | null, actorId: string | null) {
  await runInTransaction(async (tx) => {
    await assertClassWritable(tx, classId, "assign_course");
    await assertCourseAssignable(tx, courseId);
    const repo = createClassRepository(tx);
    await repo.assignCourseToClass(courseId, classId, dueAt, actorId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.courseAssigned,
        actorId: actorId ?? undefined,
        metadata: { classId, courseId },
      },
      tx,
    );
  });
}

export async function unassignCourseFromClass(courseId: string, classId: string, actorId: string | null) {
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const result = await repo.unassignCourseFromClass(courseId, classId);
    if (result.count > 0) {
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.class,
          entityId: classId,
          action: auditActions.class.courseUnassigned,
          actorId: actorId ?? undefined,
          metadata: { classId, courseId },
        },
        tx,
      );
    }
  });
}

export interface UserMembershipContext {
  userId: string;
  roles: string[];
  groupIds?: string[];
}

/**
 * The set of class ids a user belongs to, resolved dynamically:
 *  - the "Alle deltakere" system class if the user has the PARTICIPANT role,
 *  - every MANUAL class they are an explicit member of,
 *  - (only when `classEntraLinkingEnabled`) ENTRA classes whose group is in the user's token groups.
 *    ⚠️ #1017: denne grenen kan ikke treffe i dag — ingen kode oppretter ENTRA-klasser, og bryteren
 *    kan ikke slås på fra UI. Se classConfig.ts.
 */
export async function getUserClassIds(ctx: UserMembershipContext): Promise<Set<string>> {
  const ids = new Set<string>();
  // #962: går gjennom det delte oppslaget som alt annet. Merk at dette IKKE er en tilgangsvakt —
  // det er medlemskapsutledning: «er denne personen deltaker» avgjør om systemklassen gjelder.
  // Skillet er verdt å holde: en vakt nekter, dette utvider.
  if (hasAnyRole(ctx.roles, PARTICIPANTS)) ids.add(SYSTEM_ALL_PARTICIPANTS_CLASS_ID);

  const manual = await classRepository.findManualMembership(ctx.userId);
  for (const m of manual) ids.add(m.classId);

  if ((ctx.groupIds?.length ?? 0) > 0 && (await isClassEntraLinkingEnabled())) {
    const entraClasses = await prisma.class.findMany({
      where: { kind: "ENTRA", archivedAt: null, entraGroupId: { in: ctx.groupIds as string[] } },
      select: { id: true },
    });
    for (const c of entraClasses) ids.add(c.id);
  }
  return ids;
}

/**
 * course id → earliest (most urgent) due date, for the courses `userId` has from the classes in `classIds`.
 * ⚠️ DET ENE stedet som svarer på «hvilke kurs har deltakeren fra klasser». «Mine kurs» og `/enrollments`, kursdetaljen og
 * direkte adresse (`findCourseForParticipant`), seksjoner, modulgaten og diskusjonene går hit.
 *
 * Produkteier 2026-11-08: «Kurs fra arkiverte klasser som ikke er fullført eller påbegynt bør ikke vises i Mine kurs.»
 *   - Et kurs fra minst én AKTIV klasse er med, som før.
 *   - Et kurs deltakeren BARE har fra arkiverte klasser, er med bare når det er påbegynt eller fullført
 *     (`findStartedOrCompletedCourseIds`, under). Ellers er det borte, som om tildelingen ikke fantes.
 *   - OPEN-kurs og individuell tildeling avgjøres ikke her (`filterVisibleCourseIds`), og vises som før.
 * Fristen er den tidligste over de AKTIVE klassene som gir kurset. En arkivert klasse gir ikke frist (produkteier 2026-11-24,
 * #1192 punkt 3): arkiveringsdialogen lover at påminnelsene stopper, og fristen herfra står i «Mine kurs», `/enrollments` og den
 * ukentlige e-posten. Et påbegynt kurs bare fra arkiverte klasser er fortsatt med, men uten frist (`null`).
 *
 * Påminnelsene, kullstatus og kursrapporten hopper alt over arkiverte klasser (`classRepository`, `class: { archivedAt: null }`).
 * Kursrapporten tar i tillegg med alle som har levert, lest eller fullført, og det er den samme regelen som her.
 */
export async function getClassAssignedCourseDueDates(classIds: Set<string>, userId: string): Promise<Map<string, Date | null>> {
  const deadlines = await getClassAssignedCourseDeadlines(classIds, userId);
  return new Map([...deadlines].map(([courseId, deadline]) => [courseId, deadline.dueAt]));
}

/**
 * Som `getClassAssignedCourseDueDates`, med `dueSetAt` for fristen (#1192 punkt 2): kursene fra klasser, og fristen fra klassene
 * etter `effectiveDeadline` (tidligste fra aktive klasser; ved lik dato følger det seneste tidspunktet med).
 */
export async function getClassAssignedCourseDeadlines(classIds: Set<string>, userId: string): Promise<Map<string, EffectiveDeadline>> {
  if (classIds.size === 0) return new Map();
  const rows = await prisma.courseGroupAssignment.findMany({
    where: { classId: { in: [...classIds] } },
    select: { courseId: true, dueAt: true, dueSetAt: true, class: { select: { archivedAt: true } } },
  });
  const fromActiveClass = new Set(rows.filter((r) => r.class.archivedAt === null).map((r) => r.courseId));
  const onlyFromArchived = [...new Set(rows.map((r) => r.courseId))].filter((courseId) => !fromActiveClass.has(courseId));
  const keptFromArchived = await findStartedOrCompletedCourseIds(userId, onlyFromArchived);
  const byCourse = new Map<string, ClassDeadlineRow[]>();
  for (const r of rows) {
    if (!fromActiveClass.has(r.courseId) && !keptFromArchived.has(r.courseId)) continue;
    const list = byCourse.get(r.courseId) ?? [];
    list.push({ dueAt: r.dueAt, dueSetAt: r.dueSetAt, archived: r.class.archivedAt !== null });
    byCourse.set(r.courseId, list);
  }
  return new Map([...byCourse].map(([courseId, classes]) => [courseId, effectiveDeadline({ classes })]));
}

/**
 * Kursene i `courseIds` som deltakeren har påbegynt eller fullført (produkteier 2026-11-08, arkiverte klasser).
 *
 * «Påbegynt eller fullført» er det kursdetaljen allerede regner som fremdrift, minst én av:
 *   1. en lest seksjon i kurset (en rad i `CourseSectionRead` for kurset). #1156: bare en lesing gjort I kurset, ikke en som
 *      teller på tvers;
 *   2. en levert modul: en innlevering på en modul som ligger i kurset, uansett status. En bestått modul har alltid en
 *      innlevering, så «bestått modul» er med her;
 *   3. et kursbevis for kurset (`CourseCompletion`), uansett versjon: fullført;
 *   4. deltakelse i kursets diskusjoner: en tråd eller et svar deltakeren har skrevet, eller en tråd hen følger.
 * Med vilje litt videre enn kursdetaljens telling: en lesing teller her også når seksjonen er endret i en senere hovedversjon,
 * og en innlevering også når modulen er arkivert. Det deltakeren har gjort i kurset, skal ikke forsvinne fra «Mine kurs».
 *
 * ⚠️ Punkt 4 (QA-porten 2026-11-08): svarvarslene (`notifyNewReply`) går til alle som følger tråden, uten å spørre om tilgang.
 * Uten punkt 4 kunne en deltaker som fulgte en tråd, mistet kurset ved arkiveringen og likevel fått e-post med lenke til en
 * side som svarer 404. Med punkt 4 beholder hen kurset, og varselet stemmer.
 */
export async function findStartedOrCompletedCourseIds(userId: string, courseIds: string[]): Promise<Set<string>> {
  // #1156: regelen bor i `findStartedOrCompletedPairs` (learnerVisibility.ts), som også svarer for mange deltakere på én gang
  // (synligheten for lesinger gjort i et annet kurs). Bare lesinger gjort I kurset teller (produkteier 14.11.2026).
  const pairs = await findStartedOrCompletedPairs(prisma, [userId], courseIds);
  return new Set(courseIds.filter((courseId) => pairs.has(pairKey(userId, courseId))));
}
