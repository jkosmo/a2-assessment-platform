import { renderDiscussionMarkdown } from "./userGeneratedContentSanitizer.js";

/**
 * DTO-formatering for diskusjon (#495/T-QA-2). All UGC rendres her gjennom den strenge
 * {@link renderDiscussionMarkdown}. To prinsipper fra doc/DISCUSSIONS_DESIGN.md håndheves:
 *  - Soft-delete: slettede innlegg beholder raden men eksponerer hverken tittel eller tekst
 *    (klienten viser «Slettet innlegg» fra egen i18n). `deleted: true` signaliserer dette.
 *  - Anonymiserte brukere (User.isAnonymized) eksponeres uten navn (`anonymized: true`),
 *    klienten viser «Slettet bruker».
 * UGC er énspråklig — vi sender ferdig-rendret HTML, ikke lokalisert JSON.
 */

export type DiscussionAuthorDto = {
  id: string;
  name: string | null;
  anonymized: boolean;
} | null;

export type DiscussionReplyDto = {
  id: string;
  bodyHtml: string | null;
  deleted: boolean;
  author: DiscussionAuthorDto;
  createdAt: string;
  updatedAt: string;
  isAccepted: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type DiscussionThreadSummaryDto = {
  id: string;
  courseId: string;
  courseItemId: string | null;
  kind: string;
  status: string;
  title: string | null;
  deleted: boolean;
  pinned: boolean;
  acceptedReplyId: string | null;
  author: DiscussionAuthorDto;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
  canModerate: boolean;
};

export type DiscussionThreadDetailDto = Omit<DiscussionThreadSummaryDto, "replyCount"> & {
  bodyHtml: string | null;
  isSubscribed: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAccept: boolean;
  replies: DiscussionReplyDto[];
};

export type ViewerContext = {
  userId: string;
  canModerate: boolean;
};

type AuthorRow = { id: string; name: string; isAnonymized: boolean } | null;

export function toAuthorDto(author: AuthorRow): DiscussionAuthorDto {
  if (!author) return null;
  if (author.isAnonymized) return { id: author.id, name: null, anonymized: true };
  return { id: author.id, name: author.name, anonymized: false };
}

export type ThreadSummaryRow = {
  id: string;
  courseId: string;
  courseItemId: string | null;
  kind: string;
  status: string;
  title: string;
  pinnedAt: Date | null;
  acceptedReplyId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: AuthorRow;
  _count: { replies: number };
};

export function toThreadSummaryDto(
  row: ThreadSummaryRow,
  viewer: ViewerContext,
): DiscussionThreadSummaryDto {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    courseId: row.courseId,
    courseItemId: row.courseItemId,
    kind: row.kind,
    status: row.status,
    title: deleted ? null : row.title,
    deleted,
    pinned: row.pinnedAt !== null,
    acceptedReplyId: row.acceptedReplyId,
    author: toAuthorDto(row.author),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    replyCount: row._count.replies,
    canModerate: viewer.canModerate,
  };
}

export type ReplyRow = {
  id: string;
  authorId: string;
  bodyMarkdown: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: AuthorRow;
};

export function toReplyDto(
  row: ReplyRow,
  viewer: ViewerContext,
  acceptedReplyId: string | null,
): DiscussionReplyDto {
  const deleted = row.deletedAt !== null;
  const isOwn = row.authorId === viewer.userId;
  return {
    id: row.id,
    bodyHtml: deleted ? null : renderDiscussionMarkdown(row.bodyMarkdown),
    deleted,
    author: toAuthorDto(row.author),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isAccepted: acceptedReplyId !== null && acceptedReplyId === row.id,
    canEdit: !deleted && isOwn,
    canDelete: !deleted && (isOwn || viewer.canModerate),
  };
}

export type ThreadDetailRow = ThreadSummaryRow & {
  authorId: string;
  bodyMarkdown: string;
  replies: ReplyRow[];
  subscriptions: Array<{ userId: string }>;
};

export function toThreadDetailDto(
  row: ThreadDetailRow,
  viewer: ViewerContext,
): DiscussionThreadDetailDto {
  const deleted = row.deletedAt !== null;
  const isOwn = row.authorId === viewer.userId;
  return {
    id: row.id,
    courseId: row.courseId,
    courseItemId: row.courseItemId,
    kind: row.kind,
    status: row.status,
    title: deleted ? null : row.title,
    bodyHtml: deleted ? null : renderDiscussionMarkdown(row.bodyMarkdown),
    deleted,
    pinned: row.pinnedAt !== null,
    acceptedReplyId: row.acceptedReplyId,
    author: toAuthorDto(row.author),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isSubscribed: row.subscriptions.some((s) => s.userId === viewer.userId),
    canEdit: !deleted && isOwn,
    canDelete: !deleted && (isOwn || viewer.canModerate),
    // Akseptert svar settes av spørrer (på QUESTION) eller moderator.
    canAccept: !deleted && row.kind === "QUESTION" && (isOwn || viewer.canModerate),
    canModerate: viewer.canModerate,
    replies: row.replies.map((r) => toReplyDto(r, viewer, row.acceptedReplyId)),
  };
}
