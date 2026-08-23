// #957: kursimporten regnet ut `anyContentHeldBack`, brukte det til å holde kurset som utkast, og
// kastet det så i `return { courseId, moduleIds }`. Kommentaren over utregningen lover eksplisitt
// at flagget «is reported to the caller, not just acted on locally» — og modul- og seksjonsimporten
// gjør nettopp det. Forfatteren fikk `201 Created` uten et ord om hvorfor kurset lå som utkast.
//
// Testene her er et par: én som viser at flagget rapporteres når noe FAKTISK ble holdt tilbake, og
// én kontrollcase som viser at det er `false` når kurset ble publisert som normalt. Uten den andre
// ville «alltid true» bestått.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportEnvelope } from "../../src/modules/adminContent/adminContentSchemas.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

const createModule = vi.fn();
const createRubricVersion = vi.fn();
const createPromptTemplateVersion = vi.fn();
const createMcqSetVersion = vi.fn();
const createModuleVersion = vi.fn();
const publishModuleVersion = vi.fn();

const createCourse = vi.fn();
const setCourseItems = vi.fn();
const setCourseModules = vi.fn();
const publishCourse = vi.fn();

const findModuleTitle = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/modules/adminContent/adminContentCommands.js", () => ({
  createModule,
  createRubricVersion,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
  publishModuleVersion,
}));

vi.mock("../../src/modules/adminContent/adminContentRepository.js", () => {
  const repo = { findModuleTitle };
  return { adminContentRepository: repo, createAdminContentRepository: () => repo };
});

vi.mock("../../src/modules/course/courseCommands.js", () => ({
  createCourse,
  setCourseItems,
  setCourseModules,
  publishCourse,
}));

vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));

// ⚠️ #996: tx-dobbelen var `{}`. Da importen begynte å AVPUBLISERE et målkurs som holdes tilbake,
// falt testen på `tx.course.update` — og det var riktig av den. En dobbel som ikke kan feile på en
// ny skriving, kan heller ikke bekrefte at skrivingen skjer.
const courseUpdate = vi.fn();

vi.mock("../../src/db/transaction.js", () => ({
  runInTransaction: (cb: (tx: unknown) => unknown) => cb({ course: { update: courseUpdate } }),
}));

function resetMocks() {
  courseUpdate.mockReset().mockResolvedValue({});
  createModule.mockReset().mockResolvedValue({ id: "new-module-id" });
  createRubricVersion.mockReset().mockResolvedValue({ id: "rubric-id" });
  createPromptTemplateVersion.mockReset().mockResolvedValue({ id: "prompt-id" });
  createMcqSetVersion.mockReset().mockResolvedValue({ id: "mcq-id" });
  createModuleVersion.mockReset().mockResolvedValue({ id: "module-version-id" });
  publishModuleVersion.mockReset().mockResolvedValue(undefined);
  createCourse.mockReset().mockResolvedValue({ id: "new-course-id" });
  setCourseItems.mockReset().mockResolvedValue(undefined);
  setCourseModules.mockReset().mockResolvedValue(undefined);
  publishCourse.mockReset().mockResolvedValue(undefined);
  findModuleTitle.mockReset();
  recordAuditEvent.mockReset().mockResolvedValue(undefined);
}

// `fullyTranslated: false` gir en pakke med bare én locale — språkporten (#896 S4) holder da en
// publisert kildemodul tilbake ved import.
function buildCourseEnvelope({ fullyTranslated }: { fullyTranslated: boolean }): ExportEnvelope {
  const localized = (base: string) =>
    (fullyTranslated ? { "en-GB": base, nb: `${base} (nb)`, nn: `${base} (nn)` } : base) as never;
  const modulePayload = {
    module: {
      title: localized("Imported module"),
      description: localized("A description"),
      certificationLevel: "foundation",
    },
    activeVersion: {
      assessmentMode: "FREETEXT_ONLY",
      taskText: localized("Do the task"),
      assessorExpectedContent: localized("Expected content"),
      candidateTaskConstraints: localized("Constraints"),
      assessmentBlueprint: "blueprint",
      rubric: { criteria: { c1: 1 }, scalingRule: { practical_weight: 70 } },
      promptTemplate: { systemPrompt: "system", userPromptTemplate: "template", examples: [] },
      // Kilden VAR publisert — det er forutsetningen for at porten i det hele tatt kan holde noe
      // tilbake (en kildemodul som var utkast skal ikke publiseres uansett).
      audit: { publishedAt: "2026-06-20T00:00:00.000Z", publishedBy: "author@source", sourceVersionNo: 3 },
    },
  };
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-06-20T00:00:00.000Z",
    scope: "course",
    course: {
      course: {
        title: localized("Imported course"),
        description: localized("Course description"),
        certificationLevel: localized("foundation"),
        items: [{ type: "MODULE", sortOrder: 1, module: modulePayload }],
        audit: { publishedAt: "2026-06-20T00:00:00.000Z", publishedBy: "author@source" },
      },
    },
  } as unknown as ExportEnvelope;
}

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/adminContent/contentImportService.js"));

