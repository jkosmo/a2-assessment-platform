import { describe, expect, it, vi } from "vitest";
import { createCertificationRepository } from "../../src/modules/certification/certificationRepository.js";

describe("certification repository", () => {
  it("upserts certification status through the Prisma client", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "cert-1" });
    const repository = createCertificationRepository({
      certificationStatus: {
        upsert,
      },
    } as never);

    await repository.upsertCertificationStatus({
      userId: "user-1",
      moduleId: "module-1",
      latestDecisionId: "decision-1",
      status: "ACTIVE",
      passedAt: new Date("2026-03-11T00:00:00.000Z"),
      expiryDate: new Date("2027-03-11T00:00:00.000Z"),
      recertificationDueDate: new Date("2027-02-09T00:00:00.000Z"),
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_moduleId: {
            userId: "user-1",
            moduleId: "module-1",
          },
        },
        update: expect.objectContaining({
          latestDecisionId: "decision-1",
          status: "ACTIVE",
        }),
        create: expect.objectContaining({
          userId: "user-1",
          moduleId: "module-1",
          latestDecisionId: "decision-1",
        }),
      }),
    );
  });

  it("queries reminder-schedule certifications with user and module context", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = createCertificationRepository({
      certificationStatus: {
        findMany,
      },
    } as never);

    await repository.findCertificationsForReminderSchedule();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          expiryDate: { not: null },
        },
        include: expect.objectContaining({
          user: expect.any(Object),
          module: expect.any(Object),
        }),
      }),
    );
  });
});
