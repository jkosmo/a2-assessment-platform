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
