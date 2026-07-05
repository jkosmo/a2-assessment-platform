// AA-4 (#652): happy-path test for the a2-authoring-api skill's reference
// implementation. Boots the real app on an ephemeral port and runs the skill's
// fixture package through skills/a2-authoring-api/scripts/import-package.mjs —
// i.e. the exact HTTP flow an agent following the skill executes. Verifies the
// acceptance criteria: all three assessment modes as drafts, a course with mixed
// section/module order, admin links for every created object, and nothing published.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import {
  importPackage,
  validatePackage,
} from "../skills/a2-authoring-api/scripts/import-package.mjs";

const headers = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

async function loadFixture(suffix: string) {
  const raw = await readFile("skills/a2-authoring-api/fixtures/example-package.json", "utf8");
  // Unique titles per run so possible_duplicate_title warnings from earlier runs
  // don't accumulate and the created rows are identifiable.
  return JSON.parse(raw.replaceAll('"title": "', `"title": "[${suffix}] `));
}

describe("#652 a2-authoring-api skill happy path (fixture package → drafts via API)", () => {
  it("imports the example package end-to-end: drafts, links and mixed course order", async () => {
    const suffix = `skill-${Date.now()}`;
    const pkg = await loadFixture(suffix);

    const result = await importPackage({ baseUrl, headers, pkg });

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.report.valid).toBe(true);

    // 2 sections + 3 modules + 1 course created, in plan order.
    expect(result.created.map((entry) => `${entry.type}:${entry.clientRef}`)).toEqual([
      "section:intro",
      "section:oppsummering",
      "module:modul-behandlingsgrunnlag",
      "module:modul-prinsipper",
      "module:modul-avvik",
      "course:kurs-personvern",
    ]);

    // Every created object carries an admin link.
    for (const entry of result.created) {
      const link = entry.links.conversation ?? entry.links.course ?? entry.links.editor;
      expect(link).toContain(entry.id);
    }

    // All three assessment-mode modules are drafts (never published).
    const moduleEntries = result.created.filter((entry) => entry.type === "module");
    expect(moduleEntries).toHaveLength(3);
    for (const entry of moduleEntries) {
      const row = await prisma.module.findUniqueOrThrow({
        where: { id: entry.id },
        select: { activeVersionId: true },
      });
      expect(row.activeVersionId).toBeNull();
    }
    const modes = await prisma.moduleVersion.findMany({
      where: { moduleId: { in: moduleEntries.map((entry) => entry.id) } },
      select: { assessmentMode: true },
    });
    expect(modes.map((version) => version.assessmentMode).sort()).toEqual([
      "FREETEXT_ONLY",
      "FREETEXT_PLUS_MCQ",
      "MCQ_ONLY",
    ]);

    // Sections are drafts too (draft: true is part of the skill flow).
    for (const entry of result.created.filter((item) => item.type === "section")) {
      const row = await prisma.courseSection.findUniqueOrThrow({
        where: { id: entry.id },
        select: { activeVersionId: true },
      });
      expect(row.activeVersionId).toBeNull();
    }

    // The course is a draft with the fixture's mixed section/module order.
    const courseEntry = result.created.find((entry) => entry.type === "course");
    expect(courseEntry).toBeDefined();
    const course = await prisma.course.findUniqueOrThrow({
      where: { id: courseEntry!.id },
      select: { publishedAt: true, items: { orderBy: { sortOrder: "asc" }, select: { moduleId: true, sectionId: true } } },
    });
    expect(course.publishedAt).toBeNull();
    const byRef = new Map(result.created.map((entry) => [entry.clientRef, entry.id]));
    expect(course.items.map((item) => item.moduleId ?? item.sectionId)).toEqual([
      byRef.get("intro"),
      byRef.get("modul-prinsipper"),
      byRef.get("modul-behandlingsgrunnlag"),
      byRef.get("modul-avvik"),
      byRef.get("oppsummering"),
    ]);
  });

  it("stops before any write when the package is invalid", async () => {
    const suffix = `skill-invalid-${Date.now()}`;
    const pkg = await loadFixture(suffix);
    // Break the MCQ_ONLY module: forbidden free-text field.
    const mcqModule = pkg.objects.find((object: { clientRef: string }) => object.clientRef === "modul-prinsipper");
    mcqModule.payload.activeVersion.taskText = "Not allowed in MCQ_ONLY";

    const result = await importPackage({ baseUrl, headers, pkg });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("validation_failed");
    expect(result.created).toEqual([]);
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({ code: "forbidden_for_mode" }),
    );
    const persisted = await prisma.module.count({ where: { title: { contains: suffix } } });
    expect(persisted).toBe(0);
  });

  it("validate-only path returns the report without creating anything", async () => {
    const suffix = `skill-dry-${Date.now()}`;
    const report = await validatePackage({ baseUrl, headers, pkg: await loadFixture(suffix) });
    expect(report.valid).toBe(true);
    expect(report.plan).toHaveLength(7); // 2 sections + 3 modules + course + set_course_items
    const persisted = await prisma.course.count({ where: { title: { contains: suffix } } });
    expect(persisted).toBe(0);
  });
});
