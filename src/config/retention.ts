/**
 * Retention policy constants (Privacy by Design — GDPR Art. 5(1)(e)).
 *
 * These values control how long data is kept before automatic pseudonymisation
 * or deletion. They are intentionally conservative: the shortest defensible
 * period given operational and legal requirements.
 *
 * All durations are expressed in whole days so the pseudonymisation scanners
 * can compare against timestamps without timezone ambiguity.
 */

/** Days to retain operational logs (request logs, logOperationalEvent output).
 *  Logs contain IP addresses and user IDs and have no long-term audit value. */
export const OPERATIONAL_LOG_RETENTION_DAYS = 7;

/** Days of grace period after a user-requested pseudonymisation before it is
 *  executed. Gives the user a chance to cancel. Set to 0 to execute immediately
 *  when the user explicitly chooses immediate deletion. */
export const USER_DELETION_GRACE_PERIOD_DAYS = 30;

/** Days of grace period after Entra offboarding (activeStatus → false) before
 *  pseudonymisation runs. Covers re-hire scenarios and sync delays. */
export const OFFBOARDING_GRACE_PERIOD_DAYS = 90;

/** Years of inactivity (no login) before a user is pseudonymised as a backstop.
 *  Applies only when the Entra offboarding trigger has not already fired.
 *  Expressed in years for readability; converted to days internally. */
export const INACTIVITY_RETENTION_YEARS = 2;
export const INACTIVITY_RETENTION_DAYS = INACTIVITY_RETENTION_YEARS * 365;

/**
 * #1152 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Fristen»): archived content without participant
 * history is deleted this many CALENDAR months after it was archived. Not days: the author reads the date in
 * the list («Slettes 13.05.2027»), and «six months after 13 November» is 13 May. The arithmetic (Oslo calendar
 * date, month end) lives in src/modules/content/retentionDeadline.ts.
 */
export const ARCHIVED_CONTENT_RETENTION_MONTHS = 6;

/**
 * #1185 (produkteier 21.11.2026: «Deltager får 7 dager så sletting», regnet «fra deltageren leverte»): in a module with free text
 * and multiple choice, the submission is created when the text is delivered, and the assessment job only when the multiple choice is
 * sent. A participant who has delivered the text but not finished holds an ARCHIVED course back from deletion for this many CALENDAR
 * days (Oslo dates) after `submittedAt`, so they can still finish and earn the course certificate if the course is restored. Then the
 * course can be deleted; the module and the text stay (a delivered submission holds the module back). See courseDeleteGuard.ts.
 */
export const UNFINISHED_SUBMISSION_GRACE_DAYS = 7;

/**
 * #1152: the `PlatformConfig` row that holds the transition floor — the moment the retention rule arrived in
 * this environment (written once by the migration `20261114120000_archived_content_retention`, ISO 8601 UTC).
 * The deadline counts from the LATER of `archivedAt` and this floor, so content archived before the rule
 * existed gets its full six months. A missing or unparseable row means «unknown»: the lists show no date and
 * the job (4c) deletes nothing.
 */
export const ARCHIVED_CONTENT_RETENTION_FLOOR_KEY = "archived_content_retention_floor";
