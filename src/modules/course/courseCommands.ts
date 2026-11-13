import { prisma } from "../../db/prisma.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { runContentWrite, type ContentWriteTx } from "../../db/contentLock.js";
import { ConflictError, DomainRuleError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes, agentAuthoringAuditMetadata, type AgentAuthoringContext } from "../../observability/auditEvents.js";
import { clearArchiveMarksForCourse } from "./courseArchive.js";
import { assertNotArchived, deleteRequiresArchivedError } from "../content/archivedGuard.js";
import { addContentOwner } from "../content/contentOwnershipService.js";
import { setCourseThemes } from "./courseThemeService.js";
import { assignCourseSlugIfMissing } from "./courseSlug.js";
import { applyCourseVersionChange, claimCourseRevision, isCourseEverPublished, NO_SECTION_SNAPSHOT, sameLocalizedText, type CourseVersionBump, type CourseVersionChoice, type CourseVersionRequest } from "./courseVersioning.js";

/**
 * #934 skive 4a: hvordan en lagring av kursets elementer forholder seg til telleren (`Course.contentRevision`).
 *   - `expected`: tallet skjemaet lastet. Er det endret, `409 course_changed`.
 *   - `requireUnlessDraft`: uten `expected` godtas lagringen bare for et kurs som aldri har vært ute (agent-tokenet,
 *     og et nytt kurs fra skjemaet). Ellers er det en gammel fane, og den avvises før noe skrives
 *     (`409 course_form_outdated`). Sjekkes etter innholdslåsen: et kurs kan bli publisert mens kallet venter.
 *   - utelatt (importen): telleren øker bare.
 */
export type CourseRevisionCheck = { expected?: number; requireUnlessDraft?: boolean };

export function courseFormOutdatedError() {
  return new ConflictError(
    "course_form_outdated",
    "This course form is from an older version of the platform. Reload the page and make your change again; nothing was saved.",
  );
}

async function claimRevisionForItemWrite(client: ContentWriteTx, courseId: string, revision?: CourseRevisionCheck) {
  // #1151: før sjekken av gammel fane, så et arkivert kurs svarer «arkivert» (et kurs som har vært ute, har delingslenke).
  await assertNotArchived(client, { type: "COURSE", id: courseId });
  if (revision?.expected === undefined && revision?.requireUnlessDraft && (await isCourseEverPublished(client, courseId))) {
    throw courseFormOutdatedError();
  }
  await claimCourseRevision(client, courseId, revision?.expected);
}
import { createCourseRepository } from "./courseRepository.js";
import { syncModuleRequirements } from "../adminContent/moduleVersioning.js";

// #934 skive 3: kursets innhold er rekkefølgen av moduler og seksjoner. Diskusjonsbryteren per element er
// ikke innhold — å slå den av eller på gir ingen ny versjon.
function itemSequenceKey(rows: Array<{ itemType: string; moduleId: string | null; sectionId: string | null }>) {
  return rows.map((r) => `${r.itemType}:${r.itemType === "MODULE" ? r.moduleId : r.sectionId}`).join("|");
}

