// Agent Authoring package contract (`a2-authoring-package/v1`) — AA-1 (#649, EPIC #647).
//
// The package is the agent's *plan*: it is sent to the validate endpoint for a
// dry-run and used by the authoring skill as the source for individual create
// calls. It is never persisted as a whole. Leaf payloads reuse the
// `a2-content-export/v1` schemas minus `audit` — agents have no publish history,
// and the contract must not carry any field that could make content live.
// All objects are `.strict()` so publish/audit fields fail loudly
// (`unrecognized_keys` → reported as `unknown_field`) instead of being ignored.
// See doc/design/AGENT_AUTHORING_647.md §2.

import { z } from "zod";
import {
  localizedTextSchema,
  localizedTextPatchSchema,
  certificationLevelInputSchema,
  assessmentModeSchema,
  submissionSchemaBodySchema,
  assessmentPolicyBodySchema,
  rubricBodySchema,
  promptTemplateBodySchema,
  mcqSetBodySchema,
  clientRefSchema,
} from "./adminContentSchemas.js";

export const AUTHORING_PACKAGE_FORMAT = "a2-authoring-package/v1" as const;

export { clientRefSchema };

// #763 (Layer B): a client-chosen reference token an agent uses to tie a section's inline figure
// to its markdown. UNLIKE the export `sourceId` (which is a source-environment DB id), an authoring
// asset's `sourceId` is a free token the agent invents, referenced in `bodyMarkdown` as
// `asset:<sourceId>`. Wider grammar than clientRef (allows `_` and upper-case) so it round-trips
// through the export `sourceId` shape; still tight enough to stay a safe markdown ref.
export const authoringAssetSourceIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "asset sourceId must match [a-zA-Z0-9_-]{1,64}.");

// #763 (Layer B): one inline section figure/image carried in an authoring package. Shape mirrors
// the export `sectionAssetExportSchema` (base64 blob + optional #657 localized SVG variants), but
// `sourceId` is a client-chosen ref token (see above). Strict so a hallucinated field fails loudly.
export const authoringSectionAssetSchema = z
  .object({
    sourceId: authoringAssetSourceIdSchema,
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().min(0),
    contentBase64: z.string().min(1),
    sourceLocale: z.string().min(1).nullable().optional(),
    localizedVariants: z
      .array(
        z
          .object({
            locale: z.string().min(1),
            contentBase64: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

// Module payload = moduleExportPayloadSchema without `audit` (strict).
export const authoringModulePayloadSchema = z
  .object({
    module: z
      .object({
        title: localizedTextSchema,
        description: localizedTextSchema.nullable().optional(),
        certificationLevel: certificationLevelInputSchema,
      })
      .strict(),
    activeVersion: z
      .object({
        assessmentMode: assessmentModeSchema.optional(),
        taskText: localizedTextSchema.nullable().optional(),
        assessorExpectedContent: localizedTextSchema.nullable().optional(),
        candidateTaskConstraints: localizedTextSchema.nullable().optional(),
        assessmentBlueprint: z.string().nullable().optional(),
        submissionSchema: submissionSchemaBodySchema.nullable().optional(),
        assessmentPolicy: assessmentPolicyBodySchema.nullable().optional(),
        rubric: rubricBodySchema.nullable().optional(),
        promptTemplate: promptTemplateBodySchema.nullable().optional(),
        mcqSet: mcqSetBodySchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();

// Section payload = sectionExportPayloadSchema without `audit` (strict).
// #763 (Layer B): an OPTIONAL `assets[]` carries the section's inline figures/images; markdown
// references each as `asset:<sourceId>`. Omit it entirely for a text-only section.
export const authoringSectionPayloadSchema = z
  .object({
    title: localizedTextPatchSchema,
    bodyMarkdown: localizedTextPatchSchema,
    assets: z.array(authoringSectionAssetSchema).optional(),
  })
  .strict();

// Course items reference other package objects by `clientRef` OR existing
// content by server ID (mixing is allowed — an agent may reuse an existing
// module in a new course). Exactly-one-of is enforced by the validation
// service so it can report precise `ref_or_id_required` / `ref_and_id_conflict`
// codes instead of a generic refine failure.
export const authoringCourseItemSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("MODULE"),
      ref: clientRefSchema.optional(),
      moduleId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SECTION"),
      ref: clientRefSchema.optional(),
      sectionId: z.string().min(1).optional(),
    })
    .strict(),
]);

export const authoringCoursePayloadSchema = z
  .object({
    course: z
      .object({
        title: localizedTextSchema,
        description: localizedTextSchema.nullable().optional(),
        certificationLevel: certificationLevelInputSchema,
      })
      .strict(),
    items: z.array(authoringCourseItemSchema),
  })
  .strict();

export const authoringObjectSchema = z.discriminatedUnion("type", [
  z.object({ clientRef: clientRefSchema, type: z.literal("module"), payload: authoringModulePayloadSchema }).strict(),
  z.object({ clientRef: clientRefSchema, type: z.literal("section"), payload: authoringSectionPayloadSchema }).strict(),
  z.object({ clientRef: clientRefSchema, type: z.literal("course"), payload: authoringCoursePayloadSchema }).strict(),
]);

export const authoringPackageSchema = z
  .object({
    packageFormat: z.literal(AUTHORING_PACKAGE_FORMAT),
    // Informative only (the agent's primary language); leaf payloads follow the
    // LocalizedText rules regardless.
    locale: z.string().trim().min(1).max(16).optional(),
    // Free-form audit/debug context (the requirements the agent worked from).
    // Never interpreted by the server.
    constraints: z.record(z.unknown()).optional(),
    objects: z.array(authoringObjectSchema).min(1),
  })
  .strict();

export type AuthoringPackage = z.infer<typeof authoringPackageSchema>;
export type AuthoringObject = z.infer<typeof authoringObjectSchema>;
export type AuthoringModulePayload = z.infer<typeof authoringModulePayloadSchema>;
export type AuthoringSectionPayload = z.infer<typeof authoringSectionPayloadSchema>;
export type AuthoringSectionAsset = z.infer<typeof authoringSectionAssetSchema>;
export type AuthoringCoursePayload = z.infer<typeof authoringCoursePayloadSchema>;
