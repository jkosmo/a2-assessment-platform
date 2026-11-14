import { describe, expect, it, vi } from "vitest";
import { creditSectionReads, findSectionReadCredit, type CourseForReadCredit, type ReadForCredit } from "../../src/modules/course/sectionReadCredit.js";

// #1156 (QA-porten): alt leses på klienten som sendes inn. Den globale klienten kaster, så en spørring utenom transaksjonen (den
// gamle synligheten gikk gjennom `prisma`) gjør testene røde.
vi.mock("../../src/db/prisma.js", () => ({
  prisma: new Proxy({}, { get: (_target, property) => { if (property === "then") return undefined; throw new Error(`global prisma used: ${String(property)}`); } }),
}));

// #1156 (doc/design/PLAN_1156_LEST_PA_TVERS.md): regelen for «lest seksjon i dette kurset», uten database (`creditSectionReads`)
// og med en falsk klient som tolker filtrene (`findSectionReadCredit`). Integrasjonstesten gjennom rutene:
// test/m2-section-read-across-courses-1156.test.ts.

const T0 = new Date("2026-10-01T10:00:00.000Z");
const T1 = new Date("2026-10-10T10:00:00.000Z");
const T2 = new Date("2026-10-20T10:00:00.000Z");
const T3 = new Date("2026-10-30T10:00:00.000Z");

const course = (id: string, over: Partial<CourseForReadCredit> = {}): CourseForReadCredit => ({
  id,
  archivedAt: null,
  sectionIds: ["s1"],
  rule: null,
  ...over,
});
const read = (courseId: string | null, readAt: Date, over: Partial<ReadForCredit> = {}): ReadForCredit => ({
  userId: "u1",
  courseId,
  sectionId: "s1",
  readAt,
  ...over,
});
const everyoneSees = () => true;
const nobodySees = () => false;

