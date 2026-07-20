-- #787 slice 4a: catch-up backfill of ContentOwner. The original backfills (20260719130000 for
-- Class/Module from createdById, 20260719140000 for Course/Section from the created-audit actor) ran
-- once. Content created BETWEEN those migrations and slice 4a's create-time assignment has no
-- ContentOwner row. This re-runs the same seeding idempotently so that when 4b enforcement lands, no
-- existing content is left unowned (which would lock its creator out → admin-only).
--
-- Data-only. Idempotent (NOT EXISTS guard on every insert). 0 rows in CI (empty tables). Content with
-- no createdById / no created-audit stays UNOWNED → admin-managed (the deliberate no-frozen-limbo).

-- Class → creator from createdById
INSERT INTO "ContentOwner" ("id", "contentType", "contentId", "userId", "addedById", "addedAt")
SELECT gen_random_uuid()::text, 'CLASS'::"ContentOwnerType", c."id", c."createdById", NULL, CURRENT_TIMESTAMP
FROM "Class" c
WHERE c."createdById" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ContentOwner" co WHERE co."contentType" = 'CLASS' AND co."contentId" = c."id"
  );

-- Module → creator from createdById
INSERT INTO "ContentOwner" ("id", "contentType", "contentId", "userId", "addedById", "addedAt")
SELECT gen_random_uuid()::text, 'MODULE'::"ContentOwnerType", m."id", m."createdById", NULL, CURRENT_TIMESTAMP
FROM "Module" m
WHERE m."createdById" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ContentOwner" co WHERE co."contentType" = 'MODULE' AND co."contentId" = m."id"
  );

-- Course → creator from the earliest course_created AuditEvent actor
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
    SELECT 1 FROM "ContentOwner" co WHERE co."contentType" = 'COURSE' AND co."contentId" = c."id"
);

-- CourseSection → creator from the earliest section_created AuditEvent actor
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
    SELECT 1 FROM "ContentOwner" co WHERE co."contentType" = 'SECTION' AND co."contentId" = s."id"
);
