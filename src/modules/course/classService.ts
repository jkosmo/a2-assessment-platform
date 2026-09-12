import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { DomainRuleError, NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { recipientLocale } from "../../i18n/recipientLocale.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { hasAnyRole, PARTICIPANTS } from "../../auth/roleSets.js";
import { sendCourseAssignmentNotification } from "../certification/participantNotificationService.js";
import { classRepository, createClassRepository, SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "./classRepository.js";
import { isClassEntraLinkingEnabled } from "./classConfig.js";
import { addContentOwner } from "../content/contentOwnershipService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { isReachableParticipant } from "../user/participantReach.js";

// #645/CL-2: class (cohort) business logic — CRUD + membership + course assignment + dynamic
// membership evaluation. Course→class assignment is dynamic: a participant is assigned a course if
// they belong to an assigned class, evaluated at read time (never materialised to CourseEnrollment).

async function requireClass(classId: string) {
  const klass = await classRepository.findClassById(classId);
  if (!klass) throw new NotFoundError("Class", "class_not_found", "Class not found.");
  return klass;
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
export async function deleteClass(classId: string, actorId: string | null) {
  const klass = await requireClass(classId);
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
  await runInTransaction(async (tx) => {
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
  }));
}

export async function assignCourseToClass(courseId: string, classId: string, dueAt: Date | null, actorId: string | null) {
  const klass = await requireClass(classId);
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, archivedAt: true, publishedAt: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  // #688: archived courses are retired and must not be assignable to a class.
  if (course.archivedAt) {
    throw new DomainRuleError("course_archived", "Cannot assign an archived course.");
  }
  await runInTransaction(async (tx) => {
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

  // #684: email the members that their class was assigned a course. Skipped for the "Alle deltakere"
  // system class (would email the whole org) and for ENTRA classes (no stored member rows). Fire-and-
  // forget so the assignment is not blocked or failed by email delivery.
  //
  // #967: ⚠️ men ikke for et UPUBLISERT kurs. E-posten sier «Logg inn på plattformen for å starte»,
  // og medlemmet logger inn og finner ingenting — kurset er usynlig for deltakere til det
  // publiseres. Med #967 er påminnelsene dessuten stille, så denne e-posten ville vært det ENESTE
  // deltakeren noensinne hørte om kurset.
  //
  // Tildelingen blokkeres IKKE: «tildel utkast nå, publiser senere» er en legitim arbeidsflyt, og
  // #688 blokkerer allerede det som virkelig er feil (arkiverte kurs). Det er varselet som er
  // feiltimet, ikke tildelingen. Undertrykkelsen logges — en e-post som aldri kom er stille.
  if (klass.kind === "MANUAL" && !klass.isSystem) {
    if (course.publishedAt === null) {
      void suppressAssignmentMail(courseId, classId);
    } else {
      void notifyClassMembersOfCourseAssignment(classId, klass.name, course.title, dueAt);
    }
  }
}

async function suppressAssignmentMail(courseId: string, classId: string): Promise<void> {
  try {
    const members = await classRepository.listMembers(classId);
    logOperationalEvent(
      operationalEvents.course.assignmentMailSuppressed,
      {
        courseId,
        classId,
        recipientCount: members.filter((m) => m.user.email).length,
        reason: "unpublished",
      },
      "info",
    );
  } catch {
    /* en uteblitt logglinje skal aldri velte en tildeling som allerede er skrevet */
  }
}

// #900: avstand mellom tildelings-e-poster. 0 i test (env), ellers 300 ms — sju mottakere = ~2 s.
const ASSIGNMENT_EMAIL_SPACING_MS = process.env.NODE_ENV === "test" ? 0 : 300;

async function notifyClassMembersOfCourseAssignment(
  classId: string,
  className: string,
  courseTitleJson: string,
  dueAt: Date | null,
): Promise<void> {
  try {
    const members = await classRepository.listMembers(classId);
    const recipients = members
      // #968: ikke e-post til en som har sluttet eller er anonymisert — samme regel som publikummet
      // og påminnelsene. Før ble den bare filtrert på at adressen fantes.
      .filter((m) => m.user.email && isReachableParticipant(m.user));
    // #900: ÉN om gangen, med en pause mellom. Sju e-poster i samme sekund ble strupet av ACS
    // 13.08.2026 — alle sju tapt. Promise.allSettled her var årsaken; sekvensielt med pause holder oss
    // under grensen, og sendViaAcs prøver på nytt om ACS likevel struper. Kalleren venter ikke på
    // dette (void), så tiden koster ingen.
    for (const [index, m] of recipients.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, ASSIGNMENT_EMAIL_SPACING_MS));
      // #970: mottakerens språk («sist sett»), ikke bokmål for alle. Tittelen velges for samme språk.
      const locale = recipientLocale(m.user);
      try {
        await sendCourseAssignmentNotification({
          recipientEmail: m.user.email,
          recipientName: m.user.name,
          courseTitle: localizeContentText(locale, courseTitleJson) ?? courseTitleJson,
          className,
          dueAt,
          locale,
        });
      } catch {
        /* én feilet mottaker skal ikke stoppe de neste */
      }
    }
  } catch {
    /* never let notification failure surface — assignment already succeeded */
  }
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
 * course id → earliest (most urgent) due date, for the courses assigned to any of `classIds`.
 * Used by the visibility filter and "my enrollments" to surface class-assigned courses dynamically.
 */
export async function getClassAssignedCourseDueDates(classIds: Set<string>): Promise<Map<string, Date | null>> {
  if (classIds.size === 0) return new Map();
  const rows = await prisma.courseGroupAssignment.findMany({
    where: { classId: { in: [...classIds] } },
    select: { courseId: true, dueAt: true },
  });
  const map = new Map<string, Date | null>();
  for (const r of rows) {
    if (!map.has(r.courseId)) {
      map.set(r.courseId, r.dueAt);
    } else {
      const existing = map.get(r.courseId) ?? null;
      if (r.dueAt && (!existing || r.dueAt < existing)) map.set(r.courseId, r.dueAt);
    }
  }
  return map;
}
