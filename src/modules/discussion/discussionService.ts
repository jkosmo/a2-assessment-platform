import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../../db/prismaRuntime.js";
import { prisma } from "../../db/prisma.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import {
  getClassAssignedCourseDueDates,
  getUserClassIds,
  filterVisibleCourseIds,
} from "../course/index.js";
import {
  toThreadDetailDto,
  toThreadSummaryDto,
  type DiscussionThreadDetailDto,
  type DiscussionThreadSummaryDto,
  type ViewerContext,
} from "./discussionReadModels.js";

/**
 * Diskusjon / Q&A — forretningslogikk (#495/T-QA-2).
 *
 * Authz-prinsipper (doc/DISCUSSIONS_DESIGN.md):
 *  - Les/skriv krever publisert-kurs-tilgang (samme synlighet som /api/courses: OPEN for alle,
 *    RESTRICTED for enrolled/klasse-tildelt). SMO/ADMIN har alltid tilgang.
 *  - Moderering (pin/lås/slett andres) krever SMO/ADMIN. Akseptert svar: spørrer eller moderator.
 *  - Skriving blokkeres hvis diskusjon er avskrudd på scope, eller tråden er LOCKED.
 *  - Soft-delete, aldri hard-delete.
 */

export type AccessContext = {
  userId: string;
  roles: AppRoleType[];
  groupIds?: string[];
};

const MODERATOR_ROLES: AppRoleType[] = [AppRole.SUBJECT_MATTER_OWNER, AppRole.ADMINISTRATOR];

function isModerator(roles: AppRoleType[]): boolean {
  return roles.some((role) => MODERATOR_ROLES.includes(role));
}

function viewerOf(access: AccessContext): ViewerContext {
  return { userId: access.userId, canModerate: isModerator(access.roles) };
}

const authorSelect = { select: { id: true, name: true, isAnonymized: true } } as const;

const threadSummarySelect = {
  id: true,
  courseId: true,
  courseItemId: true,
  kind: true,
  status: true,
  title: true,
  pinnedAt: true,
  acceptedReplyId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  author: authorSelect,
  _count: { select: { replies: { where: { deletedAt: null } } } },
} as const;

const threadDetailSelect = {
  ...threadSummarySelect,
  authorId: true,
  bodyMarkdown: true,
  replies: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      authorId: true,
      bodyMarkdown: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      author: authorSelect,
    },
  },
  subscriptions: { select: { userId: true } },
} as const;

/**
 * Verifiserer at brukeren har tilgang til kurset (publisert + synlig), og returnerer kursets
 * id + discussionsEnabled. Kaster 404 (ikke 403) for utilgjengelige kurs så eksistens ikke lekkes.
 */
async function loadAccessibleCourse(
  courseId: string,
  access: AccessContext,
): Promise<{ id: string; discussionsEnabled: boolean }> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      publishedAt: true,
      archivedAt: true,
      discussionsEnabled: true,
      enrollmentPolicy: true,
    },
  });
  if (!course || !course.publishedAt || course.archivedAt) {
    throw new NotFoundError("Course", "course_not_found", "Course not found.");
  }
  if (!isModerator(access.roles)) {
    const classIds = await getUserClassIds({
      userId: access.userId,
      roles: access.roles,
      groupIds: access.groupIds,
    });
    const classCourseDue = await getClassAssignedCourseDueDates(classIds);
    const visible = await filterVisibleCourseIds(
      access.userId,
      [{ id: course.id, enrollmentPolicy: course.enrollmentPolicy }],
      new Set(classCourseDue.keys()),
    );
    if (!visible.has(course.id)) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
  }
  return { id: course.id, discussionsEnabled: course.discussionsEnabled };
}

/**
 * Håndhever scope-toggle for SKRIVING: kurs-master må være på, og hvis tråden/innlegget hører til
 * et CourseItem må item-toggle også være på. Validerer samtidig at item tilhører kurset.
 */
async function assertScopeWritable(
  course: { id: string; discussionsEnabled: boolean },
  courseItemId: string | null,
): Promise<void> {
  if (!course.discussionsEnabled) {
    throw new ForbiddenError("Discussions are disabled for this course.", "discussions_disabled");
  }
  if (courseItemId) {
    const item = await prisma.courseItem.findFirst({
      where: { id: courseItemId, courseId: course.id },
      select: { id: true, discussionsEnabled: true },
    });
    if (!item) {
      throw new NotFoundError("CourseItem", "course_item_not_found", "Course item not found in this course.");
    }
    if (!item.discussionsEnabled) {
      throw new ForbiddenError(
        "Discussions are disabled for this course item.",
        "discussions_disabled",
      );
    }
  }
}

