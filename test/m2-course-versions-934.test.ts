import { prisma } from "../src/db/prisma.js";
import { reconcileCourseCompletionsForUser } from "../src/modules/course/index.js";
import { deriveStatus } from "../src/modules/course/enrollmentService.js";

// #934 skive 1: kurs har hovedversjon og mindre versjon, og et kursbevis gjelder sin hovedversjon
// (produkteier 2026-11-01, doc/DESIGN_934.md). Ingen flate setter versjonen ennå — testen gjør det
// direkte i databasen, slik skive 3 vil gjøre det gjennom forfatterdialogen (skive 2 lærer først leserne
// å skille versjonene og fjerner den gamle nøkkelen).

describe("#934 kursbevis per hovedversjon", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("et nytt kurs er 1.0, og beviset utstedes for 1.0", async () => {
    const { participant, course } = await courseWithOnePassedModule("ny");
    const fresh = await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { versionMajor: true, versionMinor: true } });
    expect(fresh).toEqual({ versionMajor: 1, versionMinor: 0 });

    await reconcileCourseCompletionsForUser(participant.id);
    const bevis = await completions(participant.id, course.id);
    expect(bevis).toEqual([{ versionMajor: 1, versionMinor: 0 }]);
  });

  it("en mindre versjon gir ikke nytt bevis — beviset for hovedversjonen gjelder", async () => {
    const { participant, course } = await courseWithOnePassedModule("mindre");
    await reconcileCourseCompletionsForUser(participant.id);
    await prisma.course.update({ where: { id: course.id }, data: { versionMinor: 1 } });

    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);
  });

  // Skive 1 lar den gamle nøkkelen (bruker, kurs) stå (utvid først, trekk sammen etterpå — QA-porten
  // 2026-11-01). Da kan databasen bare ha ett bevis per kurs, og ingen leser kan møte to. Dette er
  // sperren, målt: selv et kurs på hovedversjon 2 får ikke et andre bevis, og det første står urørt.
  it("så lenge den gamle nøkkelen står, finnes høyst ett bevis per kurs — og det første står urørt", async () => {
    const { participant, course } = await courseWithOnePassedModule("sperre");
    await reconcileCourseCompletionsForUser(participant.id);
    const første = await prisma.courseCompletion.findFirstOrThrow({ where: { userId: participant.id, courseId: course.id } });

    await prisma.course.update({ where: { id: course.id }, data: { versionMajor: 2, versionMinor: 3 } });
    await reconcileCourseCompletionsForUser(participant.id);

    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);
    const gamle = await prisma.courseCompletion.findUniqueOrThrow({ where: { id: første.id } });
    expect(gamle.certificateId).toBe(første.certificateId);
  });

  // Skive 2 fjerner den gamle nøkkelen sammen med at leserne lærer å skille versjonene. Da skal dette gjelde:
  it.todo("skive 2: en ny hovedversjon gir et nytt bevis når kravet er oppfylt; det gamle står, og det skjer bare én gang");

  // QA-porten 2026-11-01: en innsetting av et andre bevis avvises også av den GAMLE nøkkelen, så den testen
  // ble grønn uten den nye. Her måles indeksene selv: den nye må finnes og være unik på nøyaktig de tre
  // kolonnene — ellers kan skive 2, som fjerner den gamle, gi flere bevis for samme hovedversjon.
  it("databasen har den nye unike nøkkelen (bruker, kurs, hovedversjon) — og den gamle står ennå", async () => {
    const indekser = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'CourseCompletion' AND indexdef LIKE 'CREATE UNIQUE%'`;
    const def = (navn: string) => indekser.find((i) => i.indexname === navn)?.indexdef ?? "";
    expect(def("CourseCompletion_userId_courseId_versionMajor_key")).toMatch(/\("userId", "courseId", "versionMajor"\)$/);
    expect(def("CourseCompletion_userId_courseId_key")).toMatch(/\("userId", "courseId"\)$/);
  });

  it("en oppfylt frist står som oppfylt etter en ny hovedversjon (produkteier 2026-11-01)", async () => {
    const { participant, course } = await courseWithOnePassedModule("frist");
    await reconcileCourseCompletionsForUser(participant.id);
    // Versjon 2 har fått en modul deltakeren ikke har tatt — hen har bare bevis for versjon 1.
    const ny = await createPublishedModule(`934 frist ny modul ${Date.now()}`);
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId: ny.module.id, sortOrder: 2 } });
    await prisma.course.update({ where: { id: course.id }, data: { versionMajor: 2, versionMinor: 0 } });
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);

    const status = await deriveStatus(participant.id, course.id, new Date(Date.now() - 86_400_000), new Date());
    expect(status).toBe("COMPLETED");
  });
});

async function completions(userId: string, courseId: string) {
  return prisma.courseCompletion.findMany({
    where: { userId, courseId },
    orderBy: { versionMajor: "asc" },
    select: { versionMajor: true, versionMinor: true },
  });
}

async function courseWithOnePassedModule(tag: string) {
  const suffix = `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const participant = await prisma.user.create({
    data: { externalId: `v934-${suffix}`, email: `v934.${suffix}@company.com`, name: "Versjonstest", department: "Learning" },
    select: { id: true },
  });
  const modul = await createPublishedModule(`934 modul ${suffix}`);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": `934 ${suffix}`, nb: `934 ${suffix}`, nn: `934 ${suffix}` }),
      publishedAt: new Date(),
      items: { create: [{ itemType: "MODULE", moduleId: modul.module.id, sortOrder: 1 }] },
    },
    select: { id: true },
  });
  await createPassedCertification(participant.id, modul);
  return { participant, course };
}

async function createPublishedModule(title: string) {
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const module = await prisma.module.create({ data: { title }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: `${title} task`,
      assessorExpectedContent: `${title} guidance`,
      rubricVersionId: source!.rubricVersionId,
      promptTemplateVersionId: source!.promptTemplateVersionId,
      mcqSetVersionId: source!.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true, rubricVersionId: true, promptTemplateVersionId: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  return { module, moduleVersion };
}

async function createPassedCertification(userId: string, fixture: Awaited<ReturnType<typeof createPublishedModule>>) {
  const submission = await prisma.submission.create({
    data: {
      userId,
      moduleId: fixture.module.id,
      moduleVersionId: fixture.moduleVersion.id,
      deliveryType: "text",
      responseJson: JSON.stringify({ response: "934" }),
      submissionStatus: "COMPLETED",
    },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: fixture.moduleVersion.id,
      rubricVersionId: fixture.moduleVersion.rubricVersionId,
      promptTemplateVersionId: fixture.moduleVersion.promptTemplateVersionId,
      mcqScaledScore: 84,
      practicalScaledScore: 14,
      totalScore: 98,
      redFlagsJson: "[]",
      passFailTotal: true,
      decisionType: "AUTOMATIC",
      decisionReason: "934",
      finalisedById: userId,
    },
    select: { id: true },
  });
  await prisma.certificationStatus.create({
    data: { userId, moduleId: fixture.module.id, latestDecisionId: decision.id, status: "ACTIVE", passedAt: new Date() },
  });
}
