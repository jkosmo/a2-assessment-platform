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
  title: Record<string, string>;
  certificationLevel: string;
  moduleCount?: number;
  updatedAt?: string;
  publishedAt?: string;
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

async function mockCommonApis(page: Page, {
  modules = [],
  libraryModules = [],
  courses = [],
  moduleExports = {},
}: {
  modules?: MockModule[];
  libraryModules?: MockLibraryModule[];
  courses?: MockCourse[];
  moduleExports?: Record<string, MockModuleExport>;
} = {}) {
  const mutableModules = [...modules];
  const exportMap = new Map<string, MockModuleExport>(Object.entries(moduleExports));

  await page.route("**/participant/config", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { workspaceItems: [], profileItem: null },
        identityDefaults: {
          userId: "content-owner-1",
          email: "content.owner@example.test",
          name: "Content Owner",
          department: "Learning",
          roles: ["SUBJECT_MATTER_OWNER"],
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
      taskText?: string;
      guidanceText?: string;
      targetLocale?: string;
    };
    const suffix = body.targetLocale ?? "xx";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskText: `${body.taskText ?? ""} [${suffix}]`,
        guidanceText: `${body.guidanceText ?? ""} [${suffix}]`,
      }),
    });
  });

  await page.route("**/api/admin/content/generate/module-draft", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      certificationLevel?: string;
      generationMode?: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskText: `Scenario for ${body.certificationLevel ?? "basic"} / ${body.generationMode ?? "ordinary"}`,
        guidanceText: "A strong response should explain the core concepts clearly.",
      }),
    });
  });

  await page.route("**/api/admin/content/generate/mcq/localize", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      questions?: Array<{ stem?: string; options?: string[]; correctAnswer?: string; rationale?: string }>;
      targetLocale?: string;
    };
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
        body: JSON.stringify({ courses }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/admin/content/courses/*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

test.describe("admin content browser coverage", () => {
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
    await expect(page.getByText(/Trade unions \(EN\).*loaded\./)).toBeVisible();
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