export async function listThreads(params: {
  courseId: string;
  courseItemId: string | null;
  access: AccessContext;
}): Promise<DiscussionThreadSummaryDto[]> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  if (params.courseItemId) {
    // Valider at item tilhører kurset (404 ellers) — leser trenger ikke at toggle er på.
    const item = await prisma.courseItem.findFirst({
      where: { id: params.courseItemId, courseId: course.id },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundError("CourseItem", "course_item_not_found", "Course item not found in this course.");
    }
  }
  const rows = await prisma.discussionThread.findMany({
    where: { courseId: course.id, courseItemId: params.courseItemId },
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    select: threadSummarySelect,
  });
  const viewer = viewerOf(params.access);
  return rows.map((row) => toThreadSummaryDto(row, viewer));
}

export async function createThread(params: {
  courseId: string;
  courseItemId: string | null;
  kind: "QUESTION" | "DISCUSSION";
  title: string;
  bodyMarkdown: string;
  access: AccessContext;
}): Promise<DiscussionThreadDetailDto> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  await assertScopeWritable(course, params.courseItemId);

  const thread = await prisma.discussionThread.create({
    data: {
      courseId: course.id,
      courseItemId: params.courseItemId,
      authorId: params.access.userId,
      kind: params.kind,
      title: params.title,
      bodyMarkdown: params.bodyMarkdown,
      // Forfatter abonnerer automatisk på egen tråd (#495 §4).
      subscriptions: { create: { userId: params.access.userId } },
    },
    select: threadDetailSelect,
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.discussionThread,
    entityId: thread.id,
    action: auditActions.discussion.threadCreated,
    actorId: params.access.userId,
    metadata: { courseId: course.id, courseItemId: params.courseItemId, kind: params.kind },
  });

  return toThreadDetailDto(thread, viewerOf(params.access));
}

async function loadThreadInCourse(courseId: string, threadId: string) {
  const thread = await prisma.discussionThread.findFirst({
    where: { id: threadId, courseId },
    select: threadDetailSelect,
  });
  if (!thread) {
    throw new NotFoundError("DiscussionThread", "thread_not_found", "Discussion thread not found.");
  }
  return thread;
}

export async function getThread(params: {
  courseId: string;
  threadId: string;
  access: AccessContext;
}): Promise<DiscussionThreadDetailDto> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const thread = await loadThreadInCourse(course.id, params.threadId);
  return toThreadDetailDto(thread, viewerOf(params.access));
}

export type ThreadPatch = {
  title?: string;
  bodyMarkdown?: string;
  pinned?: boolean;
  lock?: boolean;
  acceptedReplyId?: string | null;
};

