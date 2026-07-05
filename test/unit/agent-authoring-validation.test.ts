// AA-1 (#649): unit tests for the agent-authoring package validation rules.
// DB lookups are stubbed via the injectable lookups parameter; prisma is mocked
// so importing the service never touches a database.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/prisma.js", () => ({ prisma: {} }));

import {
  validateAuthoringPackage,
  type AuthoringValidationLookups,
} from "../../src/modules/adminContent/agentAuthoringValidationService.js";

function emptyLookups(overrides: Partial<AuthoringValidationLookups> = {}): AuthoringValidationLookups {
  return {
    listActiveModuleTitles: async () => [],
    listActiveCourseTitles: async () => [],
    listActiveSectionTitles: async () => [],
    findExistingModuleIds: async () => new Set(),
    findExistingSectionIds: async () => new Set(),
    ...overrides,
  };
}

const freetextVersion = {
  assessmentMode: "FREETEXT_ONLY",
  taskText: "Describe the processing basis.",
  assessorExpectedContent: "Mentions article 6.",
  rubric: { criteria: { relevance: "0-4" }, scalingRule: { max_total: 20 } },
  promptTemplate: { systemPrompt: "Sys", userPromptTemplate: "Eval" },
};

const mcqSet = {
  title: "Quiz",
  questions: [
    { stem: "1+1?", options: ["2", "3"], correctAnswer: "2" },
  ],
};

function fullPackage() {
  return {
    packageFormat: "a2-authoring-package/v1",
    locale: "nb",
    constraints: { source: "unit test" },
    objects: [
      {
        clientRef: "intro",
        type: "section",
        payload: { title: "Introduksjon", bodyMarkdown: "## Innhold" },
      },
      {
        clientRef: "module-1",
        type: "module",
        payload: {
          module: { title: "Behandlingsgrunnlag", certificationLevel: "basic" },
          activeVersion: freetextVersion,
        },
      },
      {
        clientRef: "course-main",
        type: "course",
        payload: {
          course: { title: "GDPR for saksbehandlere" },
          items: [
            { type: "SECTION", ref: "intro" },
            { type: "MODULE", ref: "module-1" },
          ],
        },
      },
    ],
  };
}

