import { prisma } from "../../db/prisma.js";
import { AppError, NotFoundError } from "../../errors/AppError.js";
import { publishCourse } from "./courseCommands.js";
import { publishSection } from "./sectionCommands.js";
import { publishModuleVersion } from "../adminContent/adminContentCommands.js";
import { validateModuleVersionForPublish } from "../adminContent/contentValidationService.js";
import { courseRepository } from "./courseRepository.js";

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

export type PublishBlocker = { code: string; message: string };

export type CourseUnpublishedItem = {
  type: "MODULE" | "SECTION";
  id: string;
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
};

export type PublishedItemRef = { type: "MODULE" | "SECTION"; id: string };

export type CoursePublishResult = {
  course: Awaited<ReturnType<typeof publishCourse>>;
  publishedItems: PublishedItemRef[];
};

// The validator only needs a representative non-empty string for its (warning-level) length checks.
// The raw stored value — a plain string or a serialized LocalizedText JSON blob — is sufficient; the
// blocking outcome is driven by the blueprint check, which does not depend on this flattening.
function flattenLocalized(value: string | null | undefined): string | null {
  return value ?? null;
}

function parseBlueprint(raw: string | null | undefined): unknown {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type ModuleEvaluation = {
  unpublished: boolean;
  publishable: boolean;
  blockers: PublishBlocker[];
  title: string | null;
  latestVersionId: string | null;
};

async function evaluateModule(moduleId: string): Promise<ModuleEvaluation> {
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: {
      title: true,
      archivedAt: true,
      activeVersionId: true,
      versions: {
        orderBy: { versionNo: "desc" },
        take: 1,
        select: {
          id: true,
          taskText: true,
          assessorExpectedContent: true,
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
      publishable: false,
      blockers: [{ code: "module_not_found", message: "Modulen finnes ikke lenger." }],
      title: null,
      latestVersionId: null,
    };
  }

  const title = flattenLocalized(module.title);
  const unpublished = module.activeVersionId === null;

  if (!unpublished) {
    return { unpublished: false, publishable: true, blockers: [], title, latestVersionId: null };
  }

  if (module.archivedAt) {
    return {
      unpublished: true,
      publishable: false,
      blockers: [{ code: "item_archived", message: "Modulen er arkivert. Gjenopprett den før du publiserer." }],
      title,
      latestVersionId: null,
    };
  }

  const latest = module.versions[0];
  if (!latest) {
    return {
      unpublished: true,
      publishable: false,
      blockers: [{ code: "module_no_content", message: "Modulen har ingen versjon med innhold å publisere." }],
      title,
      latestVersionId: null,
    };
  }

  let mcqQuestionCount = 0;
  if (latest.mcqSetVersionId) {
    const set = await prisma.mCQSetVersion.findUnique({
      where: { id: latest.mcqSetVersionId },
      select: { _count: { select: { questions: true } } },
    });
    mcqQuestionCount = set?._count.questions ?? 0;
  }

  const validation = validateModuleVersionForPublish({
    taskText: flattenLocalized(latest.taskText) ?? "",
    candidateTaskConstraints: flattenLocalized(latest.candidateTaskConstraints),
    assessorExpectedContent: flattenLocalized(latest.assessorExpectedContent),
    blueprint: parseBlueprint(latest.assessmentBlueprint) as never,
    mcqQuestionCount,
  });

  if (!validation.valid) {
    const blockers = validation.issues
      .filter((issue) => issue.severity === "blocking")
      .map((issue) => ({ code: issue.code, message: issue.message }));
    return { unpublished: true, publishable: false, blockers, title, latestVersionId: latest.id };
  }

  return { unpublished: true, publishable: true, blockers: [], title, latestVersionId: latest.id };
}

type SectionEvaluation = {
  unpublished: boolean;
  publishable: boolean;
  blockers: PublishBlocker[];
  title: string | null;
};

async function evaluateSection(sectionId: string): Promise<SectionEvaluation> {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { title: true, archivedAt: true, activeVersionId: true },
  });

  if (!section) {
    return {
      unpublished: true,
      publishable: false,
      blockers: [{ code: "section_not_found", message: "Seksjonen finnes ikke lenger." }],
      title: null,
    };
  }

  const title = flattenLocalized(section.title);
  const unpublished = section.activeVersionId === null;

  if (!unpublished) {
    return { unpublished: false, publishable: true, blockers: [], title };
  }

  if (section.archivedAt) {
    return {
      unpublished: true,
      publishable: false,
      blockers: [{ code: "item_archived", message: "Seksjonen er arkivert. Gjenopprett den før du publiserer." }],
      title,
    };
  }

  const latest = await prisma.courseSectionVersion.findFirst({
    where: { sectionId },
    orderBy: { versionNo: "desc" },
    select: { id: true },
  });
  if (!latest) {
    return {
      unpublished: true,
      publishable: false,
      blockers: [{ code: "section_no_content", message: "Seksjonen har ikke noe innhold å publisere." }],
      title,
    };
  }

  return { unpublished: true, publishable: true, blockers: [], title };
}