// #938/#992: inngangsdøra til «arkivert innhold i et kurs» — ÉN gang, for alle innganger.
//
// Sjekken var «finnes elementet?», ikke «kan det brukes?». G2 (`contentLifecycle.ts`) nekter å
// arkivere innhold som ligger i et kurs, så den ene veien inn var stengt. Den andre sto åpen:
// allerede arkivert innhold kunne LEGGES INN. Det er slik «Samfunnsvitere» på stage fikk en
// arkivert modul som blokkerte fullføring for alltid.
//
// ⚠️ Vakta lå i `setCourseItems` alene. QA-porten fant at `setCourseModules` — legacy-inngangen bak
// `PUT /api/admin/content/courses/:courseId/modules` — skriver de samme radene UTEN den. Altså
// nøyaktig feilklassen #938 handler om, i #938 sin egen fiks: to steder som svarer ulikt på samme
// spørsmål. Derfor er den nå en delt funksjon begge kaller, ikke en kopiert blokk.
//
// `test/course-archive-entry-guard.test.js` nekter nye skrivere som ikke kaller den.
//
// Produkteier 2026-08-21: «Det er ingen legitim grunn til at arkiverte objekter skal bli i et kurs.»
export async function assertContentUsableInCourse(
  reader: DbTransactionClient | typeof prisma,
  ids: { moduleIds?: string[]; sectionIds?: string[] },
) {
  const moduleIds = ids.moduleIds ?? [];
  const sectionIds = ids.sectionIds ?? [];
  if (moduleIds.length > 0) {
    const usable = await reader.module.count({ where: { id: { in: moduleIds }, archivedAt: null } });
    if (usable !== moduleIds.length) {
      const found = await reader.module.count({ where: { id: { in: moduleIds } } });
      // ⚠️ To feil som MÅ kunne skilles. «Finnes ikke» om noe som finnes er en løgn, og forfatteren
      // mister informasjonen om hva hen skal gjøre — det var uklare feilmeldinger som ga oss #937.
      // ⚠️ #999: skillet ligger nå i KODEN, ikke bare i setningen. Kommentaren over verner om at
      // «finnes ikke» og «er arkivert» må kunne skilles — med to koder kan klienten faktisk skille
      // dem på brukerens språk, i stedet for å vise serverens engelske setning ordrett.
      throw found === moduleIds.length
        ? new DomainRuleError(
            "course_item_archived",
            "One or more modules are archived and cannot be added to a course.",
            { itemType: "MODULE" },
          )
        : new DomainRuleError(
            "course_item_not_found",
            "One or more modules do not exist.",
            { itemType: "MODULE" },
          );
    }
  }
  if (sectionIds.length > 0) {
    const usable = await reader.courseSection.count({ where: { id: { in: sectionIds }, archivedAt: null } });
    if (usable !== sectionIds.length) {
      const found = await reader.courseSection.count({ where: { id: { in: sectionIds } } });
      throw found === sectionIds.length
        ? new DomainRuleError(
            "course_item_archived",
            "One or more sections are archived and cannot be added to a course.",
            { itemType: "SECTION" },
          )
        : new DomainRuleError(
            "course_item_not_found",
            "One or more sections do not exist.",
            { itemType: "SECTION" },
          );
    }
  }
}

export async function createCourse(input: {
  title: string;
  description?: string | null;
  certificationLevel?: string | null;
  enrollmentPolicy?: "OPEN" | "RESTRICTED";
  discussionsEnabled?: boolean;
  discussionOwnerNotifications?: boolean;
  /** #1093: plassering i «Mine kurs»; null eller utelatt = alfabetisk. */
  sortOrder?: number | null;
  /** 2.102.0: kursets tema i «Mine kurs». Utelatt = ingen. */
  themeIds?: string[];
  actorId?: string;
  // AA-5 (#653): agent-orchestrated creates carry a trace in the audit metadata.
  agent?: AgentAuthoringContext;
}, tx?: ContentWriteTx) {
  // #803: create + its audit commit atomically.
  const run = async (client: ContentWriteTx) => {
    const created = await client.course.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        certificationLevel: input.certificationLevel ?? null,
        ...(input.enrollmentPolicy ? { enrollmentPolicy: input.enrollmentPolicy } : {}),
        ...(input.discussionsEnabled !== undefined ? { discussionsEnabled: input.discussionsEnabled } : {}),
        ...(input.discussionOwnerNotifications !== undefined ? { discussionOwnerNotifications: input.discussionOwnerNotifications } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    if (input.themeIds && input.themeIds.length > 0) await setCourseThemes(client, created.id, input.themeIds);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: created.id,
        action: auditActions.course.created,
        actorId: input.actorId,
        metadata: { courseId: created.id, ...agentAuthoringAuditMetadata(input.agent) },
      },
      client,
    );
    // #787 slice 4a: the creator becomes the sole initial owner (Q3 decision). Inert until enforcement
    // (slice 4b) — this only populates ContentOwner so creators aren't locked out once guards land.
    // Idempotent + audited. Skipped when there's no actor (system/seed creation stays admin-managed).
    if (input.actorId) {
      await addContentOwner({ contentType: "COURSE", contentId: created.id, ownerUserId: input.actorId, actorUserId: input.actorId }, client);
    }
    return created;
  };

  return tx ? run(tx) : runContentWrite(run);
}

