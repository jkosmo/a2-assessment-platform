// #1033: en importert pakke som sier den er agent-produsert, får det inn i revisjonsraden for
// importen — modul, seksjon og kurs. En pakke uten (eller med `human`) endrer ikke radens form.
// Kursimporten fører også `moduleIds`, for uten dem kan ingen måling knytte et spørsmål til pakken.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const L = (s: string) => ({ "en-GB": s, nb: s, nn: s });
const PROV = { producer: "agent_authoring", tool: "a2-authoring-api", toolVersion: "9.9.9", agentRunId: "run-1033" };

function moduleEnvelope(stamp: string, provenance?: unknown) {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: new Date().toISOString(),
    ...(provenance ? { provenance } : {}),
    scope: "module",
    module: {
      module: { title: L(`Prov ${stamp}`), certificationLevel: null },
      activeVersion: {
        assessmentMode: "MCQ_ONLY",
        mcqSet: { title: L("S"), questions: [{ stem: L("Q?"), options: [L("a"), L("b")], correctAnswer: L("a") }] },
        audit: {},
      },
    },
  };
}

async function metadataOf(action: string, entityId: string) {
  const event = await prisma.auditEvent.findFirst({ where: { action, entityId }, orderBy: { timestamp: "desc" } });
  expect(event, `${action} for ${entityId}`).not.toBeNull();
  return JSON.parse(event!.metadataJson) as Record<string, unknown>;
}

describe("#1033 import carries envelope provenance into the audit row", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("module import: agent_authoring is stamped as claimed provenance", async () => {
    const res = await request(app)
      .post("/api/admin/content/modules/import")
      .set(admin)
      .send({ payload: moduleEnvelope(`m-${Date.now()}`, PROV), mode: "createNew" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const meta = await metadataOf("module_imported", res.body.moduleId);
    expect(meta).toMatchObject({
      source: "agent_authoring",
      provenanceClaimed: true,
      provenanceTool: "a2-authoring-api",
      provenanceToolVersion: "9.9.9",
      agentRunId: "run-1033",
    });
  });

  it("module import: no provenance and producer=human leave the row unchanged", async () => {
    for (const provenance of [undefined, { producer: "human" }]) {
      const res = await request(app)
        .post("/api/admin/content/modules/import")
        .set(admin)
        .send({ payload: moduleEnvelope(`h-${Date.now()}`, provenance), mode: "createNew" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const meta = await metadataOf("module_imported", res.body.moduleId);
      expect(meta.source).toBeUndefined();
      expect(meta.provenanceClaimed).toBeUndefined();
    }
  });

  it("module import: a malformed provenance is rejected by the schema, not silently dropped", async () => {
    const res = await request(app)
      .post("/api/admin/content/modules/import")
      .set(admin)
      .send({ payload: moduleEnvelope(`bad-${Date.now()}`, { producer: "robot" }), mode: "createNew" });
    expect(res.status).toBe(400);
  });

  it("section import: stamped", async () => {
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      provenance: PROV,
      scope: "section",
      section: { title: L(`Sek ${Date.now()}`), bodyMarkdown: L("# B"), audit: {} },
    };
    const res = await request(app).post("/api/admin/content/sections/import").set(admin).send({ payload: envelope, mode: "createNew" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const meta = await metadataOf("section_imported", res.body.sectionId);
    expect(meta).toMatchObject({ source: "agent_authoring", provenanceClaimed: true, provenanceTool: "a2-authoring-api" });
  });

  it("course import: stamped, and the row names the modules it created", async () => {
    const stamp = `k-${Date.now()}`;
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      provenance: PROV,
      scope: "course",
      course: {
        course: {
          title: L(`Kurs ${stamp}`),
          certificationLevel: null,
          audit: {},
          items: [
            { type: "SECTION", sortOrder: 0, section: { title: L(`S ${stamp}`), bodyMarkdown: L("# B"), audit: {} } },
            { type: "MODULE", sortOrder: 1, module: moduleEnvelope(stamp).module },
          ],
        },
      },
    };
    const res = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: envelope, mode: "createNew" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const meta = await metadataOf("course_imported", res.body.courseId);
    expect(meta).toMatchObject({ source: "agent_authoring", provenanceClaimed: true, moduleCount: 1 });
    expect(meta.moduleIds).toEqual(res.body.moduleIds);
    expect((meta.moduleIds as string[]).length).toBe(1);
  });
});