// (a) Inspect a course's items and report which modules/sections are unpublished and whether each is
// currently publishable. Only unpublished items are returned; already-live items are omitted.
export async function getCoursePublishPreview(courseId: string): Promise<CoursePublishPreview> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const items = await courseRepository.findCourseItems(courseId);
  const unpublishedItems: CourseUnpublishedItem[] = [];

  for (const item of items) {
    if (item.itemType === "MODULE" && item.moduleId) {
      const evaluation = await evaluateModule(item.moduleId);
      if (evaluation.unpublished) {
        unpublishedItems.push({
          type: "MODULE",
          id: item.moduleId,
          title: evaluation.title,
          publishable: evaluation.publishable,
          blockers: evaluation.blockers,
        });
      }
    } else if (item.itemType === "SECTION" && item.sectionId) {
      const evaluation = await evaluateSection(item.sectionId);
      if (evaluation.unpublished) {
        unpublishedItems.push({
          type: "SECTION",
          id: item.sectionId,
          title: evaluation.title,
          publishable: evaluation.publishable,
          blockers: evaluation.blockers,
        });
      }
    }
  }

  return {
    courseId,
    unpublishedItems,
    allPublished: unpublishedItems.length === 0,
    publishable: unpublishedItems.every((item) => item.publishable),
  };
}

// (b) Publish a course, cascade-publishing its unpublished items first (items → course).
//
// Edge-case policy: if ANY unpublished item cannot be published, the course is NOT published — a 422
// AppError carries the blocked items so the UI can tell the author to fix them first. Only when every
// unpublished item is publishable does the cascade proceed. Publishing is atomic-ish: items are
// published in sequence and the course is published only after ALL items succeed. If an item publish
// throws mid-way we stop immediately (a 500 AppError reports what was published and which item failed)
// and never publish the course — so a published-with-broken-content course can never result.
export async function publishCourseCascade(courseId: string, actorId?: string): Promise<CoursePublishResult> {
  const preview = await getCoursePublishPreview(courseId);

  if (preview.allPublished) {
    // Nothing to cascade — plain publish (still enforces G1: at least one module).
    const course = await publishCourse(courseId, actorId);
    return { course, publishedItems: [] };
  }

  if (!preview.publishable) {
    throw new AppError(
      "course_publish_blocked_by_items",
      422,
      "One or more course items cannot be published. Fix them before publishing the course.",
      { unpublishedItems: preview.unpublishedItems },
    );
  }

  const publishedItems: PublishedItemRef[] = [];
  try {
    for (const item of preview.unpublishedItems) {
      if (item.type === "SECTION") {
        await publishSection(item.id, actorId);
      } else {
        const latest = await prisma.moduleVersion.findFirst({
          where: { moduleId: item.id },
          orderBy: { versionNo: "desc" },
          select: { id: true },
        });
        if (!latest) {
          // Should not happen — preview marks version-less modules un-publishable — but guard anyway.
          throw new AppError(
            "module_no_content",
            422,
            `Module ${item.id} has no version to publish.`,
            { moduleId: item.id },
          );
        }
        if (!actorId) {
          // publishModuleVersion attributes the publish to an actor; a module publish must be
          // performed by an authenticated admin (the publish route is behind the admin_content guard).
          throw new AppError(
            "unauthorized",
            401,
            "Publishing a module requires an authenticated actor.",
          );
        }
        await publishModuleVersion(item.id, latest.id, actorId);
      }
      publishedItems.push({ type: item.type, id: item.id });
    }
  } catch (error) {
    // An item publish failed mid-cascade. The course is deliberately NOT published (I1). Report what
    // was already published and which item failed so the author can reconcile.
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new AppError(
      "course_publish_partial_failure",
      500,
      `Publishing course items failed before the course could be published: ${message}`,
      { publishedItems },
    );
  }

  const course = await publishCourse(courseId, actorId);
  return { course, publishedItems };
}