export async function updateCourse(
  courseId: string,
  input: {
    title?: string;
    description?: string | null;
    certificationLevel?: string | null;
    enrollmentPolicy?: "OPEN" | "RESTRICTED";
    discussionsEnabled?: boolean;
    discussionOwnerNotifications?: boolean;
    sortOrder?: number | null;
    /** 2.102.0: satt = kursets tema blir nøyaktig disse; utelatt = urørt. */
    themeIds?: string[];
  },
  actorId?: string,
  // #934 skive 3: kursskjemaet lagrer navnet og innholdet i ÉN lagring. Med `items` skrives innholdet i samme
  // transaksjon, med forfatterens svar (`version`), og serveren avgjør versjonen én gang: endret innhold gir
  // forfatterens svar; bare navn eller beskrivelse endret gir mindre. Ingen klient kan slå økningen av.
  // #934 skive 4a: `expectedRevision` er telleren skjemaet lastet. Er den endret siden, har noen andre lagret
  // kurset: `409 course_changed`, og ingenting er skrevet. Rutene krever den (en gammel fane sender den ikke).
  // #934 skive 4b: `confirmEmailRecipients` — tallet dialogen viste da forfatteren sa ja til e-post til mange
  // (se `applyCourseVersionChange`).
  // #1140 etappe 2: `publishingDraft` settes bare når utkastet til kurset publiseres (`publishCourseDraft`, courseDraft.ts).
  // Da skrives utkastet til kurset med denne funksjonen, og låsen som utkastet selv gir, gjelder ikke.
  options?: { items?: CourseItemInput[]; version?: CourseVersionChoice; expectedRevision?: number; confirmEmailRecipients?: number; publishingDraft?: boolean },
  // #1140 etappe 2: publiseringen av utkastet holder alt innholdslåsen og sender transaksjonen sin, som `setCourseItems`.
  lockedTx?: ContentWriteTx,
) {
  // #805: a course-metadata edit is a state change and must leave a trail. Record which fields changed.
  // #803: update + audit commit atomically.
  // #934 skive 4a: innholdslåsen først; telleren og alt annet sjekkes etter den, før noe skrives.
  const run = async (tx: ContentWriteTx) => {
    const { themeIds, ...fields } = input;
    const previous = await tx.course.findUnique({ where: { id: courseId }, select: { title: true, description: true } });
    if (!previous) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    await claimCourseRevision(tx, courseId, options?.expectedRevision, { publishingDraft: options?.publishingDraft });
    let course = await tx.course.update({ where: { id: courseId }, data: fields });
    const itemsBump = options?.items
      ? await writeCourseItems(tx, courseId, options.items, {
          actorId,
          versionRequest: { kind: "question", answer: options.version, confirmEmailRecipients: options.confirmEmailRecipients },
        })
      : null;
    // #934 skive 3: navn eller beskrivelse endret på et kurs som har vært ute er en mindre versjon
    // (produkteier 2026-11-01: «endrer ikke kravet»). Ingen spørsmål — og ingen ekstra økning når innholdet
    // i samme lagring allerede ga versjonen. Nivå, tilgang, diskusjon, plassering og tema er innstillinger,
    // ikke innhold, og gir ingen ny versjon.
    const textChanged =
      ((fields.title !== undefined && !sameLocalizedText(fields.title, previous.title)) ||
        (fields.description !== undefined && !sameLocalizedText(fields.description, previous.description)));
    const textBump = textChanged && !itemsBump ? await applyCourseVersionChange(tx, courseId, { kind: "minor" }, NO_SECTION_SNAPSHOT, actorId) : null;
    // Svaret skal vise versjonen etter økningen, ikke raden fra før den.
    if (itemsBump || textBump) course = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
    if (themeIds !== undefined) await setCourseThemes(tx, courseId, themeIds);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.updated,
        actorId,
        metadata: {
          courseId,
          changedFields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
        },
      },
      tx,
    );
    return course;
  };
  return lockedTx ? run(lockedTx) : runContentWrite(run);
}

