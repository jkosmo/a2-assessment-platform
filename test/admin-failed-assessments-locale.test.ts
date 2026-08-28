import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

// #1022: oversikten over feilede vurderinger sendte modultittelen som RÅ JSON.
//
// ⚠️ Hvorfor dette var en ekte feil, og ikke bare et stygt API-svar.
//
// Klienten hadde sin egen parser, med en ANNEN reservekjede enn serverens:
//
//   server:  inline[locale] ?? inline["en-GB"] ?? førsteTilgjengelige ?? input
//   klient:  parsed[locale] ?? parsed["en-GB"] ?? parsed.nb ?? raw
//
// En tittel som bare er oversatt til NYNORSK — en helt lovlig tilstand etter #892 — har verken
// `en-GB` eller `nb`. Klienten falt da helt ned på `raw`, og administratoren fikk hele
// JSON-blobben i kolonnen «Modul».
//
// To implementasjoner av «hvilket språk viser vi» er én for mye. Serveren eier spørsmålet nå.
describe("#1022 — feilede vurderinger: modultittelen er lokalisert, ikke rå JSON", () => {
  // ⚠️ EGEN bruker og egne rader, ikke `findFirst()` på en seedet.
  //
  // Første utgave hentet en vilkårlig seedet bruker og hengte innleveringer på hen. Det veltet fire
  // tester i tre andre filer — GDPR, påminnelser og outbox — som teller rader for den brukeren.
  // Feilene så ut som flaks i suiten, men var min: en test som legger igjen tilstand andre teller.
  const OWN_EXTERNAL_ID = "admin-failed-locale-1022";
  const created = { userId: "", moduleIds: [] as string[] };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        externalId: OWN_EXTERNAL_ID,
        name: "Fikstur #1022",
        email: "fikstur.1022@example.invalid",
      },
      select: { id: true },
    });
    created.userId = user.id;
  });

  afterAll(async () => {
    // Rydder i omvendt rekkefølge av avhengighetene.
    await prisma.assessmentJob.deleteMany({ where: { submission: { userId: created.userId } } });
    await prisma.submission.deleteMany({ where: { userId: created.userId } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: created.moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: created.moduleIds } } });
    await prisma.user.deleteMany({ where: { id: created.userId } });
    await prisma.$disconnect();
  });

  /** Én feilet vurdering på VÅR bruker, med den gitte tittelen. */
  async function failedAssessmentWithTitle(title: string) {
    const module = await prisma.module.create({
      data: { title, description: null, createdById: created.userId },
      select: { id: true },
    });
    created.moduleIds.push(module.id);
    const moduleVersion = await prisma.moduleVersion.create({
      data: { moduleId: module.id, versionNo: 1, assessmentMode: "FREETEXT_ONLY" },
      select: { id: true },
    });
    const submission = await prisma.submission.create({
      data: {
        userId: created.userId,
        moduleId: module.id,
        moduleVersionId: moduleVersion.id,
        deliveryType: "text",
        submissionStatus: "PROCESSING",
      },
      select: { id: true },
    });
    await prisma.assessmentJob.create({
      data: { submissionId: submission.id, status: "FAILED", attempts: 6, maxAttempts: 6 },
    });
    return submission.id;
  }

  async function moduleTitleFor(submissionId: string, locale?: string) {
    const req = request(app).get("/api/admin/platform/failed-assessments");
    const res = await (locale ? req.set({ ...adminHeaders, "x-locale": locale }) : req.set(adminHeaders));
    const rows = res.body.failedAssessments as Array<{ submissionId: string; moduleTitle: string }>;
    return rows.find((r) => r.submissionId === submissionId)?.moduleTitle;
  }

  it("sender en lesbar tittel for en modul som BARE er oversatt til nynorsk", async () => {
    // ⚠️ Bare nynorsk — nettopp tilfellet den gamle klientparseren ikke kunne håndtere: den falt
    // tilbake på `nb`, og fantes ikke nb, viste den den rå JSON-strengen.
    const submissionId = await failedAssessmentWithTitle(JSON.stringify({ nn: "Tryggleik i praksis" }));

    const title = await moduleTitleFor(submissionId);

    // Påstand på INNHOLDET. Et rått JSON-svar er også «en streng», så en eksistenssjekk ville vært
    // grønn for nøyaktig feilen vi retter.
    expect(title).toBe("Tryggleik i praksis");
    expect(title).not.toContain("{");
  });

  // ⚠️ QA-porten: uten denne kjørte alle testene UTEN språk-header og ble grønne via reservekjeden.
  // En mutant som hardkodet «nb» ville bestått dem.
  it("følger forespørselens språk, ikke en fast standard", async () => {
    const submissionId = await failedAssessmentWithTitle(
      JSON.stringify({ "en-GB": "Safety in practice", nb: "Sikkerhet i praksis" }),
    );

    expect(await moduleTitleFor(submissionId, "en-GB")).toBe("Safety in practice");
    expect(await moduleTitleFor(submissionId, "nb")).toBe("Sikkerhet i praksis");
  });

  it("lar en utoversatt tittel stå som den er", async () => {
    const submissionId = await failedAssessmentWithTitle("Ren tittel uten språkmerke");

    // Blokkeringens makker: uten denne ville testene over vært grønne for en server som alltid
    // returnerte en tom eller fast streng.
    expect(await moduleTitleFor(submissionId)).toBe("Ren tittel uten språkmerke");
  });
});
