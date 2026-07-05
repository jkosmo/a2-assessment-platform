// Agent Authoring validate (dry-run) — AA-1 (#649, EPIC #647).
//
// Takes an agent-generated `a2-authoring-package/v1`, returns a detailed,
// actionable validation report and (when error-free) an execution plan in
// topological order. Performs NO database writes — the only DB access is
// read-only lookups for duplicate-title warnings and existing-ID checks.
// Lookups are injectable so the rule set is unit-testable without a DB.
// Report format: doc/design/AGENT_AUTHORING_647.md §5.

import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { localizedTextCodec, type LocalizedText } from "../../codecs/localizedTextCodec.js";
import {
  AUTHORING_PACKAGE_FORMAT,
  authoringPackageSchema,
  type AuthoringPackage,
  type AuthoringModulePayload,
} from "./agentAuthoringSchemas.js";

export type AuthoringIssueSeverity = "error" | "warning";

export interface AuthoringIssue {
  severity: AuthoringIssueSeverity;
  path: string;
  code: string;
  message: string;
}

export type AuthoringPlanOp = "create_section" | "create_module" | "create_course" | "set_course_items";

export interface AuthoringPlanStep {
  op: AuthoringPlanOp;
  clientRef: string;
}

export interface AuthoringValidationReport {
  valid: boolean;
  summary: { errors: number; warnings: number; objects: number };
  issues: AuthoringIssue[];
  plan: AuthoringPlanStep[];
}

// Read-only lookups. `listActive*Titles` return the raw stored title strings
// (plain or serialized LocalizedText JSON); `findExisting*Ids` return the
// subset of the given IDs that exist and are not archived.
export interface AuthoringValidationLookups {
  listActiveModuleTitles(): Promise<Array<{ id: string; title: string }>>;
  listActiveCourseTitles(): Promise<Array<{ id: string; title: string }>>;
  listActiveSectionTitles(): Promise<Array<{ id: string; title: string }>>;
  findExistingModuleIds(ids: string[]): Promise<Set<string>>;
  findExistingSectionIds(ids: string[]): Promise<Set<string>>;
}

const prismaLookups: AuthoringValidationLookups = {
  async listActiveModuleTitles() {
    return prisma.module.findMany({ where: { archivedAt: null }, select: { id: true, title: true } });
  },
  async listActiveCourseTitles() {
    return prisma.course.findMany({ where: { archivedAt: null }, select: { id: true, title: true } });
  },
  async listActiveSectionTitles() {
    return prisma.courseSection.findMany({ where: { archivedAt: null }, select: { id: true, title: true } });
  },
  async findExistingModuleIds(ids: string[]) {
    if (ids.length === 0) return new Set();
    const rows = await prisma.module.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  },
  async findExistingSectionIds(ids: string[]) {
    if (ids.length === 0) return new Set();
    const rows = await prisma.courseSection.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  },
};

function formatIssuePath(path: Array<string | number>): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? segment : `.${segment}`;
    }
  }
  return out.length > 0 ? out : "package";
}

// Zod issues translate 1:1 to report issues with stable codes. The only
// remap is `unrecognized_keys` → `unknown_field`, which is also how a
// hallucinated publish/audit field surfaces (the schemas are strict).
function zodIssueToAuthoringIssue(issue: z.ZodIssue): AuthoringIssue {
  if (issue.code === "unrecognized_keys") {
    return {
      severity: "error",
      path: formatIssuePath(issue.path),
      code: "unknown_field",
      message: `Unknown field(s): ${issue.keys.join(", ")}. Publish/audit fields are not allowed in authoring packages.`,
    };
  }
  return {
    severity: "error",
    path: formatIssuePath(issue.path),
    code: issue.code,
    message: issue.message,
  };
}

// Lower-cased, trimmed locale values of a title — used for duplicate matching.
// A plain-string title matches a localized one when any locale value is equal.
function titleValues(value: LocalizedText | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return Object.values(value)
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());
}

function titlesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

interface ModeFieldCheck {
  field: "taskText" | "rubric" | "promptTemplate" | "mcqSet";
  present: boolean;
}

