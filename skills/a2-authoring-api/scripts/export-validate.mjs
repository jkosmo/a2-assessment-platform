// AA-6 (#762): deterministic fallback-export validation for the a2-authoring-api skill.
//
// Problem this guards against: a fallback a2-content-export/v1 file was called "validated"
// without ever being checked against A2's real import schema. Its exportedAt was
// "2026-07-10T21:01:25.216841+00:00" (offset + microseconds); A2's import REJECTED it, because
// exportEnvelopeSchema.exportedAt = z.string().datetime() (Zod) accepts ONLY the JS
// Date.toISOString() shape — "YYYY-MM-DDTHH:mm:ss.sssZ" (no timezone offset, no microseconds).
// The same risk exists on every audit.publishedAt.
//
// This module: (1) normalises any date to Date.toISOString(); (2) provides a strict format
// check for exportedAt/publishedAt; (3) provides a BUNDLED structural validator that mirrors
// A2's exportEnvelopeSchema/importBodySchema (the distributed zip cannot import src); (4) runs
// the real fallback round-trip — write file, read it back, parse, validate against the same
// schema as import, deliver only on pass; (5) builds a NAMED-check production report so the
// skill never says "validated" generically.
//
// The repo test test/unit/agent-authoring-export-schema-roundtrip.test.ts feeds this module's
// generator output through the REAL src schema — that is what guarantees the bundled validator
// stays faithful. Node stdlib only; fs is injectable so the round-trip is unit-testable.
//
// See references/export-validation.md for the governing rules and the headline rule.

import { writeFile as fsWriteFile, readFile as fsReadFile } from "node:fs/promises";

export const EXPORT_FORMAT_VERSION = "a2-content-export/v1";

// The ONLY datetime shape A2's Zod .datetime() (as configured) accepts: exactly what
// Date.prototype.toISOString() produces. 3 fractional digits, trailing Z, no offset.
export const STRICT_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Normalise any date input (Date, ISO with offset, microseconds, epoch ms) to the strict
// Date.toISOString() shape. Throws on an unparseable value rather than emitting garbage.
export function toIsoZ(input) {
  if (input == null) throw new Error("toIsoZ: no date given");
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`toIsoZ: unparseable date "${input}"`);
  return date.toISOString();
}

export function isStrictDatetime(value) {
  return typeof value === "string" && STRICT_DATETIME_RE.test(value);
}

