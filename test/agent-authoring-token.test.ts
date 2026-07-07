// Integration tests for AA-3 (#651): short-lived agent authoring tokens.
// Covers issuance/listing/revocation, full orchestration with a token (attributed
// to the issuing user), scope enforcement (draft-authoring endpoints only, no
// publish, no token self-minting), per-route hardening (autoPublish/replaceExisting,
// draft-only sections, items only on draft courses), and expiry.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { importPackage } from "../skills/a2-authoring-api/scripts/import-package.mjs";

const adminHeaders = {
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

async function issueToken(ttlMinutes?: number) {
  const response = await request(app)
    .post("/api/admin/content/agent-authoring/tokens")
    .set(adminHeaders)
    .send({ label: "test-token", ...(ttlMinutes ? { ttlMinutes } : {}) });
  expect(response.status).toBe(201);
  expect(response.body.token).toMatch(/^aat_[0-9a-f]{48}$/);
  return response.body as { token: string; id: string; expiresAt: string };
}

function tokenPackage(suffix: string) {
  return {
    packageFormat: "a2-authoring-package/v1",
    objects: [
      {
        clientRef: "intro",
        type: "section",
        payload: { title: `AA3 section ${suffix}`, bodyMarkdown: "## Token" },
      },
      {
        clientRef: "module-1",
        type: "module",
        payload: {
          module: { title: `AA3 module ${suffix}` },
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
          course: { title: `AA3 course ${suffix}` },
          items: [
            { type: "SECTION", ref: "intro" },
            { type: "MODULE", ref: "module-1" },
          ],
        },
      },
    ],
  };
}

describe("#651 agent authoring tokens", () => {
  it("issues a token once, lists it without the secret, and audits the issuance", async () => {
    const issued = await issueToken(30);

    const list = await request(app)
      .get("/api/admin/content/agent-authoring/tokens")
      .set(adminHeaders);
    expect(list.status).toBe(200);
    const entry = list.body.tokens.find((token: { id: string }) => token.id === issued.id);
    expect(entry).toMatchObject({ label: "test-token", revokedAt: null });
    expect(JSON.stringify(entry)).not.toContain("aat_");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "agent_authoring_token_issued", entityId: issued.id },
    });
    expect(audit).not.toBeNull();
  });

  it("runs the full orchestration with a token, attributed to the issuing user", async () => {
    const { token } = await issueToken();
    const suffix = `aa3-ok-${Date.now()}`;

    const result = await importPackage({
      baseUrl,
      headers: { authorization: `Bearer ${token}` },
      pkg: tokenPackage(suffix),
    });
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    const moduleEntry = result.created.find((entry) => entry.type === "module")!;
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { externalId: "admin-1" },
      select: { id: true },
    });
    const moduleRow = await prisma.module.findUniqueOrThrow({
      where: { id: moduleEntry.id },
      select: { activeVersionId: true, createdById: true },
    });
    expect(moduleRow.activeVersionId).toBeNull();
    expect(moduleRow.createdById).toBe(adminUser.id);
  });

  it("works when the issuer's role is not persisted (Entra claim / mock hint) — #651 stage 403 regression", async () => {
    // A user whose SMO role comes ONLY from the request (x-user-roles hint in mock,
    // a JWT app-role claim on stage) and has NO persisted RoleAssignment. Before the
    // role-snapshot fix, getActiveRoles() returned [] at token-auth time → 403.
    const claimOnlyHeaders = {
      "x-user-id": "smo-claim-only-651",
      "x-user-email": "smo.claim651@company.com",
      "x-user-name": "Claim-only SMO",
      "x-user-roles": "SUBJECT_MATTER_OWNER",
    };
    const issued = await request(app)
      .post("/api/admin/content/agent-authoring/tokens")
      .set(claimOnlyHeaders)
      .send({ label: "claim-only" });
    expect(issued.status).toBe(201);

    // Sanity: this user genuinely has no persisted roles.
    const user = await prisma.user.findUniqueOrThrow({
      where: { externalId: "smo-claim-only-651" },
      select: { id: true },
    });
    const persisted = await prisma.roleAssignment.count({ where: { userId: user.id } });
    expect(persisted).toBe(0);

    // The token still authorises the draft-authoring endpoint (200, not 403).
    const validate = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set({ authorization: `Bearer ${issued.body.token}` })
      .send({ package: tokenPackage(`claim-${Date.now()}`) });
    expect(validate.status).toBe(200);
    expect(validate.body.valid).toBe(true);
  });

  it("denies everything outside the draft-authoring allowlist", async () => {
    const { token, id } = await issueToken();
    const bearer = { authorization: `Bearer ${token}` };

    const denied = [
      request(app).get("/api/admin/content/modules/library").set(bearer),
      request(app).get("/api/me").set(bearer),
      // No token self-minting or self-management:
      request(app).post("/api/admin/content/agent-authoring/tokens").set(bearer).send({}),
      request(app).post(`/api/admin/content/agent-authoring/tokens/${id}/revoke`).set(bearer),
      // No publish paths (module/course/section publish are all outside the allowlist):
      request(app).post("/api/admin/content/courses/some-id/publish").set(bearer),
      request(app).post("/api/admin/content/sections/some-id/publish").set(bearer),
    ];
    for (const call of denied) {
      const response = await call;
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("agent_token_scope");
    }
  });

  it("hardens the allowlisted writes: no auto-publish, no replaceExisting, draft-only sections, draft-only course items", async () => {
    const { token } = await issueToken();
    const bearer = { authorization: `Bearer ${token}` };
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "module",
      module: {
        module: { title: `AA3 hardening ${Date.now()}` },
        activeVersion: {
          assessmentMode: "MCQ_ONLY",
          mcqSet: { title: "Q", questions: [{ stem: "1+1?", options: ["2", "3"], correctAnswer: "2" }] },
          audit: { publishedAt: new Date().toISOString() },
        },
      },
    };

    // autoPublish omitted (default would publish because source audit has publishedAt):
    const noAutoPublishFalse = await request(app)
      .post("/api/admin/content/modules/import")
      .set(bearer)
      .send({ payload: envelope, mode: "createNew" });
    expect(noAutoPublishFalse.status).toBe(403);

    const replaceExisting = await request(app)
      .post("/api/admin/content/modules/import")
      .set(bearer)
      .send({ payload: envelope, mode: "replaceExisting", targetId: "m-x", autoPublish: false });
    expect(replaceExisting.status).toBe(403);

    const publishedSection = await request(app)
      .post("/api/admin/content/sections")
      .set(bearer)
      .send({ title: `AA3 live section ${Date.now()}`, bodyMarkdown: "## x" });
    expect(publishedSection.status).toBe(403);

    // Items on a published course: create as admin, force-publish via prisma.
    const course = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({ title: `AA3 published course ${Date.now()}` });
    expect(course.status).toBe(201);
    await prisma.course.update({ where: { id: course.body.course.id }, data: { publishedAt: new Date() } });
    const items = await request(app)
      .put(`/api/admin/content/courses/${course.body.course.id}/items`)
      .set(bearer)
      .send({ items: [] });
    expect(items.status).toBe(403);
    expect(items.body.error).toBe("agent_token_scope");
  });

  it("rejects expired and revoked tokens with 401", async () => {
    const expired = await issueToken();
    await prisma.agentAuthoringToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredCall = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set({ authorization: `Bearer ${expired.token}` })
      .send({ package: tokenPackage("x") });
    expect(expiredCall.status).toBe(401);

    const revokable = await issueToken();
    const revoke = await request(app)
      .post(`/api/admin/content/agent-authoring/tokens/${revokable.id}/revoke`)
      .set(adminHeaders);
    expect(revoke.status).toBe(200);
    expect(revoke.body.token.revokedAt).not.toBeNull();

    const revokedCall = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set({ authorization: `Bearer ${revokable.token}` })
      .send({ package: tokenPackage("y") });
    expect(revokedCall.status).toBe(401);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "agent_authoring_token_revoked", entityId: revokable.id },
    });
    expect(audit).not.toBeNull();

    // Unknown token → 401 too.
    const bogus = await request(app)
      .get("/api/admin/content/agent-authoring/tokens")
      .set({ authorization: `Bearer aat_${"0".repeat(48)}` });
    expect(bogus.status).toBe(401);
  });

  it("requires admin_content roles to issue tokens", async () => {
    const response = await request(app)
      .post("/api/admin/content/agent-authoring/tokens")
      .set({ ...adminHeaders, "x-user-roles": "PARTICIPANT" })
      .send({});
    expect(response.status).toBe(403);
  });
});
