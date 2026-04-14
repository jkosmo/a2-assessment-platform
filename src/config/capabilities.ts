import { AppRole } from "../db/prismaRuntime.js";
import type { AppRole as AppRoleType } from "@prisma/client";

/**
 * Single source of truth for route and workspace role requirements.
 *
 * app.ts consumes the API route catalog and participantConsole.ts derives
 * workspace navigation from the same module, eliminating duplicated role
 * contracts between app.ts, participant-console.json, frontend fallback
 * navigation arrays, and targeted tests.
 *
 * ## Calibration access override (documented exception)
 *
 * /api/calibration is the only API route whose access roles are NOT defined
 * here. This is an intentional runtime-configurable override:
 * - Roles are read from `calibrationWorkspace.accessRoles` in participant-console.json
 * - Route protection in app.ts uses `participantConsoleRuntimeConfig.calibrationWorkspace.accessRoles`
 * - Workspace navigation uses `buildWorkspaceNavigationItems(calibrationAccessRoles)`
 *
 * This exception exists so calibration access can be tuned per environment
 * without a code deploy. All other routes must have a capability entry below.
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
    id: "courses",
    prefix: "/api/courses",
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
  {
    id: "queue_counts",
    prefix: "/api/queue-counts",
    roles: [AppRole.ADMINISTRATOR, AppRole.REVIEWER, AppRole.APPEAL_HANDLER],
  },
] as const;

export type ApiRouteCapability = (typeof API_ROUTE_CAPABILITIES)[number];
export type WorkspaceNavigationItem = {
  id: string;
  path: string;
  labelKey: string;
  requiredRoles: AppRoleType[];
};

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

export function buildWorkspaceNavigationItems(calibrationAccessRoles: AppRoleType[]): WorkspaceNavigationItem[] {
  return [
    {
      id: "participant",
      path: "/participant",
      labelKey: "nav.participant",
      requiredRoles: [AppRole.PARTICIPANT, AppRole.ADMINISTRATOR, AppRole.REVIEWER],
    },
    {
      id: "review",
      path: "/review",
      labelKey: "nav.review",
      requiredRoles: [AppRole.REVIEWER, AppRole.APPEAL_HANDLER, AppRole.ADMINISTRATOR],
    },
    {
      id: "calibration",
      path: "/calibration",
      labelKey: "nav.calibration",
      requiredRoles: [...calibrationAccessRoles],
    },
    {
      id: "admin-content",
      path: "/admin-content",
      labelKey: "nav.adminContent",
      requiredRoles: [AppRole.SUBJECT_MATTER_OWNER, AppRole.ADMINISTRATOR],
    },
    {
      id: "results",
      path: "/results",
      labelKey: "nav.results",
      requiredRoles: [AppRole.SUBJECT_MATTER_OWNER, AppRole.ADMINISTRATOR, AppRole.REPORT_READER],
    },
    {
      id: "admin-platform",
      path: "/admin-platform",
      labelKey: "nav.adminPlatform",
      requiredRoles: [AppRole.ADMINISTRATOR],
    },
    {
      id: "profile",
      path: "/profile",
      labelKey: "nav.profile",
      requiredRoles: [],
    },
  ];
}