describe("#1156 creditSectionReads: regelen", () => {
  it("en lesing gjort i kurs A teller i kurs B når deltakeren ser B", () => {
    const credit = creditSectionReads({ courses: [course("A"), course("B")], reads: [read("A", T1)], sees: everyoneSees });
    expect([...credit.readSectionIds("u1", "A")]).toEqual(["s1"]);
    expect([...credit.readSectionIds("u1", "B")]).toEqual(["s1"]);
  });

  it("en lesing gjort et annet sted teller IKKE i et kurs deltakeren ikke ser; KONTROLL: en lesing gjort i kurset selv teller alltid", () => {
    const sees = vi.fn(nobodySees);
    const elsewhere = creditSectionReads({ courses: [course("B")], reads: [read("A", T1)], sees });
    expect(elsewhere.readSectionIds("u1", "B").size).toBe(0);
    expect(sees).toHaveBeenCalledWith("u1", "B");

    sees.mockClear();
    const here = creditSectionReads({ courses: [course("B")], reads: [read("B", T1)], sees });
    expect([...here.readSectionIds("u1", "B")]).toEqual(["s1"]);
    // Synligheten spørres ikke for en lesing gjort i kurset selv.
    expect(sees).not.toHaveBeenCalled();
  });

  it("en lesing i et slettet kurs (uten kurs) teller videre i kurs deltakeren ser", () => {
    const credit = creditSectionReads({ courses: [course("B")], reads: [read(null, T1)], sees: everyoneSees });
    expect([...credit.readSectionIds("u1", "B")]).toEqual(["s1"]);
    expect(creditSectionReads({ courses: [course("B")], reads: [read(null, T1)], sees: nobodySees }).readSectionIds("u1", "B").size).toBe(0);
  });

  it("et arkivert kurs teller bare lesinger gjort et annet sted fram til arkiveringen; KONTROLL: en lesing før arkiveringen teller", () => {
    const archived = course("B", { archivedAt: T2 });
    expect(creditSectionReads({ courses: [archived], reads: [read("A", T3)], sees: everyoneSees }).readSectionIds("u1", "B").size).toBe(0);
    expect([...creditSectionReads({ courses: [archived], reads: [read("A", T1)], sees: everyoneSees }).readSectionIds("u1", "B")]).toEqual(["s1"]);
    // En lesing gjort i kurset selv teller som før (lesestien slipper ikke inn i et arkivert kurs; fiksturene i #1152 lager dem).
    expect([...creditSectionReads({ courses: [archived], reads: [read("B", T3)], sees: nobodySees }).readSectionIds("u1", "B")]).toEqual(["s1"]);
    // Den seneste FØR arkiveringen velges: en senere lesing etter arkiveringen skyver ikke en gyldig til side.
    const both = creditSectionReads({ courses: [archived], reads: [read("A", T1), read("C", T3)], sees: everyoneSees });
    expect(both.rows).toEqual([{ userId: "u1", courseId: "B", sectionId: "s1", readAt: T1, readInCourseId: "A", counts: true }]);
  });

  it("kursets hovedversjon: en seksjon endret i B sin nye hovedversjon må leses på nytt i B, ikke i A (og omvendt)", () => {
    // B tok i bruk ny hovedversjon ved T2, der s1 er endret. A har ingen hovedversjon: alle lesinger teller der.
    const B = course("B", { rule: { since: T2, unchanged: new Set() } });
    const before = creditSectionReads({ courses: [course("A"), B], reads: [read("A", T1)], sees: everyoneSees });
    expect([...before.readSectionIds("u1", "A")]).toEqual(["s1"]);
    expect(before.readSectionIds("u1", "B").size).toBe(0);
    // Omvendt: lest i B før B sin nye hovedversjon teller fortsatt i A.
    const fromB = creditSectionReads({ courses: [course("A"), B], reads: [read("B", T1)], sees: everyoneSees });
    expect([...fromB.readSectionIds("u1", "A")]).toEqual(["s1"]);
    expect(fromB.readSectionIds("u1", "B").size).toBe(0);
    // Lest på nytt (hvor som helst) etter T2: teller i begge.
    const after = creditSectionReads({ courses: [course("A"), B], reads: [read("A", T1), read("A", T3, { courseId: "C" })], sees: everyoneSees });
    expect([...after.readSectionIds("u1", "B")]).toEqual(["s1"]);
    // En seksjon som er uendret i B sin hovedversjon, teller uansett tidspunkt.
    const unchanged = course("B", { rule: { since: T2, unchanged: new Set(["s1"]) } });
    expect([...creditSectionReads({ courses: [unchanged], reads: [read("A", T0)], sees: everyoneSees }).readSectionIds("u1", "B")]).toEqual(["s1"]);
  });

  it("den SENESTE lesingen velges: en gammel lesing i kurset selv og en ny et annet sted gir den nye", () => {
    const B = course("B", { rule: { since: T2, unchanged: new Set() } });
    const credit = creditSectionReads({ courses: [B], reads: [read("B", T1), read("A", T3)], sees: everyoneSees });
    expect(credit.rows).toEqual([{ userId: "u1", courseId: "B", sectionId: "s1", readAt: T3, readInCourseId: "A", counts: true }]);
  });

  it("vinduet gjelder den seneste lesingen, valgt FØR vinduet; «har lest» tar med en lesing som ikke teller for hovedversjonen", () => {
    const window = { dateFrom: T0, dateTo: T2 };
    // Lest i vinduet (T1) og igjen etter (T3): den seneste er utenfor vinduet.
    const outside = creditSectionReads({ courses: [course("B")], reads: [read("A", T1), read("B", T3)], sees: everyoneSees, filters: window });
    expect(outside.rows).toEqual([]);
    expect(outside.readerIds("B").size).toBe(0);
    // KONTROLL: bare lest i vinduet.
    const inside = creditSectionReads({ courses: [course("B")], reads: [read("A", T1)], sees: everyoneSees, filters: window });
    expect([...inside.readSectionIds("u1", "B")]).toEqual(["s1"]);
    // En lesing som ikke teller for B sin hovedversjon: deltakeren har lest i kurset, men seksjonen er ikke lest.
    const B = course("B", { rule: { since: T2, unchanged: new Set() } });
    const stale = creditSectionReads({ courses: [B], reads: [read("A", T1)], sees: everyoneSees });
    expect([...stale.readerIds("B")]).toEqual(["u1"]);
    expect(stale.readSectionIds("u1", "B").size).toBe(0);
    expect(stale.rows).toEqual([{ userId: "u1", courseId: "B", sectionId: "s1", readAt: T1, readInCourseId: "A", counts: false }]);
  });

  it("bare seksjonene i kursets elementliste telles", () => {
    const credit = creditSectionReads({ courses: [course("B", { sectionIds: ["s2"] })], reads: [read("A", T1)], sees: everyoneSees });
    expect(credit.rows).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findSectionReadCredit: hvilken liste, hvilke lesinger, og når synligheten slås opp.
// ─────────────────────────────────────────────────────────────────────────────

type ItemRow = { courseId: string; sectionId: string; available: boolean };

/** Det synligheten leser (learnerVisibility.ts). Tom som standard: ingen påmeldinger, klasser eller roller. */
type VisibilityData = {
  enrollments?: Array<{ userId: string; courseId: string }>;
  assignments?: Array<{ courseId: string; classId: string; archivedAt: Date | null }>;
  members?: Array<{ classId: string; userId: string }>;
  participants?: string[];
  completions?: Array<{ userId: string; courseId: string }>;
};

/**
 * En falsk klient som tolker filtrene og TELLER spørringene per tabell, så testen kan måle at synligheten koster et fast antall
 * spørringer uansett hvor mange deltakere, og at de går gjennom klienten som ble sendt inn (transaksjonen).
 */
function fakeClient(input: {
  courses: Array<{ id: string; enrollmentPolicy: string; archivedAt?: Date | null }>;
  items: ItemRow[];
  reads: Array<{ userId: string; courseId: string | null; sectionId: string; readAt: Date }>;
  visibility?: VisibilityData;
}) {
  const itemWheres: unknown[] = [];
  const calls: Record<string, number> = {};
  const count = (table: string) => {
    calls[table] = (calls[table] ?? 0) + 1;
  };
  const v = input.visibility ?? {};
  const inList = (value: string, filter?: { in: string[] }) => !filter || filter.in.includes(value);
  const client = {
    course: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        input.courses.filter((c) => where.id.in.includes(c.id)).map((c) => ({ id: c.id, enrollmentPolicy: c.enrollmentPolicy, archivedAt: c.archivedAt ?? null })),
    },
    courseItem: {
      findMany: async ({ where }: { where: { courseId: { in: string[] }; itemType?: string; section?: unknown } }) => {
        if (where.itemType === "MODULE") {
          count("courseItem:module");
          return [];
        }
        itemWheres.push(where);
        return input.items
          .filter((item) => where.courseId.in.includes(item.courseId) && (!where.section || item.available))
          .map((item) => ({ courseId: item.courseId, sectionId: item.sectionId }));
      },
    },
    courseSectionRead: {
      findMany: async ({ where }: { where: { sectionId?: { in: string[] }; userId?: { in: string[] }; courseId?: { in: string[] } } }) => {
        if (!where.sectionId) {
          count("courseSectionRead:own");
          return input.reads.filter((r) => r.courseId && inList(r.userId, where.userId) && inList(r.courseId, where.courseId));
        }
        return input.reads.filter((r) => where.sectionId!.in.includes(r.sectionId) && inList(r.userId, where.userId));
      },
    },
    courseVersion: { findMany: async () => [] },
    courseEnrollment: {
      findMany: async ({ where }: { where: { courseId: { in: string[] }; userId: { in: string[] } } }) => {
        count("courseEnrollment");
        return (v.enrollments ?? []).filter((e) => where.courseId.in.includes(e.courseId) && where.userId.in.includes(e.userId));
      },
    },
    courseGroupAssignment: {
      findMany: async ({ where }: { where: { courseId: { in: string[] } } }) => {
        count("courseGroupAssignment");
        return (v.assignments ?? []).filter((a) => where.courseId.in.includes(a.courseId)).map((a) => ({ courseId: a.courseId, classId: a.classId, class: { archivedAt: a.archivedAt } }));
      },
    },
    classMember: {
      findMany: async ({ where }: { where: { classId: { in: string[] }; userId: { in: string[] } } }) => {
        count("classMember");
        return (v.members ?? []).filter((m) => where.classId.in.includes(m.classId) && where.userId.in.includes(m.userId));
      },
    },
    roleAssignment: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) => {
        count("roleAssignment");
        return (v.participants ?? []).filter((userId) => where.userId.in.includes(userId)).map((userId) => ({ userId }));
      },
    },
    courseCompletion: {
      findMany: async ({ where }: { where: { userId: { in: string[] }; courseId: { in: string[] } } }) => {
        count("courseCompletion");
        return (v.completions ?? []).filter((c) => where.userId.in.includes(c.userId) && where.courseId.in.includes(c.courseId));
      },
    },
    discussionThread: { findMany: async () => (count("discussionThread"), []) },
    discussionReply: { findMany: async () => (count("discussionReply"), []) },
    discussionSubscription: { findMany: async () => (count("discussionSubscription"), []) },
    submission: { findMany: async () => (count("submission"), []) },
  };
  const visibilityQueries = () => Object.values(calls).reduce((total, n) => total + n, 0);
  return { client: client as never, itemWheres, calls, visibilityQueries };
}

const learners = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("#1156 findSectionReadCredit: lista, lesingene og synligheten", () => {
  const open = { id: "A", enrollmentPolicy: "OPEN" };
  const restricted = { id: "R", enrollmentPolicy: "RESTRICTED" };
  const shared: ItemRow[] = [{ courseId: "A", sectionId: "s1", available: true }, { courseId: "R", sectionId: "s1", available: true }];

  it("et begrenset kurs teller en lesing gjort et annet sted bare for den som er tildelt; kurset selv og et åpent kurs slår ingenting opp", async () => {
    const { client, calls } = fakeClient({
      courses: [open, restricted],
      items: shared,
      reads: [
        { userId: "u1", courseId: "A", sectionId: "s1", readAt: T1 },
        { userId: "u2", courseId: "A", sectionId: "s1", readAt: T1 },
        { userId: "u3", courseId: "R", sectionId: "s1", readAt: T1 },
      ],
      visibility: { enrollments: [{ userId: "u2", courseId: "R" }] },
    });
    const credit = await findSectionReadCredit(client, { courseIds: ["A", "R"], items: "participant" });
    expect([...credit.readerIds("A")].sort()).toEqual(["u1", "u2", "u3"]);
    // u1: ikke tildelt. u2: påmeldt (KONTROLL). u3: lest i kurset selv.
    expect([...credit.readerIds("R")].sort()).toEqual(["u2", "u3"]);
    // Ett oppslag for det begrensede kurset, ingen for det åpne.
    expect(calls).toEqual({ courseEnrollment: 1, courseGroupAssignment: 1 });
  });

  it("klasser: aktiv klasse og «Alle deltakere» (lagret rolle) ser kurset; bare en arkivert klasse ser det bare når kurset er påbegynt", async () => {
    const { client } = fakeClient({
      courses: [open, restricted],
      items: shared,
      reads: ["aktiv", "alle", "arkivert-uten", "arkivert-med", "utenfor"].map((userId) => ({ userId, courseId: "A", sectionId: "s1", readAt: T1 })),
      visibility: {
        assignments: [
          { courseId: "R", classId: "k-aktiv", archivedAt: null },
          { courseId: "R", classId: "k-arkivert", archivedAt: T0 },
          { courseId: "R", classId: "cls_all_participants", archivedAt: null },
        ],
        members: [
          { classId: "k-aktiv", userId: "aktiv" },
          { classId: "k-arkivert", userId: "arkivert-uten" },
          { classId: "k-arkivert", userId: "arkivert-med" },
        ],
        participants: ["alle"],
        completions: [{ userId: "arkivert-med", courseId: "R" }],
      },
    });
    const credit = await findSectionReadCredit(client, { courseIds: ["R"], items: "participant" });
    expect([...credit.readerIds("R")].sort()).toEqual(["aktiv", "alle", "arkivert-med"]);
  });

  it("synligheten koster et fast antall spørringer, uansett hvor mange deltakere (ikke én omgang per deltaker), og går gjennom klienten som sendes inn", async () => {
    const measure = async (n: number) => {
      const users = learners(n);
      const { client, calls, visibilityQueries } = fakeClient({
        courses: [open, restricted],
        items: shared,
        reads: users.map((userId) => ({ userId, courseId: "A", sectionId: "s1", readAt: T1 })),
        visibility: {
          enrollments: users.filter((_, i) => i % 2 === 0).map((userId) => ({ userId, courseId: "R" })),
          assignments: [{ courseId: "R", classId: "k-arkivert", archivedAt: T0 }, { courseId: "R", classId: "cls_all_participants", archivedAt: null }],
          members: users.filter((_, i) => i % 3 === 0).map((userId) => ({ classId: "k-arkivert", userId })),
          participants: users.filter((_, i) => i % 5 === 0),
        },
      });
      const credit = await findSectionReadCredit(client, { courseIds: ["R"], items: "participant" });
      return { queries: visibilityQueries(), calls: { ...calls }, readers: credit.readerIds("R").size };
    };
    const small = await measure(10);
    const large = await measure(300);
    expect(large.queries).toBe(small.queries);
    expect(large.calls).toEqual(small.calls);
    // Påmeldinger, tildelinger, medlemskap, roller, og én omgang «påbegynt» for kurset fra den arkiverte klassen.
    expect(large.queries).toBeLessThanOrEqual(12);
    // KONTROLL: svaret er riktig for de mange: påmeldt (i % 2 == 0) eller «Alle deltakere» (i % 5 == 0).
    expect(large.readers).toBe(learners(300).filter((_, i) => i % 2 === 0 || i % 5 === 0).length);
  });

  it("lesinger som forkastes uansett (gjort etter arkiveringen) slår ikke opp synlighet", async () => {
    const { client, visibilityQueries } = fakeClient({
      courses: [open, { ...restricted, archivedAt: T2 }],
      items: shared,
      reads: [{ userId: "u1", courseId: "A", sectionId: "s1", readAt: T3 }],
    });
    const credit = await findSectionReadCredit(client, { courseIds: ["R"], items: "participant" });
    expect(credit.rows).toEqual([]);
    expect(visibilityQueries()).toBe(0);
  });

  it("kjente synlige kurs slår ikke opp noe; `visibilityComplete` er hele svaret; begge gjelder bare én deltaker", async () => {
    const { client, visibilityQueries } = fakeClient({
      courses: [restricted],
      items: [{ courseId: "R", sectionId: "s1", available: true }],
      reads: [{ userId: "u1", courseId: "A", sectionId: "s1", readAt: T1 }],
      visibility: { enrollments: [{ userId: "u1", courseId: "R" }] },
    });
    const known = await findSectionReadCredit(client, { userIds: ["u1"], courseIds: ["R"], items: "participant", knownVisibleCourseIds: ["R"] });
    expect([...known.readSectionIds("u1", "R")]).toEqual(["s1"]);
    // Påmeldt, men avstemmingen sier at deltakeren ikke ser kurset: svaret står, og ingenting slås opp.
    const complete = await findSectionReadCredit(client, { userIds: ["u1"], courseIds: ["R"], items: "participant", knownVisibleCourseIds: [], visibilityComplete: true });
    expect(complete.readSectionIds("u1", "R").size).toBe(0);
    expect(visibilityQueries()).toBe(0);
    // KONTROLL: uten noe kjent slås det opp, og påmeldingen gjelder.
    const looked = await findSectionReadCredit(client, { userIds: ["u1"], courseIds: ["R"], items: "participant" });
    expect([...looked.readSectionIds("u1", "R")]).toEqual(["s1"]);
    expect(visibilityQueries()).toBeGreaterThan(0);

    await expect(findSectionReadCredit(client, { userIds: ["u1", "u2"], courseIds: ["R"], items: "participant", knownVisibleCourseIds: ["R"] })).rejects.toThrow(/exactly one participant/);
    await expect(findSectionReadCredit(client, { courseIds: ["R"], items: "participant", visibilityComplete: true })).rejects.toThrow(/exactly one participant/);
  });

  it("lista: `participant` utelater seksjoner deltakeren ikke kan lese, `all` tar dem med; `onlySectionIds` avgrenser", async () => {
    const { client, itemWheres } = fakeClient({
      courses: [open],
      items: [{ courseId: "A", sectionId: "s1", available: true }, { courseId: "A", sectionId: "arkivert", available: false }],
      reads: [
        { userId: "u1", courseId: "A", sectionId: "s1", readAt: T1 },
        { userId: "u1", courseId: "A", sectionId: "arkivert", readAt: T1 },
      ],
    });
    const participant = await findSectionReadCredit(client, { userIds: ["u1"], courseIds: ["A"], items: "participant" });
    expect([...participant.readSectionIds("u1", "A")]).toEqual(["s1"]);
    expect(itemWheres.at(-1)).toHaveProperty("section");
    const all = await findSectionReadCredit(client, { userIds: ["u1"], courseIds: ["A"], items: "all" });
    expect([...all.readSectionIds("u1", "A")].sort()).toEqual(["arkivert", "s1"]);
    expect(itemWheres.at(-1)).not.toHaveProperty("section");
    const only = await findSectionReadCredit(client, { courseIds: ["A"], items: "all", onlySectionIds: ["arkivert"] });
    expect(only.rows.map((row) => row.sectionId)).toEqual(["arkivert"]);
  });

  it("uten deltakere (rapporten) leses alle, og en tom liste gir ingenting", async () => {
    const { client } = fakeClient({
      courses: [open],
      items: [{ courseId: "A", sectionId: "s1", available: true }],
      reads: [
        { userId: "u1", courseId: "A", sectionId: "s1", readAt: T1 },
        { userId: "u2", courseId: null, sectionId: "s1", readAt: T2 },
      ],
    });
    const everyone = await findSectionReadCredit(client, { courseIds: ["A"], items: "participant" });
    expect([...everyone.readerIds("A")].sort()).toEqual(["u1", "u2"]);
    const none = await findSectionReadCredit(client, { userIds: [], courseIds: ["A"], items: "participant" });
    expect(none.rows).toEqual([]);
  });
});
