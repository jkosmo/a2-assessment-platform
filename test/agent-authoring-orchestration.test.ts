// Integration tests for AA-2 (#650): agent-friendly create/import responses.
// Exercises the exact orchestration sequence the authoring skill will run
// (validate → import modules → create draft section → create course → set items)
// and verifies the AA-2 guarantees: everything stays draft, responses carry
// admin links + clientRef echo, and both ADMINISTRATOR and SUBJECT_MATTER_OWNER
// can run the flow.

import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

// Mock-auth auto-provisions the user; the roles header defines the effective role set.
const smoHeaders = {
  "x-user-id": "smo-agent-650",
  "x-user-email": "smo.agent650@company.com",
  "x-user-name": "SMO Agent",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const freetextOnlyVersion = {
  assessmentMode: "FREETEXT_ONLY",
  taskText: "Beskriv behandlingsgrunnlaget.",
  assessorExpectedContent: "Nevner artikkel 6.",
  rubric: { criteria: { relevance: "0-4" }, scalingRule: { max_total: 20 } },
  promptTemplate: { systemPrompt: "Sys", userPromptTemplate: "Eval" },
};

const mcqSet = {
  title: "Quiz",
  questions: [{ stem: "1+1?", options: ["2", "3"], correctAnswer: "2" }],
};

// The skill synthesizes a module-scoped a2-content-export/v1 envelope per module
// object (empty audit → no publish history → can never auto-publish).
function moduleEnvelope(title: string, activeVersion: Record<string, unknown>) {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: new Date().toISOString(),
    scope: "module",
    module: {
      module: { title, certificationLevel: "basic" },
      activeVersion: { ...activeVersion, audit: {} },
    },
  };
}

async function importDraftModule(
  headers: Record<string, string>,
  title: string,
  activeVersion: Record<string, unknown>,
  clientRef?: string,
) {
  const response = await request(app)
    .post("/api/admin/content/modules/import")
    .set(headers)
    .send({
      payload: moduleEnvelope(title, activeVersion),
      mode: "createNew",
      autoPublish: false,
      ...(clientRef ? { clientRef } : {}),
    });
  expect(response.status).toBe(201);
  return response.body as {
    moduleId: string;
    moduleVersionId: string;
    links: { conversation: string; advanced: string };
    clientRef?: string;
  };
}

