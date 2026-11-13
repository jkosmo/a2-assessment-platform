import { prisma } from "../../db/prisma.js";
import type { AssessmentMode } from "@prisma/client";
import type { ContentWriteTx } from "../../db/contentLock.js";
import { AppError } from "../../errors/AppError.js";
import { resolvePublishNumber, type ModuleVersionKind } from "./moduleVersioning.js";

type AdminContentRepositoryClient = Pick<typeof prisma, "module" | "moduleVersion" | "rubricVersion" | "promptTemplateVersion" | "mCQSetVersion" | "courseItem" | "contentOwner">;

export function createAdminContentRepository(client: AdminContentRepositoryClient = prisma) {
  return {
    // #787/#836: module ids the given user is a content-owner of. Used to annotate the module library
    // with `ownedByMe` so the calibration/quality picker can default to "my modules".
    async listModuleIdsOwnedBy(userId: string): Promise<Set<string>> {
      const rows = await client.contentOwner.findMany({
        where: { contentType: "MODULE", userId },
        select: { contentId: true },
      });
      return new Set(rows.map((row) => row.contentId));
    },

    listModuleSummaries() {
      return client.module.findMany({
        where: { archivedAt: null },
        orderBy: { title: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          activeVersion: {
            select: {
              id: true,
              versionNo: true,
            },
          },
        },
      });
    },

    // #1149: «Brukt i kurs» hentes IKKE her. Lista spør `findActiveCoursesForModules` (contentLifecycle.ts),
    // som bare teller aktive kurs — en telling på relasjonen her ville tatt med arkiverte kurs.
    listLibraryModules() {
      return client.module.findMany({
        orderBy: { title: "asc" },
        select: {
          id: true,
          title: true,
          certificationLevel: true,
          archivedAt: true,
          updatedAt: true,
          activeVersionId: true,
          activeVersion: {
            select: { id: true, versionNo: true, versionMajor: true, versionMinor: true },
          },
          versions: {
            orderBy: { versionNo: "desc" },
            take: 1,
            select: { id: true, versionNo: true, publishedAt: true },
          },
        },
      });
    },

    listArchivedModuleSummaries(search?: string) {
      return client.module.findMany({
        where: {
          archivedAt: { not: null },
          ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
        },
        orderBy: { archivedAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          certificationLevel: true,
          archivedAt: true,
        },
      });
    },

    findModuleSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, activeVersionId: true, archivedAt: true },
      });
    },

    findModuleDeleteSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
          activeVersionId: true,
          _count: {
            select: {
              versions: true,
              submissions: true,
              mcqSetVersions: true,
              certificationStatuses: true,
              rubricVersions: true,
              promptTemplateVersions: true,
            },
          },
        },
      });
    },

    findModuleTitle(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, title: true },
      });
    },

    // #896 S3b: the stored values a partial update has to merge onto. Without reading them
    // first, a patch for one locale replaces the whole localized object and deletes the others.
    findModuleDetails(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, description: true, certificationLevel: true, scopeMinWords: true, scopeMaxWords: true, validFrom: true, validTo: true },
      });
    },

    /** #1124 del 2: eksempelsvaret i modulens nyeste versjon — det en lagring uten feltet skal beholde. */
    async findLatestModelAnswer(moduleId: string) {
      const latest = await client.moduleVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { modelAnswer: true },
      });
      return latest?.modelAnswer ?? null;
    },

    // v1.2.11: list purge candidates — moduler som aldri har vært publisert nå (activeVersionId
    // null), ikke arkivert, ingen submissions, ikke i noe kurs. Returnerer både id og title
    // pluss avhengighet-tellinger så caller kan vise en preview-liste til brukeren før purge.
    // #1149: `_count.courseItems` teller ALLE kurs, også arkiverte, med vilje. Ryddingen sletter, og
    // `CourseItem` → modul er `onDelete: Restrict`: en modul i et arkivert kurs kan ikke slettes.
    listPurgeCandidates() {
      return client.module.findMany({
        where: {
          activeVersionId: null,
          archivedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          _count: {
            select: {
              submissions: true,
              courseItems: true,
              versions: true,
              rubricVersions: true,
              promptTemplateVersions: true,
              mcqSetVersions: true,
              mcqQuestions: true,
              certificationStatuses: true,
            },
          },
        },
      });
    },

    findModuleContentBundle(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
          description: true,
          certificationLevel: true,
          validFrom: true,
          validTo: true,
          activeVersionId: true,
          // #1049: forfatterens omfang. Klienten sender det med ved generering, som er tilstandsløs.
          scopeMinWords: true,
          scopeMaxWords: true,
          // #955: uten dette KAN publiseringsruta ikke sjekke arkivstatus, og invarianten
          // «arkivert men publisert oppstår aldri» var uhåndhevbar der.
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              versionMajor: true,
              versionMinor: true,
              taskText: true,
              assessorExpectedContent: true,
              modelAnswer: true,
              candidateTaskConstraints: true,
              assessmentBlueprint: true,
              submissionSchemaJson: true,
              assessmentPolicyJson: true,
              assessmentMode: true,
              rubricVersionId: true,
              promptTemplateVersionId: true,
              mcqSetVersionId: true,
              publishedBy: true,
              publishedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          rubricVersions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              criteriaJson: true,
              scalingRuleJson: true,
              active: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          promptTemplateVersions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              systemPrompt: true,
              userPromptTemplate: true,
              examplesJson: true,
              active: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          mcqSetVersions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              title: true,
              active: true,
              createdAt: true,
              updatedAt: true,
              questions: {
                // Samme createdAt for spørsmål skrevet i ett kall: id holder skriverekkefølgen.
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  stem: true,
                  optionsJson: true,
                  correctAnswer: true,
                  rationale: true,
                  questionType: true,
                  answerKeyJson: true,
                  active: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      });
    },

    findLatestRubricVersion(moduleId: string) {
      return client.rubricVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    // Returns the most recently created RubricVersion for the module, regardless of `active` flag.
    // Used by the ensure-rubric flow to decide whether auto-generation is needed (#447). Any
    // existing rubric — generic default or task-specific — skips the LLM call.
    findActiveRubricVersionForModule(moduleId: string) {
      return client.rubricVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          criteriaJson: true,
          scalingRuleJson: true,
          active: true,
          createdAt: true,
        },
      });
    },

    findLatestPromptTemplateVersion(moduleId: string) {
      return client.promptTemplateVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    findLatestMcqSetVersion(moduleId: string) {
      return client.mCQSetVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    findLatestModuleVersion(moduleId: string) {
      return client.moduleVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    createRubricVersion(data: {
      moduleId: string;
      versionNo: number;
      criteriaJson: string;
      scalingRuleJson: string;
      active: boolean;
    }) {
      return client.rubricVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          active: true,
          createdAt: true,
        },
      });
    },

    // #915: «Behold kriteriene» lager en NY rubrikkversjon (se syncActiveRubricBlueprintHash). Det
    // som sto her — `updateRubricVersionScalingRule`, en patch på stedet uten versionNo-bump — var
    // det ene unntaket fra «komponentversjoner er uforanderlige», og det unntaket gjorde
    // gjenoppretting av en eldre modulversjon til en løgn om kriteriedrift.
    findRubricVersionById(id: string) {
      return client.rubricVersion.findUnique({
        where: { id },
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          criteriaJson: true,
          scalingRuleJson: true,
          active: true,
        },
      });
    },

    createPromptTemplateVersion(data: {
      moduleId: string;
      versionNo: number;
      systemPrompt: string;
      userPromptTemplate: string;
      examplesJson: string;
      active: boolean;
    }) {
      return client.promptTemplateVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          active: true,
          createdAt: true,
        },
      });
    },

    createMcqSetVersion(data: {
      moduleId: string;
      versionNo: number;
      title: string;
      active: boolean;
      questions: Array<{
        moduleId: string;
        stem: string;
        optionsJson: string;
        correctAnswer: string;
        rationale?: string;
        questionType: string;
        answerKeyJson: string | null;
        active: boolean;
      }>;
    }) {
      return client.mCQSetVersion.create({
        data: {
          moduleId: data.moduleId,
          versionNo: data.versionNo,
          title: data.title,
          active: data.active,
          questions: {
            create: data.questions,
          },
        },
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          title: true,
          active: true,
          createdAt: true,
          questions: {
            select: {
              id: true,
              stem: true,
              correctAnswer: true,
              active: true,
            },
          },
        },
      });
    },

    findVersionDependencies(input: {
      rubricVersionId: string;
      promptTemplateVersionId: string;
      mcqSetVersionId: string;
    }) {
      return Promise.all([
        client.rubricVersion.findUnique({
          where: { id: input.rubricVersionId },
          select: { id: true, moduleId: true },
        }),
        client.promptTemplateVersion.findUnique({
          where: { id: input.promptTemplateVersionId },
          select: { id: true, moduleId: true },
        }),
        client.mCQSetVersion.findUnique({
          where: { id: input.mcqSetVersionId },
          select: { id: true, moduleId: true },
        }),
      ]);
    },

    // #1062: modulens aktive versjon (hele raden), til påfylling av banken.
    findModuleActiveVersion(moduleId: string) {
      return client.module.findUnique({ where: { id: moduleId }, select: { id: true, activeVersion: true } });
    },
    // #1062: siste versjon som hel rad — kilden når modulen ikke er publisert ennå.
    findLatestModuleVersionRow(moduleId: string) {
      return client.moduleVersion.findFirst({ where: { moduleId }, orderBy: { versionNo: "desc" } });
    },

    // #1062: settet med spørsmålene, til påfylling.
    findMcqSetVersionWithQuestions(mcqSetVersionId: string) {
      return client.mCQSetVersion.findUnique({
        where: { id: mcqSetVersionId },
        // Samme createdAt for spørsmål skrevet i ett kall: id holder skriverekkefølgen.
        include: { questions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
      });
    },

    // #525: MCQ_ONLY module versions only depend on an MCQ set (no rubric/prompt).
    findMcqSetSummary(mcqSetVersionId: string) {
      return client.mCQSetVersion.findUnique({
        where: { id: mcqSetVersionId },
        select: { id: true, moduleId: true },
      });
    },

    findPromptTemplateSummary(promptTemplateVersionId: string) {
      return client.promptTemplateVersion.findUnique({
        where: { id: promptTemplateVersionId },
        select: {
          id: true,
          moduleId: true,
          systemPrompt: true,
          userPromptTemplate: true,
        },
      });
    },

    findModuleVersionSummary(moduleVersionId: string) {
      return client.moduleVersion.findUnique({
        where: { id: moduleVersionId },
        select: { id: true, moduleId: true },
      });
    },

    findActiveModuleVersionForClone(moduleVersionId: string) {
      return client.moduleVersion.findUnique({
        where: { id: moduleVersionId },
        select: {
          id: true,
          moduleId: true,
          // #896 S5: the mode has to travel with a clone. It did not, and `assessmentMode` defaults
          // to FREETEXT_PLUS_MCQ in the schema — so calibrating thresholds on an MCQ_ONLY module
          // silently republished it as a free-text-plus-MCQ one. Restoring a version would have
          // inherited the same bug.
          assessmentMode: true,
          versionNo: true,
          taskText: true,
          assessorExpectedContent: true,
          modelAnswer: true,
          candidateTaskConstraints: true,
          assessmentBlueprint: true,
          rubricVersionId: true,
          promptTemplateVersionId: true,
          mcqSetVersionId: true,
          submissionSchemaJson: true,
          assessmentPolicyJson: true,
        },
      });
    },
  };
}

