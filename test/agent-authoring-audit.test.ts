// Integration tests for AA-5 (#653): audit/observability and partial-failure
// handling for agent authoring. Boots the app on an ephemeral port and drives the
// skill's reference implementation, then verifies (a) every agent write is audit-
// logged with source: agent_authoring + clientRef + agentRunId, (b) a mid-flow
// failure still reports everything created before the failure with IDs/links, and
// (c) non-agent creates are audited WITHOUT the agent marker.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { importPackage } from "../skills/a2-authoring-api/scripts/import-package.mjs";

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

function smallPackage(suffix: string) {
  return {
    packageFormat: "a2-authoring-package/v1",
    objects: [
      {
        clientRef: "intro",
        type: "section",
        payload: { title: `AA5 section ${suffix}`, bodyMarkdown: "## Audit" },
      },
      {
        clientRef: "module-1",
        type: "module",
        payload: {
          module: { title: `AA5 module ${suffix}` },
          activeVersion: {
            assessmentMode: "MCQ_ONLY",
            mcqSet: { title: "Q", questions: [{ stem: "1+1?", options: ["2", "3"], correctAnswer: "2" }] },
          },
        },
      },
      {
        clientRef: "course-main",
        type: "course",
        payload: {
          course: { title: `AA5 course ${suffix}` },
          items: [
            { type: "SECTION", ref: "intro" },
            { type: "MODULE", ref: "module-1" },
          ],
        },
      },
    ],
  };
}

async function auditEventsForRun(runId: string) {
  const events = await prisma.auditEvent.findMany({
    where: { metadataJson: { contains: runId } },
    select: { action: true, metadataJson: true },
  });
  return events.map((event) => ({
    action: event.action,
    metadata: JSON.parse(event.metadataJson) as Record<string, unknown>,
  }));
}

describe("#653 agent authoring audit & partial failure", () => {
  it("audit-logs every write of a successful run with source, clientRef and agentRunId", async () => {
    const suffix = `aa5-ok-${Date.now()}`;
    const runId = `aar-test-${Date.now()}`;

    const result = await importPackage({ baseUrl, headers, pkg: smallPackage(suffix), runId });
    expect(result.ok).toBe(true);
    expect(result.runId).toBe(runId);
    expect(result.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);

    const events = await auditEventsForRun(runId);
    expect(events.map((event) => event.action).sort()).toEqual([
      "course_created",
      "course_items_updated",
      "module_imported",
      "section_created",
    ]);
    for (const event of events) {
      expect(event.metadata.source).toBe("agent_authoring");
      expect(event.metadata.agentRunId).toBe(runId);
    }
    const sectionEvent = events.find((event) => event.action === "section_created");
    expect(sectionEvent?.metadata).toMatchObject({ clientRef: "intro", draft: true });
    const itemsEvent = events.find((event) => event.action === "course_items_updated");
    expect(itemsEvent?.metadata).toMatchObject({ itemCount: 2 });
  });

  it("reports partial success with created IDs/links when a later step fails mid-flow", async () => {
    const suffix = `aa5-partial-${Date.now()}`;
    const runId = `aar-partial-${Date.now()}`;

    // Force the course create to fail — the section and module are already created.
    const failingFetch: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/api/admin/content/courses") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "simulated_outage" }), { status: 503 });
      }
      return fetch(url, init);
    };

    const result = await importPackage({
      baseUrl,
      headers,
      pkg: smallPackage(suffix),
      runId,
      fetchImpl: failingFetch,
    });

    expect(result.ok).toBe(false);
    expect(result.failedStep).toEqual({ op: "create_course", clientRef: "course-main" });
    expect(result.error).toContain("503");

    // Earlier objects are NOT hidden by the failure: both are reported with id + link.
    expect(result.created.map((entry) => `${entry.type}:${entry.clientRef}`)).toEqual([
      "section:intro",
      "module:module-1",
    ]);
    for (const entry of result.created) {
      expect(entry.id).toBeTruthy();
      expect(Object.values(entry.links).join(" ")).toContain(entry.id);
    }
    expect(result.steps).toEqual([
      expect.objectContaining({ op: "create_section", status: "done" }),
      expect.objectContaining({ op: "create_module", status: "done" }),
      expect.objectContaining({ op: "create_course", status: "failed" }),
      expect.objectContaining({ op: "set_course_items", status: "skipped" }),
    ]);

    // The successful writes are audit-traceable even though the run failed —
    // and nothing was deleted (drafts still exist).
    const events = await auditEventsForRun(runId);
    expect(events.map((event) => event.action).sort()).toEqual(["module_imported", "section_created"]);
    const sectionId = result.created.find((entry) => entry.type === "section")!.id;
    expect(await prisma.courseSection.count({ where: { id: sectionId } })).toBe(1);
  });

  it("audits non-agent creates without the agent_authoring marker", async () => {
    const title = `AA5 manual section ${Date.now()}`;
    const response = await request(app)
      .post("/api/admin/content/sections")
      .set(headers)
      .send({ title, bodyMarkdown: "## Manuell" });
    expect(response.status).toBe(201);

    const event = await prisma.auditEvent.findFirst({
      where: { action: "section_created", entityId: response.body.section.id },
    });
    expect(event).not.toBeNull();
    const metadata = JSON.parse(event!.metadataJson) as Record<string, unknown>;
    expect(metadata.source).toBeUndefined();
    expect(metadata.agentRunId).toBeUndefined();
    expect(metadata.draft).toBe(false);
  });
});
