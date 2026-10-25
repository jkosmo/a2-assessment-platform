import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// Synkroniseringen av brukere (Entra og «Importer brukere fra fil» går gjennom samme rute).
//
// #1114 — produkteier 2026-10-25: «e-postadresser skal ikke kobles. Det er grunnleggende». Testen
// fester derfor:
//   - en bruker oppdateres bare når `externalId` er den samme;
//   - en annen `externalId` med samme e-post kobles IKKE: brukeren står urørt, ingen ny lages, og
//     konflikten står i svaret (med e-post) og i revisjonssporet (uten);
//   - en pseudonymisert bruker får ikke navn og e-post tilbake.
// Før #1114 «nøklet» synkroniseringen om en bruker til en ny ID fordi e-posten var lik — det var det
// den gamle utgaven av denne testen festet.

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const stamp = `${Date.now()}`;
const id = (n: string) => `hr-${n}-${stamp}`;
const mail = (n: string) => `hr.user.${n}.${stamp}@company.com`;

const sync = (users: Array<Record<string, unknown>>) =>
  request(app).post("/api/admin/sync/org/delta").set(adminHeaders).send({ source: "hr-test", users });

describe("Org delta sync", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("oppretter og oppdaterer på externalId", async () => {
    const first = await sync([
      { externalId: id("100"), email: mail("100"), name: "HR User 100", department: "Finance", manager: "Manager A", activeStatus: true },
      { externalId: id("200"), email: mail("200"), name: "HR User 200", department: "Engineering", manager: "Manager B", activeStatus: true },
    ]);
    expect(first.status).toBe(200);
    expect(first.body.run).toMatchObject({ createdCount: 2, failedCount: 0, skippedConflictCount: 0 });

    const second = await sync([
      { externalId: id("100"), email: mail("100"), name: "HR User 100 Updated", department: "Operations", manager: "Manager C", activeStatus: false },
    ]);
    expect(second.body.run).toMatchObject({ updatedCount: 1, failedCount: 0 });
    const updated = await prisma.user.findUniqueOrThrow({ where: { externalId: id("100") } });
    expect(updated).toMatchObject({ name: "HR User 100 Updated", department: "Operations", activeStatus: false });
  });

  it("#1114: en annen externalId med samme e-post kobles ikke — brukeren står urørt, og ingen ny lages", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { externalId: id("200") } });
    const res = await sync([
      { externalId: id("999"), email: mail("200"), name: "Noen andre", department: "Sales", activeStatus: true },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({ createdCount: 0, updatedCount: 0, skippedConflictCount: 1, failedCount: 0 });
    // Administrator får vite hvem.
    expect(res.body.run.conflicts).toEqual([{ externalId: id("999"), email: mail("200") }]);

    const after = await prisma.user.findUniqueOrThrow({ where: { email: mail("200") } });
    expect(after).toMatchObject({ id: before.id, externalId: id("200"), name: "HR User 200", department: "Engineering" });
    expect(await prisma.user.count({ where: { externalId: id("999") } })).toBe(0);
  });

  it("#1114: en kjent bruker som får en e-post en ANNEN bruker har, røres ikke — og den andre heller ikke", async () => {
    const res = await sync([{ externalId: id("100"), email: mail("200"), name: "Conflict User", department: "Conflict Dept" }]);
    expect(res.body.run).toMatchObject({ updatedCount: 0, skippedConflictCount: 1, failedCount: 0 });
    const hundred = await prisma.user.findUniqueOrThrow({ where: { externalId: id("100") } });
    expect(hundred).toMatchObject({ email: mail("100"), name: "HR User 100 Updated" });
  });

  it("#1114: en pseudonymisert bruker får ikke navn og e-post tilbake", async () => {
    const user = await prisma.user.create({
      data: { externalId: id("300"), email: `pseudo-${stamp}@anonymized.invalid`, name: "Pseudonymisert bruker", isAnonymized: true, anonymizedAt: new Date(), activeStatus: false },
    });
    const res = await sync([{ externalId: id("300"), email: mail("300"), name: "Kari Ekte", department: "Finance", activeStatus: true }]);
    expect(res.body.run).toMatchObject({ updatedCount: 0, createdCount: 0, skippedAnonymizedCount: 1, failedCount: 0 });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ name: "Pseudonymisert bruker", email: `pseudo-${stamp}@anonymized.invalid`, activeStatus: false, department: null });
    // Pseudonymiserte står ikke med e-post i konfliktlista heller.
    expect(res.body.run.conflicts).toEqual([]);
  });

  it("revisjonssporet har konfliktene uten e-post (#806)", async () => {
    await sync([{ externalId: id("998"), email: mail("100"), name: "Enda en", activeStatus: true }]);
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "org_sync", action: "org_sync_completed" },
      orderBy: { chainSeq: "desc" },
      take: 1,
    });
    expect(events).toHaveLength(1);
    const metadata = events[0].metadataJson;
    expect(metadata).toContain(id("998"));
    expect(metadata).not.toContain(mail("100"));
  });
});
