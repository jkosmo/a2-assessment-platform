// #934 skive 5a-3 (doc/DESIGN_934.md, «5a-3»): de to endepunktene der forfatteren svarer per kurs. Begge følger samme rekkefølge,
// i én transaksjon:
//   1. ta innholdslåsen eksklusivt, finn de berørte kursene, og les settet på nytt. Er det endret siden dialogen: 409;
//   2. avgjør resultatet for hvert kurs med samme regel som `applyCourseVersionChange` (`resolveCourseVersionKind`);
//   3. ta øyeblikksbildet for hvert kurs;
//   4. publiser elementene;
//   5. øk hvert kurs NØYAKTIG én gang, og hev kravet for modulene i kursene som fikk hovedversjon.
// Bryteren leses i transaksjonen, etter låsen. Er den av: 409, og ingenting er skrevet.
import type { ContentWriteTx } from "../../db/contentLock.js";
import { runContentWrite } from "../../db/contentLock.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/AppError.js";
import { publishModuleVersion } from "../adminContent/adminContentCommands.js";
import { findModulePlacements, type ModuleVersionKind } from "../adminContent/moduleVersioning.js";
import { createCourseRepository } from "./courseRepository.js";
import {
  getCoursePendingVersions,
  itemRefs,
  PENDING_PUBLISH_TX_TIMEOUT_MS,
  type PendingVersionsActor,
  type PublishedItemRef,
} from "./coursePublishService.js";
import {
  applyCourseVersionChange,
  coursesActorMayChoose,
  findAffectedCourses,
  NO_SECTION_SNAPSHOT,
  resolveCourseVersionKind,
  type AffectedCourse,
  type CourseVersionBump,
  type CourseVersionChoice,
  type SectionSnapshot,
} from "./courseVersioning.js";
import { assertModuleVersioningActive } from "./modulePassSwitch.js";
import { publishSection } from "./sectionCommands.js";

export type CourseVersionAnswers = Record<string, CourseVersionChoice>;
export type EmailConfirmations = Record<string, number>;

export type CoursePublishOutcome = { courseId: string; version: CourseVersionBump | null };

/** Settet dialogen viste, mot settet etter låsen. Ingen kan legge modulen inn i et nytt kurs før transaksjonen er ferdig. */
function assertExpectedCourses(affected: AffectedCourse[], expectedCourseIds: string[]) {
  const now = affected.map((course) => course.courseId).sort();
  const seen = [...new Set(expectedCourseIds)].sort();
  if (now.length !== seen.length || now.some((id, index) => id !== seen[index])) {
    throw new ConflictError(
      "affected_courses_changed",
      "The courses this publishing affects changed after they were shown. Reload and answer again. Nothing was published.",
      { expectedCourseIds: seen, currentCourseIds: now },
    );
  }
}

/**
 * Hvert kurs med kursbevis må ha et svar. Et svar for et kurs som ikke er berørt, avvises: ellers ville forfatterens valg
 * forsvunnet uten at noen sa fra.
 */
function assertAnswers(affected: AffectedCourse[], answers: CourseVersionAnswers, mayChoose: Set<string>) {
  const known = new Set(affected.map((course) => course.courseId));
  const unknown = Object.keys(answers).filter((courseId) => !known.has(courseId));
  if (unknown.length > 0) {
    throw new ConflictError(
      "affected_courses_changed",
      "The answers name courses this publishing does not affect. Reload and answer again. Nothing was published.",
      { unknownCourseIds: unknown, currentCourseIds: [...known] },
    );
  }
  const notOwner = affected.filter((course) => !mayChoose.has(course.courseId) && answers[course.courseId] === "major");
  if (notOwner.length > 0) {
    throw new AppError(
      "course_version_not_owner",
      403,
      "Only a course's owners or an administrator can choose a major version for it. Nothing was published.",
      { courses: notOwner.map((course) => ({ courseId: course.courseId })) },
    );
  }
  const missing = affected.filter((course) => mayChoose.has(course.courseId) && course.certificateHolders > 0 && !answers[course.courseId]);
  if (missing.length > 0) {
    throw new AppError(
      "course_version_required",
      400,
      'Participants have a course certificate for these courses: say whether each is a minor or a major version (courseVersions). Nothing was published.',
      { courses: missing.map((course) => ({ courseId: course.courseId, certificateHolders: course.certificateHolders })) },
    );
  }
}