describe("#649 agent authoring package validation", () => {
  it("accepts a valid package and returns a topologically ordered plan", async () => {
    const report = await validateAuthoringPackage(fullPackage(), emptyLookups());
    expect(report.valid).toBe(true);
    expect(report.summary).toEqual({ errors: 0, warnings: 0, objects: 3 });
    expect(report.issues).toEqual([]);
    expect(report.plan).toEqual([
      { op: "create_section", clientRef: "intro" },
      { op: "create_module", clientRef: "module-1" },
      { op: "create_course", clientRef: "course-main" },
      { op: "set_course_items", clientRef: "course-main" },
    ]);
  });

  it("rejects duplicate clientRefs", async () => {
    const pkg = fullPackage();
    pkg.objects[1].clientRef = "intro";
    const report = await validateAuthoringPackage(pkg, emptyLookups());
    expect(report.valid).toBe(false);
    expect(report.plan).toEqual([]);
    const issue = report.issues.find((entry) => entry.code === "duplicate_client_ref");
    expect(issue).toMatchObject({ severity: "error", path: "objects[1].clientRef" });
    // The course's ref to 'module-1' now also dangles — both problems are reported.
    expect(report.issues.some((entry) => entry.code === "unknown_client_ref")).toBe(true);
  });

  it("rejects course item refs that do not exist in the package", async () => {
    const pkg = fullPackage();
    (pkg.objects[2].payload as { items: unknown[] }).items = [{ type: "MODULE", ref: "module-7" }];
    const report = await validateAuthoringPackage(pkg, emptyLookups());
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "unknown_client_ref",
        path: "objects[2].payload.items[0].ref",
      }),
    );
  });

  it("rejects refs pointing to an object of the wrong type", async () => {
    const pkg = fullPackage();
    (pkg.objects[2].payload as { items: unknown[] }).items = [{ type: "MODULE", ref: "intro" }];
    const report = await validateAuthoringPackage(pkg, emptyLookups());
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "client_ref_type_mismatch", path: "objects[2].payload.items[0].ref" }),
    );
  });

  it("requires exactly one of ref and server ID on course items", async () => {
    const pkg = fullPackage();
    (pkg.objects[2].payload as { items: unknown[] }).items = [
      { type: "MODULE", ref: "module-1", moduleId: "m_existing" },
      { type: "SECTION" },
    ];
    const report = await validateAuthoringPackage(pkg, emptyLookups());
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "ref_and_id_conflict" }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "ref_or_id_required" }));
  });

  it("checks referenced server IDs against the database", async () => {
    const pkg = fullPackage();
    (pkg.objects[2].payload as { items: unknown[] }).items = [
      { type: "MODULE", ref: "module-1" },
      { type: "MODULE", moduleId: "m_known" },
      { type: "SECTION", sectionId: "s_missing" },
    ];
    const report = await validateAuthoringPackage(
      pkg,
      emptyLookups({ findExistingModuleIds: async () => new Set(["m_known"]) }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "unknown_section_id", path: "objects[2].payload.items[2].sectionId" }),
    );
    expect(report.issues.some((entry) => entry.code === "unknown_module_id")).toBe(false);
  });

  describe("assessment modes", () => {
    function modulePackage(activeVersion: Record<string, unknown>) {
      return {
        packageFormat: "a2-authoring-package/v1",
        objects: [
          {
            clientRef: "m1",
            type: "module",
            payload: { module: { title: "Mode test" }, activeVersion },
          },
        ],
      };
    }

    it("MCQ_ONLY requires mcqSet and forbids free-text fields", async () => {
      const missing = await validateAuthoringPackage(
        modulePackage({ assessmentMode: "MCQ_ONLY" }),
        emptyLookups(),
      );
      expect(missing.issues).toContainEqual(
        expect.objectContaining({ code: "required_for_mode", path: "objects[0].payload.activeVersion.mcqSet" }),
      );

      const withFreetext = await validateAuthoringPackage(
        modulePackage({ assessmentMode: "MCQ_ONLY", mcqSet, taskText: "Not allowed" }),
        emptyLookups(),
      );
      expect(withFreetext.issues).toContainEqual(
        expect.objectContaining({ code: "forbidden_for_mode", path: "objects[0].payload.activeVersion.taskText" }),
      );
    });

    it("FREETEXT_ONLY requires the free-text triple and forbids mcqSet", async () => {
      const report = await validateAuthoringPackage(
        modulePackage({ assessmentMode: "FREETEXT_ONLY", taskText: "Task", mcqSet }),
        emptyLookups(),
      );
      const codes = report.issues.map((entry) => `${entry.code}:${entry.path}`);
      expect(codes).toContain("required_for_mode:objects[0].payload.activeVersion.rubric");
      expect(codes).toContain("required_for_mode:objects[0].payload.activeVersion.promptTemplate");
      expect(codes).toContain("forbidden_for_mode:objects[0].payload.activeVersion.mcqSet");
    });

    it("FREETEXT_PLUS_MCQ is the default mode and requires all four fields", async () => {
      const report = await validateAuthoringPackage(modulePackage({}), emptyLookups());
      const required = report.issues.filter((entry) => entry.code === "required_for_mode");
      expect(required.map((entry) => entry.path).sort()).toEqual([
        "objects[0].payload.activeVersion.mcqSet",
        "objects[0].payload.activeVersion.promptTemplate",
        "objects[0].payload.activeVersion.rubric",
        "objects[0].payload.activeVersion.taskText",
      ]);

      const valid = await validateAuthoringPackage(
        modulePackage({ taskText: "T", rubric: freetextVersion.rubric, promptTemplate: freetextVersion.promptTemplate, mcqSet }),
        emptyLookups(),
      );
      expect(valid.valid).toBe(true);
    });
  });

  it("rejects publish/audit fields as unknown_field", async () => {
    const pkg = fullPackage();
    (pkg.objects[1].payload as Record<string, unknown>).audit = { publishedAt: "2026-01-01T00:00:00Z" };
    (pkg as Record<string, unknown>).autoPublish = true;
    const report = await validateAuthoringPackage(pkg, emptyLookups());
    expect(report.valid).toBe(false);
    const unknownFieldIssues = report.issues.filter((entry) => entry.code === "unknown_field");
    expect(unknownFieldIssues.length).toBeGreaterThanOrEqual(2);
  });

  it("warns (without blocking) on possible duplicate titles and module-less courses", async () => {
    const pkg = fullPackage();
    (pkg.objects[2].payload as { items: unknown[] }).items = [{ type: "SECTION", ref: "intro" }];
    const report = await validateAuthoringPackage(
      pkg,
      emptyLookups({
        listActiveModuleTitles: async () => [
          { id: "m_abc123", title: JSON.stringify({ "en-GB": "Legal basis", nb: "Behandlingsgrunnlag" }) },
        ],
      }),
    );
    expect(report.valid).toBe(true);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "possible_duplicate_title",
        path: "objects[1].payload.module.title",
        message: expect.stringContaining("m_abc123"),
      }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "course_without_modules" }),
    );
    expect(report.summary.warnings).toBe(2);
  });

  it("returns structural schema errors with paths and no plan", async () => {
    const report = await validateAuthoringPackage(
      {
        packageFormat: "a2-authoring-package/v1",
        objects: [{ clientRef: "Bad Ref!", type: "module", payload: { module: {}, activeVersion: {} } }],
      },
      emptyLookups(),
    );
    expect(report.valid).toBe(false);
    expect(report.plan).toEqual([]);
    expect(report.summary.objects).toBe(1);
    expect(report.issues.some((entry) => entry.path === "objects[0].clientRef")).toBe(true);
    expect(report.issues.some((entry) => entry.path === "objects[0].payload.module.title")).toBe(true);
  });
});
