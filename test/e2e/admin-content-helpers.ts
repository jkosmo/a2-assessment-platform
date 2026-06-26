import { expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

// #599: shared e2e harness for the admin-content suite. Extracted from
// admin-content-workspaces.spec.ts so multiple spec files can reuse the mock API +
// helpers WITHOUT importing a test file (Playwright forbids one spec importing another).

type MockModule = {
  id: string;
  title: string;
  activeVersion?: { versionNo: number };
};

type MockLibraryModule = {
  id: string;
  title?: string;
  status?: string;
};

type MockCourse = {
  id: string;
  title: Record<string, string> | string;
  certificationLevel: string | null;
  enrollmentPolicy?: "OPEN" | "RESTRICTED";
  moduleCount?: number;
  updatedAt?: string;
  publishedAt?: string | null;
  description?: Record<string, string> | string | null;
  modules?: Array<{
    moduleId: string;
    sortOrder: number;
    moduleTitle?: Record<string, string> | string;
  }>;
  archivedAt?: string | null;
};

type MockNavigationItem = {
  id: string;
  path: string;
  labelKey: string;
  requiredRoles?: string[];
};

export type MockModuleExport = {
  module: {
    id: string;
    title: Record<string, string>;
    certificationLevel?: string;
    activeVersionId?: string | null;
    archivedAt?: string | null;
  };
  selectedConfiguration: {
    source?: string | null;
    moduleVersion?: any;
    rubricVersion?: any;
    promptTemplateVersion?: any;
    mcqSetVersion?: any;
  };
  versions: {
    moduleVersions: any[];
    rubricVersions: any[];
    promptTemplateVersions: any[];
    mcqSetVersions: any[];
  };
};

export function localizedText(base: string): Record<string, string> {
  return {
    "en-GB": `${base} (EN)`,
    nb: `${base} (NB)`,
    nn: `${base} (NN)`,
  };
}

function buildMockQuestion(index: number, optionCount = 4) {
  const options = Array.from({ length: optionCount }, (_, optionIndex) =>
    `Option ${index + 1}${String.fromCharCode(65 + optionIndex)}`,
  );
  return {
    stem: `Question ${index + 1}?`,
    options,
    correctAnswer: options[1],
    rationale: `Because option ${index + 1}B is the strongest fit.`,
  };
}

export function buildMockModuleExport({
  id,
  title,
  certificationLevel = "basic",
  taskText = localizedText("Scenario text"),
  assessorExpectedContent = localizedText("Strong answers should explain the main concepts."),
  mcqQuestions = [],
  activeVersionId = null,
  moduleVersionId = null,
}: {
  id: string;
  title: string;
  certificationLevel?: string;
  taskText?: Record<string, string>;
  assessorExpectedContent?: Record<string, string>;
  mcqQuestions?: Array<{
    stem: Record<string, string>;
    options: Record<string, string>[];
    correctAnswer: Record<string, string>;
    rationale: Record<string, string>;
  }>;
  activeVersionId?: string | null;
  moduleVersionId?: string | null;
}): MockModuleExport {
  const moduleVersion = moduleVersionId
    ? {
        id: moduleVersionId,
        versionNo: 1,
        taskText,
        assessorExpectedContent,
        submissionSchema: {
          fields: [
            {
              id: "response",
              label: localizedText("Your answer"),
              type: "textarea",
              required: true,
              placeholder: localizedText("Write your answer here"),
            },
          ],
        },
      }
    : null;

  const mcqSetVersion = mcqQuestions.length
    ? {
        id: `${id}-mcq-1`,
        title: localizedText(title),
        questions: mcqQuestions,
      }
    : null;

  return {
    module: {
      id,
      title: localizedText(title),
      certificationLevel,
      activeVersionId,
      archivedAt: null,
    },
    selectedConfiguration: {
      source: moduleVersion ? "draftModuleVersion" : null,
      moduleVersion,
      rubricVersion: moduleVersion
        ? {
            id: `${id}-rubric-1`,
            versionNo: 1,
            criteria: {},
            scalingRule: {},
          }
        : null,
      promptTemplateVersion: moduleVersion
        ? {
            id: `${id}-prompt-1`,
            versionNo: 1,
            systemPrompt: localizedText("You are an assessment assistant."),
            userPromptTemplate: localizedText("Evaluate the participant answer."),
            examples: [],
          }
        : null,
      mcqSetVersion,
    },
    versions: {
      moduleVersions: moduleVersion ? [moduleVersion] : [],
      rubricVersions: moduleVersion
        ? [
            {
              id: `${id}-rubric-1`,
              versionNo: 1,
              criteria: {},
              scalingRule: {},
            },
          ]
        : [],
      promptTemplateVersions: moduleVersion
        ? [
            {
              id: `${id}-prompt-1`,
              versionNo: 1,
              systemPrompt: localizedText("You are an assessment assistant."),
              userPromptTemplate: localizedText("Evaluate the participant answer."),
              examples: [],
            },
          ]
        : [],
      mcqSetVersions: mcqSetVersion ? [mcqSetVersion] : [],
    },
  };
}

export async function clickEnabledButton(page: Page, label: string | RegExp) {
  const button = page
    .locator("button:enabled")
    .filter(typeof label === "string" ? { hasText: label } : { hasText: label })
    .last();
  await expect(button).toBeVisible();
  await button.click();
}

export async function submitActiveChatInput(page: Page, value: string) {
  const input = page.locator(".chat-text-input:enabled, .chat-textarea:enabled").last();
  await expect(input).toBeVisible();
  await input.fill(value);
  await clickEnabledButton(page, /Next|Neste|Næste/i);
}

function courseTitleForLocale(title: Record<string, string> | string | undefined, locale = "en-GB") {
  if (!title) return "";
  if (typeof title === "string") return title;
  return title[locale] ?? title["en-GB"] ?? title.nb ?? title.nn ?? Object.values(title)[0] ?? "";
}

export function courseTextForLocale(value: Record<string, string> | string | undefined | null, locale = "en-GB") {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value["en-GB"] ?? value.nb ?? value.nn ?? Object.values(value)[0] ?? "";
}

export async function mockCommonApis(page: Page, {
  modules = [],
  libraryModules = [],
  courses = [],
  moduleExports = {},
  navigationItems = [],
  meRoles = ["SUBJECT_MATTER_OWNER"],
}: {
  modules?: MockModule[];
  libraryModules?: MockLibraryModule[];
  courses?: MockCourse[];
  moduleExports?: Record<string, MockModuleExport>;
  navigationItems?: MockNavigationItem[];
  meRoles?: string[];
} = {}) {
  const mutableModules = [...modules];
  const exportMap = new Map<string, MockModuleExport>(Object.entries(moduleExports));
  const mutableCourses = courses.map((course) => ({
    ...course,
    description: course.description ?? null,
    modules: [...(course.modules ?? [])],
    archivedAt: course.archivedAt ?? null,
  }));
  const state = {
    mutableModules,
    mutableCourses,
    exportMap,
    lastDraftGenerationBody: null as any,
    lastDraftLocalizationBody: null as any,
    lastMcqLocalizationBody: null as any,
    lastCourseLocalizationBodies: [] as any[],
    lastTitlePatchBody: null as any,
    lastSourceMaterialExtraction: null as any,
  };
  const extractionJobs = new Map<string, { fileName: string; extractedText: string }>();

  await page.route("**/participant/config", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: {
          items: navigationItems,
          workspaceItems: navigationItems,
          profileItem: navigationItems.find((item) => item.id === "profile") ?? null,
        },
        identityDefaults: {
          userId: "content-owner-1",
          email: "content.owner@example.test",
          name: "Content Owner",
          department: "Learning",
          roles: meRoles,
        },
      }),
    });
  });

  await page.route("**/version", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: "e2e" }),
    });
  });

  await page.route("**/api/queue-counts", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reviews: 0, appeals: 0 }),
    });
  });

  await page.route("**/api/me", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "content-owner-1",
          email: "content.owner@example.test",
          name: "Content Owner",
          roles: meRoles,
        },
        consent: { accepted: true },
        pendingDeletion: null,
      }),
    });
  });

  await page.route("**/api/me/consent", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-consent",
        platformName: "A2",
        body: "Consent accepted in test.",
      }),
    });
  });

  await page.route("**/api/admin/content/modules/library**", async (route: Route) => {
    // Default library fixtures to status: "published" so they appear in the
    // course module picker after the #440 filter (only published modules are
    // pickable). Tests that need other statuses must set it explicitly.
    const modulesWithStatus = libraryModules.map((m) => ({ status: "published", ...m }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: modulesWithStatus }),
    });
  });

  await page.route("**/api/admin/content/modules/*/export", async (route: Route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const moduleId = decodeURIComponent(parts[parts.length - 2] ?? "");
    const moduleExport = exportMap.get(moduleId);
    await route.fulfill({
      status: moduleExport ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(moduleExport ? { moduleExport } : { error: "not_found" }),
    });
  });

  await page.route("**/api/admin/content/generate/module-draft/localize", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      title?: string;
      taskText?: string;
      assessorExpectedContent?: string;
      sourceLocale?: string;
      targetLocale?: string;
    };
    state.lastDraftLocalizationBody = body;
    const suffix = body.targetLocale ?? "xx";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: body.title ? `${body.title} [${suffix}]` : undefined,
        taskText: `${body.taskText ?? ""} [${suffix}]`,
        assessorExpectedContent: `${body.assessorExpectedContent ?? ""} [${suffix}]`,
      }),
    });
  });

  await page.route("**/api/admin/content/courses/localize-copy", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      title?: string;
      description?: string;
      sourceLocale?: string;
      targetLocale?: string;
    };
    state.lastCourseLocalizationBodies.push(body);
    const suffix = body.targetLocale ?? "xx";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: body.title ? `${body.title} [${suffix}]` : undefined,
        description: body.description ? `${body.description} [${suffix}]` : undefined,
      }),
    });
  });

  await page.route("**/api/admin/content/modules/*/title", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }

    const body = route.request().postDataJSON() as { title?: Record<string, string> };
    state.lastTitlePatchBody = body;
    moduleExport.module.title = {
      ...moduleExport.module.title,
      ...(body.title ?? {}),
    };

    const moduleRecord = mutableModules.find((item) => item.id === moduleId);
    if (moduleRecord) {
      moduleRecord.title =
        moduleExport.module.title["en-GB"] ?? moduleExport.module.title.nb ?? moduleExport.module.title.nn ?? moduleRecord.title;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ module: { id: moduleId, title: moduleExport.module.title } }),
    });
  });

  // Mock for the blueprint endpoint (v1.1.53 / #372). Called between cert-level
  // selection and the actual draft generation. The shell shows an editable preview
  // (v1.1.71 / #448 / B1) with "Use this plan" / "Regenerate" buttons. Tests typically
  // click "Use this plan" to accept the mocked blueprint and continue.
  await page.route("**/api/admin/content/generate/blueprint", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      certificationLevel?: string;
      sourceMaterial?: string;
      locale?: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        blueprint: {
          learningObjectives: ["Stub objective for E2E test"],
          keyTopics: ["Stub key topic"],
          mcqProfile: { suggestedCount: 3 },
          notes: `Mock blueprint for ${body.certificationLevel ?? "basic"}`,
        },
      }),
    });
  });

  await page.route("**/api/admin/content/generate/module-draft", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      certificationLevel?: string;
      generationMode?: string;
      sourceMaterial?: string;
    };
    state.lastDraftGenerationBody = body;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskText: `Scenario for ${body.certificationLevel ?? "basic"} / ${body.generationMode ?? "ordinary"}`,
        assessorExpectedContent: "A strong response should explain the core concepts clearly.",
      }),
    });
  });

  await page.route("**/api/admin/content/source-material/extract", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      fileName?: string;
      mimeType?: string;
      contentBase64?: string;
    };
    state.lastSourceMaterialExtraction = body;
    const fileName = body.fileName ?? "upload.txt";
    const jobId = `extract-job-${extractionJobs.size + 1}`;
    extractionJobs.set(jobId, {
      fileName,
      extractedText: `Extracted source material from ${fileName}`,
    });
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId, status: "pending" }),
    });
  });

  await page.route("**/api/admin/content/source-material/extract/*", async (route: Route) => {
    const jobId = decodeURIComponent(route.request().url().split("/").at(-1) ?? "");
    const job = extractionJobs.get(jobId);
    if (!job) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId,
        status: "done",
        fileName: job.fileName,
        extractedText: job.extractedText,
      }),
    });
  });

  await page.route("**/api/admin/content/generate/mcq/localize", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      questions?: Array<{ stem?: string; options?: string[]; correctAnswer?: string; rationale?: string }>;
      sourceLocale?: string;
      targetLocale?: string;
    };
    state.lastMcqLocalizationBody = body;
    const targetLocale = body.targetLocale ?? "xx";
    const questions = (body.questions ?? []).map((question) => ({
      stem: `${question.stem ?? ""} [${targetLocale}]`,
      options: (question.options ?? []).map((option) => `${option} [${targetLocale}]`),
      correctAnswer: `${question.correctAnswer ?? ""} [${targetLocale}]`,
      rationale: `${question.rationale ?? ""} [${targetLocale}]`,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ questions }),
    });
  });

  await page.route("**/api/admin/content/generate/mcq", async (route: Route) => {
    const body = route.request().postDataJSON() as { questionCount?: number; optionCount?: number };
    const questionCount = body.questionCount ?? 3;
    const optionCount = body.optionCount ?? 4;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        questions: Array.from({ length: questionCount }, (_, index) => buildMockQuestion(index, optionCount)),
      }),
    });
  });

  await page.route("**/api/admin/content/modules/*/rubric-versions", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    const rubricVersion = {
      id: `${moduleId}-rubric-1`,
      versionNo: 1,
      criteria: {},
      scalingRule: {},
    };
    moduleExport.selectedConfiguration.rubricVersion = rubricVersion;
    moduleExport.versions.rubricVersions = [rubricVersion];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ rubricVersion }),
    });
  });

  // /rubric-versions/ensure — v1.1.69 (#447). Shell-save now uses this endpoint instead of
  // the legacy /rubric-versions create flow. Returns existing rubric if present, or creates
  // a new one. Tests don't exercise LLM auto-generation; the mock returns a stub rubric
  // version with the standard storage shape.
  await page.route("**/api/admin/content/modules/*/rubric-versions/ensure", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-3, -2)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    const existing = moduleExport.selectedConfiguration.rubricVersion;
    if (existing) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rubricVersion: existing, autoGenerated: false, reused: true }),
      });
      return;
    }
    const rubricVersion = {
      id: `${moduleId}-rubric-1`,
      versionNo: 1,
      criteria: {},
      scalingRule: {},
    };
    moduleExport.selectedConfiguration.rubricVersion = rubricVersion;
    moduleExport.versions.rubricVersions = [rubricVersion];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ rubricVersion, autoGenerated: false, reused: false }),
    });
  });

  await page.route("**/api/admin/content/modules/*/prompt-template-versions", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    const body = route.request().postDataJSON() as { systemPrompt?: string; userPromptTemplate?: string; examples?: unknown[] };
    const promptTemplateVersion = {
      id: `${moduleId}-prompt-1`,
      versionNo: 1,
      systemPrompt: body.systemPrompt ?? localizedText("System prompt"),
      userPromptTemplate: body.userPromptTemplate ?? localizedText("User prompt"),
      examples: body.examples ?? [],
    };
    moduleExport.selectedConfiguration.promptTemplateVersion = promptTemplateVersion;
    moduleExport.versions.promptTemplateVersions = [promptTemplateVersion];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ promptTemplateVersion }),
    });
  });

  await page.route("**/api/admin/content/modules/*/mcq-set-versions", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    const body = route.request().postDataJSON() as { title?: Record<string, string>; questions?: any[] };
    const mcqSetVersion = {
      id: `${moduleId}-mcq-1`,
      versionNo: 1,
      title: body.title ?? localizedText(moduleExport.module.title["en-GB"] ?? moduleId),
      questions: body.questions ?? [],
    };
    moduleExport.selectedConfiguration.mcqSetVersion = mcqSetVersion;
    moduleExport.versions.mcqSetVersions = [mcqSetVersion];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ mcqSetVersion }),
    });
  });

  await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    const body = route.request().postDataJSON() as {
      taskText?: Record<string, string>;
      assessorExpectedContent?: Record<string, string>;
      submissionSchema?: unknown;
      rubricVersionId?: string;
      promptTemplateVersionId?: string;
      mcqSetVersionId?: string;
    };
    const moduleVersion = {
      id: `${moduleId}-version-1`,
      versionNo: 1,
      taskText: body.taskText ?? localizedText("Scenario text"),
      assessorExpectedContent: body.assessorExpectedContent ?? localizedText("Guidance text"),
      submissionSchema: body.submissionSchema ?? { fields: [] },
      rubricVersionId: body.rubricVersionId ?? moduleExport.selectedConfiguration.rubricVersion?.id ?? null,
      promptTemplateVersionId: body.promptTemplateVersionId ?? moduleExport.selectedConfiguration.promptTemplateVersion?.id ?? null,
      mcqSetVersionId: body.mcqSetVersionId ?? moduleExport.selectedConfiguration.mcqSetVersion?.id ?? null,
    };
    moduleExport.selectedConfiguration.moduleVersion = moduleVersion;
    moduleExport.selectedConfiguration.source = "draftModuleVersion";
    moduleExport.versions.moduleVersions = [moduleVersion];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ moduleVersion }),
    });
  });

  await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const moduleVersionId = decodeURIComponent(segments[segments.length - 2] ?? "");
    const moduleId = decodeURIComponent(segments[segments.length - 4] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (!moduleExport) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }
    moduleExport.module.activeVersionId = moduleVersionId;
    const versionNo = moduleExport.selectedConfiguration.moduleVersion?.versionNo ?? 1;
    const moduleRecord = mutableModules.find((item) => item.id === moduleId);
    if (moduleRecord) {
      moduleRecord.activeVersion = { versionNo };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        moduleVersion: moduleExport.selectedConfiguration.moduleVersion ?? { id: moduleVersionId, versionNo },
      }),
    });
  });

  await page.route("**/api/admin/content/modules/*/unpublish", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (moduleExport) {
      moduleExport.module.activeVersionId = null;
    }
    const moduleRecord = mutableModules.find((item) => item.id === moduleId);
    if (moduleRecord) {
      delete moduleRecord.activeVersion;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moduleId }),
    });
  });

  await page.route("**/api/admin/content/modules/archive", async (route: Route) => {
    const archived = Array.from(exportMap.values())
      .filter((item) => item.module.archivedAt)
      .map((item) => ({
        id: item.module.id,
        title: courseTitleForLocale(item.module.title),
      }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: archived }),
    });
  });

  await page.route("**/api/admin/content/modules/*/archive", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (moduleExport) {
      moduleExport.module.archivedAt = "2026-04-18T12:00:00.000Z";
      moduleExport.module.activeVersionId = null;
    }
    const moduleRecord = mutableModules.find((item) => item.id === moduleId);
    if (moduleRecord) {
      delete moduleRecord.activeVersion;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moduleId, archivedAt: "2026-04-18T12:00:00.000Z" }),
    });
  });

  await page.route("**/api/admin/content/modules/*/restore", async (route: Route) => {
    const moduleId = decodeURIComponent(route.request().url().split("/").slice(-2, -1)[0] ?? "");
    const moduleExport = exportMap.get(moduleId);
    if (moduleExport) {
      moduleExport.module.archivedAt = null;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moduleId }),
    });
  });

  await page.route("**/api/admin/content/modules", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ modules: mutableModules }),
      });
      return;
    }

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { title?: Record<string, string>; certificationLevel?: string };
      const index = mutableModules.length + 1;
      const id = `module-${index}`;
      const titleMap = body.title ?? localizedText(`Module ${index}`);
      const title = titleMap["en-GB"] ?? titleMap.nb ?? titleMap.nn ?? `Module ${index}`;
      const module = { id, title, activeVersion: undefined };
      mutableModules.push(module);
      exportMap.set(
        id,
        buildMockModuleExport({
          id,
          title,
          certificationLevel: body.certificationLevel ?? "basic",
        }),
      );
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ module: { id, title: titleMap, certificationLevel: body.certificationLevel ?? "basic" } }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/admin/content/courses", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ courses: mutableCourses }),
      });
      return;
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        title?: Record<string, string> | string;
        description?: Record<string, string>;
        certificationLevel?: string;
      };
      const id = `course-${mutableCourses.length + 1}`;
      const course = {
        id,
        title: body.title ?? localizedText(`Course ${mutableCourses.length + 1}`),
        description: body.description ?? null,
        certificationLevel: body.certificationLevel ?? null,
        moduleCount: 0,
        updatedAt: "2026-04-18T12:00:00.000Z",
        publishedAt: undefined,
        modules: [],
        archivedAt: null,
      };
      mutableCourses.push(course);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ course }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/admin/content/courses/*/modules", async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const courseId = decodeURIComponent(segments[segments.length - 2] ?? "");
    const course = mutableCourses.find((item) => item.id === courseId);
    if (!course) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }

    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { modules?: Array<{ moduleId: string; sortOrder: number }> };
      course.modules = (body.modules ?? []).map((item) => {
        const moduleMatch =
          mutableModules.find((module) => module.id === item.moduleId) ??
          libraryModules.find((module) => module.id === item.moduleId) ??
          Array.from(exportMap.values()).find((module) => module.module.id === item.moduleId)?.module;
        return {
          moduleId: item.moduleId,
          sortOrder: item.sortOrder,
          moduleTitle:
            "title" in (moduleMatch ?? {})
              ? (moduleMatch as any).title
              : item.moduleId,
        };
      });
      course.moduleCount = course.modules.length;
      course.updatedAt = "2026-04-23T12:00:00.000Z";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ modules: course.modules }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: course.modules }),
    });
  });

  await page.route("**/api/admin/content/courses/*/publish", async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const courseId = decodeURIComponent(segments[segments.length - 2] ?? "");
    const course = mutableCourses.find((item) => item.id === courseId);
    if (!course) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }

    course.publishedAt = "2026-04-18T12:00:00.000Z";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course }) });
  });

  await page.route("**/api/admin/content/courses/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const isModulesRoute = segments.includes("modules");
    const isArchiveRoute = url.pathname.endsWith("/archive");
    const courseId = decodeURIComponent(
      isModulesRoute || isArchiveRoute
        ? (segments[segments.length - 2] ?? "")
        : (segments[segments.length - 1] ?? ""),
    );
    if (courseId === "localize-copy") {
      await route.fallback();
      return;
    }
    const course = mutableCourses.find((item) => item.id === courseId);

    if (isArchiveRoute && course) {
      course.archivedAt = "2026-04-18T12:00:00.000Z";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course }) });
      return;
    }

    if (!course) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ course }),
      });
      return;
    }

    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        title?: Record<string, string> | string;
        description?: Record<string, string> | string;
        certificationLevel?: string;
      };
      course.title = body.title ?? course.title;
      course.description = body.description ?? course.description;
      course.certificationLevel = body.certificationLevel ?? course.certificationLevel;
      course.updatedAt = "2026-04-23T12:00:00.000Z";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ course }),
      });
      return;
    }

    if (route.request().method() === "DELETE") {
      const index = mutableCourses.findIndex((item) => item.id === courseId);
      if (index >= 0) {
        mutableCourses.splice(index, 1);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ courseId }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  return state;
}