describe("#957 importCourseFromEnvelope reports heldBackByTranslationGate", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("reports the flag when a module was held back, and leaves the course a draft", async () => {
    const { importCourseFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    const result = await importCourseFromEnvelope(buildCourseEnvelope({ fullyTranslated: false }), {
      actorId: "actor-1",
      mode: "createNew",
    });

    // Dette er hele saken: flagget nådde kalleren.
    expect(result.heldBackByTranslationGate).toBe(true);
    expect(result.courseId).toBe("new-course-id");
    expect(result.moduleIds).toEqual(["new-module-id"]);
    // ...og oppførselen det forklarer er uendret.
    expect(publishCourse).not.toHaveBeenCalled();
    expect(publishModuleVersion).not.toHaveBeenCalled();
  });

  // Kontrollcase: en fullstendig oversatt pakke publiseres som før, og flagget er false.
  it("reports false when nothing was held back and the course was published", async () => {
    const { importCourseFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    const result = await importCourseFromEnvelope(buildCourseEnvelope({ fullyTranslated: true }), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(result.heldBackByTranslationGate).toBe(false);
    expect(publishCourse).toHaveBeenCalledTimes(1);
    expect(publishModuleVersion).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #996: å HOPPE OVER publisering er ikke det samme som å AVPUBLISERE.
//
// Betingelsen `if (publishedAt && !anyContentHeldBack)` var skrevet med `createNew` i tankene, der
// et nytt kurs starter upublisert uansett. Ved `replaceExisting` finnes målkurset fra før og kan
// allerede være publisert — og da lot vi det stå levende med en modul uten aktiv versjon.
//
// ⚠️ Deltakeren møter «modul ikke tilgjengelig» i et kurs som ser helt normalt ut. Det er
// publiseringsinvarianten brutt, og det er stille: ingen feilmelding noe sted.
// ─────────────────────────────────────────────────────────────────────────────
describe("#996 importCourseFromEnvelope avpubliserer et målkurs som holdes tilbake", () => {
  beforeEach(resetMocks);

  it("avpubliserer når innhold holdes tilbake", async () => {
    const { importCourseFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importCourseFromEnvelope(buildCourseEnvelope({ fullyTranslated: false }), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(publishCourse, "kurset skal ikke publiseres når noe mangler et språk").not.toHaveBeenCalled();
    // ⚠️ Det er DENNE som er ny. Før skjedde det ingenting her — og for et eksisterende, publisert
    // målkurs betydde «ingenting» at det ble stående levende.
    expect(courseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt: null }) }),
    );
  });

  it("KONTROLLCASE: en komplett pakke publiseres, og avpubliseres IKKE", async () => {
    // Uten denne ville «avpubliser alltid» bestått testen over — og da hadde ingen import kunnet
    // levere et publisert kurs igjen.
    const { importCourseFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importCourseFromEnvelope(buildCourseEnvelope({ fullyTranslated: true }), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(publishCourse).toHaveBeenCalledTimes(1);
    const unpublished = courseUpdate.mock.calls.some(
      ([arg]) => (arg as { data?: { publishedAt?: unknown } })?.data?.publishedAt === null,
    );
    expect(unpublished, "en komplett pakke skal ikke avpubliseres").toBe(false);
  });
});
