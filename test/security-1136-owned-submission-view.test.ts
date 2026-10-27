import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1136: GET /api/submissions/:id sendte hele raden med moduleVersion — også assessorExpectedContent,
// fasiten for vurdereren — og de rå KI-vurderingene. Samme klasse som #387 i modulruta. Nå: bare
// deltakerens eget, som en hvitliste.

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

describe("[Security #1136] GET /api/submissions/:id gir deltakeren ikke fasiten", () => {
  let submissionId: string;
  let expectedContent: string;

  beforeAll(async () => {
    const modules = await request(app).get("/api/modules?includeCompleted=true").set(participantHeaders);
    expect(modules.status).toBe(200);
    const seed = (modules.body.modules as Array<{ id: string; title: string }>).find((m) => m.title === "Generative AI Foundations");
    if (!seed) throw new Error("Seed module not found.");
    const module = await prisma.module.findUniqueOrThrow({ where: { id: seed.id }, include: { activeVersion: { select: { assessorExpectedContent: true } } } });
    expectedContent = module.activeVersion?.assessorExpectedContent ?? "";
    expect(expectedContent.length, "seed-modulen må ha forventet innhold, ellers tester vi ingenting").toBeGreaterThan(10);

    const created = await request(app).post("/api/submissions").set(participantHeaders).send({
      moduleId: seed.id,
      deliveryType: "text",
      responseJson: { response: "Mitt eget svar #1136.", reflection: "Refleksjon.", promptExcerpt: "Utdrag." },
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    submissionId = created.body.submission.id as string;
    // En KI-vurdering på innleveringen, så det rå svaret finnes å lekke. Feiler den, feiler testen —
    // ellers ville kontrollen under ikke testet noe.
    const row = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { moduleVersionId: true, moduleVersion: { select: { promptTemplateVersionId: true } } } });
    await prisma.lLMEvaluation.create({
      data: {
        submissionId,
        moduleVersionId: row.moduleVersionId,
        modelName: "test-1136",
        promptTemplateVersionId: row.moduleVersion.promptTemplateVersionId!,
        requestPayloadHash: "h",
        responseJson: JSON.stringify({ hemmelig: "rå KI-respons #1136" }),
        rubricTotal: 0,
        practicalScoreScaled: 0,
        passFailPractical: false,
        manualReviewRecommended: false,
      },
    });
    // Og den gamle visningen VILLE lekket begge: raden bærer dem.
    const raw = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { moduleVersion: true, llmEvaluations: true } });
    expect(JSON.stringify(raw)).toContain("rå KI-respons #1136");
  });

  afterAll(async () => {
    await prisma.lLMEvaluation.deleteMany({ where: { submissionId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("svaret har deltakerens eget — og ikke modulversjonen, fasiten, KI-vurderingene eller avgjørelsene", async () => {
    const res = await request(app).get(`/api/submissions/${submissionId}`).set(participantHeaders);
    expect(res.status).toBe(200);
    const s = res.body.submission as Record<string, unknown>;
    expect(s.id).toBe(submissionId);
    expect(s.response).toMatchObject({ response: "Mitt eget svar #1136." });
    for (const key of ["moduleVersion", "llmEvaluations", "decisions", "mcqAttempts", "responseJson", "userId", "processSignalsJson"]) {
      expect(s, key).not.toHaveProperty(key);
    }
    const tekst = JSON.stringify(res.body);
    expect(tekst).not.toContain(expectedContent);
    expect(tekst).not.toContain("rå KI-respons #1136");
  });

  it("en annen deltaker får 404", async () => {
    const res = await request(app).get(`/api/submissions/${submissionId}`).set({ ...participantHeaders, "x-user-id": "participant-1136-annen", "x-user-email": "annen1136@company.com" });
    expect(res.status).toBe(404);
  });
});