/** 2.137.0: et kurs avsenderen ikke kan velge for, får mindre versjon, som uttrykkelig svar. Kravet heves ikke, og ingen får e-post. */
function answersWithOwnership(affected: AffectedCourse[], answers: CourseVersionAnswers, mayChoose: Set<string>): CourseVersionAnswers {
  const result: CourseVersionAnswers = {};
  for (const { courseId } of affected) {
    const answer = mayChoose.has(courseId) ? answers[courseId] : "minor";
    if (answer) result[courseId] = answer;
  }
  return result;
}

async function snapshotsOf(tx: ContentWriteTx, affected: AffectedCourse[]) {
  const repo = createCourseRepository(tx);
  const snapshots = new Map<string, SectionSnapshot>();
  for (const course of affected) snapshots.set(course.courseId, await repo.snapshotContent(course.courseId));
  return snapshots;
}

/**
 * `POST …/module-versions/:id/publish-versioned`. Mindre for modulen: mindre i alle kurs, uten spørsmål. Hoved for modulen: svar
 * kreves for hvert kurs med kursbevis som avsenderen eier. Kravet heves bare i kursene som faktisk fikk hovedversjon.
 */
export async function publishModuleVersioned(
  moduleId: string,
  moduleVersionId: string,
  actor: PendingVersionsActor,
  input: {
    moduleVersion: ModuleVersionKind;
    courseVersions?: CourseVersionAnswers;
    expectedCourseIds?: string[];
    confirmEmailRecipients?: EmailConfirmations;
  },
) {
  return runContentWrite(async (tx) => {
    await assertModuleVersioningActive(tx);
    const module = await tx.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true } });
    if (!module) throw new NotFoundError("Module", "module_not_found", "Module not found.");
    const affected = await findAffectedCourses(tx, [{ moduleId }]);
    const major = input.moduleVersion === "major";
    const given = input.courseVersions ?? {};
    let answers = given;
    if (major) {
      const mayChoose = await coursesActorMayChoose(tx, affected, actor);
      assertExpectedCourses(affected, input.expectedCourseIds ?? []);
      assertAnswers(affected, given, mayChoose);
      answers = answersWithOwnership(affected, given, mayChoose);
    }
    const snapshots = major ? await snapshotsOf(tx, affected) : new Map<string, SectionSnapshot>();

    const published = await publishModuleVersion(moduleId, moduleVersionId, actor.userId, tx, { moduleVersionKind: input.moduleVersion });

    // Et nytt forsøk på en versjon som alt er aktiv, setter ingenting live, så ingen kursversjon endres. Som hovedversjon når den
    // aldri hit: nummeret er gitt, og `publishModuleVersion` har avvist den.
    const courses: CoursePublishOutcome[] = [];
    if (module.activeVersionId === moduleVersionId) return { moduleVersion: published, courses };
    for (const course of affected) {
      const version = major
        ? await applyCourseVersionChange(
            tx,
            course.courseId,
            {
              kind: "question",
              answer: answers[course.courseId],
              confirmEmailRecipients: input.confirmEmailRecipients?.[course.courseId],
              raiseModules: [{ moduleId, major: published.versionMajor as number }],
            },
            snapshots.get(course.courseId) as SectionSnapshot,
            actor.userId,
          )
        : await applyCourseVersionChange(tx, course.courseId, { kind: "minor" }, NO_SECTION_SNAPSHOT, actor.userId);
      courses.push({ courseId: course.courseId, version });
    }
    return { moduleVersion: published, courses };
  }, { timeout: PENDING_PUBLISH_TX_TIMEOUT_MS });
}

/**
 * `POST /courses/:courseId/publish-pending-versioned`. Svar for alle berørte kurs avsenderen eier: dette og andre som har et av
 * elementene og har vært ute. Andres kurs får mindre versjon. En modul får ny hovedversjon når minst ett kurs får hovedversjon på grunn
 * av den. Bare elementer forfatteren eier, som i «Publiser nye versjoner».
 */
