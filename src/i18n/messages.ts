import type { AppRole } from "@prisma/client";
import type { SupportedLocale } from "./locale.js";

type MessageKey =
  | "unauthorized"
  | "missing_bearer_token"
  | "forbidden_requires_roles"
  | "module_not_found";

const messages: Record<SupportedLocale, Record<MessageKey, string>> = {
  "en-GB": {
    unauthorized: "Authentication failed.",
    missing_bearer_token: "Missing Bearer token.",
    forbidden_requires_roles: "Requires one of roles: {roles}",
    module_not_found: "Module not found.",
  },
  nb: {
    unauthorized: "Autentisering feilet.",
    missing_bearer_token: "Mangler Bearer-token.",
    forbidden_requires_roles: "Krever en av rollene: {roles}",
    module_not_found: "Fant ikke modul.",
  },
  nn: {
    unauthorized: "Autentisering mislukkast.",
    missing_bearer_token: "Manglar Bearer-token.",
    forbidden_requires_roles: "Krev ei av rollene: {roles}",
    module_not_found: "Fann ikkje modul.",
  },
};

export function t(
  locale: SupportedLocale,
  key: MessageKey,
  params?: {
    roles?: AppRole[];
  },
): string {
  const template = messages[locale][key];
  if (!params) {
    return template;
  }

  return template.replace("{roles}", (params.roles ?? []).join(", "));
}
