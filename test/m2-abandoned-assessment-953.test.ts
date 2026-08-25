import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { createDecisionRepository } from "../src/repositories/decisionRepository.js";

// #953: når vurderingsjobben gir opp for godt, slippes innleveringen tilbake til SUBMITTED slik at
// kandidaten kan forsøke igjen.
//
// ⚠️ HVORFOR DENNE FINNES SOM INTEGRASJONSTEST. Vernet mot å overskrive et allerede avgjort vedtak
// ligger i `where`-klausulen — og unit-testen for jobbkjøreren mocker repositoriet bort. Den kan
// bekrefte at kallet gjøres, men ikke at det treffer riktig rad. Det må databasen svare på.

const stamp = `ab953-${Date.now()}`;
let seq = 0;

async function seedSubmission(submissionStatus: "PROCESSING" | "COMPLETED") {
  seq += 1;
  const tag = `${stamp}-${seq}`;
  const user = await prisma.user.create({
    data: { externalId: tag, name: tag, email: `${tag}@x.test` },
    select: { id: true },
  });
  const module = await prisma.module.create({
    data: { title: `Abandoned ${tag}`, description: "d", certificationLevel: "foundation" },
    select: { id: true },
  });
  const version = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 1 },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: {
      userId: user.id,
      moduleId: module.id,
      moduleVersionId: version.id,
      submissionStatus,
      submittedAt: new Date(),
      deliveryType: "TEXT",
      responseJson: "{}",
    },
    select: { id: true },
  });
  return submission.id;
}

async function statusOf(id: string) {
  const row = await prisma.submission.findUniqueOrThrow({
    where: { id },
    select: { submissionStatus: true },
  });
  return row.submissionStatus;
}

describe("#953 en oppgitt vurdering låser ikke innleveringen", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("en innlevering i PROCESSING slippes tilbake til SUBMITTED", async () => {
    const id = await seedSubmission("PROCESSING");

    const result = await createDecisionRepository(prisma).releaseProcessingSubmission(id);

    expect(result.count).toBe(1);
    // SUBMITTED er ikke i TERMINAL_SUBMISSION_STATUSES, så et nytt MCQ-forsøk er mulig igjen.
    expect(await statusOf(id)).toBe("SUBMITTED");
  });

  it("⚠️ KONTROLLCASE: et allerede AVGJORT vedtak røres ikke", async () => {
    // Funnet av QA-porten: hvis vedtaket ble lagret og feilen kom i en SIDEEFFEKT etterpå, når
    // retryene til slutt terminalhåndteringen. En ubetinget skriving ville gjort et gyldig
    // COMPLETED om til SUBMITTED — altså slettet et resultat kandidaten allerede hadde fått.
    const id = await seedSubmission("COMPLETED");

    const result = await createDecisionRepository(prisma).releaseProcessingSubmission(id);

    expect(result.count).toBe(0);
    expect(await statusOf(id)).toBe("COMPLETED");
  });
});
