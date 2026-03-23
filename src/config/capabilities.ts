import { AppRole } from "../db/prismaRuntime.js";
import type { AppRole as AppRoleType } from "@prisma/client";

/**
 * Single source of truth for API route role requirements.
 *
 * Each entry maps a route prefix (as mounted in app.ts) to the roles that may
 * access it.  app.ts consumes this catalog instead of repeating role arrays
 * inline, eliminating the previous three-way duplication between app.ts,
 * participant-console.json, and the RBAC matrix test.
 *
 * Note: /api/calibration roles are intentionally kept in participant-console.json
 * (calibrationWorkspace.accessRoles) because they are runtime-configurable.
 * app.ts reads those at startup and continues to use them directly.
 *
 * Note: workspace page role enforcement is handled by the client-side navigation
 * guard (participant-console.json requiredRoles) and is not duplicated here.
 * A future pass can consolidate those too once the JSON config is replaced.
 */
export const API_ROUTE_CAPABILITIES = [
  {
    id: "modules",
    prefix: "/api/modules",
    roles: [
      AppRole.PARTICIPANT,
      AppRole.SUBJECT_MATTER_OWNER,
      AppRole.ADMINISTRATOR,
      AppRole.APPEAL_HANDLER,
      AppRole.REPORT_READER,
      AppRole.REVIEWER,
    ],
  },
  {
    id: "submissions",
    prefix: "/api/submissions",
    roles: [AppRole.PARTICIPANT, AppRole.ADMINISTRATOR, AppRole.REVIEWER],
  },
  {
    id: "assessments",
    prefix: "/api/assessments",
    roles: [AppRole.PARTICIPANT, AppRole.ADMINISTRATOR, AppRole.REVIEWER],
  },
  {
    id: "audit",
    prefix: "/api/audit",
    roles: [
      AppRole.PARTICIPANT,
      AppRole.SUBJECT_MATTER_OWNER,
      AppRole.ADMINISTRATOR,
      AppRole.APPEAL_HANDLER,
      AppRole.REPORT_READER,
      AppRole.REVIEWER,
    ],
  },
  {
    id: "reviews",
    prefix: "/api/reviews",
    roles: [AppRole.ADMINISTRATOR, AppRole.REVIEWER],
  },
  {
    id: "appeals",
    prefix: "/api/appeals",
    roles: [AppRole.ADMINISTRATOR, AppRole.APPEAL_HANDLER],
  },
  {
    id: "reports",
    prefix: "/api/reports",
    roles: [AppRole.ADMINISTRATOR, AppRole.REPORT_READER, AppRole.SUBJECT_MATTER_OWNER],
  },
  {
    id: "admin_content",
    prefix: "/api/admin/content",
    roles: [AppRole.ADMINISTRATOR, AppRole.SUBJECT_MATTER_OWNER],
  },
  {
    id: "admin_modules",
    prefix: "/api/admin/modules",
    roles: [AppRole.ADMINISTRATOR, AppRole.SUBJECT_MATTER_OWNER],
  },
  {
    id: "admin_platform",
    prefix: "/api/admin/platform",
    roles: [AppRole.ADMINISTRATOR],
  },
  {
    id: "admin_sync_org",
    prefix: "/api/admin/sync/org",
    roles: [AppRole.ADMINISTRATOR],
  },
] as const;

export type ApiRouteCapability = (typeof API_ROUTE_CAPABILITIES)[number];

/**
 * Look up the roles for a given route id.  Throws if not found so that
 * typos in app.ts surface immediately at startup rather than silently
 * leaving a route unprotected.
 */
export function rolesFor(id: ApiRouteCapability["id"]): AppRoleType[] {
  const entry = API_ROUTE_CAPABILITIES.find((c) => c.id === id);
  if (!entry) {
    throw new Error(`No capability entry found for route id "${id}"`);
  }
  return [...entry.roles];
}
