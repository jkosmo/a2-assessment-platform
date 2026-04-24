import AxeBuilderModule from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const AxeBuilder = (AxeBuilderModule.default ?? AxeBuilderModule) as any;

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

type MockModuleExport = {
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

function localizedText(base: string): Record<string, string> {
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

function buildMockModuleExport({
  id,
  title,
  certificationLevel = "basic",
  taskText = localizedText("Scenario text"),
  guidanceText = localizedText("Strong answers should explain the main concepts."),
  mcqQuestions = [],
  activeVersionId = null,
  moduleVersionId = null,
}: {
  id: string;
  title: string;
  certificationLevel?: string;
  taskText?: Record<string, string>;
  guidanceText?: Record<string, string>;
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
        guidanceText,
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
            passRule: {},
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
              passRule: {},
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

async function clickEnabledButton(page: Page, label: string | RegExp) {
  const button = page
    .locator("button:enabled")
    .filter(typeof label === "string" ? { hasText: label } : { hasText: label })
    .last();
  await expect(button).toBeVisible();
  await button.click();
}

async function submitActiveChatInput(page: Page, value: string) {
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

function courseTextForLocale(value: Record<string, string> | string | undefined | null, locale = "en-GB") {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value["en-GB"] ?? value.nb ?? value.nn ?? Object.values(value)[0] ?? "";
}

async function mockCommonApis(page: Page, {
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: libraryModules }),
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
      guidanceText?: string;
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
        guidanceText: `${body.guidanceText ?? ""} [${suffix}]`,
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
        guidanceText: "A strong response should explain the core concepts clearly.",
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
      passRule: {},
    };
    moduleExport.selectedConfiguration.rubricVersion = rubricVersion;
    moduleExport.versions.rubricVersions = [rubricVersion];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ rubricVersion }),
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
      guidanceText?: Record<string, string>;
      submissionSchema?: unknown;
      rubricVersionId?: string;
      promptTemplateVersionId?: string;
      mcqSetVersionId?: string;
    };
    const moduleVersion = {
      id: `${moduleId}-version-1`,
      versionNo: 1,
      taskText: body.taskText ?? localizedText("Scenario text"),
      guidanceText: body.guidanceText ?? localizedText("Guidance text"),
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

test.describe("admin content browser coverage", () => {
  test("advanced editor can save, publish, and unpublish a module version", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [
                localizedText("Option A"),
                localizedText("Option B"),
                localizedText("Option C"),
                localizedText("Option D"),
              ],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/advanced");

    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");
    await page.locator("#saveContentBundle").click();
    await expect(page.locator("#publishModuleVersionId")).not.toHaveValue("");

    await page.locator("#publishModuleVersion").click();
    await expect(page.getByText("Module version published.")).toBeVisible();
    await expect(page.locator("#moduleStatusLive")).toContainText("Module v1");
    await expect(page.locator("#unpublishModuleBtn")).toBeVisible();

    await page.locator("#unpublishModuleBtn").click();
    await page.locator("#dlgSimpleConfirmOk").click();
    await expect(page.getByText("Module unpublished.")).toBeVisible();
    await expect(page.locator("#moduleStatusLive")).toContainText("No published version");
  });

  test("advanced editor persists a renamed module title when saving content", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [
                localizedText("Option A"),
                localizedText("Option B"),
                localizedText("Option C"),
                localizedText("Option D"),
              ],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/advanced");
    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");

    await page.locator("#editBtn_moduleDetails").click();
    await expect(page.locator("#dialogModuleDetails")).toHaveAttribute("open", "");
    await page.locator("#dlgMD_title_enGB").fill("Renamed module");
    await page.locator('#dialogModuleDetails .dialog-locale-tab[data-locale-tab="nb"]').click();
    await page.locator("#dlgMD_title_nb").fill("Omdøpt modul");
    await page.locator('#dialogModuleDetails .dialog-locale-tab[data-locale-tab="nn"]').click();
    await page.locator("#dlgMD_title_nn").fill("Omdøypt modul");
    await page.locator("#dialogModuleDetailsApply").click();

    await page.locator("#saveAllCards").click();

    await expect.poll(() => state.lastTitlePatchBody?.title?.["en-GB"]).toBe("Renamed module");
    await expect.poll(() => state.lastTitlePatchBody?.title?.nb).toBe("Omdøpt modul");
    await expect.poll(() => state.exportMap.get("module-1")?.module.title?.["en-GB"]).toBe("Renamed module");
    await expect.poll(() => state.exportMap.get("module-1")?.module.title?.nb).toBe("Omdøpt modul");
  });

  test("advanced editor hands unsaved task text back to the conversational workspace", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "Original scenario",
            nb: "Originalt scenario",
            nn: "Opphavleg scenario",
          },
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/advanced");

    await page.locator("#editBtn_versionDetails").click();
    await expect(page.locator("#dialogVersionDetails")).toHaveAttribute("open", "");
    await page.locator("#dlgVD_task_enGB").fill("Edited in advanced editor");
    await page.locator("#dialogVersionDetailsApply").click();
    await page.locator("#modeSwitchConversation").click();
    await expect(page.locator("#dialogUnsavedHandoff")).toHaveAttribute("open", "");
    await page.locator("#dlgUnsavedDiscard").click();

    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/conversation\?resumeEditing=1$/);
    await expect(page.getByText("Edited in advanced editor")).toBeVisible();
    await expect(page.getByText("The current module draft is ready for further editing in chat.")).toBeVisible();
  });

  test("shell can create a new module, generate content, and save without losing the module ID", async ({ page }) => {
    await mockCommonApis(page);

    await page.goto("/admin-content");

    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Trade unions");
    await submitActiveChatInput(page, "Source notes about labour rights and worker organising.");
    await clickEnabledButton(page, "Basic");
    await clickEnabledButton(page, "Ordinary");
    await clickEnabledButton(page, "Yes, generate MCQ");
    await clickEnabledButton(page, "3 questions");
    await clickEnabledButton(page, "4 options");

    await expect(page.getByText("Module created.")).toBeVisible();
    await clickEnabledButton(page, "Save draft");

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect(page.getByText("Open or create a module before saving.")).toHaveCount(0);
    await expect(page.getByText(/Trade unions.*loaded\./)).toBeVisible();
  });

  test("shell locale switching updates the rendered task text", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          guidanceText: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk spørsmål", nn: "Nynorsk spørsmål" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.getByText("English scenario")).toBeVisible();
    await page.locator("#localeSelect").selectOption("nb");
    await expect(page.getByText("Norsk scenario")).toBeVisible();
    await expect(page.getByText("English scenario")).toHaveCount(0);
  });

  test("shell workspace nav keeps profile on the right and preserves participant link for multi-role users", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
      navigationItems: [
        { id: "participant", path: "/participant", labelKey: "nav.participant", requiredRoles: ["PARTICIPANT"] },
        { id: "calibration", path: "/calibration", labelKey: "nav.calibration" },
        { id: "admin-content", path: "/admin-content", labelKey: "nav.adminContent" },
        { id: "results", path: "/results", labelKey: "nav.results" },
        { id: "profile", path: "/profile", labelKey: "nav.profile" },
      ],
      meRoles: ["SUBJECT_MATTER_OWNER", "PARTICIPANT"],
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.locator("#workspaceNav .workspace-nav-link")).toHaveCount(4);
    await expect(page.locator('#workspaceNav .workspace-nav-link[href="/participant"]')).toBeVisible();
    await expect(page.locator('#workspaceNav .workspace-nav-link[href="/profile"]')).toHaveCount(0);
    await expect(page.locator('.locale-picker #profileNavLink[href="/profile"]')).toBeVisible();
  });

  test("direct edit localizes from the active preview locale and save sends a title patch", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          guidanceText: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk spÃ¸rsmÃ¥l", nn: "Nynorsk spÃ¸rsmÃ¥l" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.addInitScript(() => {
      sessionStorage.setItem("adminContent.handoff", JSON.stringify({
        moduleId: "module-1",
        source: "shell",
        draft: null,
        locale: "en-GB",
        previewLocale: "nb",
        timestamp: Date.now(),
      }));
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.getByText("Norsk scenario")).toBeVisible();

    await clickEnabledButton(page, /Edit directly|Rediger direkte/);
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Norsk scenario");
    await page.locator("#previewEditTaskText").fill("Oppdatert norsk scenario");
    await page.locator("#previewEditGuidanceText").fill("Oppdatert norsk veiledning");
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastDraftLocalizationBody?.sourceLocale).toBe("nb");
    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect.poll(() => state.lastTitlePatchBody?.title?.nb).toBe("Fagforeninger");
    await expect(state.lastTitlePatchBody?.title?.["en-GB"]).toContain("[en-GB]");
    await expect(page.locator("#srModuleName")).toHaveText("Fagforeninger");
  });

  test("chat revision can rename the module title through a bounded free-text instruction", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          guidanceText: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk sporsmal", nn: "Nynorsk sporsmal" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");

    const revisionInput = page.locator(".chat-textarea:enabled").last();
    await revisionInput.fill('Rename the module title to "Trade union dialogue"');
    await clickEnabledButton(page, /Revise|Revider/);

    await expect(page.getByText('I will update the module title to "Trade union dialogue" and refresh the localized variants.')).toBeVisible();
    await expect.poll(() => state.lastDraftLocalizationBody?.title).toBe("Trade union dialogue");
    await expect(page.locator("#srModuleName")).toHaveText("Trade union dialogue");

    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect.poll(() => state.lastTitlePatchBody?.title?.["en-GB"]).toBe("Trade union dialogue");
    await expect(page.locator("#srModuleName")).toHaveText("Trade union dialogue");
  });

  test("direct edit keeps MCQ visible and editable through translation and save", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-2", title: "Workplace dialogue", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-2": buildMockModuleExport({
          id: "module-2",
          title: "Workplace dialogue",
          moduleVersionId: "module-2-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          guidanceText: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk sporsmal", nn: "Nynorsk sporsmal" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.addInitScript(() => {
      sessionStorage.setItem("adminContent.handoff", JSON.stringify({
        moduleId: "module-2",
        source: "shell",
        draft: null,
        locale: "en-GB",
        previewLocale: "nb",
        timestamp: Date.now(),
      }));
    });

    await page.goto("/admin-content/module/module-2/conversation");

    await clickEnabledButton(page, /Edit directly|Rediger direkte/);
    await expect(page.locator("#previewEditMcqStem0")).toHaveValue("Norsk sporsmal");
    await page.locator("#previewEditMcqStem0").fill("Oppdatert norsk sporsmal");
    await page.locator("#previewEditMcqOption0_1").fill("Oppdatert alternativ B");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastMcqLocalizationBody?.sourceLocale).toBe("nb");
    await expect(page.getByText("Oppdatert norsk sporsmal")).toBeVisible();
    await expect(page.getByText("Oppdatert alternativ B").first()).toBeVisible();

    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect(page.getByText("Oppdatert norsk sporsmal")).toBeVisible();
    await expect(page.getByText("Oppdatert alternativ B").first()).toBeVisible();
  });

  test("shell publish returns to the module list after confirmation", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await clickEnabledButton(page, /Publish|Publiser/);
    await clickEnabledButton(page, /Publish|Publiser/);

    await expect(page.locator(".module-list .module-list-item")).toContainText("Trade unions");
    await expect(page.locator("#previewContent .preview-empty")).toBeVisible();
  });

  test("shell source-material upload keeps extracted content out of the input and sends it to generation", async ({ page }) => {
    const state = await mockCommonApis(page);

    await page.goto("/admin-content");

    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Upload module");

    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles({
      name: "source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("fake-word-content"),
    });

    await expect(page.getByText("source.docx")).toBeVisible();
    const sourceTextarea = page.locator(".chat-textarea:enabled").last();
    await sourceTextarea.fill("Use a practical workplace framing.");
    await clickEnabledButton(page, /Next|Neste|Næste/i);
    await clickEnabledButton(page, "Basic");
    await clickEnabledButton(page, "Ordinary");

    await expect
      .poll(() => state.lastDraftGenerationBody?.sourceMaterial ?? "")
      .toContain("Extracted source material from source.docx");
    await expect
      .poll(() => state.lastDraftGenerationBody?.sourceMaterial ?? "")
      .toContain("Use a practical workplace framing.");
  });

  test("shell advanced mode switch preserves the selected module in the route", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [
                localizedText("Option A"),
                localizedText("Option B"),
                localizedText("Option C"),
                localizedText("Option D"),
              ],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.locator("#moduleWorkspaceTitle")).toBeVisible();
    await clickEnabledButton(page, "Advanced");

    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/advanced$/);
    await expect(page.locator("#modeSwitchAdvanced")).toHaveAttribute("aria-pressed", "true");
  });

  test("courses conversational flow goes straight to module selection and returns to the course list after save", async ({ page }) => {
    const state = await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Trade unions" },
        { id: "module-2", title: "Collective bargaining" },
      ],
    });

    await page.goto("/admin-content/courses/new");

    const titleInput = page.locator("#convTitleInput");
    await titleInput.fill("Labour rights");
    await titleInput.press("Enter");
    await clickEnabledButton(page, "Basic");

    await page.locator("#convComboboxInput").fill("Trade");
    await page.locator(".combobox-option").first().click();
    await page.locator("#convAddModuleItemBtn").click();
    await expect(page.locator("#convModuleListContainer")).toContainText("Trade unions");

    await page.locator("#convCreateBtn").click();
    await expect(page).toHaveURL(/\/admin-content\/courses$/);
    await expect(page.getByRole("table", { name: "Kursliste" })).toBeVisible();
    await expect(page.locator("#coursesTableBody")).toContainText("Labour rights");
    await expect.poll(() => state.mutableCourses[0]?.modules?.length ?? 0).toBe(1);
  });

  test("course detail view renders when backend returns null description for an existing course", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: "Labour rights",
          description: null,
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T12:00:00.000Z",
          publishedAt: null,
          archivedAt: null,
          modules: [],
        },
      ],
    });

    await page.goto("/admin-content/courses/course-1");

    await expect(page.locator("#detailPageTitle")).toContainText("Labour rights");
    await expect(page.locator("#desc-en-GB")).toHaveValue("");
    await expect(page.locator(".page-loading")).toHaveCount(0);
  });

  test("shell idle flow opens the module picker and renders existing module choices", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [
        { id: "module-1", title: "Trade unions", activeVersion: { versionNo: 2 } },
        { id: "module-2", title: "Collective bargaining" },
      ],
    });

    await page.goto("/admin-content");

    await expect(page.locator("#moduleWorkspaceTitle")).toBeVisible();
    await expect(page.getByText("What would you like to do?")).toBeVisible();
    await page.getByRole("button", { name: "Open existing module" }).click();

    await expect(page.getByRole("button", { name: /Trade unions/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Collective bargaining/ })).toBeVisible();
  });

  test("courses conversational flow accepts Enter on course title and advances to certification choices", async ({ page }) => {
    await mockCommonApis(page, { libraryModules: [] });

    await page.goto("/admin-content/courses/new");

    const titleInput = page.locator("#convTitleInput");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Labour rights");
    await titleInput.press("Enter");

    await expect(titleInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "Basic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Intermediate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Advanced" })).toBeVisible();
  });

  test("courses creation and detail view localize certification level labels to the active UI locale", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger", nn: "Fagforeiningar" },
          description: {
            "en-GB": "English description",
            nb: "Norsk beskrivelse",
            nn: "Nynorsk skildring",
          },
          certificationLevel: "basic",
          moduleCount: 1,
          updatedAt: "2026-04-18T10:30:00.000Z",
          modules: [],
        },
      ],
      libraryModules: [],
    });

    await page.goto("/admin-content/courses/new");
    await page.locator("#localeSelect").selectOption("nb");
    await page.locator("#convTitleInput").fill("Arbeidsmiljo");
    await page.locator("#convTitleInput").press("Enter");

    await expect(page.getByRole("button", { name: "Grunnleggende" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Videregående" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Avansert" })).toBeVisible();

    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#detailPageTitle")).toContainText("Fagforeninger");
    await expect(page.locator("#certLevel")).toContainText("Grunnleggende");
    await expect(page.locator("#tab-nb")).toHaveClass(/active/);
    await expect(page.locator("#title-nb")).toHaveValue("Fagforeninger");
    await expect(page.locator("#desc-nb")).toHaveValue("Norsk beskrivelse");
  });

  test("courses conversational creation stores the typed title in the active locale and localizes the other variants", async ({ page }) => {
    const state = await mockCommonApis(page, {
      libraryModules: [],
    });

    await page.goto("/admin-content/courses/new");
    await page.locator("#localeSelect").selectOption("nn");
    await page.locator("#convTitleInput").fill("Arbeidsmiljøkurs");
    await page.locator("#convTitleInput").press("Enter");
    await page.locator('[data-cert="basic"]').click();
    await page.locator("#convCreateBtn").click();

    await expect(page).toHaveURL(/\/admin-content\/courses$/);
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "nn")).toBe("Arbeidsmiljøkurs");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "en-GB")).toBe("Arbeidsmiljøkurs [en-GB]");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "nb")).toBe("Arbeidsmiljøkurs [nb]");
    await expect.poll(() => state.lastCourseLocalizationBodies.map((body) => body.targetLocale).sort()).toEqual(["en-GB", "nb"]);
  });

  test("course detail save refreshes other locales when title and description are edited in one language", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger", nn: "Fagforeiningar" },
          description: {
            "en-GB": "English description",
            nb: "Norsk beskrivelse",
            nn: "Nynorsk skildring",
          },
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T10:30:00.000Z",
          modules: [],
        },
      ],
    });

    await page.goto("/admin-content/courses/course-1");
    await page.locator("#tab-nn").click();
    await page.locator("#title-nn").fill("Nytt nynorsk kursnamn");
    await page.locator("#desc-nn").fill("Oppdatert nynorsk skildring");
    await page.locator("#saveCourseBtn").click();

    await expect(page.locator("#title-nn")).toHaveValue("Nytt nynorsk kursnamn");
    await expect(page.locator("#title-en-GB")).toHaveValue("Nytt nynorsk kursnamn [en-GB]");
    await expect(page.locator("#desc-nb")).toHaveValue("Oppdatert nynorsk skildring [nb]");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "nn")).toBe("Nytt nynorsk kursnamn");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "en-GB")).toBe("Nytt nynorsk kursnamn [en-GB]");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.description, "nb")).toBe("Oppdatert nynorsk skildring [nb]");
    await expect.poll(() => state.lastCourseLocalizationBodies.map((body) => body.targetLocale).slice(-2).sort()).toEqual(["en-GB", "nb"]);
  });

  test("courses conversational flow goes directly from certification choice to module search", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Trade unions" }],
    });

    await page.goto("/admin-content/courses/new");

    await page.locator("#convTitleInput").fill("Labour rights");
    await page.locator("#convTitleInput").press("Enter");
    await clickEnabledButton(page, "Basic");

    await expect(page.locator("#convComboboxInput")).toBeVisible();
    await expect(page.locator("#convCreateBtn")).toBeVisible();
    await expect(page.getByText("Du kan også opprette kurset direkte")).toBeVisible();
  });

  test("courses list refreshes 'Sist endret' after saving course changes", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions" },
          description: { "en-GB": "Original description" },
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T10:30:00.000Z",
          modules: [],
        },
      ],
    });

    await page.goto("/admin-content/courses/course-1");
    await page.locator("#desc-en-GB").fill("Updated description");
    await page.locator("#saveCourseBtn").click();
    await expect(page.locator("#saveCourseBtn")).toBeEnabled();

    await page.goto("/admin-content/courses");
    await expect(page.locator("#coursesTableBody")).toContainText("23 Apr 2026");
  });

  test("courses list can publish a saved course with modules", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions" },
          description: { "en-GB": "Original description" },
          certificationLevel: "basic",
          moduleCount: 1,
          updatedAt: "2026-04-18T10:30:00.000Z",
          publishedAt: null,
          modules: [{ moduleId: "module-1", sortOrder: 1, moduleTitle: { "en-GB": "Trade unions" } }],
        },
      ],
    });

    await page.goto("/admin-content/courses");
    await expect(page.locator('[data-action="publish"][data-course-id="course-1"]')).toBeVisible();

    await page.locator('[data-action="publish"][data-course-id="course-1"]').click();

    await expect.poll(() => state.mutableCourses[0]?.publishedAt ?? null).toBe("2026-04-18T12:00:00.000Z");
    await expect(page.locator('[data-action="publish"][data-course-id="course-1"]')).toHaveCount(0);
  });

  test("courses list opens a delete dialog bound to the chosen course", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger" },
          certificationLevel: "advanced",
          moduleCount: 3,
          updatedAt: "2026-04-18T10:30:00.000Z",
        },
      ],
    });

    await page.goto("/admin-content/courses");

    await expect(page.getByRole("table", { name: "Kursliste" })).toBeVisible();
    await page.locator('[data-action="delete"]').first().click();

    await expect(page.locator("#deleteDialog")).toHaveAttribute("open", "");
    await expect(page.locator("#deleteDialogText")).toContainText("Trade unions");
  });

  test("shell and courses routes pass an accessibility smoke check", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [],
    });

    await page.goto("/admin-content");
    const shellResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const shellViolations = shellResults.violations.filter((violation: { impact?: string | null }) =>
      ["critical", "serious"].includes(violation.impact || ""),
    );
    expect(shellViolations).toEqual([]);

    await page.goto("/admin-content/courses");
    const coursesResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const courseViolations = coursesResults.violations.filter((violation: { impact?: string | null }) =>
      ["critical", "serious"].includes(violation.impact || ""),
    );
    expect(courseViolations).toEqual([]);
  });
});
