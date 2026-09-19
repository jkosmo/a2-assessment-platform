export { upsertCertificationStatusFromDecision } from "./certificationStatusService.js";
export type { CertificationStatusOutcome } from "./certificationStatusService.js";

export {
  notifyAssessmentResult,
  notifyAppealStatusTransition,
  sendAppealStatusNotification,
  sendModuleRevisedNotification,
  sendViaAcs,
} from "./participantNotificationService.js";
export type {
  AppealNotificationInput,
  AssessmentResultNotificationInput,
  ModuleRevisedNotificationInput,
} from "./participantNotificationService.js";

export {
  certificationRepository,
  createCertificationRepository,
  isCertificationPassed,
  CERTIFICATION_PASSED_STATUSES,
} from "./certificationRepository.js";
