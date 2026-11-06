import { prisma } from "../../db/prisma.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/AppError.js";
import { publishCourse } from "./courseCommands.js";
import { publishSection, evaluateSectionTranslationGate } from "./sectionCommands.js";
import { publishModuleVersion } from "../adminContent/adminContentCommands.js";
import { createCourseRepository } from "./courseRepository.js";
import { evaluateModulePublishGate, flattenStoredLocalized } from "../adminContent/modulePublishGate.js";
import { listManageableContentIds } from "../content/contentOwnershipService.js";
import { createCertificationRepository } from "../certification/index.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { runContentWrite } from "../../db/contentLock.js";
import {
  applyCourseVersionChange,
  applyMinorVersionToCoursesContaining,
  countCertificateHolders,
  countMajorVersionRecipients,
  findAffectedCourses,
  withVersionChoiceRights,
  type AffectedCourse,
  type CourseVersionBump,
  type CourseVersionChoice,
} from "./courseVersioning.js";
import { findModulesPublishedBefore } from "../adminContent/moduleVersioning.js";
import { clientOutdatedForVersionChoice, isModulePassPerCourseOn } from "./modulePassSwitch.js";

// #934 skive 4a (kjent hull 2 etter 2.129.0): oppslagene tar klienten som parameter. Inne i en publisering
// leser de på transaksjonen som holder innholdslåsen — de ser det låsen beskytter, og bruker ikke en forbindelse
// til i poolen mens transaksjonen holder sin. Utelatt: den globale klienten (forhåndsvisningene).
type PublishReader = DbTransactionClient | typeof prisma;

// Cascade-publish (#734): when an author publishes a COURSE, its modules/sections must already be
// published — otherwise the published course contains unavailable content (violates content-
// lifecycle invariant I1). Historically publishCourse only rejected zero-module courses; a course
// could go live with draft modules/sections and participants then hit "module not available".
//
// This service (a) inspects a course's items and reports which are unpublished + whether each is
// currently publishable, and (b) cascade-publishes the unpublished items (in the correct order —
// items first, then the course) so the go-live is atomic-ish: if any item cannot be published the
// course is never published, and if an item publish fails mid-way we stop before publishing the
// course and report what happened.
//
// Publishability differs by type (see doc/design/CONTENT_LIFECYCLE.md, guard G1):
//   - SECTION: publishSection only re-points activeVersionId to the latest version, so a section is
//     (almost) always publishable — blocked only if archived or if it has no version/content.
//   - MODULE: publishModuleVersion publishes the latest version, but the latest version may fail the
//     blueprint-aware pre-publish gate (validateModuleVersionForPublish → blocking issues). A module
//     is also un-publishable if archived or if it has no version/content.

// #896 S4: `field` and `missingLocales` ride along on translation blockers so the courses page can
// render them in the viewer's language. `message` stays as a server-side fallback — it is written
// in Norwegian like every other blocker here, which is wrong in an English or Nynorsk UI, and the
// client prefers the structured fields whenever they are present.
// #914: `params` baerer det setningen trenger, som DATA.
//
// ⚠️ Meldingene her var hardkodet NORSK, mens `contentValidationService` skrev hardkodet ENGELSK.
// Publiseringsgaten ga altsaa feil sprak til begge grupper, avhengig av hvilken gate som fyrte.
//
// ⚠️ Og `item_archived` brukes for BADE modul og seksjon, med ulik tekst. En klient som
// lokaliserer paa kode alene kan ikke skille dem — derfor baerer den `itemType`.
export type PublishBlocker = {
  code: string;
  message: string;
  field?: string;
  missingLocales?: string[];
  params?: Record<string, string | number>;
};

export type CourseUnpublishedItem = {
  type: "MODULE" | "SECTION";
  id: string;
  /** #934 skive 4a: versjonen som ville blitt publisert (den nyeste), eller null når elementet ikke kan publiseres. */
  versionId: string | null;
  title: string | null;
  /** Whether this unpublished item can be published right now (all guards satisfied). */
  publishable: boolean;
  /** Reasons the item cannot be published, when `publishable` is false. */
  blockers: PublishBlocker[];
};

export type CoursePublishPreview = {
  courseId: string;
  /** Unpublished modules/sections among the course's items. Empty when everything is already live. */
  unpublishedItems: CourseUnpublishedItem[];
  /** True when the course has no unpublished items (the plain publish path applies). */
  allPublished: boolean;
  /** True when every unpublished item is publishable (cascade publish may proceed). */
  publishable: boolean;
  /** #934 skive 3: kursets versjon og antall kursbevis for den nåværende hovedversjonen. Dialogen spør
   *  mindre/hoved når det publiseres nytt innhold og tallet er over null. #934 skive 4b: `majorEmailRecipients`
   *  er hvor mange en hovedversjon sender e-post til (`findMajorVersionRecipients`). */
  course: CourseVersionFacts;
};

