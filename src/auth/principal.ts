import type { AppRole } from "@prisma/client";

export type AuthPrincipal = {
  externalId: string;
  email: string;
  name: string;
  department?: string;
  tokenRoles?: string[];
};

export type RequestContext = {
  principal: AuthPrincipal;
  userId: string;
  roles: AppRole[];
};

