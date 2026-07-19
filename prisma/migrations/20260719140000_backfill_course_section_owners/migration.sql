-- #787: backfill Course/CourseSection owners from the "created" audit event's actor, so that
-- ownership enforcement (a later slice) does not leave existing content admin-only. Course/Section have
-- no createdById column (unlike Class/Module, already backfilled in 20260719130000), so the creator is
-- recovered from the earliest course_created / section_created AuditEvent. A non-null AuditEvent.actorId
-- always references a live User (actor FK is onDelete: SetNull), so the ContentOwner.userId FK holds.
--
-- Data-only migration. Idempotent (NOT EXISTS guard). Content with no "created" audit stays UNOWNED →
-- admin-managed until an owner is assigned (the deliberate no-frozen-limbo). Runs against empty tables
-- in CI (0 rows) and against real data on stage/prod.

-- CreateOwners: Course
INSERT INTO "ContentOwner" ("id", "contentType", "contentId", "userId", "addedById", "addedAt")
SELECT gen_random_uuid()::text, 'COURSE'::"ContentOwnerType", c."id", ae."actorId", NULL, CURRENT_TIMESTAMP
FROM "Course" c
CROSS JOIN LATERAL (
    SELECT "actorId"
    FROM "AuditEvent"
    WHERE "action" = 'course_created' AND "entityId" = c."id" AND "actorId" IS NOT NULL
    ORDER BY "timestamp" ASC
    LIMIT 1
) ae
WHERE NOT EXISTS (
    SELECT 1 FROM "ContentOwner" co
    WHERE co."contentType" = 'COURSE' AND co."contentId" = c."id"
);

-- CreateOwners: CourseSection
INSERT INTO "ContentOwner" ("id", "contentType", "contentId", "userId", "addedById", "addedAt")
SELECT gen_random_uuid()::text, 'SECTION'::"ContentOwnerType", s."id", ae."actorId", NULL, CURRENT_TIMESTAMP
FROM "CourseSection" s
CROSS JOIN LATERAL (
    SELECT "actorId"
    FROM "AuditEvent"
    WHERE "action" = 'section_created' AND "entityId" = s."id" AND "actorId" IS NOT NULL
    ORDER BY "timestamp" ASC
    LIMIT 1
) ae
WHERE NOT EXISTS (
    SELECT 1 FROM "ContentOwner" co
    WHERE co."contentType" = 'SECTION' AND co."contentId" = s."id"
);