/** #934 skive 3/4b: det dialogene trenger for å spørre mindre eller hovedversjon, og vise konsekvensen. */
export type CourseVersionFacts = {
  published: boolean;
  versionMajor: number;
  versionMinor: number;
  certificateHolders: number;
  majorEmailRecipients: number;
};

async function courseVersionFacts(
  reader: PublishReader,
  course: { id: string; publishedAt: Date | null; versionMajor: number; versionMinor: number },
): Promise<CourseVersionFacts> {
  return {
    published: course.publishedAt != null,
    versionMajor: course.versionMajor,
    versionMinor: course.versionMinor,
    certificateHolders: await countCertificateHolders(reader, course.id, course.versionMajor),
    majorEmailRecipients: await countMajorVersionRecipients(reader, course.id),
  };
}

export type PublishedItemRef = { type: "MODULE" | "SECTION"; id: string };

/** #934 skive 3: elementene som referanser for `applyMinorVersionToCoursesContaining`. */
export function itemRefs(items: PublishedItemRef[]): Array<{ sectionId: string } | { moduleId: string }> {
  return items.map((item) => (item.type === "SECTION" ? { sectionId: item.id } : { moduleId: item.id }));
}

export type CoursePublishResult = {
  course: Awaited<ReturnType<typeof publishCourse>>;
  publishedItems: PublishedItemRef[];
  /** #934 skive 3: kursets nye versjon, eller `null` (ingen endring, eller kurset har aldri vært ute). */
  version?: CourseVersionBump | null;
};

// #956: tittelen til visning i kaskadeforhåndsvisningen — én representativ tekst. Selve gaten
// (lengde, blueprint, oversettelse) ligger i `evaluateModulePublishGate`, felles for alle tre dørene;
// den gamle no-op-utflatingen her gjorde at lengde- og blueprint-sjekkene målte på rå JSON.
function flattenLocalized(value: string | null | undefined): string | null {
  return flattenStoredLocalized(value);
}

// The cascade preview is server-rendered text (the courses page prints `blocker.message` as-is),
// so the field labels live here rather than in the client i18n bundle. Norwegian only, matching
// every other blocker message in this service.
const TRANSLATION_FIELD_LABELS: Record<string, string> = {
  title: "tittel",
  description: "beskrivelse",
  taskText: "oppgavetekst",
  assessorExpectedContent: "fasit",
  modelAnswer: "eksempelsvar",
  candidateTaskConstraints: "rammer for kandidaten",
  // #916: the section gate's second field. A section's body IS the section.
  bodyMarkdown: "innhold",
};

function translationFieldLabel(field: string): string {
  const mcq = /^mcq\.question(\d+)$/.exec(field);
  if (mcq) return `MCQ-spørsmål ${mcq[1]}`;
  return TRANSLATION_FIELD_LABELS[field] ?? field;
}

type ModuleEvaluation = {
  unpublished: boolean;
  /** 2.101.0: the newest version is not the live one — never published, or a newer version laid ready. */
  pending: boolean;
  publishable: boolean;
  blockers: PublishBlocker[];
  title: string | null;
  latestVersionId: string | null;
};

