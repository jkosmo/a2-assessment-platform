// Integration tests for AA-1 (#649): POST /api/admin/content/agent-authoring/validate.
// Verifies the endpoint contract (report shape, 400/403 behavior) and — critically —
// that validate performs NO database writes, including for valid packages.
//
// Vitest integration profile (vitest.integration.config.ts) provides a real
// Postgres test DB; assumes the seeded admin-1 user like the other admin tests.

import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

function validPackage(suffix: string) {
  return {
    packageFormat: "a2-authoring-package/v1",
    locale: "nb",
    constraints: { source: "integration test" },
    objects: [
      {
        clientRef: "intro",
        type: "section",
        payload: { title: `Authoring intro ${suffix}`, bodyMarkdown: "## Velkommen" },
      },
      {
        clientRef: "module-1",
        type: "module",
        payload: {
          module: { title: `Authoring module ${suffix}`, certificationLevel: "basic" },
          activeVersion: {
            assessmentMode: "FREETEXT_ONLY",
            taskText: "Beskriv behandlingsgrunnlaget.",
            assessorExpectedContent: "Nevner artikkel 6.",
            rubric: { criteria: { relevance: "0-4" }, scalingRule: { max_total: 20 } },
            promptTemplate: { systemPrompt: "Sys", userPromptTemplate: "Eval" },
          },
        },
      },
      {
        clientRef: "course-main",
        type: "course",
        payload: {
          course: { title: `Authoring course ${suffix}` },
          items: [
            { type: "SECTION", ref: "intro" },
            { type: "MODULE", ref: "module-1" },
          ],
        },
      },
    ],
  };
}

async function contentCounts() {
  const [modules, courses, sections] = await Promise.all([
    prisma.module.count(),
    prisma.course.count(),
    prisma.courseSection.count(),
  ]);
  return { modules, courses, sections };
}

describe("#649 POST /api/admin/content/agent-authoring/validate", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("validates a well-formed package without writing to the database", async () => {
    const before = await contentCounts();

    const response = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({ package: validPackage(`ok-${Date.now()}`) });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.summary).toEqual({ errors: 0, warnings: 0, objects: 3 });
    expect(response.body.plan).toEqual([
      { op: "create_section", clientRef: "intro" },
      { op: "create_module", clientRef: "module-1" },
      { op: "create_course", clientRef: "course-main" },
      { op: "set_course_items", clientRef: "course-main" },
    ]);

    expect(await contentCounts()).toEqual(before);
  });

  it("returns a 200 report (not an error status) for an invalid package, still without writes", async () => {
    const before = await contentCounts();
    const pkg = validPackage(`bad-${Date.now()}`);
    // Break it three ways: dangling ref, duplicate clientRef, mode violation.
    (pkg.objects[2].payload as { items: unknown[] }).items = [{ type: "MODULE", ref: "does-not-exist" }];
    pkg.objects[0].clientRef = "module-1";
    (pkg.objects[1].payload as { activeVersion: Record<string, unknown> }).activeVersion.mcqSet = {
      title: "Quiz",
      questions: [{ stem: "1+1?", options: ["2", "3"], correctAnswer: "2" }],
    };

    const response = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({ package: pkg });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(false);
    expect(response.body.plan).toEqual([]);
    const codes = (response.body.issues as Array<{ code: string }>).map((issue) => issue.code);
    expect(codes).toContain("unknown_client_ref");
    expect(codes).toContain("duplicate_client_ref");
    expect(codes).toContain("forbidden_for_mode");

    expect(await contentCounts()).toEqual(before);
  });

  it("warns about duplicate titles of existing modules", async () => {
    const suffix = `dup-${Date.now()}`;
    const created = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({ title: `Authoring module ${suffix}` });
    expect(created.status).toBe(201);

    const response = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({ package: validPackage(suffix) });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "possible_duplicate_title",
        message: expect.stringContaining(created.body.module.id),
      }),
    );
  });

  it("rejects requests without a recognizable package with 400", async () => {
    const missing = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("validation_error");

    const wrongFormat = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({ package: { packageFormat: "a2-content-export/v1" } });
    expect(wrongFormat.status).toBe(400);
  });

  it("is admin_content-protected (participants get 403)", async () => {
    const response = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set({
        "x-user-id": "admin-1",
        "x-user-email": "admin@company.com",
        "x-user-name": "Platform Admin",
        "x-user-roles": "PARTICIPANT",
      })
      .send({ package: validPackage("forbidden") });
    expect(response.status).toBe(403);
  });
});