// #754: emit ASCII-safe JSON — every non-ASCII char as a `\uXXXX` escape — so the DELIVERED file is
// pure ASCII and survives any download/editor/transfer that would otherwise re-encode UTF-8. That
// re-encoding is what turns æ/ø/å into Ã¦/Ã¸/Ã¥ (UTF-8 bytes read as Latin-1). A `\uXXXX` escape is
// decoded to the correct codepoint by every JSON parser regardless of the file's byte encoding, so
// the class of bug cannot occur. (SVG asset text already uses XML numeric entities; this covers the
// title/markdown/description prose.)
export function asciiSafeStringify(value, space = 2) {
  return JSON.stringify(value, null, space).replace(
    /[-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

// #754: the UTF-8-decoded-as-Latin-1 double-encoding signature — a leading byte Ã (U+00C3) or
// Â (U+00C2) followed by a continuation byte (U+0080–U+00BF). Norwegian/European prose virtually
// never contains this legitimately, so it is a high-precision "this text is already mis-encoded"
// signal. Detection only — a mojibaked source cannot be safely reversed, so the fix is to reject it
// (and to write ASCII-safe going forward), never to guess the original bytes.
const MOJIBAKE_RE = /[ÂÃ][-¿]/;

// Walk every string value in an envelope; return [{ path, sample }] for values that look
// double-encoded. `contentBase64` blobs are skipped — they are not human text.
export function findMojibake(value, path = "") {
  const offenders = [];
  const walk = (v, p) => {
    if (typeof v === "string") {
      if (MOJIBAKE_RE.test(v)) offenders.push({ path: p, sample: v.slice(0, 40) });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (k === "contentBase64") continue;
        walk(child, p ? `${p}.${k}` : k);
      }
    }
  };
  walk(value, path);
  return offenders;
}

// Every datetime field at risk in an export envelope: the top-level exportedAt, and every
// audit.publishedAt (course audit + each item's module/section audit). Returns [{ path, value }].
export function collectDatetimeFields(envelope) {
  const fields = [];
  if (envelope && "exportedAt" in envelope) fields.push({ path: "exportedAt", value: envelope.exportedAt });

  const pushAudit = (audit, path) => {
    if (audit && "publishedAt" in audit && audit.publishedAt != null) {
      fields.push({ path: `${path}.publishedAt`, value: audit.publishedAt });
    }
  };

  const course = envelope?.course?.course;
  if (course) {
    pushAudit(course.audit, "course.course.audit");
    const items = course.items ?? [];
    items.forEach((item, i) => {
      pushAudit(item.module?.activeVersion?.audit, `course.course.items[${i}].module.activeVersion.audit`);
      pushAudit(item.section?.audit, `course.course.items[${i}].section.audit`);
    });
    (course.modules ?? []).forEach((m, i) => {
      pushAudit(m.module?.activeVersion?.audit, `course.course.modules[${i}].module.activeVersion.audit`);
    });
  }
  pushAudit(envelope?.module?.activeVersion?.audit, "module.activeVersion.audit");
  return fields;
}

// Check every datetime field against the strict shape. { ok, offenders: [{ path, value }] }.
export function strictDatetimeFieldsOk(envelope) {
  const offenders = collectDatetimeFields(envelope).filter((f) => !isStrictDatetime(f.value));
  return { ok: offenders.length === 0, offenders };
}

// Return a deep-cloned envelope with every datetime field normalised to toIsoZ. Leaves null
// publishedAt (= draft, no publish history) untouched.
export function normalizeEnvelopeDates(envelope) {
  const clone = structuredClone(envelope);
  if (clone && clone.exportedAt != null) clone.exportedAt = toIsoZ(clone.exportedAt);

  const fixAudit = (audit) => {
    if (audit && audit.publishedAt != null) audit.publishedAt = toIsoZ(audit.publishedAt);
  };
  const course = clone?.course?.course;
  if (course) {
    fixAudit(course.audit);
    for (const item of course.items ?? []) {
      fixAudit(item.module?.activeVersion?.audit);
      fixAudit(item.section?.audit);
    }
    for (const m of course.modules ?? []) fixAudit(m.module?.activeVersion?.audit);
  }
  fixAudit(clone?.module?.activeVersion?.audit);
  return clone;
}

// Localized-text identity that matches the platform's localizedTextIdentity (structural, per
// locale — NOT by index), so an MCQ correctAnswer must match an option in EVERY locale.
function localizedIdentity(value) {
  if (value == null) return "";
  if (typeof value === "string") return `plain:${value.trim()}`;
  return `locale:${value["en-GB"] ?? ""}|${value.nb ?? ""}|${value.nn ?? ""}`;
}

function isNonEmptyLocalized(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") {
    return ["en-GB", "nb", "nn"].every((k) => typeof value[k] === "string" && value[k].trim().length > 0);
  }
  return false;
}

// Bundled STRUCTURAL validator — a faithful mirror of A2's exportEnvelopeSchema (the zip cannot
// import src). Kept in lock-step with the real schema by the repo round-trip test. Returns
// { valid, issues: [{ path, message }] }.
export function validateExportEnvelopeStructure(envelope) {
  const issues = [];
  const err = (path, message) => issues.push({ path, message });

  if (!envelope || typeof envelope !== "object") {
    return { valid: false, issues: [{ path: "", message: "envelope must be an object" }] };
  }
  if (envelope.exportFormat !== EXPORT_FORMAT_VERSION) err("exportFormat", `must be "${EXPORT_FORMAT_VERSION}"`);
  if (!isStrictDatetime(envelope.exportedAt)) err("exportedAt", "must be Date.toISOString() shape (YYYY-MM-DDTHH:mm:ss.sssZ)");
  if (!["module", "course"].includes(envelope.scope)) err("scope", 'must be "module" or "course"');

  // scope <-> payload must match (mirrors the two .refine()s).
  if ((envelope.scope === "module") !== (envelope.module !== undefined)) err("scope", "module scope requires a module payload (and vice versa)");
  if ((envelope.scope === "course") !== (envelope.course !== undefined)) err("scope", "course scope requires a course payload (and vice versa)");

  const validateAudit = (audit, path) => {
    if (audit == null) return;
    if (typeof audit !== "object") return err(path, "audit must be an object");
    if (audit.publishedAt != null && !isStrictDatetime(audit.publishedAt)) {
      err(`${path}.publishedAt`, "must be Date.toISOString() shape or null");
    }
  };

  const validateModulePayload = (mod, path) => {
    if (!mod || typeof mod !== "object") return err(path, "module payload required");
    if (!mod.module || !isNonEmptyLocalized(mod.module.title)) err(`${path}.module.title`, "required localized title");
    const av = mod.activeVersion;
    if (!av || typeof av !== "object") return err(`${path}.activeVersion`, "required");
    if (av.audit === undefined) err(`${path}.activeVersion.audit`, "required (use {} for draft-only)");
    validateAudit(av.audit, `${path}.activeVersion.audit`);
    // MCQ: correctAnswer must be one of options, by localized identity (every locale).
    for (const [qi, q] of (av.mcqSet?.questions ?? []).entries()) {
      const optionIds = new Set((q.options ?? []).map(localizedIdentity));
      if (!optionIds.has(localizedIdentity(q.correctAnswer))) {
        err(`${path}.activeVersion.mcqSet.questions[${qi}].correctAnswer`, "must equal one of options in every locale");
      }
    }
  };

  const validateSectionPayload = (section, path) => {
    if (!section || typeof section !== "object") return err(path, "section payload required");
    if (!isNonEmptyLocalized(section.title) && (section.title == null)) err(`${path}.title`, "required");
    validateAudit(section.audit, `${path}.audit`);
    // #749 (Layer A): optional inlined figures/images. Mirrors sectionAssetExportSchema — each
    // asset needs sourceId/filename/mimeType/contentBase64 (strings) + a non-negative sizeBytes;
    // localizedVariants (if present) each need a locale + base64. Old asset-less files omit it.
    if (section.assets !== undefined) {
      if (!Array.isArray(section.assets)) {
        err(`${path}.assets`, "must be an array");
      } else {
        section.assets.forEach((asset, ai) => {
          const ap = `${path}.assets[${ai}]`;
          if (!asset || typeof asset !== "object") return err(ap, "asset must be an object");
          for (const field of ["sourceId", "filename", "mimeType", "contentBase64"]) {
            if (typeof asset[field] !== "string" || asset[field].length === 0) err(`${ap}.${field}`, "required non-empty string");
          }
          if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 0) err(`${ap}.sizeBytes`, "must be a non-negative integer");
          if (asset.localizedVariants !== undefined) {
            if (!Array.isArray(asset.localizedVariants)) err(`${ap}.localizedVariants`, "must be an array");
            else asset.localizedVariants.forEach((v, vi) => {
              const vp = `${ap}.localizedVariants[${vi}]`;
              if (!v || typeof v !== "object") return err(vp, "variant must be an object");
              if (typeof v.locale !== "string" || v.locale.length === 0) err(`${vp}.locale`, "required non-empty string");
              if (typeof v.contentBase64 !== "string" || v.contentBase64.length === 0) err(`${vp}.contentBase64`, "required non-empty string");
            });
          }
        });
      }
    }
  };

  if (envelope.scope === "course" && envelope.course) {
    const course = envelope.course.course;
    if (!course || typeof course !== "object") {
      err("course.course", "required");
    } else {
      if (!isNonEmptyLocalized(course.title)) err("course.course.title", "required localized title");
      validateAudit(course.audit, "course.course.audit");
      const modules = course.modules ?? [];
      const items = course.items ?? [];
      if (modules.length === 0 && items.length === 0) err("course.course", "must contain at least one module or item");
      items.forEach((item, i) => {
        const p = `course.course.items[${i}]`;
        if (item.type === "MODULE") validateModulePayload(item.module, `${p}.module`);
        else if (item.type === "SECTION") validateSectionPayload(item.section, `${p}.section`);
        else err(`${p}.type`, 'must be "MODULE" or "SECTION"');
        if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0) err(`${p}.sortOrder`, "must be a non-negative integer");
      });
    }
  }
  if (envelope.scope === "module" && envelope.module) {
    validateModulePayload(envelope.module, "module");
  }

  return { valid: issues.length === 0, issues };
}