export async function updateThread(params: {
  courseId: string;
  threadId: string;
  patch: ThreadPatch;
  access: AccessContext;
}): Promise<DiscussionThreadDetailDto> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const thread = await loadThreadInCourse(course.id, params.threadId);
  const viewer = viewerOf(params.access);
  const isOwn = thread.authorId === params.access.userId;

  if (thread.deletedAt) {
    throw new NotFoundError("DiscussionThread", "thread_not_found", "Discussion thread not found.");
  }

  const data: Record<string, unknown> = {};
  const auditCalls: Array<() => Promise<void>> = [];

  // 1) Innholdsredigering — kun forfatter.
  if (params.patch.title !== undefined || params.patch.bodyMarkdown !== undefined) {
    if (!isOwn) {
      throw new ForbiddenError("Only the author can edit this thread.", "forbidden");
    }
    if (params.patch.title !== undefined) data.title = params.patch.title;
    if (params.patch.bodyMarkdown !== undefined) data.bodyMarkdown = params.patch.bodyMarkdown;
    auditCalls.push(() =>
      recordAuditEvent({
        entityType: auditEntityTypes.discussionThread,
        entityId: thread.id,
        action: auditActions.discussion.threadEdited,
        actorId: params.access.userId,
        metadata: { courseId: course.id, threadId: thread.id },
      }),
    );
  }

  // 2) Pin/unpin — moderator.
  if (params.patch.pinned !== undefined) {
    if (!viewer.canModerate) {
      throw new ForbiddenError("Only a moderator can pin threads.", "forbidden");
    }
    data.pinnedAt = params.patch.pinned ? new Date() : null;
    auditCalls.push(() =>
      recordAuditEvent({
        entityType: auditEntityTypes.discussionThread,
        entityId: thread.id,
        action: auditActions.discussion.threadModerated,
        actorId: params.access.userId,
        metadata: { courseId: course.id, threadId: thread.id, change: params.patch.pinned ? "pinned" : "unpinned" },
      }),
    );
  }

  // 3) Lås/lås opp — moderator.
  if (params.patch.lock !== undefined) {
    if (!viewer.canModerate) {
      throw new ForbiddenError("Only a moderator can lock threads.", "forbidden");
    }
    data.status = params.patch.lock ? "LOCKED" : "OPEN";
    auditCalls.push(() =>
      recordAuditEvent({
        entityType: auditEntityTypes.discussionThread,
        entityId: thread.id,
        action: auditActions.discussion.threadModerated,
        actorId: params.access.userId,
        metadata: { courseId: course.id, threadId: thread.id, change: params.patch.lock ? "locked" : "unlocked" },
      }),
    );
  }

  // 4) Aksepter/avaksepter svar — spørrer eller moderator, kun QUESTION.
  if (params.patch.acceptedReplyId !== undefined) {
    if (!(isOwn || viewer.canModerate)) {
      throw new ForbiddenError("Only the asker or a moderator can accept an answer.", "forbidden");
    }
    if (thread.kind !== "QUESTION") {
      throw new ForbiddenError("Only questions can have an accepted answer.", "invalid_thread_kind");
    }
    if (params.patch.acceptedReplyId === null) {
      data.acceptedReplyId = null;
      data.status = "OPEN";
      auditCalls.push(() =>
        recordAuditEvent({
          entityType: auditEntityTypes.discussionThread,
          entityId: thread.id,
          action: auditActions.discussion.threadModerated,
          actorId: params.access.userId,
          metadata: { courseId: course.id, threadId: thread.id, change: "answer_unaccepted" },
        }),
      );
    } else {
      const reply = await prisma.discussionReply.findFirst({
        where: { id: params.patch.acceptedReplyId, threadId: thread.id, deletedAt: null },
        select: { id: true },
      });
      if (!reply) {
        throw new NotFoundError("DiscussionReply", "reply_not_found", "Reply not found in this thread.");
      }
      data.acceptedReplyId = reply.id;
      data.status = "RESOLVED";
      const replyId = reply.id;
      auditCalls.push(() =>
        recordAuditEvent({
          entityType: auditEntityTypes.discussionThread,
          entityId: thread.id,
          action: auditActions.discussion.answerAccepted,
          actorId: params.access.userId,
          metadata: { courseId: course.id, threadId: thread.id, replyId },
        }),
      );
    }
  }

  if (Object.keys(data).length === 0) {
    // Ingen gyldige felter — returner uendret.
    return toThreadDetailDto(thread, viewer);
  }

  await prisma.discussionThread.update({ where: { id: thread.id }, data });
  for (const call of auditCalls) await call();

  const updated = await loadThreadInCourse(course.id, thread.id);
  return toThreadDetailDto(updated, viewer);
}

export async function deleteThread(params: {
  courseId: string;
  threadId: string;
  access: AccessContext;
}): Promise<void> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const thread = await loadThreadInCourse(course.id, params.threadId);
  const isOwn = thread.authorId === params.access.userId;
  if (!(isOwn || isModerator(params.access.roles))) {
    throw new ForbiddenError("You cannot delete this thread.", "forbidden");
  }
  if (thread.deletedAt) return; // idempotent
  await prisma.discussionThread.update({
    where: { id: thread.id },
    data: { deletedAt: new Date(), deletedById: params.access.userId },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.discussionThread,
    entityId: thread.id,
    action: auditActions.discussion.threadDeleted,
    actorId: params.access.userId,
    metadata: { courseId: course.id, threadId: thread.id },
  });
}