export const adminContentRepository = createAdminContentRepository();

/**
 * #934 skive 4a: det som SKRIVER moduler og modulversjoner, står for seg og tar bare imot en transaksjon som holder
 * innholdslåsen (`runContentWrite`). Leserne over kan brukes med hvilken klient som helst; skriverne kan ikke
 * kalles uten låsen — da kompilerer det ikke. `test/content-lock-write-guard.test.js` nekter skrivinger andre steder.
 */
export function createAdminContentWriter(client: ContentWriteTx) {
  return {
    archiveModule(moduleId: string, now: Date) {
      // I3: arkivering auto-avpubliserer (activeVersionId nullstilles) så «arkivert men
      // publisert» aldri oppstår. Gjenopprett (restoreModule) lander dermed i Utkast.
      // #1150 skive 2a-2: arkivering for hånd og importens arkivering setter IKKE merket fra kursarkiveringen. Det nullstilles
      // her: et merke som gammel kode lot stå etter en gjenoppretting, skal ikke få kurset til å ta modulen tilbake.
      return client.module.update({
        where: { id: moduleId },
        data: { archivedAt: now, activeVersionId: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null },
        select: { id: true, title: true, archivedAt: true },
      });
    },

    // #1150 skive 2a-2: gjenopprettet alene lander modulen som utkast (I3), og merkene nullstilles.
    restoreModule(moduleId: string) {
      return client.module.update({
        where: { id: moduleId },
        data: { archivedAt: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null },
        select: { id: true, title: true },
      });
    },

    /**
     * #1150 skive 2a-2: modulen følger kurset inn i arkivet. Som `archiveModule` (I3: ingen aktiv versjon), men kurset og
     * versjonen som var publisert, huskes, så gjenopprettingen av kurset kan sette den tilbake. Den ENE skriveren som setter
     * merkene til noe annet enn null (test/content-in-use-guard.test.js); kalles bare fra `archiveModuleWithCourse` i
     * adminContentCommands.ts.
     */
    async archiveModuleWithCourse(moduleId: string, courseId: string, now: Date) {
      const current = await client.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionId: true } });
      return client.module.update({
        where: { id: moduleId },
        data: { archivedAt: now, archivedWithCourseId: courseId, activeVersionIdBeforeArchive: current.activeVersionId, activeVersionId: null },
        select: { id: true, title: true, archivedAt: true, activeVersionIdBeforeArchive: true },
      });
    },

    /**
     * #1150 skive 2a-2: modulen kommer tilbake med kurset den fulgte inn i arkivet, PUBLISERT med samme versjon og samme nummer
     * (produkteier 13.11.2026, unntak fra I3 bare for elementer som fulgte et kurs). Merkene nullstilles alltid.
     *
     * Versjonen settes live gjennom `publishModuleVersion` (det ene stedet en modulversjon settes live, og der den får nummer):
     * med «mindre» får en versjon som alt har nummer, beholde det. Avviser den (versjonen tilhører en eldre hovedversjon enn den
     * høyeste), eller finnes ikke versjonen lenger, lander modulen som utkast, og svaret sier hvorfor.
     */
    async restoreModuleWithCourse(moduleId: string, actorId: string, now: Date): Promise<{ activeVersionId: string | null; asDraft?: "was_unpublished" | "version_missing" }> {
      const current = await client.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionIdBeforeArchive: true } });
      await client.module.update({
        where: { id: moduleId },
        data: { archivedAt: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null },
      });
      const versionId = current.activeVersionIdBeforeArchive;
      if (versionId === null) return { activeVersionId: null, asDraft: "was_unpublished" };
      const version = await client.moduleVersion.findUnique({ where: { id: versionId }, select: { moduleId: true } });
      if (!version || version.moduleId !== moduleId) return { activeVersionId: null, asDraft: "version_missing" };
      try {
        await createAdminContentWriter(client).publishModuleVersion(moduleId, versionId, actorId, now, "minor");
      } catch (error) {
        if (error instanceof AppError && (error.code === "module_version_outdated" || error.code === "module_version_number_fixed")) {
          return { activeVersionId: null, asDraft: "version_missing" };
        }
        throw error;
      }
      return { activeVersionId: versionId };
    },

    createModule(data: {
      title: string;
      description?: string;
      certificationLevel?: string;
      // #1049: forfatterens forventede svarlengde. Utelatt = nivåets standard.
      scopeMinWords?: number | null;
      scopeMaxWords?: number | null;
      validFrom?: Date;
      validTo?: Date;
    }) {
      return client.module.create({
        data,
        select: {
          id: true,
          title: true,
          description: true,
          certificationLevel: true,
          validFrom: true,
          validTo: true,
          createdAt: true,
        },
      });
    },

    updateModuleTitle(moduleId: string, title: string) {
      return client.module.update({
        where: { id: moduleId },
        data: { title },
        select: { id: true, title: true },
      });
    },

    // #896 S3b: the module-level fields an author edits after creation. Until now these were
    // create-only — the only update path on a module was the title — so «beskrivelse»,
    // «sertifiseringsnivå» and validity could be set once and never corrected.
    updateModuleDetails(
      moduleId: string,
      data: {
        description?: string | null;
        certificationLevel?: string;
        scopeMinWords?: number | null;
        scopeMaxWords?: number | null;
        validFrom?: Date | null;
        validTo?: Date | null;
      },
    ) {
      return client.module.update({
        where: { id: moduleId },
        data,
        select: { id: true, description: true, certificationLevel: true, scopeMinWords: true, scopeMaxWords: true, validFrom: true, validTo: true },
      });
    },

    deleteModule(moduleId: string) {
      return client.module.delete({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
        },
      });
    },

    createModuleVersion(data: {
      moduleId: string;
      versionNo: number;
      // taskText / rubricVersionId / promptTemplateVersionId are null for MCQ_ONLY modules (#525).
      taskText?: string | null;
      assessorExpectedContent?: string | null;
      modelAnswer?: string | null;
      candidateTaskConstraints?: string | null;
      assessmentBlueprint?: string | null;
      rubricVersionId?: string | null;
      promptTemplateVersionId?: string | null;
      mcqSetVersionId?: string | null;
      assessmentMode?: AssessmentMode;
      submissionSchemaJson?: string | null;
      assessmentPolicyJson?: string | null;
    }) {
      return client.moduleVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          taskText: true,
          assessorExpectedContent: true,
          modelAnswer: true,
          candidateTaskConstraints: true,
          assessmentBlueprint: true,
          submissionSchemaJson: true,
          assessmentPolicyJson: true,
          rubricVersionId: true,
          promptTemplateVersionId: true,
          mcqSetVersionId: true,
          assessmentMode: true,
          publishedBy: true,
          publishedAt: true,
          createdAt: true,
        },
      });
    },

    async unpublishModule(moduleId: string) {
      const module = await client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, activeVersionId: true },
      });

      if (!module) {
        throw new Error("Module not found.");
      }

      if (!module.activeVersionId) {
        throw new Error("Module has no active version to unpublish.");
      }

      const previousActiveVersionId = module.activeVersionId;

      await client.module.update({
        where: { id: moduleId },
        data: { activeVersionId: null },
      });

      return { moduleId, previousActiveVersionId };
    },

    // #934 skive 5a-2: det ene stedet en modulversjon settes live, og det ene stedet den får versjonsnummer. `versionKind` er
    // påkrevd, så en ny vei må si hva den er. Nummeret regnes ut før noe skrives; en avvist publisering endrer ingenting.
    // #934 skive 5a-3: en hovedversjon hever kravet bare i kursene som fikk hovedversjon. Det gjør kalleren (`applyCourseVersionChange`).
    // Den globale hevingen fra #997 (`all_courses`) kunne bare nås med bryteren av, og er fjernet (2026-11-08).
    async publishModuleVersion(
      moduleId: string,
      moduleVersionId: string,
      actorId: string,
      now: Date,
      versionKind: ModuleVersionKind,
    ) {
      const moduleVersion = await client.moduleVersion.findUnique({
        where: { id: moduleVersionId },
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          publishedAt: true,
          publishedBy: true,
        },
      });

      if (!moduleVersion || moduleVersion.moduleId !== moduleId) {
        throw new Error("Module version not found for module.");
      }

      const number = await resolvePublishNumber(client, moduleId, moduleVersionId, versionKind);

      const publishedVersion = await client.moduleVersion.update({
        where: { id: moduleVersionId },
        data: {
          ...(moduleVersion.publishedAt ? {} : { publishedAt: now, publishedBy: actorId }),
          versionMajor: number.major,
          versionMinor: number.minor,
        },
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          versionMajor: true,
          versionMinor: true,
          publishedAt: true,
          publishedBy: true,
        },
      });

      await client.module.update({
        where: { id: moduleId },
        data: { activeVersionId: moduleVersionId },
      });

      return publishedVersion;
    },
  };
}
