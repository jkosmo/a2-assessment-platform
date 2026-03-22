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

export async function getConsentConfig(locale: SupportedLocale): Promise<ConsentConfig> {
  const keys = [
    `consent.body.${locale}`,
    "dpo.name",
    "dpo.email",
    "platform.name",
  ];
  const config = await platformConfigRepository.getMany(keys);

  const body = config[`consent.body.${locale}`] ?? DEFAULT_CONSENT_BODY[locale] ?? DEFAULT_CONSENT_BODY["en-GB"];
  const changelog = CONSENT_CHANGELOG[CURRENT_CONSENT_VERSION] ?? "";

  return {
    version: CURRENT_CONSENT_VERSION,
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
