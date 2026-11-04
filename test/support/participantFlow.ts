import type { Express } from "express";
import request from "supertest";

export type ParticipantHeaders = Record<string, string>;

export async function findModuleIdByTitle(
  app: Express,
  headers: ParticipantHeaders,
  title: string,
  includeCompleted = true,
) {
  const modulesResponse = await request(app)
    .get(`/api/modules${includeCompleted ? "?includeCompleted=true" : ""}`)
    .set(headers);

  if (modulesResponse.status !== 200) {
    throw new Error(`Expected module list 200, received ${modulesResponse.status}.`);
  }

  const module = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
    (candidate) => candidate.title === title,
  );

  if (!module) {
    throw new Error(`Module '${title}' not found.`);
  }

  return module.id;
}

// #934 skive 5a-1: det klienten gjør. Deltakersiden viser modulen fra `GET /api/modules` og sender versjonen den viste
// med innleveringen. `undefined` når modulen ikke har en aktiv versjon, så ruta får svare selv.
export async function seenModuleVersionId(app: Express, headers: ParticipantHeaders, moduleId: string) {
  const response = await request(app).get(`/api/modules/${moduleId}`).set(headers);
  return response.body.module?.activeVersion?.id as string | undefined;
}

// #934 skive 5a-1: det klienten gjør. Først hentes teksten, så sendes versjonen den kom fra tilbake med lesingen. Svaret
// er ruta sitt, også når teksten ikke kunne hentes.
export async function readSection(app: Express, headers: ParticipantHeaders, courseId: string, sectionId: string) {
  const shown = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(headers);
  return request(app)
    .post(`/api/courses/${courseId}/sections/${sectionId}/read`)
    .set(headers)
    .send({ sectionVersionId: shown.body.sectionVersionId });
}

export async function createSubmission(app: Express, headers: ParticipantHeaders, input: {
  moduleId: string;
  responseJson: Record<string, unknown>;
}) {
  const submissionResponse = await request(app)
    .post("/api/submissions")
    .set(headers)
    .send({
      moduleId: input.moduleId,
      moduleVersionId: await seenModuleVersionId(app, headers, input.moduleId),
      deliveryType: "text",
      responseJson: input.responseJson,
    });

  if (submissionResponse.status !== 201) {
    throw new Error(`Expected submission create 201, received ${submissionResponse.status}.`);
  }

  return submissionResponse.body.submission.id as string;
}

export async function startMcq(app: Express, headers: ParticipantHeaders, moduleId: string, submissionId: string) {
  const startMcqResponse = await request(app)
    .get(`/api/modules/${moduleId}/mcq/start`)
    .query({ submissionId })
    .set(headers);

  if (startMcqResponse.status !== 200) {
    throw new Error(`Expected MCQ start 200, received ${startMcqResponse.status}.`);
  }

  return startMcqResponse.body as {
    attemptId: string;
    questions: Array<{ id: string; stem: string }>;
  };
}

export async function submitMcqWithAnswerSelector(
  app: Express,
  headers: ParticipantHeaders,
  moduleId: string,
  submissionId: string,
  attemptId: string,
  questions: Array<{ id: string; stem: string }>,
  selectAnswer: (question: { id: string; stem: string }) => string,
) {
  const responses = questions.map((question) => ({
    questionId: question.id,
    selectedAnswer: selectAnswer(question),
  }));

  const submitMcqResponse = await request(app)
    .post(`/api/modules/${moduleId}/mcq/submit`)
    .set(headers)
    .send({
      submissionId,
      attemptId,
      responses,
    });

  if (submitMcqResponse.status !== 200) {
    throw new Error(`Expected MCQ submit 200, received ${submitMcqResponse.status}.`);
  }

  return submitMcqResponse.body as {
    scaledScore: number;
    percentScore: number;
  };
}

export async function runAssessmentSync(app: Express, headers: ParticipantHeaders, submissionId: string) {
  const runAssessmentResponse = await request(app)
    .post(`/api/assessments/${submissionId}/run`)
    .set(headers)
    .send({ sync: true });

  if (runAssessmentResponse.status !== 202) {
    throw new Error(`Expected assessment run 202, received ${runAssessmentResponse.status}.`);
  }
}
