import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1000: fem roller kan lese ETHVERT revisjonsspor. To av dem er begrunnet med et forhold til
// kandidaten — «mine kandidater», «mine mentees» — som datamodellen ikke har.
//
// ⚠️ Første steg er IKKE å stramme inn. En avgrensning mot en relasjon som ikke finnes, gir null
// tilgang til alle. Første steg er å kunne SE hvor ofte et spor leses uten at noe forhold finnes.
//
// Og et funn saken ikke nevnte: lesing av sporet ble ikke logget i det hele tatt. Det er
// personopplysninger om både kandidaten og alle som har behandlet saken.

const readerHeaders = {
  "x-user-id": "audit-reader-1000",
  "x-user-email": "leser.1000@example.invalid",
  "x-user-name": "Leser #1000",
  "x-user-roles": "REPORT_READER",
};

describe("#1000 — lesing av et revisjonsspor logges, med forholdet", () => {
  const created = { ownerId: "", moduleIds: [] as string[], submissionId: "", extraUserIds: [] as string[] };

  /** Metadataen fra den nyeste tilgangshendelsen på fikstur-innleveringen. */
  async function latestAccessMeta(): Promise<Record<string, unknown>> {
    const access = await prisma.auditEvent.findFirst({
      where: { entityType: "submission_audit_access", entityId: created.submissionId },
      orderBy: { timestamp: "desc" },
    });
    expect(access).toBeTruthy();
    return JSON.parse(access!.metadataJson) as Record<string, unknown>;
  }

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        externalId: "audit-subject-1000",
        name: "Kandidat #1000",
        email: "kandidat.1000@example.invalid",
      },
      select: { id: true },
    });
    created.ownerId = owner.id;

    const module = await prisma.module.create({
      data: { title: "Modul for #1000", description: null, createdById: owner.id },
      select: { id: true },
    });
    created.moduleIds.push(module.id);
    const moduleVersion = await prisma.moduleVersion.create({
      data: { moduleId: module.id, versionNo: 1, assessmentMode: "FREETEXT_ONLY" },
      select: { id: true },
    });
    const submission = await prisma.submission.create({
      data: {
        userId: owner.id,
        moduleId: module.id,
        moduleVersionId: moduleVersion.id,
        deliveryType: "text",
        submissionStatus: "COMPLETED",
      },
      select: { id: true },
    });
    created.submissionId = submission.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { entityId: created.submissionId } });
    await prisma.manualReview.deleteMany({ where: { submissionId: created.submissionId } });
    await prisma.appeal.deleteMany({ where: { submissionId: created.submissionId } });
    await prisma.contentOwner.deleteMany({ where: { contentId: { in: created.moduleIds } } });
    await prisma.submission.deleteMany({ where: { userId: created.ownerId } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: created.moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: created.moduleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.extraUserIds } } });
    await prisma.user.deleteMany({ where: { externalId: { in: ["audit-subject-1000", "audit-reader-1000"] } } });
    await prisma.$disconnect();
  });

  // ⚠️ DEN VIKTIGSTE. `roleOnly` er tallet hele saken hviler på: hvor ofte hviler lesingen på
  // rollen ALENE, uten at noe forhold i datamodellen knytter leseren til innleveringen.
  it("en leser uten noe forhold logges med roleOnly", async () => {
    const response = await request(app)
      .get(`/api/audit/submissions/${created.submissionId}`)
      .set(readerHeaders);

    expect(response.status).toBe(200);

    const access = await prisma.auditEvent.findFirst({
      where: { entityType: "submission_audit_access", entityId: created.submissionId },
      orderBy: { timestamp: "desc" },
    });

    expect(access).toBeTruthy();
    const meta = JSON.parse(access!.metadataJson) as Record<string, unknown>;
    expect(meta.roleOnly).toBe(true);
    expect(meta.isOwnSubmission).toBe(false);
    expect(meta.isAssignedReviewer).toBe(false);
    expect(meta.readerRoles).toEqual(["REPORT_READER"]);
    // Innleveringen skal navngis under en ANNEN nøkkel — se testen under for hvorfor.
    expect(meta.subjectSubmissionId).toBe(created.submissionId);
  });

  // ⚠️ Blokkeringens makker, og den som gjør loggingen brukbar: hendelsen skal IKKE havne i
  // deltakerens eget spor. Brukte vi nøkkelen `submissionId`, ville den denormaliserte kolonnen
  // blitt fylt, sporet ville vokst for hver lesing — og lesinger av lesinger ville fulgt.
  it("tilgangshendelsen forurenser ikke deltakerens eget spor", async () => {
    await request(app).get(`/api/audit/submissions/${created.submissionId}`).set(readerHeaders);
    await request(app).get(`/api/audit/submissions/${created.submissionId}`).set(readerHeaders);

    const response = await request(app)
      .get(`/api/audit/submissions/${created.submissionId}`)
      .set(readerHeaders);

    const actions = (response.body.events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).not.toContain("submission_audit_trail_read");

    // Og den denormaliserte kolonnen skal stå tom på tilgangshendelsene.
    const withSubmissionId = await prisma.auditEvent.count({
      where: { entityType: "submission_audit_access", submissionId: { not: null } },
    });
    expect(withSubmissionId).toBe(0);
  });

  // Kandidaten som leser sitt EGET spor er ikke det saken handler om, og skal ikke telles som
  // rollebasert tilgang.
  it("kandidatens egen lesing telles ikke som roleOnly", async () => {
    const ownerUser = await prisma.user.findUnique({
      where: { id: created.ownerId },
      select: { externalId: true, email: true, name: true },
    });

    await request(app)
      .get(`/api/audit/submissions/${created.submissionId}`)
      .set({
        "x-user-id": ownerUser!.externalId,
        "x-user-email": ownerUser!.email,
        "x-user-name": ownerUser!.name,
        "x-user-roles": "PARTICIPANT",
      });

    const access = await prisma.auditEvent.findFirst({
      where: { entityType: "submission_audit_access", entityId: created.submissionId },
      orderBy: { timestamp: "desc" },
    });

    const meta = JSON.parse(access!.metadataJson) as Record<string, unknown>;
    expect(meta.isOwnSubmission).toBe(true);
    expect(meta.roleOnly).toBe(false);
  });

  // ⚠️ QA-porten fant hullet som teller: ingen av testene over SKAPER et forhold. `findReaderRelations`
  // kunne vært koblet til feil felt — `appealedById` i stedet for `resolvedById`, eller feil
  // `contentType` — og alle tre ville vært grønne. Da ville `roleOnly` vært stille feil, og det er
  // tallet hele GDPR-beslutningen skal hvile på.
  //
  // Disse testene lager forholdene på ekte og krever at flagget snur.
  it("en TILDELT vurderer telles ikke som roleOnly", async () => {
    const reviewer = await prisma.user.create({
      data: {
        externalId: "audit-reviewer-1000",
        name: "Sensor #1000",
        email: "sensor.1000@example.invalid",
      },
      select: { id: true, externalId: true, email: true, name: true },
    });
    created.extraUserIds.push(reviewer.id);
    await prisma.manualReview.create({
      data: { submissionId: created.submissionId, reviewerId: reviewer.id, triggerReason: "fikstur", reviewStatus: "OPEN" },
    });

    await request(app)
      .get(`/api/audit/submissions/${created.submissionId}`)
      .set({
        "x-user-id": reviewer.externalId,
        "x-user-email": reviewer.email,
        "x-user-name": reviewer.name,
        "x-user-roles": "REVIEWER",
      });

    const meta = await latestAccessMeta();
    expect(meta.isAssignedReviewer).toBe(true);
    expect(meta.roleOnly).toBe(false);
  });

  it("en klagebehandler som har behandlet anken telles ikke som roleOnly", async () => {
    const handler = await prisma.user.create({
      data: {
        externalId: "audit-handler-1000",
        name: "Klagebehandler #1000",
        email: "klage.1000@example.invalid",
      },
      select: { id: true, externalId: true, email: true, name: true },
    });
    created.extraUserIds.push(handler.id);
    await prisma.appeal.create({
      data: {
        submissionId: created.submissionId,
        appealedById: created.ownerId,
        appealReason: "fikstur",
        // ⚠️ Nettopp feltet oppslaget leser. Var det koblet til `appealedById`, ville dette vært grønt
        // av feil grunn — kandidaten er jo den som anker.
        resolvedById: handler.id,
      },
    });

    await request(app)
      .get(`/api/audit/submissions/${created.submissionId}`)
      .set({
        "x-user-id": handler.externalId,
        "x-user-email": handler.email,
        "x-user-name": handler.name,
        "x-user-roles": "APPEAL_HANDLER",
      });

    const meta = await latestAccessMeta();
    expect(meta.isAssignedAppealHandler).toBe(true);
    expect(meta.roleOnly).toBe(false);
  });

  it("en eier av modulinnholdet telles ikke som roleOnly", async () => {
    const owner = await prisma.user.create({
      data: {
        externalId: "audit-owner-1000",
        name: "Fagansvarlig #1000",
        email: "fag.1000@example.invalid",
      },
      select: { id: true, externalId: true, email: true, name: true },
    });
    created.extraUserIds.push(owner.id);
    await prisma.contentOwner.create({
      data: { contentType: "MODULE", contentId: created.moduleIds[0], userId: owner.id },
    });

    await request(app)
      .get(`/api/audit/submissions/${created.submissionId}`)
      .set({
        "x-user-id": owner.externalId,
        "x-user-email": owner.email,
        "x-user-name": owner.name,
        "x-user-roles": "SUBJECT_MATTER_OWNER",
      });

    const meta = await latestAccessMeta();
    expect(meta.ownsModuleContent).toBe(true);
    expect(meta.roleOnly).toBe(false);
  });
});