// #934 skive 4a: `publishCourse` publiserer bare kursraden. Ruta og kaskaden kaller den inne i
// `publishCourseChecked`/`publishCourseCascade` (coursePublishService.ts), som ser etter upubliserte elementer
// ETTER innholdslåsen. Importen kaller den med sin egen låste transaksjon.
export async function publishCourse(courseId: string, actorId: string | undefined, tx: ContentWriteTx) {
  // #796: sjekken kjører på tx-klienten når en import komponeres, så den ser kurselementene som ble
  // laget tidligere i SAMME transaksjon.
  //
  // ⚠️ #1001: kravet er «minst ett ELEMENT», ikke «minst én modul».
  //
  // Regelen ga mening da et kurs var en beholder for moduler. Etter #916 er seksjoner likeverdige
  // kurselementer med sin egen publiseringsgate, og da ble «minst én modul» vilkårlig: et kurs som
  // bare består av lesestoff kunne ikke publiseres, uansett hvor mange publiserte seksjoner det
  // hadde.
  //
  // Produkteier 2026-08-24: «jeg tviler på at rene seksjonskurs vil trengs, men det krever
  // kompleksitet å aktivt hindre det samt at vi ville måtte forklare brukere begrensningen som
  // også krever mer.» Beslutningen er altså ikke at rene lesekurs er ØNSKET, men at det koster
  // mer å hindre dem enn å tillate dem.
  //
  // ⚠️ PORTEN FJERNES IKKE. Null elementer avvises fortsatt — det var reell beskyttelse mot å
  // publisere et tomt skall, ikke vilkårlighet. Det eneste som faller bort er filteret på
  // `itemType`.
  //
  // To steder i kodebasen behandlet allerede rene lesekurs som normale: rapportlaget regner ut
  // fullføringsgrad for dem (#969), og #916 måtte legge inn en dummy-modul i fiksturet sitt for å
  // komme forbi denne porten.
  const course = await tx.course.findUnique({
    where: { id: courseId },
    include: { _count: { select: { items: true } } },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  // #1151: et arkivert kurs publiseres ikke («arkivert og publisert» skal aldri finnes, I3). Gjenopprett først.
  await assertNotArchived(tx, { type: "COURSE", id: courseId });
  if (course._count.items === 0) {
    // ⚠️ EGEN KODE, ikke bare en setning (#972/#999). `ValidationError` gir `validation_error`
    // uten `issues`, og da viser `api-error.js` serverens `message` ordrett — altså denne engelske
    // setningen midt i et norsk grensesnitt. Med en kode treffer den den delte oversetteren.
    throw new DomainRuleError(
      "course_has_no_items",
      "Cannot publish a course with no items. Add at least one module or section first.",
    );
  }

  // #803: publish + audit commit atomically.
  await tx.course.update({
    where: { id: courseId },
    data: { publishedAt: new Date() },
  });
  // 2.121.0: delingslenka settes første gang kurset publiseres, og står fast etterpå.
  await assignCourseSlugIfMissing(tx, courseId);
  const updated = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
  await recordAuditEvent(
    {
      entityType: auditEntityTypes.course,
      entityId: courseId,
      action: auditActions.course.published,
      actorId,
      metadata: { courseId },
    },
    tx,
  );
  return updated;
}

// #705: avpubliser et kurs (motstykke til publishCourse). Symmetri med modul/seksjon.
// Bevisst UTEN G3-lås: avpublisering er reversibel (republiser når som helst) og er den «myke»
// måten å ta et kurs ned på mens noen er midt i det. Den harde G3-låsen gjelder kun arkivering
// (som er pensjonering). Frontend bekrefter avpublisering med en advarsel.
export async function unpublishCourse(courseId: string, actorId?: string) {
  // #803: unpublish + audit commit atomically. #934 skive 4a: innholdslåsen først, så sjekken.
  return runContentWrite(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    // #1151: et arkivert kurs er alt avpublisert (I3); en avpublisering ville bare skrevet en hendelse som ikke er sann.
    await assertNotArchived(tx, { type: "COURSE", id: courseId });
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { publishedAt: null },
    });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.unpublished,
        actorId,
        metadata: { courseId },
      },
      tx,
    );
    return updated;
  });
}