export async function createReply(params: {
  courseId: string;
  threadId: string;
  bodyMarkdown: string;
  access: AccessContext;
}): Promise<DiscussionThreadDetailDto> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const thread = await loadThreadInCourse(course.id, params.threadId);
  if (thread.deletedAt) {
    throw new NotFoundError("DiscussionThread", "thread_not_found", "Discussion thread not found.");
  }
  if (thread.status === "LOCKED") {
    throw new ForbiddenError("This thread is locked.", "thread_locked");
  }
  await assertScopeWritable(course, thread.courseItemId);

  await prisma.$transaction(async (tx) => {
    await tx.discussionReply.create({
      data: { threadId: thread.id, authorId: params.access.userId, bodyMarkdown: params.bodyMarkdown },
    });
    // Bump trådens updatedAt så «siste aktivitet»-sortering reflekterer svaret.
    await tx.discussionThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    // Auto-abonner forfatter (idempotent).
    await tx.discussionSubscription.upsert({
      where: { threadId_userId: { threadId: thread.id, userId: params.access.userId } },
      create: { threadId: thread.id, userId: params.access.userId },
      update: {},
    });
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.discussionReply,
    entityId: thread.id,
    action: auditActions.discussion.replyCreated,
    actorId: params.access.userId,
    metadata: { courseId: course.id, threadId: thread.id },
  });

  const updated = await loadThreadInCourse(course.id, thread.id);
  return toThreadDetailDto(updated, viewerOf(params.access));
}

async function loadReplyInThread(courseId: string, threadId: string, replyId: string) {
  const reply = await prisma.discussionReply.findFirst({
    where: { id: replyId, threadId, thread: { courseId } },
    select: { id: true, authorId: true, deletedAt: true },
  });
  if (!reply) {
    throw new NotFoundError("DiscussionReply", "reply_not_found", "Reply not found in this thread.");
  }
  return reply;
}

export async function updateReply(params: {
  courseId: string;
  threadId: string;
  replyId: string;
  bodyMarkdown: string;
  access: AccessContext;
}): Promise<DiscussionThreadDetailDto> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const reply = await loadReplyInThread(course.id, params.threadId, params.replyId);
  if (reply.deletedAt) {
    throw new NotFoundError("DiscussionReply", "reply_not_found", "Reply not found in this thread.");
  }
  if (reply.authorId !== params.access.userId) {
    throw new ForbiddenError("Only the author can edit this reply.", "forbidden");
  }
  await prisma.discussionReply.update({
    where: { id: reply.id },
    data: { bodyMarkdown: params.bodyMarkdown },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.discussionReply,
    entityId: reply.id,
    action: auditActions.discussion.replyEdited,
    actorId: params.access.userId,
    metadata: { courseId: course.id, threadId: params.threadId },
  });
  const updated = await loadThreadInCourse(course.id, params.threadId);
  return toThreadDetailDto(updated, viewerOf(params.access));
}

export async function deleteReply(params: {
  courseId: string;
  threadId: string;
  replyId: string;
  access: AccessContext;
}): Promise<void> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const reply = await loadReplyInThread(course.id, params.threadId, params.replyId);
  const isOwn = reply.authorId === params.access.userId;
  if (!(isOwn || isModerator(params.access.roles))) {
    throw new ForbiddenError("You cannot delete this reply.", "forbidden");
  }
  if (reply.deletedAt) return; // idempotent
  await prisma.discussionReply.update({
    where: { id: reply.id },
    data: { deletedAt: new Date(), deletedById: params.access.userId },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.discussionReply,
    entityId: reply.id,
    action: auditActions.discussion.replyDeleted,
    actorId: params.access.userId,
    metadata: { courseId: course.id, threadId: params.threadId },
  });
}

export async function setSubscription(params: {
  courseId: string;
  threadId: string;
  subscribed: boolean;
  access: AccessContext;
}): Promise<{ subscribed: boolean }> {
  const course = await loadAccessibleCourse(params.courseId, params.access);
  const thread = await loadThreadInCourse(course.id, params.threadId);
  if (params.subscribed) {
    await prisma.discussionSubscription.upsert({
      where: { threadId_userId: { threadId: thread.id, userId: params.access.userId } },
      create: { threadId: thread.id, userId: params.access.userId },
      update: {},
    });
  } else {
    await prisma.discussionSubscription.deleteMany({
      where: { threadId: thread.id, userId: params.access.userId },
    });
  }
  return { subscribed: params.subscribed };
}
