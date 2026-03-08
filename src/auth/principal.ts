import type { AppRole } from "@prisma/client";
import type { SupportedLocale } from "../i18n/locale.js";

export type AuthPrincipal = {
  externalId: string;
  email: string;
  name: string;
  department?: string;
  tokenRoles?: string[];
  groupIds?: string[];
};

export type RequestContext = {
  correlationId?: string;
  principal?: AuthPrincipal;
  userId?: string;
  roles?: AppRole[];
  locale?: SupportedLocale;
};