// Import-wrapper validity (mirrors importBodySchema draft-only usage): the fallback file is
// imported with mode "createNew" + empty audits, so no publish history exists. Verifies the
// audits are empty/null (draft-only) — a completeness guard, not a rewrite.
export function validateImportWrapper(envelope) {
  const issues = [];
  const datetimes = strictDatetimeFieldsOk(envelope);
  if (!datetimes.ok) {
    for (const o of datetimes.offenders) issues.push({ path: o.path, message: `datetime "${o.value}" is not import-acceptable` });
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Generator: a2-authoring-package/v1 -> a2-content-export/v1 course envelope.
// The mechanical re-wrap described in references/package-schema.md (Fallback format). This is
// the "fallback-export generator output" the repo round-trip test runs through the REAL schema.
// ---------------------------------------------------------------------------
export function buildFallbackEnvelope(pkg, { exportedAt = new Date(), exportedBy = null } = {}) {
  const objectsByRef = new Map((pkg.objects ?? []).map((o) => [o.clientRef, o]));
  const courseObject = (pkg.objects ?? []).find((o) => o.type === "course");
  if (!courseObject) throw new Error("buildFallbackEnvelope: package has no course object");

  const coursePayload = courseObject.payload.course;
  const items = (courseObject.payload.items ?? []).map((item, index) => {
    if (item.moduleId || item.sectionId) {
      throw new Error("buildFallbackEnvelope: fallback export cannot reference existing DB IDs — inline objects only");
    }
    const ref = objectsByRef.get(item.ref);
    if (!ref) throw new Error(`buildFallbackEnvelope: unresolved ref "${item.ref}"`);
    // Deep-clone so the generated envelope never aliases the source package (a shallow spread
    // would share nested mcqSet/rubric objects and let a later edit mutate the source).
    const payload = structuredClone(ref.payload);
    if (item.type === "SECTION") {
      return { type: "SECTION", sortOrder: index, section: { ...payload, audit: {} } };
    }
    return {
      type: "MODULE",
      sortOrder: index,
      module: {
        module: payload.module,
        activeVersion: { ...payload.activeVersion, audit: {} },
      },
    };
  });

  const envelope = {
    exportFormat: EXPORT_FORMAT_VERSION,
    exportedAt: toIsoZ(exportedAt),
    ...(exportedBy ? { exportedBy } : {}),
    scope: "course",
    course: {
      course: {
        title: structuredClone(coursePayload.title),
        ...(coursePayload.description != null ? { description: structuredClone(coursePayload.description) } : {}),
        certificationLevel: coursePayload.certificationLevel ?? null,
        audit: {},
        items,
      },
    },
  };
  return envelope;
}

// ---------------------------------------------------------------------------
// Round-trip: the ONLY thing that earns the word "validated" for a fallback export.
// 1 generate complete -> 2 write file -> 3 read back -> 4 parse -> 5 validate against the same
// schema as A2's import -> 6 deliver only on pass. The delivered file IS the validated file.
// ---------------------------------------------------------------------------
export async function roundTripFallbackExport(
  envelope,
  { filePath, writeFileImpl = fsWriteFile, readFileImpl = fsReadFile, normalize = true, contentIntegrity } = {},
) {
  const checks = {
    jsonParsing: { status: "not-run" },
    exportSchemaValidation: { status: "not-run" },
    importSchemaValidation: { status: "not-run" },
    contentIntegrity: { status: "not-run" },
    encodingIntegrity: { status: "not-run" },
    apiDryRun: { status: "unavailable", detail: "A2 has no import dry-run endpoint (course import writes)" },
    actualImport: { status: "skipped", detail: "human imports the delivered file via the admin UI; the skill never imports" },
  };

  // Step 1: normalise dates on the complete, generated envelope before writing.
  const normalized = normalize ? normalizeEnvelopeDates(envelope) : envelope;

  // Step 2: write ASCII-safe (#754) — every non-ASCII char as `\uXXXX` so the delivered file is pure
  // ASCII and immune to the UTF-8→Latin-1 re-encoding that produces æ/ø/å → Ã¦/Ã¸/Ã¥ mojibake.
  await writeFileImpl(filePath, `${asciiSafeStringify(normalized, 2)}\n`, "utf8");

  // Step 3-4: read back and parse the FINISHED file (never the in-memory object).
  let parsed;
  try {
    parsed = JSON.parse(await readFileImpl(filePath, "utf8"));
    checks.jsonParsing = { status: "pass" };
  } catch (error) {
    checks.jsonParsing = { status: "fail", detail: error instanceof Error ? error.message : String(error) };
    return { delivered: false, file: filePath, checks, envelope: normalized };
  }

  // Step 5a: export-schema validation (structure + strict datetimes).
  const structure = validateExportEnvelopeStructure(parsed);
  checks.exportSchemaValidation = structure.valid
    ? { status: "pass" }
    : { status: "fail", issues: structure.issues };

  // Step 5b: import-schema validation (the same acceptance A2's import applies).
  const wrapper = validateImportWrapper(parsed);
  checks.importSchemaValidation = wrapper.valid ? { status: "pass" } : { status: "fail", issues: wrapper.issues };

  // Step 5c: optional content-integrity (loss audit) if the caller supplies a comparison.
  if (typeof contentIntegrity === "function") {
    const audit = contentIntegrity(parsed);
    checks.contentIntegrity = audit.blocks
      ? { status: "fail", reasons: audit.reasons }
      : { status: "pass" };
  }

  // Step 5d: encoding integrity (#754) — the read-back file must carry no double-encoded (mojibake)
  // text. A garbled source cannot be safely reversed, so it is NOT deliverable: the author must fix
  // the source encoding (or regenerate) rather than ship unreadable Norwegian into the course.
  const mojibake = findMojibake(parsed);
  checks.encodingIntegrity = mojibake.length === 0 ? { status: "pass" } : { status: "fail", offenders: mojibake };

  const passed =
    checks.jsonParsing.status === "pass" &&
    checks.exportSchemaValidation.status === "pass" &&
    checks.importSchemaValidation.status === "pass" &&
    checks.encodingIntegrity.status === "pass" &&
    checks.contentIntegrity.status !== "fail";

  return { delivered: passed, file: filePath, checks, envelope: parsed };
}

// True only when the import-compatibility check actually PASSED. Guards the report against
// claiming "import validation" when only JSON parsing (or nothing) ran (Issue 2, test 10).
export function claimsImportValidated(report) {
  return report?.checks?.importSchemaValidation?.status === "pass";
}

// Human-readable, per-check lines for the production report. Never a generic "validated".
export function describeChecks(report) {
  const label = {
    jsonParsing: "JSON parsing",
    exportSchemaValidation: "export-schema validation",
    importSchemaValidation: "import-schema validation",
    contentIntegrity: "content-integrity",
    encodingIntegrity: "encoding-integrity",
    apiDryRun: "API dry-run",
    actualImport: "actual import",
  };
  return Object.entries(report.checks).map(([key, value]) => {
    const detail = value.detail ? ` — ${value.detail}` : "";
    return `${label[key] ?? key}: ${value.status}${detail}`;
  });
}
