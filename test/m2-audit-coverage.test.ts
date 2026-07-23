import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #805: every state-changing operation must leave an audit trail. Previously a course-metadata edit wrote
// nothing, and a bulk enrollment left only per-user rows (no coherent record of the operation's scope).

const adminHeaders = {
  "x-user-id": "audit-cov-admin",
  "x-user-email": "audit-cov-admin@x.test",
  "x-user-name": "Audit Cov Admin",
  "x-user-roles": "ADMINISTRATOR",
};

async function auditEventsFor(entityId: string, action: string) {
  const rows = await prisma.auditEvent.findMany({ where: { entityId, action } });
  return rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadataJson) as Record<string, unknown> }));
}

describe("audit coverage for state-changing mutations (#805)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a course-metadata update writes a course_updated event listing the changed fields", async () => {
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": `Cov course ${Date.now()}` }) },
      select: { id: true },
    });

    const res = await request(app)
      .put(`/api/admin/content/courses/${course.id}`)
      .set(adminHeaders)
      .send({ title: { "en-GB": "Renamed" }, enrollmentPolicy: "RESTRICTED" });
    expect(res.status).toBe(200);

    const events = await auditEventsFor(course.id, "course_updated");
    expect(events.length).toBe(1);
    expect(events[0].metadata.changedFields).toEqual(expect.arrayContaining(["title", "enrollmentPolicy"]));
  });

  it("a bulk enrollment writes a course_enrollment_bulk_assigned summary with requested/assigned counts", async () => {
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": `Cov enroll ${Date.now()}` }), enrollmentPolicy: "OPEN", publishedAt: new Date() },
      select: { id: true },
    });
    const learners = await Promise.all(
      [0, 1].map((n) =>
        prisma.user.create({
          data: { externalId: `cov-learner-${Date.now()}-${n}`, name: `L${n}`, email: `cov-${Date.now()}-${n}@x.test` },
          select: { id: true },
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/admin/content/courses/${course.id}/enrollments`)
      .set(adminHeaders)
      .send({ userIds: learners.map((l) => l.id) });
    expect(res.status).toBe(201);

    const summary = await auditEventsFor(course.id, "course_enrollment_bulk_assigned");
    expect(summary.length).toBe(1);
    expect(summary[0].metadata.requestedCount).toBe(2);
    expect(summary[0].metadata.assignedCount).toBe(2);
    // per-user rows are still written (unchanged behaviour)
    expect((await auditEventsFor(course.id, "course_enrollment_assigned")).length).toBe(2);
  });
});
