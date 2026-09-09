import type { AssessmentJobStatus as AssessmentJobStatusType, SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

type CreateAssessmentJobInput = {
  submissionId: string;
  status: AssessmentJobStatusType;
  maxAttempts: number;
};

type CreateLlmEvaluationInput = {
  submissionId: string;
  moduleVersionId: string;
  modelName: string;
  promptTemplateVersionId: string;
  requestPayloadHash: string;
  responseJson: string;
  rubricTotal: number;
  practicalScoreScaled: number;
  passFailPractical: boolean;
  manualReviewRecommended: boolean;
  confidenceNote: string;
};

type AssessmentJobRepositoryClient = Pick<typeof prisma, "assessmentJob" | "submission" | "lLMEvaluation" | "assessmentDecision">;

// #953: «venter fortsatt på et menneske» — ett sted, brukt av både lista og telleren, så de to
// ikke kan komme i utakt. Ingen vedtak = ingen dom er felt; ingen aktiv jobb = ingen er på saken.
// ⚠️ Ikke `as const` på lista: det gir en readonly tuple, som Prisma ikke godtar for `in`. Typen
// faller da stille tilbake til standardformen, og `select` i spørringene under mistes — feilen
// dukker opp langt unna, hos kalleren, som «submission finnes ikke på typen».
const ACTIVE_JOB_FILTER_STATUSES: AssessmentJobStatusType[] = ["PENDING", "RUNNING"];

const STUCK_SUBMISSION_FILTER = {
  // ⚠️ `AND`, ikke to `assessmentJobs`-nøkler i samme objekt. Prisma tar det siste, og et filter
  // som «finnes en feilet» ville da spist «ingen aktiv» uten et pip.
  AND: [
    { decisions: { none: {} } },
    { assessmentJobs: { some: { status: "FAILED" as AssessmentJobStatusType } } },
    { assessmentJobs: { none: { status: { in: ACTIVE_JOB_FILTER_STATUSES } } } },
  ],
};

export function createAssessmentJobRepository(client: AssessmentJobRepositoryClient = prisma) {
  return {
    findPendingOrRunningJobForSubmission(submissionId: string, statuses: AssessmentJobStatusType[]) {
      return client.assessmentJob.findFirst({
        where: {
          submissionId,
          status: { in: statuses },
        },
      });
    },

    findPendingOrRunningJobIdForSubmission(submissionId: string, statuses: AssessmentJobStatusType[]) {
      return client.assessmentJob.findFirst({
        where: {
          submissionId,
          status: { in: statuses },
        },
        select: { id: true },
      });
    },

    createAssessmentJob(data: CreateAssessmentJobInput) {
      return client.assessmentJob.create({ data });
    },

    findNextRunnableJob(now: Date, maxAttempts: number, submissionId?: string) {
      return client.assessmentJob.findFirst({
        where: {
          ...(submissionId ? { submissionId } : {}),
          status: "PENDING",
          availableAt: { lte: now },
          attempts: { lt: maxAttempts },
        },
        orderBy: { createdAt: "asc" },
      });
    },

    tryLockPendingJob(jobId: string, now: Date, lockedBy: string, leaseExpiresAt: Date) {
      return client.assessmentJob.updateMany({
        where: {
          id: jobId,
          status: "PENDING",
        },
        data: {
          status: "RUNNING",
          lockedAt: now,
          lockedBy,
          leaseExpiresAt,
          attempts: { increment: 1 },
        },
      });
    },

    // #792: fenced terminal write. Only succeeds if THIS worker still holds the lease it acquired (status
    // RUNNING + same lockedBy + same lockedAt). If the lease was reset and re-claimed by another worker
    // mid-run, count===0 and the caller must NOT overwrite the new owner's state.
    markJobSucceeded(jobId: string, lockedBy: string, lockedAt: Date) {
      return client.assessmentJob.updateMany({
        where: { id: jobId, status: "RUNNING", lockedBy, lockedAt },
        data: { status: "SUCCEEDED", errorMessage: null, leaseExpiresAt: null },
      });
    },

    /** #953 krav 2: vedtaket er predikatet for «allerede avgjort», ikke innleveringens status. */
    findDecisionIdForSubmission(submissionId: string) {
      return client.assessmentDecision.findFirst({ where: { submissionId }, select: { id: true } });
    },

    findAssessmentJobOrThrow(jobId: string) {
      return client.assessmentJob.findUniqueOrThrow({ where: { id: jobId } });
    },

    /**
     * #953: samme gjerde som de terminale skrivingene, men brukt FØR et vedtak skrives.
     *
     * ⚠️ Jobb-id-en alene duger ikke som gjerde. Når en kjøring forlates på tidsgrensen (#856),
     * fortsetter den i bakgrunnen, og gjenforsøket bruker SAMME jobb-id. Det som skiller de to er
     * `lockedAt` — hver låsing setter et nytt tidspunkt. Uten dette kunne en forlatt kjøring lande
     * et vedtak etter at et nytt forsøk allerede var i gang, og besvarelsen fått to dommer.
     *
     * Skrives som `updateMany` og ikke `count` med vilje: den tar en radlås, så gjerdet holder helt
     * fram til vedtakstransaksjonen commiter. En ren telling kunne blitt utdatert i mellomtiden.
     * `errorMessage: null` er den samme uskadelige nullstillingen `markJobSucceeded` gjør.
     */
    claimDecisionWrite(jobId: string, lockedBy: string, lockedAt: Date) {
      return client.assessmentJob.updateMany({
        where: { id: jobId, status: "RUNNING", lockedBy, lockedAt },
        data: { errorMessage: null },
      });
    },

    // #792: fenced terminal write (see markJobSucceeded). count===0 → lease lost, don't overwrite.
    markJobForRetryOrFailure(jobId: string, lockedBy: string, lockedAt: Date, data: {
      status: AssessmentJobStatusType;
      availableAt: Date;
      errorMessage: string;
    }) {
      return client.assessmentJob.updateMany({
        where: { id: jobId, status: "RUNNING", lockedBy, lockedAt },
        data: { ...data, leaseExpiresAt: null },
      });
    },

    // #792: extend the lease while the assessment is still running, fenced on the current holder, so a long
    // run (two sequential LLM calls) is not reset + re-claimed mid-flight. count===0 → we no longer hold it.
    renewLease(jobId: string, lockedBy: string, lockedAt: Date, leaseExpiresAt: Date) {
      return client.assessmentJob.updateMany({
        where: { id: jobId, status: "RUNNING", lockedBy, lockedAt },
        data: { leaseExpiresAt },
      });
    },

    findAssessmentJobWithSubmissionOrThrow(jobId: string) {
      return client.assessmentJob.findUniqueOrThrow({
        where: { id: jobId },
        include: {
          submission: {
            include: {
              user: true,
              moduleVersion: {
                include: {
                  promptTemplateVersion: true,
                  rubricVersion: true,
                  module: true,
                },
              },
              mcqAttempts: { where: { completedAt: { not: null } }, orderBy: { completedAt: "desc" } },
            },
          },
        },
      });
    },

    updateSubmissionStatus(submissionId: string, submissionStatus: SubmissionStatusType) {
      return client.submission.update({
        where: { id: submissionId },
        data: { submissionStatus },
      });
    },

    createLlmEvaluation(data: CreateLlmEvaluationInput) {
      return client.lLMEvaluation.create({ data });
    },

    /**
     * #953: innleveringer som STÅR FAST fordi vurderingen ga opp.
     *
     * ⚠️ Første utgave spurte «finnes det en FAILED-jobbrad?». Det spørsmålet kan aldri bli nei:
     * et gjenforsøk oppretter en NY jobbrad, og den gamle blir stående for alltid.
     *
     * Riktig spørsmål er «venter denne innleveringen fortsatt på et menneske?»: vurderingen ga opp,
     * det finnes ikke noe vedtak, og ingen ny kjøring er i gang. Da friskmelder tilstanden seg selv.
     *
     * ⚠️ Både lista og telleren spør over INNLEVERINGER, ikke jobbrader. To grunner, begge lærte:
     *
     *  1. Andre utgave la filteret i lista, men bygget tellerens `where` med objektspredning:
     *     `{ ...STUCK, assessmentJobs: { some: FAILED } }`. Senere nøkkel vinner i JS, så
     *     «ingen aktiv jobb» forsvant STILLE fra telleren. Varselet talte da saker noen nettopp
     *     hadde tatt hånd om. Med samme enhet finnes det ikke to `where` å holde i takt.
     *  2. `distinct` + `take` i Prisma tar `take` i databasen på JOBBRADER og dedupliserer i minnet
     *     etterpå. Med flere feilede forsøk per innlevering kunne lista vise færre enn telleren sa.
     */
    findStuckFailedAssessments(limit: number) {
      return client.submission.findMany({
        where: STUCK_SUBMISSION_FILTER,
        orderBy: { submittedAt: "desc" },
        take: limit,
        select: {
          id: true,
          submissionStatus: true,
          submittedAt: true,
          user: { select: { name: true, email: true } },
          module: { select: { id: true, title: true } },
          assessmentJobs: {
            where: { status: "FAILED" },
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { id: true, attempts: true, maxAttempts: true, errorMessage: true, updatedAt: true },
          },
        },
      });
    },

    /** #953: NØYAKTIG samme `where` som lista — samme enhet, samme filter, ett sted. */
    countStuckFailedAssessments() {
      return client.submission.count({ where: STUCK_SUBMISSION_FILTER });
    },

    countJobsByStatus(status: AssessmentJobStatusType) {
      return client.assessmentJob.count({
        where: { status },
      });
    },

    findExpiredRunningJobs(now: Date) {
      return client.assessmentJob.findMany({
        where: {
          status: "RUNNING",
          leaseExpiresAt: { lt: now },
        },
        select: { id: true, attempts: true, maxAttempts: true, submissionId: true },
      });
    },

    findLongRunningJobs(lockedBefore: Date) {
      return client.assessmentJob.findMany({
        where: {
          status: "RUNNING",
          lockedAt: { lt: lockedBefore },
        },
        select: { id: true, submissionId: true, lockedAt: true, lockedBy: true, attempts: true },
      });
    },

    resetExpiredJob(jobId: string, data: {
      status: AssessmentJobStatusType;
      availableAt: Date;
      errorMessage: string;
    }) {
      return client.assessmentJob.update({
        where: { id: jobId },
        data: {
          ...data,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
        },
      });
    },
  };
}

export const assessmentJobRepository = createAssessmentJobRepository();