describe("#650 agent-friendly authoring orchestration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs the full skill sequence as ADMINISTRATOR: drafts only, links and clientRef echo everywhere", async () => {
    const suffix = `aa2-admin-${Date.now()}`;

    // 1. Module import (FREETEXT_ONLY) — draft + agent-friendly response.
    const module1 = await importDraftModule(adminHeaders, `AA2 module ${suffix}`, freetextOnlyVersion, "module-1");
    expect(module1.clientRef).toBe("module-1");
    expect(module1.links).toEqual({
      conversation: `/admin-content/module/${module1.moduleId}/conversation`,
      advanced: `/admin-content/module/${module1.moduleId}/advanced`,
    });
    const moduleRow = await prisma.module.findUniqueOrThrow({
      where: { id: module1.moduleId },
      select: { activeVersionId: true, createdById: true },
    });
    expect(moduleRow.activeVersionId).toBeNull(); // draft
    expect(moduleRow.createdById).not.toBeNull(); // ownership tracked

    // 2. Draft section — activeVersionId stays null, content preserved in v1.
    const sectionResponse = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({ title: `AA2 section ${suffix}`, bodyMarkdown: "## Innhold", draft: true, clientRef: "intro" });
    expect(sectionResponse.status).toBe(201);
    expect(sectionResponse.body.clientRef).toBe("intro");
    const sectionId = sectionResponse.body.section.id as string;
    expect(sectionResponse.body.links).toEqual({ editor: `/admin-content/sections?id=${sectionId}` });
    expect(sectionResponse.body.section.activeVersionId).toBeNull();
    const versionCount = await prisma.courseSectionVersion.count({ where: { sectionId } });
    expect(versionCount).toBe(1);

    // 3. Course create — draft + links + echo.
    const courseResponse = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({ title: `AA2 course ${suffix}`, clientRef: "course-main" });
    expect(courseResponse.status).toBe(201);
    const courseId = courseResponse.body.course.id as string;
    expect(courseResponse.body.clientRef).toBe("course-main");
    expect(courseResponse.body.links).toEqual({ course: `/admin-content/courses/${courseId}` });
    expect(courseResponse.body.course.publishedAt).toBeNull();

    // 4. Mixed item sequence.
    const itemsResponse = await request(app)
      .put(`/api/admin/content/courses/${courseId}/items`)
      .set(adminHeaders)
      .send({
        items: [
          { type: "SECTION", sectionId },
          { type: "MODULE", moduleId: module1.moduleId },
        ],
      });
    expect(itemsResponse.status).toBe(204);

    const itemsRead = await request(app)
      .get(`/api/admin/content/courses/${courseId}/items`)
      .set(adminHeaders);
    expect(itemsRead.status).toBe(200);
    expect(
      itemsRead.body.items.map((item: { type: string; moduleId: string | null; sectionId: string | null }) => ({
        type: item.type,
        id: item.moduleId ?? item.sectionId,
      })),
    ).toEqual([
      { type: "SECTION", id: sectionId },
      { type: "MODULE", id: module1.moduleId },
    ]);

    // Nothing became live along the way.
    const courseRow = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { publishedAt: true } });
    expect(courseRow.publishedAt).toBeNull();
  });

  it("imports draft modules in all three assessment modes (never published)", async () => {
    const suffix = Date.now();
    const variants: Array<[string, Record<string, unknown>]> = [
      [`AA2 freetext-only ${suffix}`, freetextOnlyVersion],
      [`AA2 mcq-only ${suffix}`, { assessmentMode: "MCQ_ONLY", mcqSet }],
      [`AA2 freetext-plus-mcq ${suffix}`, { ...freetextOnlyVersion, assessmentMode: "FREETEXT_PLUS_MCQ", mcqSet }],
    ];
    for (const [title, activeVersion] of variants) {
      const imported = await importDraftModule(adminHeaders, title, activeVersion);
      const row = await prisma.module.findUniqueOrThrow({
        where: { id: imported.moduleId },
        select: { activeVersionId: true },
      });
      expect(row.activeVersionId).toBeNull();
    }
  });

  it("lets a SUBJECT_MATTER_OWNER run the same flow and records ownership", async () => {
    const suffix = `aa2-smo-${Date.now()}`;

    const imported = await importDraftModule(smoHeaders, `AA2 SMO module ${suffix}`, freetextOnlyVersion, "smo-module");
    expect(imported.clientRef).toBe("smo-module");
    const smoUser = await prisma.user.findUniqueOrThrow({
      where: { externalId: "smo-agent-650" },
      select: { id: true },
    });
    const moduleRow = await prisma.module.findUniqueOrThrow({
      where: { id: imported.moduleId },
      select: { activeVersionId: true, createdById: true },
    });
    expect(moduleRow.activeVersionId).toBeNull();
    expect(moduleRow.createdById).toBe(smoUser.id);

    const sectionResponse = await request(app)
      .post("/api/admin/content/sections")
      .set(smoHeaders)
      .send({ title: `AA2 SMO section ${suffix}`, bodyMarkdown: "## SMO", draft: true });
    expect(sectionResponse.status).toBe(201);
    expect(sectionResponse.body.section.activeVersionId).toBeNull();

    const courseResponse = await request(app)
      .post("/api/admin/content/courses")
      .set(smoHeaders)
      .send({ title: `AA2 SMO course ${suffix}` });
    expect(courseResponse.status).toBe(201);

    const itemsResponse = await request(app)
      .put(`/api/admin/content/courses/${courseResponse.body.course.id}/items`)
      .set(smoHeaders)
      .send({
        items: [
          { type: "SECTION", sectionId: sectionResponse.body.section.id },
          { type: "MODULE", moduleId: imported.moduleId },
        ],
      });
    expect(itemsResponse.status).toBe(204);
  });

  it("keeps the default section-create behavior (auto-publish) when draft is not set", async () => {
    const response = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({ title: `AA2 default section ${Date.now()}`, bodyMarkdown: "## Publisert" });
    expect(response.status).toBe(201);
    expect(response.body.section.activeVersionId).not.toBeNull();
    expect(response.body.section.bodyMarkdown).toBe("## Publisert");
  });
});
