import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #989: het `m2-recertification-flow.test.ts` og verifiserte utløpsdatoer + påminnelseskjøringer.
// Nå verifiserer den det motsatte: en bestått modul får ACTIVE og `passedAt`, INGEN utløpsdato, og
// påminnelses-endepunktet finnes ikke lenger.

const participantHeaders = {
  "x-user-id": "participant-recert-1",
  "x-user-email": "participant.recert@company.com",
  "x-user-name": "Recert Participant",
  "x-user-roles": "PARTICIPANT",
};

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

describe("Certification status without expiry", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records a passing module as ACTIVE with passedAt and no expiry", async () => {
    const modulesResponse = await request(app).get("/api/modules").set(participantHeaders);
    expect(modulesResponse.status).toBe(200);
    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }
    const moduleId = seedModule.id;

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set(participantHeaders)
      .send({
        moduleId,
        deliveryType: "text",
        responseJson: {
          response:
            "A practical submission with structured examples and responsible guidance. " +
            "It includes before/after prompt versions, measurable output checks, " +
            "documented QA criteria, and mitigation notes for model limitations. " +
            "The submission also describes approval checkpoints, stakeholder review, " +
            "and traceability decisions to ensure robust governance in real delivery contexts.",
          reflection:
            "I iterated prompts in multiple rounds, validated output quality against explicit acceptance criteria, " +
            "documented false-positive/false-negative behavior, and added clear human-review guardrails. " +
            "I also captured how responsible-use checks were executed and how remediation actions were tracked.",
          promptExcerpt:
            "Summarize findings with clear recommendations, evidence references, and operational safeguards.",
        },
      });
    expect(submissionResponse.status).toBe(201);
    const submissionId = submissionResponse.body.submission.id as string;

    const startMcqResponse = await request(app)
      .get(`/api/modules/${moduleId}/mcq/start`)
      .query({ submissionId })
      .set(participantHeaders);
    expect(startMcqResponse.status).toBe(200);

    const responses = startMcqResponse.body.questions.map((question: { id: string; stem: string }) => ({
      questionId: question.id,
      selectedAnswer:
        question.stem === "What is the recommended model ownership boundary?"
          ? "Backend owns final decision"
          : "Prompt versions and thresholds",
    }));

    const submitMcqResponse = await request(app)
      .post(`/api/modules/${moduleId}/mcq/submit`)
      .set(participantHeaders)
      .send({
        submissionId,
        attemptId: startMcqResponse.body.attemptId,
        responses,
      });
    expect(submitMcqResponse.status).toBe(200);

    const runAssessmentResponse = await request(app)
      .post(`/api/assessments/${submissionId}/run`)
      .set(participantHeaders)
      .send({ sync: true });
    expect(runAssessmentResponse.status).toBe(202);

    const reportResponse = await request(app).get("/api/reports/recertification").set(adminHeaders);
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.body.reportType).toBe("certification-status");
    // Tellingen per livssyklustilstand er ryddet: bare de to som betyr noe står igjen.
    expect(Object.keys(reportResponse.body.totals).sort()).toEqual([
      "ACTIVE",
      "NOT_CERTIFIED",
      "certificationCount",
    ]);

    const participantRow = (reportResponse.body.rows as Array<Record<string, unknown>>).find(
      (entry) =>
        entry.moduleId === moduleId &&
        entry.participantEmail === participantHeaders["x-user-email"],
    ) as { certificationId: string; status: string; passedAt: string | null } | undefined;

    expect(participantRow).toBeDefined();
    expect(participantRow?.status).toBe("ACTIVE");
    // Krav 1: `passedAt` beholdes.
    expect(participantRow?.passedAt).toBeTruthy();
    // Utløpsfeltene er ute av rapporten.
    expect(participantRow).not.toHaveProperty("expiryDate");
    expect(participantRow).not.toHaveProperty("recertificationDueDate");
    expect(participantRow).not.toHaveProperty("daysUntilExpiry");

    // Krav 2: kolonnene står igjen i skjemaet — de skrives bare ikke.
    const stored = await prisma.certificationStatus.findUnique({
      where: { id: participantRow!.certificationId },
    });
    expect(stored?.status).toBe("ACTIVE");
    expect(stored?.passedAt).toBeTruthy();
    expect(stored?.expiryDate).toBeNull();
    expect(stored?.recertificationDueDate).toBeNull();
  });

  it("no longer exposes the recertification reminder endpoint", async () => {
    const response = await request(app)
      .post("/api/reports/recertification/reminders/run")
      .set(adminHeaders);

    expect(response.status).toBe(404);
  });
});
