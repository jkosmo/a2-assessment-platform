import { describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #958: de to dørene inn til et kurs' elementer, målt gjennom den ekte aksessoren.
//
// ⚠️ Hvorfor en falsk Prisma-klient som FAKTISK TOLKER `where` og `select`.
//
// Regelen bor nå i spørringen (`sectionAvailableWhere`) og i projeksjonen (hvilke felt som i det
// hele tatt kommer ut). En mock som ignorerer `where` ville svart det testen håper, og vært like
// grønn med og uten filteret — altså verre enn ingen test. Klienten under evaluerer de filtrene og
// de projeksjonene dørene bruker, så testene måler regelen og ikke mocken.
//
// Mutasjonsmål (verifisert):
//   1. fjern `section: sectionAvailableWhere` fra deltakerdøra  → «utelater en tilbakeholdt
//      seksjon» og «utelater en arkivert seksjon» blir røde.
//   2. la `sectionAvailableWhere` bare være `{ archivedAt: null }` → «utelater en tilbakeholdt
//      seksjon» blir rød alene (arkiv-leddet dekker den ikke, de er to ulike årsaker).
//   3. la `available` for MODULE være hardkodet `true`                → «avpublisert modul» blir rød.
//   4. la deltakerdøra returnere `item.section` med `archivedAt`      → «bærer ikke feltene
//      regelen bygger på» blir rød.

vi.mock("../../src/db/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent: vi.fn() }));

const COURSE_ID = "course-1";

type SectionRow = { id: string; title: string; archivedAt: Date | null; activeVersionId: string | null };
type ModuleRow = {
  id: string;
  title: string;
  archivedAt: Date | null;
  activeVersionId: string | null;
  activeVersion: { publishedAt: Date | null } | null;
};
type ItemRow = {
  id: string;
  courseId: string;
  itemType: "MODULE" | "SECTION";
  sortOrder: number;
  moduleId: string | null;
  sectionId: string | null;
  discussionsEnabled: boolean;
  module: ModuleRow | null;
  section: SectionRow | null;
};

// ── Minimal Prisma-tolk: nøyaktig de operatorene dørene bruker. Møter den noe annet, kaster den
// heller enn å svare feil — en tolk som stilltiende ignorerer et ukjent filter er samme felle som
// mocken den erstatter.
function matchesRelation(row: Record<string, unknown> | null, filter: Record<string, unknown>): boolean {
  if (!row) return false;
  for (const [field, expected] of Object.entries(filter)) {
    const actual = row[field];
    if (expected === null) {
      if (actual !== null) return false;
    } else if (typeof expected === "object" && expected !== null && "not" in expected) {
      if ((expected as { not: unknown }).not === null) {
        if (actual === null) return false;
      } else if (actual === (expected as { not: unknown }).not) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

function matchesClause(row: ItemRow, clause: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(clause)) {
    if (key === "itemType") {
      if (row.itemType !== value) return false;
    } else if (key === "section") {
      if (!matchesRelation(row.section as never, value as Record<string, unknown>)) return false;
    } else if (key === "module") {
      if (!matchesRelation(row.module as never, value as Record<string, unknown>)) return false;
    } else if (key === "courseId") {
      if (row.courseId !== value) return false;
    } else {
      throw new Error(`Testtolken kjenner ikke filteret «${key}» — utvid den, ikke ignorer det.`);
    }
  }
  return true;
}

/** Projiserer et relasjonsobjekt etter `select`, slik Prisma gjør. Uten dette ville testen på hvilke
 *  felt dørene lekker målt fikstureringen i stedet for `select`-klausulen. */
function project(row: Record<string, unknown> | null, select: Record<string, unknown> | undefined) {
  if (!row || !select) return row;
  const out: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(select)) {
    if (spec === true) out[field] = row[field];
    else if (typeof spec === "object" && spec !== null && "select" in spec) {
      out[field] = project(row[field] as never, (spec as { select: Record<string, unknown> }).select);
    }
  }
  return out;
}

function createClient(items: ItemRow[], extra: Record<string, unknown> = {}) {
  return {
    courseItem: {
      findMany: async ({ where, include }: { where: Record<string, unknown>; include?: Record<string, { select?: Record<string, unknown> }> }) => {
        const { OR, ...rest } = where as { OR?: Array<Record<string, unknown>> } & Record<string, unknown>;
        return items
          .filter((row) => matchesClause(row, rest))
          .filter((row) => (OR ? OR.some((clause) => matchesClause(row, clause)) : true))
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => ({
            ...row,
            module: include?.module ? project(row.module as never, include.module.select) : row.module,
            section: include?.section ? project(row.section as never, include.section.select) : row.section,
          }));
      },
    },
    ...extra,
  };
}

function sectionItem(id: string, sortOrder: number, section: Partial<SectionRow>): ItemRow {
  return {
    id,
    courseId: COURSE_ID,
    itemType: "SECTION",
    sortOrder,
    moduleId: null,
    sectionId: `sec-${id}`,
    discussionsEnabled: true,
    module: null,
    section: { id: `sec-${id}`, title: id, archivedAt: null, activeVersionId: "v1", ...section },
  };
}

function moduleItem(id: string, sortOrder: number, module: Partial<ModuleRow>): ItemRow {
  return {
    id,
    courseId: COURSE_ID,
    itemType: "MODULE",
    sortOrder,
    moduleId: `mod-${id}`,
    sectionId: null,
    discussionsEnabled: true,
    module: {
      id: `mod-${id}`,
      title: id,
      archivedAt: null,
      activeVersionId: "v1",
      activeVersion: { publishedAt: new Date("2026-01-01") },
      ...module,
    },
    section: null,
  };
}

async function participantItems(items: ItemRow[]) {
  const { createCourseRepository } = await import("../../src/modules/course/courseRepository.js");
  return createCourseRepository(createClient(items) as never).findCourseItemsForParticipant(COURSE_ID);
}

async function allItems(items: ItemRow[]) {
  const { createCourseRepository } = await import("../../src/modules/course/courseRepository.js");
  return createCourseRepository(createClient(items) as never).findAllCourseItems(COURSE_ID);
}

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
// ⚠️ Begge, ikke bare den ene. `courseRepository` lastes av hjelperne over — de er DEKLARERT
// før første `it(`, men KJØRER inne i en test, og belastes derfor testens budsjett.
warmModuleGraph(async () => {
  await import("../../src/modules/course/courseCompletionService.js");
  await import("../../src/modules/course/courseRepository.js");
});

describe("#958 findCourseItemsForParticipant — seksjoner deltakeren ikke kan åpne er utelatt", () => {
  it("utelater en seksjon oversettelsesgaten har holdt tilbake", async () => {
    // Ingen aktiv versjon: nøyaktig tilstanden gaten etterlater. Begge deltakerrutene svarer 404 på
    // den, så en rad i sekvensen ville vært en blindvei — og klienten ignorerer `available` på
    // seksjoner (#992), så flagget beskyttet ingen.
    const items = await participantItems([sectionItem("withheld", 0, { activeVersionId: null })]);

    expect(items).toEqual([]);
  });

  it("utelater en arkivert seksjon — den andre årsaken, samme sti", async () => {
    // `archiveSection` setter begge feltene, men databasen tillater kombinasjonen «arkivert med
    // aktiv versjon», og importen kan skrive den. Derfor konstrueres den direkte her.
    const items = await participantItems([sectionItem("archived", 0, { archivedAt: new Date() })]);

    expect(items).toEqual([]);
  });

  it("KONTROLLCASE: en publisert seksjon slipper gjennom, og er available", async () => {
    // Uten denne vet vi ikke om vi målte tilgjengelighetsregelen eller bare knakk døra. En
    // `where` som filtrerer bort alt ville bestått begge testene over.
    const items = await participantItems([sectionItem("live", 0, {})]);

    expect(items).toHaveLength(1);
    expect(items[0].sectionId).toBe("sec-live");
    expect(items[0].available).toBe(true);
  });

  it("KONTROLLCASE: én tilbakeholdt og én publisert — bare den publiserte kommer ut", async () => {
    // Den skarpeste av kontrollcasene: den skiller «filteret virker» fra både «alt slipper gjennom»
    // og «ingenting slipper gjennom», i én måling.
    const items = await participantItems([
      sectionItem("withheld", 0, { activeVersionId: null }),
      sectionItem("live", 1, {}),
    ]);

    expect(items.map((i) => i.sectionId)).toEqual(["sec-live"]);
  });
});

describe("#958 findCourseItemsForParticipant — moduler er ALLE med, med et avgjort available", () => {
  it("en avpublisert modul er med, men available:false", async () => {
    // ⚠️ Bevisst asymmetri mot seksjoner: en avpublisert modul er en midlertidig tilstand
    // deltakeren skal se (FEATURE_SURFACE_MAP §6b-2), klienten rendrer den som deaktivert, og den
    // teller fortsatt i moduleTotal. Å skjule den ville endret hva kursbeviset krever.
    const items = await participantItems([moduleItem("unpublished", 0, { activeVersionId: null, activeVersion: null })]);

    expect(items).toHaveLength(1);
    expect(items[0].available).toBe(false);
  });

  it("en modul med aktiv versjon som aldri ble publisert er available:false", async () => {
    // Det tredje leddet i regelen: `activeVersionId` finnes, men versjonen har ingen publishedAt.
    const items = await participantItems([moduleItem("draft", 0, { activeVersion: { publishedAt: null } })]);

    expect(items[0].available).toBe(false);
  });

  it("en arkivert modul er med, men available:false", async () => {
    const items = await participantItems([moduleItem("archived", 0, { archivedAt: new Date() })]);

    expect(items).toHaveLength(1);
    expect(items[0].available).toBe(false);
  });

  it("KONTROLLCASE: en publisert, ikke-arkivert modul er available:true", async () => {
    // Uten denne ville `available: false` for alt bestått de tre testene over.
    const items = await participantItems([moduleItem("live", 0, {})]);

    expect(items[0].available).toBe(true);
  });
});

describe("#958 deltakerdøra bærer ikke feltene regelen bygger på", () => {
  it("verken archivedAt, activeVersionId eller publishedAt kommer ut", async () => {
    // ⚠️ Dette er selve poenget i #958, ikke en detalj. Så lenge feltene fulgte med kunne hver
    // kaller regne ut sin egen variant av regelen — og åtte kallere gjorde det, med fem svar. Nå
    // finnes de ikke å regne på: kalleren kan ikke unnlate å ta stilling, den har allerede fått
    // avgjørelsen.
    const items = await participantItems([sectionItem("live", 0, {}), moduleItem("live", 1, {})]);

    const asText = JSON.stringify(items);
    expect(asText).not.toContain("archivedAt");
    expect(asText).not.toContain("activeVersionId");
    expect(asText).not.toContain("publishedAt");
    // …og avgjørelsen ER der, ellers ville testen over bestått på en tom respons.
    expect(items.map((i) => i.available)).toEqual([true, true]);
  });
});

describe("#958 findAllCourseItems — forfatter, publisering, sletting og eksport ser ALT", () => {
  it("returnerer også det arkiverte og det tilbakeholdte", async () => {
    // Gaten som ikke fikk se det upubliserte hadde ingenting å rapportere; slettingen som ikke fikk
    // se det arkiverte ville etterlatt foreldreløse rader; eksporten ville tapt innhold permanent.
    const items = await allItems([
      sectionItem("withheld", 0, { activeVersionId: null }),
      sectionItem("archived", 1, { archivedAt: new Date() }),
      moduleItem("archived", 2, { archivedAt: new Date() }),
      sectionItem("live", 3, {}),
    ]);

    expect(items).toHaveLength(4);
  });

  it("bærer archivedAt (forfatterlista sender det videre) men ikke activeVersionId", async () => {
    // `archivedAt` er en forfatterflate-opplysning. `activeVersionId` er en byggekloss i
    // DELTAKERregelen, og har ingenting her å gjøre — den ville vært råstoff til en niende variant.
    const items = await allItems([sectionItem("live", 0, {}), moduleItem("live", 1, {})]);

    const asText = JSON.stringify(items);
    expect(asText).toContain("archivedAt");
    expect(asText).not.toContain("activeVersionId");
  });
});

describe("#958 bevisporten og deltakersekvensen får radene fra samme dør", () => {
  // Porten hadde sitt eget `isSectionAvailableToParticipant`-filter. Det var riktig, men det var en
  // fjerde kopi av setningen — og #938 var nettopp at kopiene kom i utakt. Nå er det ingen kopi å
  // holde i takt: porten leser det døra ga den.
  async function issue(items: ItemRow[], reads: string[]) {
    const created: Array<{ courseId: string }> = [];
    const client = createClient(items, {
      course: {
        findMany: async () => [
          { id: COURSE_ID, publishedAt: new Date("2026-01-01"), archivedAt: null, items: [] },
        ],
      },
      certificationStatus: { count: async () => 0 },
      courseSectionRead: { findMany: async () => reads.map((sectionId) => ({ sectionId })) },
      courseCompletion: {
        findUnique: async () => null,
        create: async ({ data }: { data: { courseId: string } }) => {
          created.push({ courseId: data.courseId });
          return { ...data, certificateId: "cert-1" };
        },
      },
    });

    const { checkAndIssueCourseCompletions } = await import("../../src/modules/course/courseCompletionService.js");
    await checkAndIssueCourseCompletions({ userId: "user-1", moduleId: "mod-x" }, client as never);
    return created;
  }

  it("en tilbakeholdt seksjon KREVES ikke — beviset utstedes uten at den er lest", async () => {
    // Produkteiers regel: et krav som ALDRI kan oppfylles er verre enn ikke noe krav. Deltakeren får
    // 404 på lesestien, så å kreve seksjonen ville gjort kurset umulig å fullføre — #945s form.
    const created = await issue(
      [sectionItem("live", 0, {}), sectionItem("withheld", 1, { activeVersionId: null })],
      ["sec-live"],
    );

    expect(created).toEqual([{ courseId: COURSE_ID }]);
  });

  it("KONTROLLCASE: en LESBAR ulest seksjon holder porten stengt", async () => {
    // Uten denne ville «krev ingenting» bestått testen over, og porten hadde sluttet å måle noe.
    const created = await issue([sectionItem("live", 0, {}), sectionItem("other", 1, {})], ["sec-live"]);

    expect(created).toEqual([]);
  });
});
