import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { createSubmission, findModuleIdByTitle, runAssessmentSync, startMcq, submitMcqWithAnswerSelector } from "./support/participantFlow.js";

// #1160: deltakersiden fortsetter et påbegynt flervalgsforsøk fra kladden med `GET mcq/start` på den lagrede innleveringen.
// Den må kunne skille et ENDELIG avslag (glem kladden, start på nytt) fra en forbigående feil (behold svarene, prøv igjen).
// Før var alle avslagene vanlige `Error`, og ruta svarte 500 `internal_error` på dem, akkurat som på en tjenerfeil.
// Testen går gjennom ruta, for det er statuskoden og koden klienten leser.

const participant = { "x-user-id": "participant-1", "x-user-email": "participant@company.com", "x-user-name": "Platform Participant" };
const stranger = {
  "x-user-id": `mcq1160-${Date.now()}`,
  "x-user-email": `mcq1160-${Date.now()}@company.com`,
  "x-user-name": "Noen andre",
  "x-user-roles": "PARTICIPANT",
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("#1160 mcq/start: å fortsette og de endelige avslagene", () => {
  it("samme innlevering gir det samme åpne forsøket; levert og vurdert gir 409, en annens innlevering 404", async () => {
    const moduleId = await findModuleIdByTitle(app, participant, "Generative AI Foundations");
    const submissionId = await createSubmission(app, participant, {
      moduleId,
      responseJson: { response: "Svar for #1160.", reflection: "Refleksjon.", promptExcerpt: "Assess." },
    });

    // Premisset for å fortsette: kallet er idempotent mens forsøket er åpent.
    const first = await startMcq(app, participant, moduleId, submissionId);
    const again = await startMcq(app, participant, moduleId, submissionId);
    expect(again.attemptId).toBe(first.attemptId);
    expect(again.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));

    // En annens innlevering: endelig, 404 med egen kode (ikke 500).
    const foreign = await request(app).get(`/api/modules/${moduleId}/mcq/start`).query({ submissionId }).set(stranger);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("submission_not_found");

    await submitMcqWithAnswerSelector(app, participant, moduleId, submissionId, first.attemptId, first.questions, () => "Backend owns final decision");
    await runAssessmentSync(app, participant, submissionId);

    // Levert og vurdert: endelig, 409 med egen kode.
    const closed = await request(app).get(`/api/modules/${moduleId}/mcq/start`).query({ submissionId }).set(participant);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe("mcq_attempt_closed");
  });
});
