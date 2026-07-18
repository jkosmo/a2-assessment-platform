-- #502: drop the deprecated CourseModule join table.
--
-- Since #480 (expand-contract), CourseItem is the single source of truth for a course's ordered
-- modules + sections: every READ derives modules from CourseItem (itemType = MODULE) and every WRITE
-- goes through CourseItem. CourseModule rows were only ever cleaned up on delete — no code reads or
-- writes them as truth. Dropping the table is therefore safe (no data loss of record).
--
-- CourseModule is a pure join table with no INCOMING foreign keys, so DROP TABLE also removes its
-- own primary key, foreign keys (courseId → Course, moduleId → Module) and the moduleId index.

DROP TABLE "CourseModule";