// #1150 skive 2a-2: `archiveCourse` og `restoreCourse` bor i courseArchive.ts. Arkiveringen tar innholdet med seg, og
// gjenopprettingen setter det tilbake; begge i én transaksjon under innholdslåsen.

export async function deleteCourse(courseId: string, actorId?: string) {
  // #803: delete + audit commit atomically. #934 skive 4a: innholdslåsen først, så sjekkene.
  await runContentWrite(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true, archivedAt: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    // #1151 (G4): bare et arkivert kurs kan slettes. Før sto regelen bare i klienten.
    if (!course.archivedAt) throw deleteRequiresArchivedError({ type: "COURSE", id: courseId });

    // #660: CourseCompletion.course is onDelete: Restrict (issued certificates are achievement
    // records we never silently destroy). Without this guard, course.delete fails with a raw FK
    // violation and the route surfaces a generic 500. Block with a clear message.
    // #1151: kurset er alt arkivert her, så rådet «arkiver i stedet» er borte. Det blir stående arkivert, med kursbevisene.
    const completionCount = await tx.courseCompletion.count({ where: { courseId } });
    if (completionCount > 0) {
      // ⚠️ ANTALLET SOM FELT, ikke som interpolert prosa — klienten skal kunne si «3 kursbevis» på
      // brukerens språk uten å lese tallet ut av en engelsk setning.
      throw new DomainRuleError(
        "course_has_completions",
        `Cannot delete a course that has ${completionCount} completion${completionCount === 1 ? "" : "s"} ` +
          `(issued certificates). The course stays archived and keeps the completion records.`,
        { count: completionCount },
      );
    }

    // #1150 skive 2a-2: elementer som fulgte kurset inn i arkivet, peker på det. Merket er et merke, ikke et eierskap: det
    // nullstilles, og elementene blir stående arkivert.
    await clearArchiveMarksForCourse(tx, courseId);
    await tx.course.delete({ where: { id: courseId } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        // #705: a delete is a delete — was previously mislogged as `archived`.
        action: auditActions.course.deleted,
        actorId,
        metadata: { courseId },
      },
      tx,
    );
  });
}

export type CourseItemInput =
  | { type: "MODULE"; moduleId: string; discussionsEnabled?: boolean }
  | { type: "SECTION"; sectionId: string; discussionsEnabled?: boolean };

// Sets the full ordered sequence of a course's items — modules and learning
// sections interleaved (#486/B2). sortOrder follows array position. During the
// expand-contract transition this also re-syncs CourseModule from the MODULE
// items so the not-yet-cut-over read paths stay correct.
export async function setCourseItems(
  courseId: string,
  items: CourseItemInput[],
  // AA-5 (#653): audited write; agent runs stamp source/agentRunId into the metadata.
  // #934 skive 3: hvordan endringen spør om versjonen (courseVersioning.ts). Utelatt = spørsmålet uten svar:
  // avvises når noen har kursbevis og innholdet er endret (`course_version_required`).
  // #934 skive 4a: `revision` — se `CourseRevisionCheck`. Telleren økes alltid; utelatt (importen) gjør bare det.
  options?: { actorId?: string; agent?: AgentAuthoringContext; versionRequest?: CourseVersionRequest; revision?: CourseRevisionCheck },
  tx?: ContentWriteTx,
): Promise<CourseVersionBump | null> {
  // #796: when composing an import, existence checks must run on the tx client so they see the course,
  // modules, and sections created earlier in the SAME transaction.
  // #934 skive 4a: ALT sjekkes etter innholdslåsen, i samme transaksjon som skrivingen. Sjekket før, kunne en
  // modul bli arkivert mellom sjekken og innleggingen (Codex runde 1 nr. 2).
  const run = async (client: ContentWriteTx) => {
    const course = await client.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    await claimRevisionForItemWrite(client, courseId, options?.revision);
    return writeCourseItems(client, courseId, items, options);
  };
  return tx ? run(tx) : runContentWrite(run);
}