async function evaluateModule(moduleId: string, reader: PublishReader): Promise<ModuleEvaluation> {
  const module = await reader.module.findUnique({
    where: { id: moduleId },
    select: {
      title: true,
      description: true,
      archivedAt: true,
      activeVersionId: true,
      versions: {
        orderBy: { versionNo: "desc" },
        take: 1,
        select: {
          id: true,
          taskText: true,
          assessorExpectedContent: true,
          modelAnswer: true,
          candidateTaskConstraints: true,
          assessmentBlueprint: true,
          mcqSetVersionId: true,
        },
      },
    },
  });

  if (!module) {
    // A course item may reference a deleted module in pathological states; treat as un-publishable.
    return {
      unpublished: true,
      pending: true,
      publishable: false,
      blockers: [{ code: "module_not_found", message: "Modulen finnes ikke lenger.", params: {} }],
      title: null,
      latestVersionId: null,
    };
  }

  const title = flattenLocalized(module.title);
  const unpublished = module.activeVersionId === null;
  const latest = module.versions[0];
  // 2.101.0: en publisert modul med en nyere versjon lagt klar (kursoppdatering, #1095) skal gjennom
  // samme port som en upublisert — det er den nyere versjonen som publiseres.
  const pending = unpublished || (latest !== undefined && latest.id !== module.activeVersionId);

  if (!pending) {
    return { unpublished: false, pending: false, publishable: true, blockers: [], title, latestVersionId: null };
  }

  if (module.archivedAt) {
    return {
      unpublished,
      pending,
      publishable: false,
      blockers: [{ code: "item_archived", message: "Modulen er arkivert. Gjenopprett den før du publiserer.", params: { itemType: "module" } }],
      title,
      latestVersionId: null,
    };
  }

  if (!latest) {
    return {
      unpublished,
      pending,
      publishable: false,
      blockers: [{ code: "module_no_content", message: "Modulen har ingen versjon med innhold å publisere.", params: {} }],
      title,
      latestVersionId: null,
    };
  }

  // #896 S4: the question rows themselves — the shared gate reads their stored text and counts them.
  let mcqQuestions: Array<{
    stem: string | null;
    optionsJson: string | null;
    correctAnswer: string | null;
    rationale: string | null;
  }> = [];
  if (latest.mcqSetVersionId) {
    const set = await reader.mCQSetVersion.findUnique({
      where: { id: latest.mcqSetVersionId },
      select: {
        _count: { select: { questions: true } },
        // Samme rekkefølge som de andre lesestedene (porten nummererer spørsmålene i meldingene).
        questions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { stem: true, optionsJson: true, correctAnswer: true, rationale: true } },
      },
    });
    mcqQuestions = set?.questions ?? [];
  }

  // #896 S4 / #956: the cascade is a second door into publishing. It runs the SAME gate as the
  // module-publish button and the import — one function, one field set, one normalisation. Before,
  // this door had its own copy with a no-op flatten, and the author got a different answer here
  // than from the button for the same module. The archived case is handled above and never reaches
  // this point, so `archivedAt` is passed as null.
  const validation = evaluateModulePublishGate({
    module: { title: module.title, description: module.description, archivedAt: null },
    version: {
      taskText: latest.taskText,
      candidateTaskConstraints: latest.candidateTaskConstraints,
      assessorExpectedContent: latest.assessorExpectedContent,
      modelAnswer: latest.modelAnswer,
      assessmentBlueprint: latest.assessmentBlueprint,
    },
    mcqQuestions,
  });

  if (!validation.valid) {
    const blockers = validation.issues
      .filter((issue) => issue.severity === "blocking")
      // The cascade dialog prints `message` verbatim next to blockers like "Modulen er arkivert.
      // Gjenopprett den før du publiserer." A raw "taskText: missing nn" would read as a leaked
      // internal string beside them, so translation issues get a sentence in the same voice.
      .map((issue) =>
        issue.code === "translation_incomplete" && issue.field && issue.missingLocales
          ? {
              code: issue.code,
              message: `Modulen mangler oversettelse av «${translationFieldLabel(issue.field)}» på ${issue.missingLocales.join(", ")}. Åpne modulen og bruk «Oversett det som mangler».`,
              field: issue.field,
              missingLocales: issue.missingLocales,
            }
          : { code: issue.code, message: issue.message },
      );
    return { unpublished, pending, publishable: false, blockers, title, latestVersionId: latest.id };
  }

  return { unpublished, pending, publishable: true, blockers: [], title, latestVersionId: latest.id };
}

type SectionEvaluation = {
  unpublished: boolean;
  pending: boolean;
  publishable: boolean;
  blockers: PublishBlocker[];
  title: string | null;
  latestVersionId: string | null;
};

async function evaluateSection(sectionId: string, reader: PublishReader): Promise<SectionEvaluation> {
  const section = await reader.courseSection.findUnique({
    where: { id: sectionId },
    select: { title: true, archivedAt: true, activeVersionId: true },
  });

  if (!section) {
    return {
      unpublished: true,
      pending: true,
      publishable: false,
      blockers: [{ code: "section_not_found", message: "Seksjonen finnes ikke lenger.", params: {} }],
      title: null,
      latestVersionId: null,
    };
  }

  const title = flattenLocalized(section.title);
  const unpublished = section.activeVersionId === null;
  const latest = await reader.courseSectionVersion.findFirst({
    where: { sectionId },
    orderBy: { versionNo: "desc" },
    select: { id: true, bodyMarkdown: true },
  });
  // 2.101.0: som for moduler — en nyere versjon enn den levende er også «ikke publisert ennå».
  const pending = unpublished || (latest !== null && latest.id !== section.activeVersionId);

  if (!pending) {
    return { unpublished: false, pending: false, publishable: true, blockers: [], title, latestVersionId: null };
  }

  if (section.archivedAt) {
    return {
      unpublished,
      pending,
      publishable: false,
      blockers: [{ code: "item_archived", message: "Seksjonen er arkivert. Gjenopprett den før du publiserer.", params: { itemType: "section" } }],
      title,
      latestVersionId: null,
    };
  }

  if (!latest) {
    return {
      unpublished,
      pending,
      publishable: false,
      blockers: [{ code: "section_no_content", message: "Seksjonen har ikke noe innhold å publisere.", params: {} }],
      title,
      latestVersionId: null,
    };
  }

  // #916: the cascade is a door into publishing a SECTION too, and it must agree with the section's
  // own publish route about what "complete" means — otherwise the author is told different things
  // depending on which button they pressed. `publishSection` throws on the same condition; reporting
  // it here means the cascade refuses up front and publishes NOTHING, rather than failing mid-way.
  const gate = evaluateSectionTranslationGate({ title: section.title, bodyMarkdown: latest.bodyMarkdown });
  if (!gate.ok) {
    return {
      unpublished,
      pending,
      latestVersionId: latest.id,
      publishable: false,
      blockers: gate.issues.map((issue) => ({
        code: issue.code,
        message:
          issue.field && issue.missingLocales
            ? `Seksjonen mangler oversettelse av «${translationFieldLabel(issue.field)}» på ${issue.missingLocales.join(", ")}. Åpne seksjonen og oversett det som mangler.`
            : issue.message,
        field: issue.field,
        missingLocales: issue.missingLocales,
      })),
      title,
    };
  }

  return { unpublished, pending, publishable: true, blockers: [], title, latestVersionId: latest.id };
}

