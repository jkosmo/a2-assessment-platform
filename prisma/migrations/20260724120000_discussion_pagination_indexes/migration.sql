-- #802: discussion reads had no index matching their sort. Replace the prefix-only indexes with composite
-- indexes that cover the thread-list (WHERE courseId, courseItemId ORDER BY pinnedAt desc, updatedAt desc)
-- and the reply load (WHERE threadId ORDER BY createdAt asc). The new indexes have the old ones as a
-- prefix, so dropping the old ones loses no coverage.

DROP INDEX "DiscussionThread_courseId_courseItemId_idx";
CREATE INDEX "DiscussionThread_courseId_courseItemId_pinnedAt_updatedAt_idx" ON "DiscussionThread"("courseId", "courseItemId", "pinnedAt", "updatedAt");

DROP INDEX "DiscussionReply_threadId_idx";
CREATE INDEX "DiscussionReply_threadId_createdAt_idx" ON "DiscussionReply"("threadId", "createdAt");