export async function publishCoursePendingVersioned(
  courseId: string,
  actor: PendingVersionsActor,
  input: {
    versionIds: string[];
    courseVersions?: CourseVersionAnswers;
    expectedCourseIds: string[];
    confirmEmailRecipients?: EmailConfirmations;
  },
): Promise<{ publishedItems: PublishedItemRef[]; courses: CoursePublishOutcome[] }> {
  return runContentWrite(async (tx) => {
    await assertModuleVersioningActive(tx);
    const fresh = await getCoursePendingVersions(courseId, actor, tx);
    const now = fresh.items.map((item) => item.versionId ?? "").sort();
    const seen = [...new Set(input.versionIds)].sort();
    if (now.length !== seen.length || now.some((id, index) => id !== seen[index])) {
      throw new ConflictError("pending_versions_changed", "The versions ready to publish changed since they were shown. Reload and try again.");
    }
    if (fresh.items.length === 0) return { publishedItems: [], courses: [] };
    if (!fresh.publishable) {
      throw new AppError("course_pending_blocked", 422, "One or more new versions cannot be published. Fix them before publishing.", { items: fresh.items });
    }

    const affected = fresh.affectedCourses ?? (await findAffectedCourses(tx, itemRefs(fresh.items)));
    const given = input.courseVersions ?? {};
    const mayChoose = await coursesActorMayChoose(tx, affected, actor);
    assertExpectedCourses(affected, input.expectedCourseIds);
    assertAnswers(affected, given, mayChoose);
    const answers = answersWithOwnership(affected, given, mayChoose);

    // Resultatet for hvert kurs, med samme regel som `applyCourseVersionChange` bruker under. Ingen endrer kursbevis mens vi
    // holder den eksklusive låsen: utstedelsen tar den delt.
    const courseKind = new Map(affected.map((course) => [course.courseId, resolveCourseVersionKind(answers[course.courseId], course.certificateHolders)]));
    const moduleItems = fresh.items.filter((item) => item.type === "MODULE");
    const placements = await findModulePlacements(tx, affected.map((course) => course.courseId), moduleItems.map((item) => item.id));
    const modulesInCourse = new Map<string, Set<string>>();
    const majorModules = new Set<string>();
    for (const placement of placements) {
      const set = modulesInCourse.get(placement.courseId);
      if (set) set.add(placement.moduleId);
      else modulesInCourse.set(placement.courseId, new Set([placement.moduleId]));
      if (courseKind.get(placement.courseId) === "major") majorModules.add(placement.moduleId);
    }

    const snapshots = await snapshotsOf(tx, affected);

    const publishedItems: PublishedItemRef[] = [];
    const newMajor = new Map<string, number>();
    for (const item of fresh.items) {
      if (item.type === "SECTION") {
        await publishSection(item.id, actor.userId, tx, { courseVersionHandledByCaller: true });
      } else {
        const version = await publishModuleVersion(item.id, item.versionId as string, actor.userId, tx, {
          moduleVersionKind: majorModules.has(item.id) ? "major" : "minor",
        });
        if (majorModules.has(item.id)) newMajor.set(item.id, version.versionMajor as number);
      }
      publishedItems.push({ type: item.type, id: item.id });
    }

    const courses: CoursePublishOutcome[] = [];
    for (const course of affected) {
      const raiseModules = [...(modulesInCourse.get(course.courseId) ?? [])].flatMap((moduleId) => {
        const major = newMajor.get(moduleId);
        return major === undefined ? [] : [{ moduleId, major }];
      });
      const version = await applyCourseVersionChange(
        tx,
        course.courseId,
        { kind: "question", answer: answers[course.courseId], confirmEmailRecipients: input.confirmEmailRecipients?.[course.courseId], raiseModules },
        snapshots.get(course.courseId) as SectionSnapshot,
        actor.userId || undefined,
      );
      courses.push({ courseId: course.courseId, version });
    }
    return { publishedItems, courses };
  }, { timeout: PENDING_PUBLISH_TX_TIMEOUT_MS });
}
