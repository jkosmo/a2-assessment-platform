#!/usr/bin/env node
// AA-4 (#652): reference implementation of the Agent Authoring orchestration.
// Validates an a2-authoring-package/v1 against the dry-run endpoint, then executes
// the returned plan (draft sections → draft module imports → draft course → items).
// Never calls a publish endpoint; on failure it stops and reports partial progress.
//
// Library usage (also consumed by test/agent-authoring-skill-import.test.ts):
//   import { importPackage, validatePackage } from ".../import-package.mjs";
// CLI usage:
//   node skills/a2-authoring-api/scripts/import-package.mjs --file pkg.json \
//     --base-url http://localhost:3000 [--validate-only]
// Auth (CLI): A2_AUTH_BEARER=<jwt>  — or mock headers via A2_USER_ID / A2_USER_EMAIL /
// A2_USER_NAME / A2_USER_ROLES (default SUBJECT_MATTER_OWNER). Tokens stay in env —
// they are never written to files or echoed in output.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

// The module payload is wrapped in a module-scoped a2-content-export/v1 envelope with an
// EMPTY audit: no source publish history means the import can never auto-publish.
export function synthesizeModuleEnvelope(modulePayload) {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: new Date().toISOString(),
    scope: "module",
    module: {
      module: modulePayload.module,
      activeVersion: { ...modulePayload.activeVersion, audit: {} },
    },
  };
}

async function requestJson(fetchImpl, method, url, headers, body) {
  const response = await fetchImpl(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body — keep raw text for reporting
  }
  return { status: response.status, ok: response.ok, json, text };
}

export async function validatePackage({ baseUrl, headers, pkg, fetchImpl = fetch }) {
  const result = await requestJson(
    fetchImpl,
    "POST",
    `${baseUrl}/api/admin/content/agent-authoring/validate`,
    headers,
    { package: pkg },
  );
  if (result.status !== 200) {
    throw new Error(`validate returned HTTP ${result.status}: ${result.text}`);
  }
  return result.json;
}

// Executes the validate plan. Returns:
//   { ok, report, created: [{ clientRef, type, id, links }], failedStep, error }
// Partial failure: `created` holds everything that succeeded before `failedStep`.
export async function importPackage({ baseUrl, headers, pkg, fetchImpl = fetch, log = () => {} }) {
  const report = await validatePackage({ baseUrl, headers, pkg, fetchImpl });
  if (!report.valid) {
    return { ok: false, report, created: [], failedStep: null, error: "validation_failed" };
  }

  const objectsByRef = new Map(pkg.objects.map((object) => [object.clientRef, object]));
  const idsByRef = new Map();
  const created = [];

  for (const step of report.plan) {
    const object = objectsByRef.get(step.clientRef);
    let result;

    if (step.op === "create_section") {
      result = await requestJson(fetchImpl, "POST", `${baseUrl}/api/admin/content/sections`, headers, {
        title: object.payload.title,
        bodyMarkdown: object.payload.bodyMarkdown,
        draft: true,
        clientRef: step.clientRef,
      });
      if (result.ok) {
        idsByRef.set(step.clientRef, result.json.section.id);
        created.push({ clientRef: step.clientRef, type: "section", id: result.json.section.id, links: result.json.links });
      }
    } else if (step.op === "create_module") {
      result = await requestJson(fetchImpl, "POST", `${baseUrl}/api/admin/content/modules/import`, headers, {
        payload: synthesizeModuleEnvelope(object.payload),
        mode: "createNew",
        autoPublish: false,
        clientRef: step.clientRef,
      });
      if (result.ok) {
        idsByRef.set(step.clientRef, result.json.moduleId);
        created.push({ clientRef: step.clientRef, type: "module", id: result.json.moduleId, links: result.json.links });
      }
    } else if (step.op === "create_course") {
      const course = object.payload.course;
      result = await requestJson(fetchImpl, "POST", `${baseUrl}/api/admin/content/courses`, headers, {
        title: course.title,
        ...(course.description ? { description: course.description } : {}),
        ...(course.certificationLevel ? { certificationLevel: course.certificationLevel } : {}),
        clientRef: step.clientRef,
      });
      if (result.ok) {
        idsByRef.set(step.clientRef, result.json.course.id);
        created.push({ clientRef: step.clientRef, type: "course", id: result.json.course.id, links: result.json.links });
      }
    } else if (step.op === "set_course_items") {
      const items = object.payload.items.map((item) =>
        item.type === "MODULE"
          ? { type: "MODULE", moduleId: item.moduleId ?? idsByRef.get(item.ref) }
          : { type: "SECTION", sectionId: item.sectionId ?? idsByRef.get(item.ref) },
      );
      result = await requestJson(
        fetchImpl,
        "PUT",
        `${baseUrl}/api/admin/content/courses/${idsByRef.get(step.clientRef)}/items`,
        headers,
        { items },
      );
    } else {
      return { ok: false, report, created, failedStep: step, error: `Unknown plan op: ${step.op}` };
    }

    if (!result.ok) {
      return { ok: false, report, created, failedStep: step, error: `HTTP ${result.status}: ${result.text}` };
    }
    log(`${step.op} ${step.clientRef} ✓`);
  }

  return { ok: true, report, created, failedStep: null, error: null };
}

function headersFromEnv(env) {
  if (env.A2_AUTH_BEARER) {
    return { authorization: `Bearer ${env.A2_AUTH_BEARER}` };
  }
  if (!env.A2_USER_ID) {
    throw new Error("Set A2_AUTH_BEARER (shared envs) or A2_USER_ID/A2_USER_EMAIL/A2_USER_NAME (local mock auth).");
  }
  return {
    "x-user-id": env.A2_USER_ID,
    "x-user-email": env.A2_USER_EMAIL ?? `${env.A2_USER_ID}@example.local`,
    "x-user-name": env.A2_USER_NAME ?? env.A2_USER_ID,
    "x-user-roles": env.A2_USER_ROLES ?? "SUBJECT_MATTER_OWNER",
  };
}

function parseArgs(argv) {
  const args = { file: undefined, baseUrl: undefined, validateOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") args.file = argv[++i];
    else if (argv[i] === "--base-url") args.baseUrl = argv[++i];
    else if (argv[i] === "--validate-only") args.validateOnly = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.file || !args.baseUrl) {
    throw new Error("Usage: import-package.mjs --file <package.json> --base-url <url> [--validate-only]");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(await readFile(args.file, "utf8"));
  const headers = headersFromEnv(process.env);

  if (args.validateOnly) {
    const report = await validatePackage({ baseUrl: args.baseUrl, headers, pkg });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.valid ? 0 : 1;
    return;
  }

  const result = await importPackage({
    baseUrl: args.baseUrl,
    headers,
    pkg,
    log: (line) => console.log(line),
  });

  if (!result.ok && result.error === "validation_failed") {
    console.error("Package is invalid — nothing was created:");
    for (const issue of result.report.issues) {
      console.error(`  [${issue.severity}] ${issue.path} (${issue.code}): ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (result.created.length > 0) {
    console.log("\nCreated drafts (review and publish manually in the admin UI):");
    for (const entry of result.created) {
      const link = entry.links?.conversation ?? entry.links?.course ?? entry.links?.editor ?? "";
      console.log(`  ${entry.type} ${entry.clientRef} → ${entry.id}  ${link}`);
    }
  }

  if (!result.ok) {
    console.error(`\nFAILED at step ${result.failedStep?.op} ${result.failedStep?.clientRef}: ${result.error}`);
    console.error("Objects listed above WERE created (drafts). Nothing has been deleted; remaining steps were skipped.");
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