/** Et element kan bare stå én gang i et kurs. Gir id-ene tilbake, delt på type. */
function assertNoDuplicateCourseItems(items: CourseItemInput[]): { moduleIds: string[]; sectionIds: string[] } {
  const moduleIds = items.flatMap((i) => (i.type === "MODULE" ? [i.moduleId] : []));
  const sectionIds = items.flatMap((i) => (i.type === "SECTION" ? [i.sectionId] : []));
  if (new Set(moduleIds).size !== moduleIds.length) {
    throw new DomainRuleError(
      "course_duplicate_item",
      "A module may appear only once in a course.",
      { itemType: "MODULE" },
    );
  }
  if (new Set(sectionIds).size !== sectionIds.length) {
    throw new DomainRuleError(
      "course_duplicate_item",
      "A section may appear only once in a course.",
      { itemType: "SECTION" },
    );
  }
  return { moduleIds, sectionIds };
}

/**
 * #1140 etappe 2: de to sjekkene lagringen av et kurs gjør av lista (ingen dobbel, ingenting arkivert eller borte), uten å
 * skrive. Utkastet til et kurs kaller den ved lagring, så feilen kommer da og ikke først når utkastet publiseres.
 */
export async function assertCourseItemsUsable(reader: DbTransactionClient | typeof prisma, items: CourseItemInput[]) {
  await assertContentUsableInCourse(reader, assertNoDuplicateCourseItems(items));
}

/**
 * Skriver kursets elementer og avgjør versjonen. Kalles bare med låst klient, etter at telleren er tatt
 * (`setCourseItems`, og `updateCourse` som tar telleren selv).
 */
async function writeCourseItems(
  client: ContentWriteTx,
  courseId: string,
  items: CourseItemInput[],
  options?: { actorId?: string; agent?: AgentAuthoringContext; versionRequest?: CourseVersionRequest },
): Promise<CourseVersionBump | null> {
  const { moduleIds, sectionIds } = assertNoDuplicateCourseItems(items);
  await assertContentUsableInCourse(client, { moduleIds, sectionIds });

  // #502: CourseItem er eneste sannhetskilde — ingen dual-write til CourseModule lenger.
  {
    // #934 skive 3: det som gjaldt FØR endringen, lest i samme transaksjon som den skrives. Er kurset
    // publisert og innholdet endret, øker versjonen her — med seksjonsversjonene fra før som øyeblikksbilde.
    const repo = createCourseRepository(client);
    const previous = await repo.findAllCourseItems(courseId);
    const snapshot = await repo.snapshotContent(courseId);
    await client.courseItem.deleteMany({ where: { courseId } });
    if (items.length > 0) {
      await client.courseItem.createMany({
        data: items.map((item, index) => ({
          courseId,
          sortOrder: index,
          itemType: item.type,
          moduleId: item.type === "MODULE" ? item.moduleId : null,
          sectionId: item.type === "SECTION" ? item.sectionId : null,
          // #495/T-QA-4: per-element diskusjons-toggle. Editoren sender full ønsket tilstand;
          // default true når feltet ikke er med (bakoverkompatibelt).
          discussionsEnabled: item.discussionsEnabled ?? true,
        })),
      });
    }
    // #934 skive 5a-2: krav for nye moduler, sletting for dem som er tatt ut, i samme transaksjon som elementene.
    await syncModuleRequirements(client, courseId);
    await client.course.update({ where: { id: courseId }, data: { updatedAt: new Date() } });
    // #803: itemsUpdated audit commits atomically with the item rewrite.
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.itemsUpdated,
        actorId: options?.actorId,
        metadata: { courseId, itemCount: items.length, ...agentAuthoringAuditMetadata(options?.agent) },
      },
      client,
    );
    const next = items.map((item) => ({
      itemType: item.type,
      moduleId: item.type === "MODULE" ? item.moduleId : null,
      sectionId: item.type === "SECTION" ? item.sectionId : null,
    }));
    if (itemSequenceKey(previous) === itemSequenceKey(next)) return null;
    return applyCourseVersionChange(client, courseId, options?.versionRequest ?? { kind: "question" }, snapshot, options?.actorId);
  }
}