// (a) Inspect a course's items and report which modules/sections are unpublished and whether each is
// currently publishable. Only unpublished items are returned; already-live items are omitted.
export async function getCoursePublishPreview(courseId: string, reader: PublishReader = prisma): Promise<CoursePublishPreview> {
  const courseRepository = createCourseRepository(reader);
  const course = await reader.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  // #958: gaten må se ALT — dens spørsmål er «hva er ikke publisert ennå», og den døra som skjuler
  // det upubliserte ville gitt den ingenting å rapportere. Hva som er publiserbart avgjøres i
  // `evaluateModule`/`evaluateSection`, som henter versjonsradene de uansett trenger. Det er en
  // ANNEN regel enn deltakerens, og skal ikke kunne forveksles med den.
  const items = await courseRepository.findAllCourseItems(courseId);
  const unpublishedItems: CourseUnpublishedItem[] = [];

  for (const item of items) {
    if (item.itemType === "MODULE" && item.moduleId) {
      const evaluation = await evaluateModule(item.moduleId, reader);
      if (evaluation.unpublished) {
        unpublishedItems.push({
          type: "MODULE",
          id: item.moduleId,
          title: evaluation.title,
          versionId: evaluation.latestVersionId,
          publishable: evaluation.publishable,
          blockers: evaluation.blockers,
        });
      }
    } else if (item.itemType === "SECTION" && item.sectionId) {
      const evaluation = await evaluateSection(item.sectionId, reader);
      if (evaluation.unpublished) {
        unpublishedItems.push({
          type: "SECTION",
          id: item.sectionId,
          title: evaluation.title,
          versionId: evaluation.latestVersionId,
          publishable: evaluation.publishable,
          blockers: evaluation.blockers,
        });
      }
    }
  }

  const versionRow = await reader.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { id: true, publishedAt: true, versionMajor: true, versionMinor: true },
  });
  return {
    courseId,
    unpublishedItems,
    allPublished: unpublishedItems.length === 0,
    publishable: unpublishedItems.every((item) => item.publishable),
    course: await courseVersionFacts(reader, versionRow),
  };
}

/**
 * #934 skive 4a: «Publiser kurs» når ingenting er upublisert. Ruta så det i en forhåndsvisning FØR låsen; her ses
 * det på nytt etter den. Har noen lagt et upublisert element inn i kurset i mellomtiden, publiseres ikke kurset —
 * det ville stått levende med noe deltakeren ikke kan åpne (I1). Samme svar som ruta gir når det er upubliserte
 * elementer: `409 course_has_unpublished_items` med forhåndsvisningen, så dialogen kan spørre.
 */
export async function publishCourseChecked(courseId: string, actorId?: string) {
  return runContentWrite(async (tx) => {
    const fresh = await getCoursePublishPreview(courseId, tx);
    if (!fresh.allPublished) {
      throw new ConflictError(
        "course_has_unpublished_items",
        "The course has unpublished items. Confirm cascade publish with { publishItems: true }.",
        { unpublishedItems: fresh.unpublishedItems, publishable: fresh.publishable },
      );
    }
    return publishCourse(courseId, actorId, tx);
  });
}

