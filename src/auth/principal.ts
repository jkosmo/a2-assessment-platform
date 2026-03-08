import type { AppRole } from "@prisma/client";

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
};