// Mode rules mirror moduleVersionBodySchema/#525/#578: FREETEXT_* modes need the
// free-text triple, *_MCQ modes need the MCQ set. Fields that the target mode
// cannot use are rejected (not silently dropped) so the agent's package stays an
// accurate description of what will be created.
function checkAssessmentMode(payload: AuthoringModulePayload, basePath: string): AuthoringIssue[] {
  const version = payload.activeVersion;
  const mode = version.assessmentMode ?? "FREETEXT_PLUS_MCQ";
  const fields: ModeFieldCheck[] = [
    { field: "taskText", present: version.taskText !== null && version.taskText !== undefined },
    { field: "rubric", present: version.rubric !== null && version.rubric !== undefined },
    { field: "promptTemplate", present: version.promptTemplate !== null && version.promptTemplate !== undefined },
    { field: "mcqSet", present: version.mcqSet !== null && version.mcqSet !== undefined },
  ];
  const required = new Set<ModeFieldCheck["field"]>(
    mode === "MCQ_ONLY" ? ["mcqSet"]
      : mode === "FREETEXT_ONLY" ? ["taskText", "rubric", "promptTemplate"]
        : ["taskText", "rubric", "promptTemplate", "mcqSet"],
  );

  const issues: AuthoringIssue[] = [];
  for (const { field, present } of fields) {
    if (required.has(field) && !present) {
      issues.push({
        severity: "error",
        path: `${basePath}.activeVersion.${field}`,
        code: "required_for_mode",
        message: `assessmentMode ${mode} requires ${field}.`,
      });
    }
    if (!required.has(field) && present) {
      issues.push({
        severity: "error",
        path: `${basePath}.activeVersion.${field}`,
        code: "forbidden_for_mode",
        message: `assessmentMode ${mode} does not use ${field} — remove it.`,
      });
    }
  }
  return issues;
}

function buildPlan(pkg: AuthoringPackage): AuthoringPlanStep[] {
  const plan: AuthoringPlanStep[] = [];
  for (const object of pkg.objects) {
    if (object.type === "section") plan.push({ op: "create_section", clientRef: object.clientRef });
  }
  for (const object of pkg.objects) {
    if (object.type === "module") plan.push({ op: "create_module", clientRef: object.clientRef });
  }
  for (const object of pkg.objects) {
    if (object.type === "course") {
      plan.push({ op: "create_course", clientRef: object.clientRef });
      if (object.payload.items.length > 0) {
        plan.push({ op: "set_course_items", clientRef: object.clientRef });
      }
    }
  }
  return plan;
}

