import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #989: resertifisering fjernes. Den bærende påstanden i saken er at fjerningen **ikke endrer én
// eneste bestått-avgjørelse** — kursbevisporten ignorerte allerede utløp, fordi `EXPIRED` (og `DUE`,
// `DUE_SOON`) står i CERTIFICATION_PASSED_STATUSES.
//
// Denne testen pinner nettopp det, gjennom den ekte porten: courseCompletionService →
// courseRepository.countPassedModulesForUser → `status: { in: CERTIFICATION_PASSED_STATUSES }`.
// Den falske Prisma-klienten under evaluerer `in`-filteret på ekte rader, så den måler regelen og
// ikke en mock som svarer det testen håper.
//
// ⚠️ Mutasjonsmål: krymp CERTIFICATION_PASSED_STATUSES til ["ACTIVE"] (den «opplagte» forenklingen
// når bare to tilstander skrives) — da blir de tre legacy-casene røde. Historiske rader med
// DUE_SOON/DUE/EXPIRED ville mistet kursbeviset sitt.

const recordAuditEvent = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));

type CertRow = { userId: string; moduleId: string; status: string };

const COURSE_ID = "course-1";
const MODULE_ID = "module-1";
const USER_ID = "user-1";

// Minimal Prisma-lignende klient som faktisk tolker de filtrene porten bruker.
function createFakeClient(certifications: CertRow[]) {
  const created: Array<{ userId: string; courseId: string }> = [];
  // #934: hva tjenesten faktisk spør etter og skriver. Kurset er 3.2 her, så en vei som glemte versjonen
  // (`undefined`, eller standard 1) synes — ekte Prisma ville avvist `undefined` i den sammensatte nøkkelen.
  const lookups: unknown[] = [];
  const versions: Array<{ versionMajor: unknown; versionMinor: unknown }> = [];

  const client = {
    course: {
      findMany: async () => [
        {
          id: COURSE_ID,
          publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          archivedAt: null,
          versionMajor: 3,
          versionMinor: 2,
          items: [{ moduleId: MODULE_ID }],
        },
      ],
    },
    courseItem: {
      // Kurset har én modul og ingen lærings-seksjoner: modulporten er eneste gate.
      findMany: async () => [
        { id: "item-1", courseId: COURSE_ID, itemType: "MODULE", moduleId: MODULE_ID, section: null },
      ],
    },
    certificationStatus: {
      count: async ({ where }: { where: { userId: string; moduleId: { in: string[] }; status: { in: string[] } } }) =>
        certifications.filter(
          (row) =>
            row.userId === where.userId &&
            where.moduleId.in.includes(row.moduleId) &&
            where.status.in.includes(row.status),
        ).length,
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

async function issueCompletionsFor(status: string | null) {
  const { client, created } = createFakeClient(
    status == null ? [] : [{ userId: USER_ID, moduleId: MODULE_ID, status }],
  );

  const { checkAndIssueCourseCompletions } = await import(
    "../../src/modules/course/courseCompletionService.js"
  );

  await checkAndIssueCourseCompletions({ userId: USER_ID, moduleId: MODULE_ID }, client as never);
  return created;
}

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/course/courseCompletionService.js"));

describe("kursbevisporten er uendret av at resertifisering fjernes (#989)", () => {
  beforeEach(() => {
    recordAuditEvent.mockReset();
  });

  // De tre livssyklustilstandene som ingenting lenger SKRIVER, men som eksisterende rader har.
  for (const legacyStatus of ["EXPIRED", "DUE", "DUE_SOON"]) {
    it(`utsteder fortsatt kursbevis for en historisk rad med status ${legacyStatus}`, async () => {
      const created = await issueCompletionsFor(legacyStatus);

      expect(created).toEqual([{ userId: USER_ID, courseId: COURSE_ID }]);
    });
  }

  // Kontrollcase 1: den tilstanden som fortsatt skrives skal fortsatt slippe gjennom.
  it("utsteder kursbevis for ACTIVE", async () => {
    const created = await issueCompletionsFor("ACTIVE");

    expect(created).toEqual([{ userId: USER_ID, courseId: COURSE_ID }]);
  });

  // Kontrollcase 2: uten en bestått-tilstand må porten fortsatt holde stengt — ellers måler testene
  // over bare at porten alltid åpner.
  it("utsteder IKKE kursbevis for NOT_CERTIFIED", async () => {
    const created = await issueCompletionsFor("NOT_CERTIFIED");

    expect(created).toEqual([]);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  // #934: beviset slås opp og utstedes for kursets NÅVÆRENDE versjon (her 3.2) — ikke `undefined`, og
  // ikke standardverdien 1.
  it("#934: slår opp beviset for kursets hovedversjon og stempler det nye med versjonen", async () => {
    const { client, lookups, versions } = createFakeClient([{ userId: USER_ID, moduleId: MODULE_ID, status: "ACTIVE" }]);
    const { checkAndIssueCourseCompletions } = await import("../../src/modules/course/courseCompletionService.js");
    await checkAndIssueCourseCompletions({ userId: USER_ID, moduleId: MODULE_ID }, client as never);

    expect(lookups).toEqual([{ userId_courseId_versionMajor: { userId: USER_ID, courseId: COURSE_ID, versionMajor: 3 } }]);
    expect(versions).toEqual([{ versionMajor: 3, versionMinor: 2 }]);
  });

  it("utsteder IKKE kursbevis når modulen mangler sertifiseringsrad", async () => {
    const created = await issueCompletionsFor(null);

    expect(created).toEqual([]);
  });

  // #997: revidert modul. Verdien står med vilje UTENFOR CERTIFICATION_PASSED_STATUSES — det er
  // hele mekanismen: ingen leser måtte endres for at en revisjon skal slutte å telle.
  //
  // ⚠️ Mutasjonsmål: legg "SUPERSEDED" inn i lista. Da blir denne rød, og revisjonen ville vært
  // et navn uten virkning.
  it("utsteder IKKE kursbevis for SUPERSEDED — modulen er revidert etter at deltakeren besto", async () => {
    const created = await issueCompletionsFor("SUPERSEDED");

    expect(created).toEqual([]);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
