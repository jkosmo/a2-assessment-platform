import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// Kursbevisporten gjennom den ekte koden: courseCompletionService → `findModuleProgress` (moduleCredit.ts) → `passCountsForCourse`.
// Den falske Prisma-klienten under evaluerer `in`-filtrene på ekte rader, så den måler regelen og ikke en mock som svarer det
// testen håper.
//
// 2026-11-08: porten leser bare regelen om beståtte per kurs (#934 5a-3): `ModulePass` og kravet per kurs. Den gamle regelen
// (`CertificationStatus`, med DUE/EXPIRED som bestått fra #989) er fjernet; klienten under har ikke engang tabellen, så en
// leser som gikk tilbake til den, ville feilet her. Gamle DUE/EXPIRED-rader ble gjort om til `ModulePass` av tilbakefyllingen
// før regelen ble slått på (2026-11-06).

const recordAuditEvent = vi.fn();

// #934 skive 5a-1: utstedelsen åpner sin egen låste transaksjon, så den falske klienten står nå der `prisma` står.
const prismaHolder = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../../src/db/prisma.js", () => ({ prisma: prismaHolder }));
// #934 skive 5a-1: låsene er SQL; her går de rett gjennom den falske transaksjonen.
vi.mock("../../src/db/contentLock.js", () => import("../support/contentLockThroughTransaction.js"));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));

type PassRow = { userId: string; moduleId: string; invalidatedAt: Date | null; versionMajor: number | null };

const COURSE_ID = "course-1";
const MODULE_ID = "module-1";
const USER_ID = "user-1";

// Minimal Prisma-lignende klient som faktisk tolker de filtrene porten bruker.
function createFakeClient(passes: PassRow[], minModuleMajor: number | null = 1) {
  const created: Array<{ userId: string; courseId: string }> = [];
  // #934: hva tjenesten faktisk spør etter og skriver. Kurset er 3.2 her, så en vei som glemte versjonen
  // (`undefined`, eller standard 1) synes — ekte Prisma ville avvist `undefined` i den sammensatte nøkkelen.
  const lookups: unknown[] = [];
  const versions: Array<{ versionMajor: unknown; versionMinor: unknown }> = [];

  const courseRow = {
    id: COURSE_ID,
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    versionMajor: 3,
    versionMinor: 2,
    items: [{ moduleId: MODULE_ID, sortOrder: 0, module: { archivedAt: null } }],
  };
  const client = {
    $transaction: (cb: (tx: unknown) => unknown) => cb(client),
    course: {
      findMany: async () => [courseRow],
      findUnique: async () => courseRow,
    },
    courseItem: {
      // Kurset har én modul og ingen lærings-seksjoner: modulporten er eneste gate.
      findMany: async () => [
        { id: "item-1", courseId: COURSE_ID, itemType: "MODULE", moduleId: MODULE_ID, section: null },
      ],
    },
    // #934 skive 5a-3: kravet for modulen i kurset, og beståttene per innlevering. Det er alt porten leser om modulene.
    courseModuleRequirement: {
      findMany: async () => (minModuleMajor === null ? [] : [{ courseId: COURSE_ID, moduleId: MODULE_ID, minModuleMajor }]),
    },
    modulePass: {
      findMany: async ({ where }: { where: { userId: { in: string[] }; moduleId: { in: string[] } } }) =>
        passes
          .filter((row) => where.userId.in.includes(row.userId) && where.moduleId.in.includes(row.moduleId))
          .map((row) => ({ userId: row.userId, moduleId: row.moduleId, invalidatedAt: row.invalidatedAt, moduleVersion: { versionMajor: row.versionMajor } })),
    },
    courseSectionRead: {
      findMany: async () => [],
    },
    // #934 skive 3: ingen hovedversjon er laget — alle lesinger teller.
    courseVersion: {
      findMany: async () => [],
    },
    courseCompletion: {
      findUnique: async ({ where }: { where: unknown }) => {
        lookups.push(where);
        return null;
      },
      create: async ({ data }: { data: { userId: string; courseId: string; versionMajor: unknown; versionMinor: unknown } }) => {
        created.push({ userId: data.userId, courseId: data.courseId });
        versions.push({ versionMajor: data.versionMajor, versionMinor: data.versionMinor });
        return { ...data, certificateId: "certificate-1" };
      },
    },
  };

  return { client, created, lookups, versions };
}

const pass = (over: Partial<PassRow> = {}): PassRow => ({ userId: USER_ID, moduleId: MODULE_ID, invalidatedAt: null, versionMajor: 1, ...over });

async function issueCompletionsFor(passes: PassRow[], minModuleMajor: number | null = 1) {
  const { client, created } = createFakeClient(passes, minModuleMajor);

  const { checkAndIssueCourseCompletions } = await import(
    "../../src/modules/course/courseCompletionService.js"
  );

  Object.assign(prismaHolder, client);
  await checkAndIssueCourseCompletions({ userId: USER_ID, moduleId: MODULE_ID });
  return created;
}

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/course/courseCompletionService.js"));

describe("kursbevisporten leser regelen om beståtte per kurs (#934 5a-3)", () => {
  beforeEach(() => {
    recordAuditEvent.mockReset();
  });

  it("utsteder kursbevis for en bestått som oppfyller kravet, også en høyere hovedversjon", async () => {
    expect(await issueCompletionsFor([pass()])).toEqual([{ userId: USER_ID, courseId: COURSE_ID }]);
    expect(await issueCompletionsFor([pass({ versionMajor: 3 })], 2)).toEqual([{ userId: USER_ID, courseId: COURSE_ID }]);
  });

  // Kontrollcasene: uten en bestått som teller, må porten holde stengt, ellers måler testen over bare at porten alltid åpner.
  it("utsteder IKKE kursbevis uten bestått, under kravet, uten krav, for en ugyldiggjort (#997) eller en versjon uten nummer", async () => {
    expect(await issueCompletionsFor([])).toEqual([]);
    expect(await issueCompletionsFor([pass({ versionMajor: 1 })], 2)).toEqual([]);
    expect(await issueCompletionsFor([pass()], null)).toEqual([]);
    expect(await issueCompletionsFor([pass({ invalidatedAt: new Date("2026-11-01T00:00:00.000Z") })])).toEqual([]);
    expect(await issueCompletionsFor([pass({ versionMajor: null })])).toEqual([]);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  // #934: beviset slås opp og utstedes for kursets NÅVÆRENDE versjon (her 3.2) — ikke `undefined`, og
  // ikke standardverdien 1.
  it("#934: slår opp beviset for kursets hovedversjon og stempler det nye med versjonen", async () => {
    const { client, lookups, versions } = createFakeClient([pass()]);
    const { checkAndIssueCourseCompletions } = await import("../../src/modules/course/courseCompletionService.js");
    Object.assign(prismaHolder, client);
    await checkAndIssueCourseCompletions({ userId: USER_ID, moduleId: MODULE_ID });

    expect(lookups).toEqual([{ userId_courseId_versionMajor: { userId: USER_ID, courseId: COURSE_ID, versionMajor: 3 } }]);
    expect(versions).toEqual([{ versionMajor: 3, versionMinor: 2 }]);
  });
});