export async function validateAuthoringPackage(
  input: unknown,
  lookups: AuthoringValidationLookups = prismaLookups,
): Promise<AuthoringValidationReport> {
  const parsed = authoringPackageSchema.safeParse(input);
  const rawObjectCount = Array.isArray((input as { objects?: unknown } | null)?.objects)
    ? ((input as { objects: unknown[] }).objects).length
    : 0;

  if (!parsed.success) {
    const issues = parsed.error.issues.map(zodIssueToAuthoringIssue);
    return {
      valid: false,
      summary: { errors: issues.length, warnings: 0, objects: rawObjectCount },
      issues,
      plan: [],
    };
  }

  const pkg = parsed.data;
  const issues: AuthoringIssue[] = [];

  // Unique clientRef — flag every re-occurrence, keep the first.
  const seenRefs = new Map<string, number>();
  pkg.objects.forEach((object, index) => {
    const firstIndex = seenRefs.get(object.clientRef);
    if (firstIndex !== undefined) {
      issues.push({
        severity: "error",
        path: `objects[${index}].clientRef`,
        code: "duplicate_client_ref",
        message: `clientRef '${object.clientRef}' is already used by objects[${firstIndex}].`,
      });
    } else {
      seenRefs.set(object.clientRef, index);
    }
  });

  const refTypes = new Map<string, "module" | "section" | "course">();
  for (const object of pkg.objects) {
    if (!refTypes.has(object.clientRef)) refTypes.set(object.clientRef, object.type);
  }

  // Per-module assessment-mode rules.
  pkg.objects.forEach((object, index) => {
    if (object.type === "module") {
      issues.push(...checkAssessmentMode(object.payload, `objects[${index}].payload`));
    }
  });

  // Course item references: exactly one of ref | server ID; refs must resolve
  // to a package object of the matching type; server IDs must exist (checked
  // against the DB below).
  const referencedModuleIds = new Map<string, string[]>(); // id -> paths
  const referencedSectionIds = new Map<string, string[]>();
  pkg.objects.forEach((object, objectIndex) => {
    if (object.type !== "course") return;
    object.payload.items.forEach((item, itemIndex) => {
      const itemPath = `objects[${objectIndex}].payload.items[${itemIndex}]`;
      const serverId = item.type === "MODULE" ? item.moduleId : item.sectionId;
      const idField = item.type === "MODULE" ? "moduleId" : "sectionId";
      if (item.ref !== undefined && serverId !== undefined) {
        issues.push({
          severity: "error",
          path: itemPath,
          code: "ref_and_id_conflict",
          message: `Provide either ref or ${idField}, not both.`,
        });
        return;
      }
      if (item.ref === undefined && serverId === undefined) {
        issues.push({
          severity: "error",
          path: itemPath,
          code: "ref_or_id_required",
          message: `A ${item.type} item needs either ref (package object) or ${idField} (existing content).`,
        });
        return;
      }
      if (item.ref !== undefined) {
        const targetType = refTypes.get(item.ref);
        if (targetType === undefined) {
          issues.push({
            severity: "error",
            path: `${itemPath}.ref`,
            code: "unknown_client_ref",
            message: `ref '${item.ref}' does not exist in the package.`,
          });
        } else {
          const expected = item.type === "MODULE" ? "module" : "section";
          if (targetType !== expected) {
            issues.push({
              severity: "error",
              path: `${itemPath}.ref`,
              code: "client_ref_type_mismatch",
              message: `ref '${item.ref}' points to a ${targetType} object, but the item type is ${item.type}.`,
            });
          }
        }
        return;
      }
      const target = item.type === "MODULE" ? referencedModuleIds : referencedSectionIds;
      const paths = target.get(serverId as string) ?? [];
      paths.push(`${itemPath}.${idField}`);
      target.set(serverId as string, paths);
    });
  });

  // Existing-ID checks (read-only).
  const [existingModuleIds, existingSectionIds] = await Promise.all([
    lookups.findExistingModuleIds([...referencedModuleIds.keys()]),
    lookups.findExistingSectionIds([...referencedSectionIds.keys()]),
  ]);
  for (const [moduleId, paths] of referencedModuleIds) {
    if (!existingModuleIds.has(moduleId)) {
      for (const path of paths) {
        issues.push({
          severity: "error",
          path,
          code: "unknown_module_id",
          message: `Module '${moduleId}' does not exist (or is archived).`,
        });
      }
    }
  }
  for (const [sectionId, paths] of referencedSectionIds) {
    if (!existingSectionIds.has(sectionId)) {
      for (const path of paths) {
        issues.push({
          severity: "error",
          path,
          code: "unknown_section_id",
          message: `Section '${sectionId}' does not exist (or is archived).`,
        });
      }
    }
  }

  // Warnings — never blockers.
  pkg.objects.forEach((object, index) => {
    if (object.type === "course") {
      const hasModule = object.payload.items.some((item) => item.type === "MODULE");
      if (!hasModule) {
        issues.push({
          severity: "warning",
          path: `objects[${index}].payload.items`,
          code: "course_without_modules",
          message: "The course has no modules; it cannot be published or completed until at least one module is added.",
        });
      }
    }
  });

  const [moduleTitles, courseTitles, sectionTitles] = await Promise.all([
    lookups.listActiveModuleTitles(),
    lookups.listActiveCourseTitles(),
    lookups.listActiveSectionTitles(),
  ]);
  const existingTitles = {
    module: moduleTitles,
    course: courseTitles,
    section: sectionTitles,
  } as const;
  pkg.objects.forEach((object, index) => {
    const candidate =
      object.type === "module" ? { label: "module" as const, path: `objects[${index}].payload.module.title`, title: object.payload.module.title }
        : object.type === "course" ? { label: "course" as const, path: `objects[${index}].payload.course.title`, title: object.payload.course.title }
          : { label: "section" as const, path: `objects[${index}].payload.title`, title: object.payload.title };
    const candidateValues = titleValues(candidate.title as LocalizedText);
    const duplicate = existingTitles[candidate.label].find((existing) =>
      titlesOverlap(candidateValues, titleValues(localizedTextCodec.parse(existing.title))),
    );
    if (duplicate) {
      issues.push({
        severity: "warning",
        path: candidate.path,
        code: "possible_duplicate_title",
        message: `A ${candidate.label} with this title already exists (id: ${duplicate.id}).`,
      });
    }
  });

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    valid: errors === 0,
    summary: { errors, warnings, objects: pkg.objects.length },
    issues,
    plan: errors === 0 ? buildPlan(pkg) : [],
  };
}
