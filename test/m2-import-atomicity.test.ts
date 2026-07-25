import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { importModuleFromEnvelope, importCourseFromEnvelope } from "../src/modules/adminContent/contentImportService.js";
import type { ExportEnvelope } from "../src/modules/adminContent/adminContentSchemas.js";

// #796: a content import builds its whole module/course graph in ONE transaction. A failure partway
// through must roll the ENTIRE import back — no standalone modules, partial versions, or a half-built
// course. This proves that against a real Postgres by importing envelopes that fail mid-graph and
// asserting nothing persisted, plus a success case that persists the whole graph + the import audit.

let actorId: string;

// A module payload. `withRubric: false` omits the rubric block while keeping FREETEXT_PLUS_MCQ mode, so
// createModuleVersion throws ("Rubric and prompt template are required") AFTER createModule + prompt + mcq
// have already run inside the tx — a clean mid-graph failure that must roll all of them back.
function modulePayload(title: string, withRubric = true) {
  return {
    module: { title, description: "d", certificationLevel: "foundation" },
    activeVersion: {
      assessmentMode: "FREETEXT_PLUS_MCQ",
      taskText: "Do the task",
      assessorExpectedContent: "Expected",
      candidateTaskConstraints: "Constraints",
      assessmentBlueprint: "bp",
      ...(withRubric ? { rubric: { criteria: { c1: 1 }, scalingRule: { practical_weight: 70 } } } : {}),
      promptTemplate: { systemPrompt: "system", userPromptTemplate: "template", examples: [] },
      mcqSet: {
        title: "Quiz",
        questions: [{ stem: "Q?", options: ["A", "B"], correctAnswer: "A", rationale: "because" }],
      },
      audit: { publishedAt: null, publishedBy: null, sourceVersionNo: null },
    },
  };
}

function moduleEnvelope(title: string, withRubric = true): ExportEnvelope {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-07-25T00:00:00.000Z",
    scope: "module",
    module: modulePayload(title, withRubric),
  } as unknown as ExportEnvelope;
}

function courseEnvelope(courseTitle: string, moduleTitles: Array<{ title: string; withRubric?: boolean }>): ExportEnvelope {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-07-25T00:00:00.000Z",
    scope: "course",
    course: {
      course: {
        title: courseTitle,
        description: "d",
        certificationLevel: "foundation",
        audit: { publishedAt: null },
        items: moduleTitles.map((m, i) => ({
          type: "MODULE",
          sortOrder: i,
          module: modulePayload(m.title, m.withRubric ?? true),
        })),
      },
    },
  } as unknown as ExportEnvelope;
}

const moduleCount = (title: string) => prisma.module.count({ where: { title } });
const courseCount = (title: string) => prisma.course.count({ where: { title } });

describe("content import is atomic (#796)", () => {
  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        externalId: `imp-${Date.now()}-${Math.random()}`,
        name: "Importer",
        email: `imp-${Date.now()}-${Math.random()}@x.test`,
      },
      select: { id: true },
    });
    actorId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("module import: a mid-graph failure rolls the whole module back (no standalone module/versions)", async () => {
    const title = `atomic-mod-fail-${Date.now()}-${Math.random()}`;
    await expect(
      importModuleFromEnvelope(moduleEnvelope(title, false), { actorId, mode: "createNew" }),
    ).rejects.toThrow(/Rubric and prompt template are required/);

    // Rolled back: the module (created before the failing createModuleVersion) must not exist.
    expect(await moduleCount(title)).toBe(0);
  });

  it("module import: success persists the module + version + the module_imported audit", async () => {
    const title = `atomic-mod-ok-${Date.now()}-${Math.random()}`;
    const result = await importModuleFromEnvelope(moduleEnvelope(title, true), { actorId, mode: "createNew" });

    expect(await moduleCount(title)).toBe(1);
    const version = await prisma.moduleVersion.findUnique({ where: { id: result.moduleVersionId } });
    expect(version).not.toBeNull();
    const audit = await prisma.auditEvent.count({
      where: { entityType: "module", entityId: result.moduleId, action: "module_imported" },
    });
    expect(audit).toBe(1);
  });

  it("course import: a failure on module 2 rolls back the whole course (no course, no module 1)", async () => {
    const courseTitle = `atomic-course-fail-${Date.now()}-${Math.random()}`;
    const mod1 = `atomic-c-mod1-${Date.now()}-${Math.random()}`;
    const mod2 = `atomic-c-mod2-${Date.now()}-${Math.random()}`;

    await expect(
      importCourseFromEnvelope(courseEnvelope(courseTitle, [{ title: mod1 }, { title: mod2, withRubric: false }]), {
        actorId,
        mode: "createNew",
      }),
    ).rejects.toThrow(/Rubric and prompt template are required/);

    // Everything rolls back: no course, and the first (valid) module created earlier in the tx is gone too.
    expect(await courseCount(courseTitle)).toBe(0);
    expect(await moduleCount(mod1)).toBe(0);
    expect(await moduleCount(mod2)).toBe(0);
  });

  it("course import: success persists the course, its modules, and the course items", async () => {
    const courseTitle = `atomic-course-ok-${Date.now()}-${Math.random()}`;
    const mod1 = `atomic-ok-mod1-${Date.now()}-${Math.random()}`;
    const mod2 = `atomic-ok-mod2-${Date.now()}-${Math.random()}`;

    const result = await importCourseFromEnvelope(
      courseEnvelope(courseTitle, [{ title: mod1 }, { title: mod2 }]),
      { actorId, mode: "createNew" },
    );

    expect(await courseCount(courseTitle)).toBe(1);
    expect(result.moduleIds).toHaveLength(2);
    expect(await moduleCount(mod1)).toBe(1);
    expect(await moduleCount(mod2)).toBe(1);
    const items = await prisma.courseItem.count({ where: { courseId: result.courseId, itemType: "MODULE" } });
    expect(items).toBe(2);
  });
});
