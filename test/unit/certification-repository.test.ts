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

  // #989: utløpsfeltene skal ikke lenger SKRIVES. Kolonnene står igjen (expand/contract), så en
  // regresjon her ville vært stille — derfor pinnes fraværet, ikke bare nærværet av resten.
  it("skriver hverken expiryDate eller recertificationDueDate", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "cert-1" });
    const repository = createCertificationRepository({
      certificationStatus: { upsert },
    } as never);

    await repository.upsertCertificationStatus({
      userId: "user-1",
      moduleId: "module-1",
      latestDecisionId: "decision-1",
      status: "ACTIVE",
      passedAt: new Date("2026-03-11T00:00:00.000Z"),
    });

    const call = upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(call.update).not.toHaveProperty("expiryDate");
    expect(call.update).not.toHaveProperty("recertificationDueDate");
    expect(call.create).not.toHaveProperty("expiryDate");
    expect(call.create).not.toHaveProperty("recertificationDueDate");
    // Kontrollcase: `passedAt` BEHOLDES — når modulen ble bestått har verdi i seg selv.
    expect(call.update).toMatchObject({ passedAt: new Date("2026-03-11T00:00:00.000Z") });
    expect(call.create).toMatchObject({ passedAt: new Date("2026-03-11T00:00:00.000Z") });
  });

  it("har ingen spørring for påminnelsesplanen lenger (#989)", () => {
    const repository = createCertificationRepository({ certificationStatus: {} } as never);

    expect(repository).not.toHaveProperty("findCertificationsForReminderSchedule");
  });
});
