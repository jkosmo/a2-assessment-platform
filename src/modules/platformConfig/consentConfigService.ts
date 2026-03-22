import { platformConfigRepository } from "./platformConfigRepository.js";
import { CURRENT_CONSENT_VERSION, CONSENT_CHANGELOG, DEFAULT_CONSENT_BODY } from "../../config/consent.js";
import type { SupportedLocale } from "../../i18n/locale.js";

export type ConsentConfig = {
  version: string;
  changelog: string;
  body: string;
  dpoName: string | null;
  dpoEmail: string | null;
  platformName: string;
};

// ── Consent version cache ─────────────────────────────────────────────────────
// Reading the active version from DB on every API request would add unnecessary
// latency. The version changes at most a few times per year, so a 60-second
// in-process cache is a safe trade-off.

let versionCache: { version: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Returns the active consent version — the DB value (consent.version) takes
 * precedence over the hard-coded fallback so admins can bump it without a
 * redeploy.
 */
export async function getActiveConsentVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.fetchedAt < CACHE_TTL_MS) {
    return versionCache.version;
  }
  const stored = await platformConfigRepository.get("consent.version");
  const version = stored ?? CURRENT_CONSENT_VERSION;
  versionCache = { version, fetchedAt: Date.now() };
  return version;
}

export function invalidateConsentVersionCache(): void {
  versionCache = null;
}

function incrementMinorVersion(version: string): string {
  const [major, minor] = version.split(".");
  return `${major}.${parseInt(minor ?? "0", 10) + 1}`;
}

/**
 * Auto-increments the consent version and persists it to PlatformConfig.
 * All existing UserConsent records become stale — users will be prompted to
 * re-accept on their next API request.
 */
export async function bumpConsentVersion(updatedBy: string): Promise<string> {
  const current = await getActiveConsentVersion();
  const next = incrementMinorVersion(current);
  await platformConfigRepository.set("consent.version", next, updatedBy);
  invalidateConsentVersionCache();
  return next;
}

export async function getConsentConfig(locale: SupportedLocale): Promise<ConsentConfig> {
  const keys = [
    `consent.body.${locale}`,
    "dpo.name",
    "dpo.email",
    "platform.name",
  ];
  const [config, version] = await Promise.all([
    platformConfigRepository.getMany(keys),
    getActiveConsentVersion(),
  ]);

  const body = config[`consent.body.${locale}`] ?? DEFAULT_CONSENT_BODY[locale] ?? DEFAULT_CONSENT_BODY["en-GB"];
  const changelog = CONSENT_CHANGELOG[version] ?? CONSENT_CHANGELOG[CURRENT_CONSENT_VERSION] ?? "";

  return {
    version,
    changelog,
    body,
    dpoName: config["dpo.name"] ?? null,
    dpoEmail: config["dpo.email"] ?? null,
    platformName: config["platform.name"] ?? "Assessment Platform",
  };
}

export async function upsertConsentConfig(
  entries: {
    bodyNb?: string;
    bodyEnGb?: string;
    bodyNn?: string;
    dpoName?: string;
    dpoEmail?: string;
    platformName?: string;
  },
  updatedBy: string,
): Promise<void> {
  const updates: Record<string, string> = {};
  if (entries.bodyNb !== undefined) updates["consent.body.nb"] = entries.bodyNb;
  if (entries.bodyEnGb !== undefined) updates["consent.body.en-GB"] = entries.bodyEnGb;
  if (entries.bodyNn !== undefined) updates["consent.body.nn"] = entries.bodyNn;
  if (entries.dpoName !== undefined) updates["dpo.name"] = entries.dpoName;
  if (entries.dpoEmail !== undefined) updates["dpo.email"] = entries.dpoEmail;
  if (entries.platformName !== undefined) updates["platform.name"] = entries.platformName;
  if (Object.keys(updates).length > 0) {
    await platformConfigRepository.setMany(updates, updatedBy);
  }
}
