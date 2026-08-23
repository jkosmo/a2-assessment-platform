// #961: sletting av en seksjon etterlot ingen revisjonsspor. Alle andre livssyklushandlinger på en
// seksjon auditerer (created/published/unpublished/archived/restored), og både modul- og
// kurssletting gjør det.
//
// Testene her pinner to ting, og de er IKKE det samme:
//   1. at hendelsen i det hele tatt skrives, med riktig handling og metadata
//   2. at den skrives med SAMME transaksjonsklient som slettingen (#803-mønsteret)
//
// Punkt 2 er det som gjør sporet troverdig: et spor som committes utenfor transaksjonen kan finnes
// for noe som ble rullet tilbake, eller mangle for noe som faktisk ble slettet.

import { beforeEach, describe, expect, it, vi } from "vitest";

const recordAuditEvent = vi.fn();
const sectionFindUnique = vi.fn();
const assertSectionNotInAnyCourse = vi.fn();
const assertSectionNotInIssuedCertificate = vi.fn();
const collectSectionAssetBlobPaths = vi.fn();
const reclaimAssetBlobs = vi.fn();

// Én delt tx-klient per runInTransaction-kall, slik at testen kan se OM revisjonshendelsen fikk
// nøyaktig den klienten slettingen brukte.
let lastTx: Record<string, unknown> | null = null;
const txSectionUpdate = vi.fn();
const txVersionDeleteMany = vi.fn();
const txSectionDelete = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { courseSection: { findUnique: sectionFindUnique } },
}));

vi.mock("../../src/db/transaction.js", () => ({
  runInTransaction: (cb: (tx: unknown) => unknown) => {
    lastTx = {
      courseSection: { update: txSectionUpdate, delete: txSectionDelete },
      courseSectionVersion: { deleteMany: txVersionDeleteMany },
    };
    return cb(lastTx);
  },
}));

vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));

vi.mock("../../src/modules/course/contentLifecycle.js", () => ({
  assertSectionNotInAnyCourse,
  assertSectionNotInIssuedCertificate,
}));

vi.mock("../../src/modules/course/assetCommands.js", () => ({
  collectSectionAssetBlobPaths,
  reclaimAssetBlobs,
  importSectionAssets: vi.fn(),
}));

vi.mock("../../src/modules/content/contentOwnershipService.js", () => ({ addContentOwner: vi.fn() }));

describe("#961 deleteSection leaves an audit trail", () => {
  beforeEach(() => {
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    sectionFindUnique.mockReset().mockResolvedValue({ id: "section-1", title: "Arbeidsmiljøloven" });
    assertSectionNotInAnyCourse.mockReset().mockResolvedValue(undefined);
    assertSectionNotInIssuedCertificate.mockReset().mockResolvedValue(undefined);
    collectSectionAssetBlobPaths.mockReset().mockResolvedValue([]);
    reclaimAssetBlobs.mockReset().mockResolvedValue(undefined);
    txSectionUpdate.mockReset().mockResolvedValue(undefined);
    txVersionDeleteMany.mockReset().mockResolvedValue(undefined);
    txSectionDelete.mockReset().mockResolvedValue(undefined);
    lastTx = null;
  });

  it("records section_deleted with the actor and the title the row had", async () => {
    const { deleteSection } = await import("../../src/modules/course/sectionCommands.js");
    const { auditActions, auditEntityTypes } = await import("../../src/observability/auditEvents.js");

    await deleteSection("section-1", "actor-9");

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent.mock.calls[0][0]).toEqual({
      entityType: auditEntityTypes.courseSection,
      entityId: "section-1",
      action: auditActions.section.deleted,
      actorId: "actor-9",
      // Tittelen finnes ingen andre steder etter slettingen.
      metadata: { sectionId: "section-1", title: "Arbeidsmiljøloven" },
    });
  });

  it("commits the audit event on the same transaction client as the delete", async () => {
    const { deleteSection } = await import("../../src/modules/course/sectionCommands.js");

    await deleteSection("section-1", "actor-9");

    expect(txSectionDelete).toHaveBeenCalledWith({ where: { id: "section-1" } });
    // Andre argument til recordAuditEvent ER tx-klienten. Er den undefined (eller en annen
    // klient), skrives sporet utenfor slettingens transaksjon.
    expect(recordAuditEvent.mock.calls[0][1]).toBe(lastTx);
  });

  it("writes no audit event when a guard blocks the delete", async () => {
    assertSectionNotInIssuedCertificate.mockRejectedValue(new Error("står i et utstedt bevis"));
    const { deleteSection } = await import("../../src/modules/course/sectionCommands.js");

    await expect(deleteSection("section-1", "actor-9")).rejects.toThrow(/utstedt bevis/);

    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(txSectionDelete).not.toHaveBeenCalled();
  });
});