// Legacy modules-only setter (import + admin PUT /modules). #502: skriver nå CourseItem MODULE-
// elementer i stedet for CourseModule. Erstatter modul-elementene; eventuelle SECTION-elementer
// bevares (re-indekseres etter modulene for stabil sortOrder).
export async function setCourseModules(
  courseId: string,
  modules: Array<{ moduleId: string; sortOrder: number }>,
  tx?: ContentWriteTx,
  // #934 skive 3: hvem endringen gjelder, til revisjonssporet for versjonsøkningen.
  actorId?: string,
  // #934 skive 3: hvordan endringen spør. Utelatt = mindre (legacy-ruta har ingen dialog); importen som
  // bytter ut alt sender spørsmålet med forfatterens svar.
  versionRequest?: CourseVersionRequest,
  // #934 skive 4a: som `setCourseItems`. Legacy-ruta krever telleren, unntatt for et kurs som aldri har vært ute.
  revision?: CourseRevisionCheck,
) {
  const run = async (client: ContentWriteTx) => {
    const course = await client.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    await claimRevisionForItemWrite(client, courseId, revision);
    // #992: samme dør som `setCourseItems`. Denne ruta er dokumentert som legacy, men den er ikke
    // stengt — importklienter og `PUT /api/admin/content/courses/:id/modules` bruker den — og uten
    // vakta kunne den gjenskape den ugyldige tilstanden #938 skulle gjøre uoppnåelig.
    // #934 skive 4a: etter innholdslåsen, i samme transaksjon som skrivingen.
    await assertContentUsableInCourse(client, { moduleIds: modules.map((m) => m.moduleId) });
    // #934 skive 3: samme regel som `setCourseItems` — denne inngangen har ingen dialog, så en endring av
    // et publisert kurs blir en mindre versjon.
    const repo = createCourseRepository(client);
    const previous = await repo.findAllCourseItems(courseId);
    const snapshot = await repo.snapshotContent(courseId);
    const sections = await client.courseItem.findMany({
      where: { courseId, itemType: "SECTION" },
      orderBy: { sortOrder: "asc" },
      select: { sectionId: true, discussionsEnabled: true },
    });
    await client.courseItem.deleteMany({ where: { courseId } });
    // Bevar den passerte sortOrder for moduler (uendret kontrakt fra før #502); seksjoner legges
    // etter høyeste modul-sortOrder så de overlever en modul-re-set.
    const moduleRows = modules.map((m) => ({
      courseId,
      itemType: "MODULE" as const,
      moduleId: m.moduleId,
      sortOrder: m.sortOrder,
    }));
    const maxModuleOrder = moduleRows.reduce((max, r) => Math.max(max, r.sortOrder), -1);
    const sectionRows = sections.map((s, i) => ({
      courseId,
      itemType: "SECTION" as const,
      sectionId: s.sectionId,
      sortOrder: maxModuleOrder + 1 + i,
      discussionsEnabled: s.discussionsEnabled,
    }));
    if (moduleRows.length + sectionRows.length > 0) {
      await client.courseItem.createMany({ data: [...moduleRows, ...sectionRows] });
    }
    // #934 skive 5a-2: samme som i `writeCourseItems`.
    await syncModuleRequirements(client, courseId);
    await client.course.update({
      where: { id: courseId },
      data: { updatedAt: new Date() },
    });
    const next = [...moduleRows, ...sectionRows]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => ({ itemType: r.itemType, moduleId: "moduleId" in r ? r.moduleId : null, sectionId: "sectionId" in r ? (r.sectionId ?? null) : null }));
    if (itemSequenceKey(previous) !== itemSequenceKey(next)) {
      await applyCourseVersionChange(client, courseId, versionRequest ?? { kind: "minor" }, snapshot, actorId);
    }
  };
  return tx ? run(tx) : runContentWrite(run);
}
