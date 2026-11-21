// #1176: EN INNLEVERING SOM BARE ER ÅPNET, ALDRI LEVERT.
//
// I en REN FLERVALGSMODUL (`MCQ_ONLY`) lages innleveringen (`Submission`) når deltakeren åpner modulen, med status SUBMITTED, før noe er
// levert, og et forsøk (`MCQAttempt`) når spørsmålene hentes. En slik rad er ingen deltakerhistorikk: den holder ikke en arkivert
// modul igjen fra sletting, og den slettes sammen med modulen. (I en modul med fritekst lages innleveringen når teksten leveres; se
// under.)
//
// ⚠️ HVITELISTE, ikke svarteliste (CLAUDE.md, «Pre-flight» punkt 3): raden er tom bare når INGENTING annet finnes. Alt som tyder på at
// noe er levert eller vurdert, gjør den til historikk: en vurderingsjobb (fritekst ved levering), en avgjørelse, en anke, en manuell
// behandling, en KI-vurdering, en bestått, eller et flervalgsforsøk som er fullført eller har svar. En ny tabell under `Submission`
// må tas med her; test/unit/opened-only-submission-1176.test.ts leser hvert felt på `Submission` i skjemaet.
//
// Samme tanke som i 2.164.1 for kurs (`countPendingReviewsOnModules`, contentLifecycle.ts: SUBMITTED uten vurderingsjobb venter ikke
// på noe), men strengere, fordi dette avgjør om noe slettes.
//
// ⚠️ BARE RENE FLERVALGSMODULER (QA 2.172.0, Claude-agent: NO-GO i første versjon). En innlevering i en modul med fritekst lages
// IKKE når modulen åpnes, men når deltakeren trykker «Lever», med teksten i `responseJson` (participant.js, «/api/submissions»;
// submissionService.ts). I en modul med fritekst og flervalg står den så som SUBMITTED uten vurderingsjobb til flervalget er sendt
// inn: den SER tom ut, men har levert tekst. Bare en ren flervalgsmodul (`MCQ_ONLY`) har ingen tekst å miste; der lages
// innleveringen når modulen åpnes, og det som leveres, er flervalget (forsøket). Derfor kreves `MCQ_ONLY`, og i tillegg ingen
// KI-erklæring og intet vedlegg. Fritekst som er levert men ikke vurdert, er alltid deltakerhistorikk.
import type { Prisma } from "@prisma/client";
import { SubmissionStatus } from "../../db/prismaRuntime.js";

export const openedOnlySubmissionWhere = {
  submissionStatus: SubmissionStatus.SUBMITTED,
  moduleVersion: { assessmentMode: "MCQ_ONLY" },
  processSignalsJson: null,
  attachmentUri: null,
  assessmentJobs: { none: {} },
  decisions: { none: {} },
  appeals: { none: {} },
  manualReviews: { none: {} },
  llmEvaluations: { none: {} },
  modulePass: { is: null },
  mcqAttempts: { every: { completedAt: null, responses: { none: {} } } },
} satisfies Prisma.SubmissionWhereInput;

/** En innlevering som er levert eller vurdert: deltakerhistorikk. Det motsatte av `openedOnlySubmissionWhere`. */
export const deliveredSubmissionWhere = { NOT: openedOnlySubmissionWhere } satisfies Prisma.SubmissionWhereInput;
