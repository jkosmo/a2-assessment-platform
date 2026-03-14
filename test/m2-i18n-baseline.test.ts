import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import { AssessmentJobStatus } from "../src/db/prismaRuntime.js";

const originalFetch = global.fetch;
const originalLlmMode = env.LLM_MODE;
const originalEndpoint = env.AZURE_OPENAI_ENDPOINT;
const originalApiKey = env.AZURE_OPENAI_API_KEY;
const originalDeployment = env.AZURE_OPENAI_DEPLOYMENT;

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

describe("MVP i18n baseline", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    env.LLM_MODE = originalLlmMode;
    env.AZURE_OPENAI_ENDPOINT = originalEndpoint;
    env.AZURE_OPENAI_API_KEY = originalApiKey;
    env.AZURE_OPENAI_DEPLOYMENT = originalDeployment;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves locale from x-locale header and returns supported locales", async () => {
    const response = await request(app)
      .get("/api/me")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });

    expect(response.status).toBe(200);
    expect(response.body.user.locale).toBe("nb");
    expect(response.body.supportedLocales).toEqual(["en-GB", "nb", "nn"]);
  });

  it("uses fallback locale when unsupported locale is provided", async () => {
    const response = await request(app)
      .get("/api/reviews")
      .set({
        ...participantHeaders,
        "x-locale": "fr",
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("Requires one of roles:");
  });

  it("localizes role error to nb and not-found message to nn", async () => {
    const roleError = await request(app)
      .get("/api/reviews")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });

    expect(roleError.status).toBe(403);
    expect(roleError.body.message).toContain("Krever en av rollene:");

    const notFound = await request(app)
      .get("/api/modules/not-a-real-module")
      .set({
        ...participantHeaders,
        "x-locale": "nn",
      });

    expect(notFound.status).toBe(404);
    expect(notFound.body.message).toBe("Fann ikkje modul.");
  });

  it("resolves locale from Accept-Language when x-locale is absent", async () => {
    const response = await request(app)
      .get("/api/me")
      .set({
        ...participantHeaders,
        "accept-language": "nn-NO,nb;q=0.9,en-GB;q=0.8",
      });

    expect(response.status).toBe(200);
    expect(response.body.user.locale).toBe("nn");
  });

  it("localizes module title and MCQ content for nb locale", async () => {
    const modulesEn = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set({
        ...participantHeaders,
        "x-locale": "en-GB",
      });
    expect(modulesEn.status).toBe(200);

    const seedModule = (modulesEn.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }

    const moduleNb = await request(app)
      .get(`/api/modules/${seedModule.id}`)
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });
    expect(moduleNb.status).toBe(200);
    expect(moduleNb.body.module.title).toBe("Grunnleggende generativ KI");

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      })
      .send({
        moduleId: seedModule.id,
        deliveryType: "text",
        responseJson: {
          response: "Praktisk svar for i18n-test.",
          reflection: "Jeg testet sprakveksling og validerte resultatet.",
          promptExcerpt: "Oppsummer innholdet med tydelig struktur.",
        },
      });
    expect(submissionResponse.status).toBe(201);
    expect(submissionResponse.body.submission.locale).toBe("nb");
    const submissionId = submissionResponse.body.submission.id as string;

    const mcqStartResponse = await request(app)
      .get(`/api/modules/${seedModule.id}/mcq/start`)
      .query({ submissionId })
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });
    expect(mcqStartResponse.status).toBe(200);
    expect(mcqStartResponse.body.questions.length).toBeGreaterThan(0);

    const stems = (mcqStartResponse.body.questions as Array<{ stem: string }>).map((question) => question.stem);
    expect(stems).toContain("Hva er anbefalt ansvarsgrense for modellen?");

    const options = (mcqStartResponse.body.questions as Array<{ options: string[] }>).flatMap(
      (question) => question.options,
    );
    expect(options).toContain("Backend eier endelig beslutning");

    const translatedBoundaryQuestion = (
      mcqStartResponse.body.questions as Array<{ id: string; stem: string }>
    ).find((question) => question.stem === "Hva er anbefalt ansvarsgrense for modellen?");
    if (!translatedBoundaryQuestion) {
      throw new Error("Translated MCQ question not found.");
    }

    const mcqSubmitResponse = await request(app)
      .post(`/api/modules/${seedModule.id}/mcq/submit`)
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      })
      .send({
        submissionId,
        attemptId: mcqStartResponse.body.attemptId,
        responses: [
          {
            questionId: translatedBoundaryQuestion.id,
            selectedAnswer: "Backend eier endelig beslutning",
          },
        ],
      });
    expect(mcqSubmitResponse.status).toBe(200);
    expect(mcqSubmitResponse.body.rawScore).toBeGreaterThanOrEqual(1);
  });

  it("localizes the second seed module title, brief, and MCQ content for nb locale", async () => {
    const modulesEn = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set({
        ...participantHeaders,
        "x-locale": "en-GB",
      });
    expect(modulesEn.status).toBe(200);

    const seedModule = (modulesEn.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "AI Governance and Risk Essentials",
    );
    if (!seedModule) {
      throw new Error("Second seed module not found.");
    }

    const moduleNb = await request(app)
      .get(`/api/modules/${seedModule.id}`)
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });
    expect(moduleNb.status).toBe(200);
    expect(moduleNb.body.module.title).toBe("Grunnleggende KI-styring og risiko");
    expect(moduleNb.body.module.taskText).toBe(
      "Vurder styringsrisiko og dokumenter en praktisk tilnærming til risikoreduserende tiltak.",
    );
    expect(moduleNb.body.module.guidanceText).toBe("Beskriv konkrete kontroller, ansvarlige og oppfølgingsaktiviteter.");

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      })
      .send({
        moduleId: seedModule.id,
        deliveryType: "text",
        responseJson: {
          response: "Praktisk styringssvar for i18n-test.",
          reflection: "Jeg testet norsk visning for styringsmodulen.",
          promptExcerpt: "Beskriv risiko, tiltak og oppfølging.",
        },
      });
    expect(submissionResponse.status).toBe(201);

    const submissionId = submissionResponse.body.submission.id as string;
    const mcqStartResponse = await request(app)
      .get(`/api/modules/${seedModule.id}/mcq/start`)
      .query({ submissionId })
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });
    expect(mcqStartResponse.status).toBe(200);

    const stems = (mcqStartResponse.body.questions as Array<{ stem: string }>).map((question) => question.stem);
    expect(stems).toContain("Hvilken kontroll støtter best sporbarhet i KI-vurderinger?");

    const options = (mcqStartResponse.body.questions as Array<{ options: string[] }>).flatMap(
      (question) => question.options,
    );
    expect(options).toContain("Versjonerte beslutninger og revisjonsspor");
    expect(options).toContain("Send til manuell vurdering etter policy");
  });

  it("uses the submission locale for localized LLM task and guidance context", async () => {
    const modulesEn = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set({
        ...participantHeaders,
        "x-locale": "en-GB",
      });
    expect(modulesEn.status).toBe(200);

    const seedModule = (modulesEn.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }

    const moduleVersion = await prisma.moduleVersion.findFirstOrThrow({
      where: { moduleId: seedModule.id, publishedAt: { not: null } },
      orderBy: { versionNo: "desc" },
    });

    await prisma.moduleVersion.update({
      where: { id: moduleVersion.id },
      data: {
        taskText: JSON.stringify({
          "en-GB": "Complete the assignment in English.",
          nb: "Norsk oppgavekontekst.",
          nn: "Nynorsk oppgavekontekst.",
        }),
        guidanceText: JSON.stringify({
          "en-GB": "Include assurance notes in English.",
          nb: "Norsk veiledningskontekst.",
          nn: "Nynorsk veiledningskontekst.",
        }),
      },
    });

    const modulesNb = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });
    expect(modulesNb.status).toBe(200);

    const localizedModule = (
      modulesNb.body.modules as Array<{ id: string; taskText?: string; guidanceText?: string }>
    ).find((module) => module.id === seedModule.id);
    expect(localizedModule?.taskText).toBe("Norsk oppgavekontekst.");
    expect(localizedModule?.guidanceText).toBe("Norsk veiledningskontekst.");

    env.LLM_MODE = "azure_openai";
    env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    env.AZURE_OPENAI_API_KEY = "test-key";
    env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";

    const fetchSpy = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  module_id: seedModule.id,
                  rubric_scores: {
                    relevance_for_case: 3,
                    quality_and_utility: 3,
                    iteration_and_improvement: 3,
                    human_quality_assurance: 3,
                    responsible_use: 3,
                  },
                  rubric_total: 15,
                  practical_score_scaled: 52.5,
                  pass_fail_practical: true,
                  criterion_rationales: {
                    relevance_for_case: "Relevant.",
                    quality_and_utility: "Useful.",
                    iteration_and_improvement: "Iterative.",
                    human_quality_assurance: "Quality checked.",
                    responsible_use: "Responsible.",
                  },
                  improvement_advice: ["Add examples."],
                  red_flags: [],
                  manual_review_recommended: false,
                  confidence_note: "High confidence.",
                  evidence_sufficiency: "sufficient",
                  recommended_outcome: "pass",
                  manual_review_reason_code: "none",
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      })
      .send({
        moduleId: seedModule.id,
        deliveryType: "text",
        responseJson: {
          response: "Praktisk svar for LLM-lokaliseringskontroll.",
          reflection: "Jeg vurderte norsk lokalisering i assessment-pipelinen.",
          promptExcerpt: "Oppsummer innholdet med norsk kontekst.",
        },
      });
    expect(submissionResponse.status).toBe(201);
    expect(submissionResponse.body.submission.locale).toBe("nb");

    const submissionId = submissionResponse.body.submission.id as string;

    const mcqStartResponse = await request(app)
      .get(`/api/modules/${seedModule.id}/mcq/start`)
      .query({ submissionId })
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });
    expect(mcqStartResponse.status).toBe(200);

    const translatedBoundaryQuestion = (
      mcqStartResponse.body.questions as Array<{ id: string; stem: string }>
    ).find((question) => question.stem === "Hva er anbefalt ansvarsgrense for modellen?");
    if (!translatedBoundaryQuestion) {
      throw new Error("Translated MCQ question not found.");
    }

    const mcqSubmitResponse = await request(app)
      .post(`/api/modules/${seedModule.id}/mcq/submit`)
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      })
      .send({
        submissionId,
        attemptId: mcqStartResponse.body.attemptId,
        responses: [
          {
            questionId: translatedBoundaryQuestion.id,
            selectedAnswer: "Backend eier endelig beslutning",
          },
        ],
      });
    expect(mcqSubmitResponse.status).toBe(200);

    const runAssessmentResponse = await request(app)
      .post(`/api/assessments/${submissionId}/run`)
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      })
      .send({ sync: true });
    expect(runAssessmentResponse.status).toBe(202);

    const latestEvaluation = await prisma.lLMEvaluation.findFirstOrThrow({
      where: { submissionId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestEvaluation).toBeTruthy();

    const latestJob = await prisma.assessmentJob.findFirstOrThrow({
      where: { submissionId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestJob.status).toBe(AssessmentJobStatus.SUCCEEDED);

    const capturedCall = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = capturedCall?.body;
    expect(typeof requestBody).toBe("string");
    const parsedRequestBody = JSON.parse(requestBody as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = parsedRequestBody.messages.find((message) => message.role === "user");

    expect(userMessage?.content).toContain("Participant assignment context:\nNorsk oppgavekontekst.");
    expect(userMessage?.content).toContain("Expected submission content context:\nNorsk veiledningskontekst.");
    expect(userMessage?.content).not.toContain("Complete the assignment in English.");
    expect(userMessage?.content).not.toContain("Include assurance notes in English.");
  });
});