// (b) Publish a course, cascade-publishing its unpublished items first (items → course).
//
// Edge-case policy: if ANY unpublished item cannot be published, the course is NOT published — a 422
// AppError carries the blocked items so the UI can tell the author to fix them first. Only when every
// unpublished item is publishable does the cascade proceed. Publishing is atomic-ish: items are
// published in sequence and the course is published only after ALL items succeed. If an item publish
// throws mid-way we stop immediately (a 500 AppError reports what was published and which item failed)
// and never publish the course — so a published-with-broken-content course can never result.
// #934 skive 3: `courseVersion` er forfatterens svar når kurset har vært ute og noen har kursbevis — nytt
// innhold går live, og det er samme spørsmål som i skjemaet (produkteier 2026-11-02).
// #934 skive 4b: `options.confirmEmailRecipients` — tallet dialogen viste da forfatteren sa ja til e-post til mange.
export async function publishCourseCascade(
  courseId: string,
  actorId?: string,
  courseVersion?: CourseVersionChoice,
  options?: { confirmEmailRecipients?: number },
): Promise<CoursePublishResult> {
  const preview = await getCoursePublishPreview(courseId);

  if (preview.allPublished) {
    // Nothing to cascade — plain publish (still enforces G1: at least one module). #934 skive 4a: sjekket på nytt
    // etter låsen.
    const course = await publishCourseChecked(courseId, actorId);
    return { course, publishedItems: [] };
  }

  const blockedByItems = (items: CourseUnpublishedItem[]) =>
    new AppError(
      "course_publish_blocked_by_items",
      422,
      "One or more course items cannot be published. Fix them before publishing the course.",
      { unpublishedItems: items },
    );
  if (!preview.publishable) {
    throw blockedByItems(preview.unpublishedItems);
  }

  // #960: ALT som kan avvise, avvises FØR første skriving.
  //
  // ⚠️ Her lå to vakter INNE i løkka, etter at tidligere elementer alt var publisert: «modulen har
  // ingen versjon» og «mangler aktør» (401). Begge var i praksis unåbare — forhåndsvisningen over
  // avviser versjonsløse moduler, og ruta står bak `requireContentOwnership`, som 403-er uten
  // aktør — men skulle en av dem likevel fyre (en kappestrid mot forhåndsvisningen, eller en
  // framtidig kaller uten HTTP-laget), ville seksjonene alt vært publisert og kurset stått
  // halvpublisert: nøyaktig tilstanden I1 lover aldri kan oppstå.
  //
  // Nå slås versjonene opp og aktøren kreves i ett forberedelsessteg. Feiler noe her, er ingenting
  // skrevet. Vakter som leser som vakter, men står for sent, er verre enn ingen vakter
  // (`adminSections.ts`-regelen).
  // #934 skive 4a: forberedelsen står nå ETTER innholdslåsen, inne i transaksjonen (under). Forhåndsvisningen
  // over er det forfatteren svarte på; stemmer den ikke med det som regnes ut etter låsen, er svaret gitt på noe
  // annet (409), og ingenting er publisert.
  // Med versjonen: lagrer noen en ny versjon av et element mens publiseringen venter på låsen, er det ikke den
  // forhåndsvisningen viste (QA-porten 2.131.0, runde 1) — 409 i stedet for å publisere den.
  const planIds = preview.unpublishedItems.map((item) => `${item.type}:${item.id}:${item.versionId ?? "-"}`).sort();

  // Publisering tilskrives en aktør. Ruta garanterer én; en kaller uten HTTP-laget som ikke gjør
  // det, er en programmeringsfeil — og den skal stoppe her, ikke halvveis i en kaskade.
  // (planen er aldri tom her: vi er forbi `preview.allPublished`.)
  if (!actorId) {
    throw new AppError("internal_error", 500, "Publishing course items requires an actor; the caller passed none.");
  }

  // #934 skive 3: alt i ÉN transaksjon — øyeblikksbildet FØR, elementene, kursets versjon, og så selve
  // publiseringen. Versjonen avgjøres FØR `publishCourse`: et kurs som aldri har vært ute, er da fortsatt uten
  // delingslenke og blir 1.0; et som har vært ute, får spørsmålet. Stopper noe, er ingenting publisert (I1, og
  // ingen ny tekst uten versjon). #934 skive 4a: innholdslåsen er det første transaksjonen gjør.
  try {
    return await runContentWrite(async (tx) => {
      // To samtidige «Publiser kurs» kan begge ha sett forhåndsvisningen. Den andre venter på låsen; så leses det
      // upubliserte på nytt, og har den første publisert det, er svaret gitt på noe annet (409).
      const fresh = await getCoursePublishPreview(courseId, tx);
      const freshIds = fresh.unpublishedItems.map((item) => `${item.type}:${item.id}:${item.versionId ?? "-"}`).sort();
      if (freshIds.length !== planIds.length || freshIds.some((id, index) => id !== planIds[index])) {
        throw new AppError("course_publish_items_changed", 409, "The course changed since publishing was requested. Reload and try again.");
      }
      if (!fresh.publishable) throw blockedByItems(fresh.unpublishedItems);
      // #934 skive 5a-3 (Codex runde 2 nr. 11): «upublisert» betyr bare at modulen ikke har en aktiv versjon nå. En modul som har
      // vært ute før, kan ha beståtte, og her ville den gått live uten at noen ble spurt per kurs. Moduler som aldri har vært
      // ute, og seksjoner, går som før. Bryteren leses etter låsen, i denne transaksjonen.
      if (await isModulePassPerCourseOn(tx)) {
        const moduleItems = fresh.unpublishedItems.filter((item) => item.type === "MODULE");
        const publishedBefore = await findModulesPublishedBefore(tx, moduleItems.map((item) => item.id));
        const republished = moduleItems.filter((item) => publishedBefore.has(item.id));
        if (republished.length > 0) {
          throw new ConflictError(
            "course_publish_has_republished_modules",
            'These modules have been published before. Use "Publish new versions", which asks per course. Nothing was published.',
            { modules: republished.map((item) => ({ moduleId: item.id, title: item.title })) },
          );
        }
      }
      const plan: Array<{ type: "SECTION"; id: string } | { type: "MODULE"; id: string; versionId: string }> = [];
      for (const item of fresh.unpublishedItems) {
        if (item.type === "SECTION") {
          plan.push({ type: "SECTION", id: item.id });
          continue;
        }
        // Versjonen forhåndsvisningen viste og som ble sammenlignet over — ikke en ny oppslag.
        if (!item.versionId) {
          throw new AppError("module_no_content", 422, `Module ${item.id} has no version to publish.`, { moduleId: item.id });
        }
        plan.push({ type: "MODULE", id: item.id, versionId: item.versionId });
      }
      const repo = createCourseRepository(tx);
      const snapshot = await repo.snapshotContent(courseId);
      const publishedItems: PublishedItemRef[] = [];
      for (const item of plan) {
        if (item.type === "SECTION") {
          await publishSection(item.id, actorId, tx, { courseVersionHandledByCaller: true });
        } else {
          await publishModuleVersion(item.id, item.versionId, actorId, tx, { courseVersionHandledByCaller: true });
        }
        publishedItems.push({ type: item.type, id: item.id });
      }
      await applyMinorVersionToCoursesContaining(tx, itemRefs(publishedItems), actorId, { exceptCourseId: courseId });
      const version = await applyCourseVersionChange(
        tx,
        courseId,
        { kind: "question", answer: courseVersion, confirmEmailRecipients: options?.confirmEmailRecipients },
        snapshot,
        actorId,
      );
      const course = await publishCourse(courseId, actorId, tx);
      return { course, publishedItems, version };
    }, { timeout: PENDING_PUBLISH_TX_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new AppError("course_publish_failed", 500, `Publishing the course failed; nothing was published: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 2.101.0: publiser alle nye versjoner i et kurs på én gang.
//
// Produkteier, 2026-10-25: «Ved import av kurs blir nye versjoner av moduler importert som under
// arbeid, så må man manuelt inn i hver modul og publisere. Vi trenger et samlet spørsmål om å
// publisere alle, [og] spørsmålet om "Er dette en revisjon" der svar gis samlet for alle moduler.»
//
// Kaskaden over dekker bare elementer som ALDRI er publisert. En kursoppdatering (#1095) legger en
// nyere versjon på elementer som er levende — de er «publisert» for kaskaden og kom aldri med.
//
// Reglene:
//   - Alt eller ingenting, som kaskaden (#734): mangler ett element et språk, publiseres ingenting.
//     Ellers kan en ny test stå bak den gamle seksjonen den prøver.
//   - Bare elementer forfatteren eier. Et kurs kan inneholde andres moduler og seksjoner (#903);
//     dem publiserer eieren. De listes for seg og stopper ikke resten.
//   - Revisjonsspørsmålet (#997) besvares én gang. Har noen bestått en av modulene, KREVES svaret.
//   - Fasiten er det forfatteren så: klienten sender versjonene fra dialogen, og har settet endret
//     seg i mellomtiden, publiseres ingenting (409).
// ---------------------------------------------------------------------------

export type CoursePendingItem = {
  type: "MODULE" | "SECTION";
  id: string;
  title: string | null;
  /** The version that would be published — the newest one. */
  versionId: string | null;
  /** Never published before (a new element), as opposed to a newer version of a live one. */
  isNew: boolean;
  publishable: boolean;
  blockers: PublishBlocker[];
  /** Participants who have passed the module now. Always 0 for sections. */
  passedCount: number;
};

export type CoursePendingVersions = {
  courseId: string;
  /** Pending items the actor may publish. */
  items: CoursePendingItem[];
  /** Pending items owned by someone else; not published from here. */
  notOwnedItems: Array<{ type: "MODULE" | "SECTION"; id: string; title: string | null }>;
  /** True when every item in `items` can be published. */
  publishable: boolean;
  /** Sum of `passedCount` over `items`. */
  passedTotal: number;
  /** How many modules in `items` someone has passed. */
  modulesWithPasses: number;
  /** #934 skive 3: kursets versjon nå, og hvor mange som har kursbevis for den nåværende hovedversjonen.
   *  Dialogen spør «mindre eller hovedversjon?» bare når kurset er publisert og tallet er over null.
   *  #934 skive 4b: og hvor mange en hovedversjon sender e-post til. */
  course: CourseVersionFacts;
  /** #934 skive 5a-3: kursene `publish-pending-versioned` vil ha svar for. Bare når bryteren er på; ellers er svaret som før. */
  affectedCourses?: AffectedCourse[];
};

export type PendingVersionsActor = { userId: string; roles: string[] };

export async function getCoursePendingVersions(courseId: string, actor: PendingVersionsActor, reader: PublishReader = prisma): Promise<CoursePendingVersions> {
  const courseRepository = createCourseRepository(reader);
  const certificationRepository = createCertificationRepository(reader);
  const course = await reader.course.findUnique({
    where: { id: courseId },
    select: { id: true, publishedAt: true, versionMajor: true, versionMinor: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const courseItems = await courseRepository.findAllCourseItems(courseId);
  const moduleIds = courseItems.flatMap((item) => (item.itemType === "MODULE" && item.moduleId ? [item.moduleId] : []));
  const sectionIds = courseItems.flatMap((item) => (item.itemType === "SECTION" && item.sectionId ? [item.sectionId] : []));
  const [ownedModules, ownedSections] = await Promise.all([
    listManageableContentIds({ contentType: "MODULE", contentIds: moduleIds, actorUserId: actor.userId, roles: actor.roles, reader }),
    listManageableContentIds({ contentType: "SECTION", contentIds: sectionIds, actorUserId: actor.userId, roles: actor.roles, reader }),
  ]);

  const items: CoursePendingItem[] = [];
  const notOwnedItems: CoursePendingVersions["notOwnedItems"] = [];
  for (const item of courseItems) {
    if (item.itemType === "MODULE" && item.moduleId) {
      const evaluation = await evaluateModule(item.moduleId, reader);
      if (!evaluation.pending) continue;
      if (!ownedModules.has(item.moduleId)) {
        notOwnedItems.push({ type: "MODULE", id: item.moduleId, title: evaluation.title });
        continue;
      }
      const passedCount = (await certificationRepository.findPassedCertificationsForModule(item.moduleId)).length;
      items.push({
        type: "MODULE",
        id: item.moduleId,
        title: evaluation.title,
        versionId: evaluation.latestVersionId,
        isNew: evaluation.unpublished,
        publishable: evaluation.publishable,
        blockers: evaluation.blockers,
        passedCount,
      });
    } else if (item.itemType === "SECTION" && item.sectionId) {
      const evaluation = await evaluateSection(item.sectionId, reader);
      if (!evaluation.pending) continue;
      if (!ownedSections.has(item.sectionId)) {
        notOwnedItems.push({ type: "SECTION", id: item.sectionId, title: evaluation.title });
        continue;
      }
      items.push({
        type: "SECTION",
        id: item.sectionId,
        title: evaluation.title,
        versionId: evaluation.latestVersionId,
        isNew: evaluation.unpublished,
        publishable: evaluation.publishable,
        blockers: evaluation.blockers,
        passedCount: 0,
      });
    }
  }

  return {
    courseId,
    items,
    notOwnedItems,
    publishable: items.every((item) => item.publishable),
    passedTotal: items.reduce((sum, item) => sum + item.passedCount, 0),
    modulesWithPasses: items.filter((item) => item.passedCount > 0).length,
    course: await courseVersionFacts(reader, course),
    ...((await isModulePassPerCourseOn(reader))
      ? { affectedCourses: await withVersionChoiceRights(reader, await findAffectedCourses(reader, itemRefs(items)), actor) }
      : {}),
  };
}

export async function publishCoursePendingVersions(
  courseId: string,
  actor: PendingVersionsActor,
  // #934 skive 3: `courseVersion` er forfatterens svar for kurset — ett svar, som for modulene. Utelatt = mindre.
  // #934 skive 4b: `confirmEmailRecipients` — tallet dialogen viste da forfatteren sa ja til e-post til mange.
  input: { versionIds: string[]; supersedesEarlierPasses?: boolean; courseVersion?: CourseVersionChoice; confirmEmailRecipients?: number },
): Promise<{ publishedItems: PublishedItemRef[]; version: CourseVersionBump | null }> {
  const pending = await getCoursePendingVersions(courseId, actor);
  // #934 skive 5a-3: den gamle kontrakten etter bryteren. Avgjøres på nytt etter låsen under; her er det bare for at
  // spørsmålet om #997 ikke skal stilles når det ikke lenger gjelder.
  const perCourseRule = await isModulePassPerCourseOn(prisma);

  // Det forfatteren så, er det som publiseres. Et annet sett (noen lagret en ny versjon, eller
  // publiserte én, etter at dialogen ble åpnet) betyr at svaret ble gitt på noe annet.
  const current = pending.items.map((item) => item.versionId ?? "").sort();
  const seen = [...new Set(input.versionIds)].sort();
  if (current.length !== seen.length || current.some((id, index) => id !== seen[index])) {
    throw new AppError("pending_versions_changed", 409, "The versions ready to publish changed since they were shown. Reload and try again.");
  }
  if (pending.items.length === 0) return { publishedItems: [], version: null };

  if (!pending.publishable) {
    throw new AppError(
      "course_pending_blocked",
      422,
      "One or more new versions cannot be published. Fix them before publishing.",
      { items: pending.items },
    );
  }
  // #997: svaret sender ett varsel per person — det skal være et valg, ikke en standard.
  if (!perCourseRule && pending.passedTotal > 0 && input.supersedesEarlierPasses === undefined) {
    throw new AppError("revision_answer_required", 400, "Participants have passed some of these modules: say whether this is a revision (supersedesEarlierPasses).");
  }

  // #934 skive 3: alt i ÉN transaksjon — elementene, kursets versjon og øyeblikksbildet. Stopper noe, er
  // ingenting publisert: en ny tekst skal aldri stå levende uten versjonen som hører til, og et nytt forsøk
  // ser det samme settet som det første. Seksjonsversjonene RETT FØR leses først i transaksjonen.
  try {
    return await runContentWrite(async (tx) => {
      // To samtidige «Publiser» kan begge ha passert sjekken over. Låsen gjør at den andre venter; så leses
      // settet på nytt, og har den første publisert det, er svaret gitt på noe annet (409) — ikke en ny økning.
      // #934 skive 4a: også det andre sjekkene over avgjorde, sjekkes på nytt etter låsen.
      const fresh = await getCoursePendingVersions(courseId, actor, tx);
      const now = fresh.items.map((item) => item.versionId ?? "").sort();
      if (now.length !== seen.length || now.some((id, index) => id !== seen[index])) {
        throw new AppError("pending_versions_changed", 409, "The versions ready to publish changed since they were shown. Reload and try again.");
      }
      if (!fresh.publishable) {
        throw new AppError(
          "course_pending_blocked",
          422,
          "One or more new versions cannot be published. Fix them before publishing.",
          { items: fresh.items },
        );
      }
      const perCourse = await isModulePassPerCourseOn(tx);
      if (perCourse) {
        // #934 skive 5a-3: avkrysningen sier ingenting om kursene. Berører publiseringen andre kurs med kursbevis, er det et
        // spørsmål denne kontrakten ikke kan stille. Det samme gjelder hovedversjon av kurset med en ny modul: den skulle bety «må
        // bestå på nytt», men denne kontrakten kan ikke heve kravet per kurs, og valget skal ikke forsvinne uten at noen sier fra.
        // Ellers publiseres det med `courseVersion` for dette kurset, og modulene blir mindre.
        if (input.supersedesEarlierPasses === true) throw clientOutdatedForVersionChoice({ courseId });
        if (input.courseVersion === "major" && fresh.items.some((item) => item.type === "MODULE")) throw clientOutdatedForVersionChoice({ courseId });
        const others = (await findAffectedCourses(tx, itemRefs(fresh.items))).filter((course) => course.courseId !== courseId && course.certificateHolders > 0);
        if (others.length > 0) throw clientOutdatedForVersionChoice({ courseId, courseIds: others.map((course) => course.courseId) });
      } else if (fresh.passedTotal > 0 && input.supersedesEarlierPasses === undefined) {
        throw new AppError("revision_answer_required", 400, "Participants have passed some of these modules: say whether this is a revision (supersedesEarlierPasses).");
      }
      const repo = createCourseRepository(tx);
      const snapshot = await repo.snapshotContent(courseId);
      const publishedItems: PublishedItemRef[] = [];
      for (const item of fresh.items) {
        if (item.type === "SECTION") {
          await publishSection(item.id, actor.userId, tx, { courseVersionHandledByCaller: true });
        } else {
          await publishModuleVersion(item.id, item.versionId as string, actor.userId, tx, {
            supersedesEarlierPasses: input.supersedesEarlierPasses === true && item.passedCount > 0,
            courseVersionHandledByCaller: true,
          });
        }
        publishedItems.push({ type: item.type, id: item.id });
      }
      await applyMinorVersionToCoursesContaining(tx, itemRefs(publishedItems), actor.userId || undefined, { exceptCourseId: courseId });
      const version = await applyCourseVersionChange(
        tx,
        courseId,
        { kind: "question", answer: input.courseVersion, confirmEmailRecipients: input.confirmEmailRecipients },
        snapshot,
        actor.userId || undefined,
      );
      return { publishedItems, version };
    }, { timeout: PENDING_PUBLISH_TX_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new AppError("course_pending_failed", 500, `Publishing new versions failed; nothing was published: ${message}`);
  }
}

// Som importen (#796): mange elementer i én transaksjon kan ta lenger tid enn Prismas 5 sekunder.
export const PENDING_PUBLISH_TX_TIMEOUT_MS = 30_000;
