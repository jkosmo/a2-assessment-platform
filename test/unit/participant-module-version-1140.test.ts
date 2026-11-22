import { beforeEach, describe, expect, it, vi } from "vitest";

// #1140 etappe 1: regelen for hvilken hovedversjon en deltaker får, uten database. Gjennom rutene: m2-participant-module-version-1140.

// Etterligningene løftes over importen (vi.hoisted), så fila kan importeres statisk: ingen lasting av src/ inne i en test (#994).
const { findShownModuleMajors, findAccessibleCoursesContainingModules, filterPublishedCoursesContainingModule } = vi.hoisted(() => ({
  findShownModuleMajors: vi.fn(),
  findAccessibleCoursesContainingModules: vi.fn(),
  filterPublishedCoursesContainingModule: vi.fn(),
}));

vi.mock("../../src/db/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/modules/adminContent/moduleVersioning.js", () => ({ findShownModuleMajors }));
vi.mock("../../src/modules/course/enrollmentService.js", () => ({ findAccessibleCoursesContainingModules, filterPublishedCoursesContainingModule }));
vi.mock("../../src/repositories/moduleRepository.js", () => ({ moduleSummarySelect: { activeVersion: { select: { id: true } } } }));

import { highestShownMajors, narrowToOpenedCourse, resolveShownMajors, prepareShownMajorScope, findShownVersion } from "../../src/modules/module/participantModuleVersion.js";

const lock = (courseId: string, moduleId: string, shownModuleMajor: number) => ({ courseId, moduleId, shownModuleMajor });
const reader = { userId: "u1", roles: [] };

beforeEach(() => {
  findShownModuleMajors.mockReset();
  findAccessibleCoursesContainingModules.mockReset();
  filterPublishedCoursesContainingModule.mockReset();
});

describe("#1140: highestShownMajors", () => {
  it("ett tilgjengelig kurs med lås: kursets hovedversjon", () => {
    expect(highestShownMajors(new Map([["m", ["a"]]]), [lock("a", "m", 1)])).toEqual(new Map([["m", 1]]));
  });

  it("flere tilgjengelige kurs med lås: den høyeste, uansett rekkefølge", () => {
    expect(highestShownMajors(new Map([["m", ["a", "b", "c"]]]), [lock("a", "m", 2), lock("b", "m", 3), lock("c", "m", 1)]).get("m")).toBe(3);
    expect(highestShownMajors(new Map([["m", ["c", "b", "a"]]]), [lock("a", "m", 2), lock("b", "m", 3), lock("c", "m", 1)]).get("m")).toBe(3);
  });

  it("et tilgjengelig kurs uten lås følger nyeste: modulen er ikke med i svaret", () => {
    expect(highestShownMajors(new Map([["m", ["a", "b"]]]), [lock("a", "m", 1)]).has("m")).toBe(false);
    expect(highestShownMajors(new Map([["m", ["b", "a"]]]), [lock("a", "m", 1)]).has("m")).toBe(false);
  });

  it("en lås i et kurs deltakeren ikke har tilgang til, teller ikke", () => {
    expect(highestShownMajors(new Map([["m", ["a"]]]), [lock("a", "m", 1), lock("utenfor", "m", 5)]).get("m")).toBe(1);
    expect(highestShownMajors(new Map(), [lock("utenfor", "m", 5)]).size).toBe(0);
    expect(highestShownMajors(new Map([["m", []]]), [lock("utenfor", "m", 5)]).size).toBe(0);
  });

  it("låsen gjelder modulen den står på, ikke en annen modul i samme kurs", () => {
    const out = highestShownMajors(new Map([["m", ["a"]], ["n", ["a"]]]), [lock("a", "m", 1)]);
    expect(out.get("m")).toBe(1);
    expect(out.has("n")).toBe(false);
  });
});

describe("#1140: narrowToOpenedCourse — kurset modulen åpnes fra, bestemmer", () => {
  const accessible = () => new Map([["m", ["a", "b"]], ["n", ["b"]]]);

  it("leseren har modulen i kurset: bare det kurset teller for modulen", () => {
    expect(narrowToOpenedCourse(accessible(), "a")).toEqual(new Map([["m", ["a"]], ["n", ["b"]]]));
    expect(narrowToOpenedCourse(accessible(), "b")).toEqual(new Map([["m", ["b"]], ["n", ["b"]]]));
  });

  it("kurset er ikke blant dem leseren har modulen i (ingen tilgang, eller modulen ligger ikke der): reserven, alle kursene", () => {
    expect(narrowToOpenedCourse(accessible(), "utenfor")).toEqual(accessible());
  });

  it("uten kurs: reserven, alle kursene", () => {
    expect(narrowToOpenedCourse(accessible(), undefined)).toEqual(accessible());
    expect(narrowToOpenedCourse(accessible(), null)).toEqual(accessible());
    expect(narrowToOpenedCourse(accessible(), "")).toEqual(accessible());
  });

  it("sammen med regelen: kurset på 1 gir 1 selv om et annet tilgjengelig kurs står på 2 eller følger nyeste", () => {
    const locks = [lock("a", "m", 1), lock("b", "m", 2)];
    expect(highestShownMajors(narrowToOpenedCourse(new Map([["m", ["a", "b"]]]), "a"), locks).get("m")).toBe(1);
    expect(highestShownMajors(narrowToOpenedCourse(new Map([["m", ["a", "b"]]]), "b"), locks).get("m")).toBe(2);
    expect(highestShownMajors(narrowToOpenedCourse(new Map([["m", ["a", "b"]]]), undefined), locks).get("m")).toBe(2);
    // Kurset uten lås følger nyeste — også når et annet tilgjengelig kurs har låst en eldre.
    expect(highestShownMajors(narrowToOpenedCourse(new Map([["m", ["a", "ulåst"]]]), "ulåst"), [lock("a", "m", 1)]).has("m")).toBe(false);
    expect(highestShownMajors(narrowToOpenedCourse(new Map([["m", ["a", "ulåst"]]]), "a"), [lock("a", "m", 1)]).get("m")).toBe(1);
  });
});

describe("#1140: resolveShownMajors og prepareShownMajorScope", () => {
  it("kurset modulen åpnes fra, sendes gjennom: lista og forberedelsen snevrer inn til det", async () => {
    findShownModuleMajors.mockResolvedValue([lock("a", "m", 1), lock("b", "m", 2)]);
    findAccessibleCoursesContainingModules.mockResolvedValue(new Map([["m", ["a", "b"]]]));
    expect((await resolveShownMajors(reader, ["m"], "a")).get("m")).toBe(1);
    expect((await resolveShownMajors(reader, ["m"])).get("m")).toBe(2);
    expect(await prepareShownMajorScope(reader, "m", "a")).toEqual(["a"]);
    expect(await prepareShownMajorScope(reader, "m", "utenfor")).toEqual(["a", "b"]);
    expect(await prepareShownMajorScope(reader, "m")).toEqual(["a", "b"]);
  });

  it("hurtigveien: ingen kurs har låst noe, og tilgangen regnes aldri ut", async () => {
    findShownModuleMajors.mockResolvedValue([]);
    expect((await resolveShownMajors(reader, ["m", "n"])).size).toBe(0);
    expect(await prepareShownMajorScope(reader, "m")).toBeNull();
    expect(findAccessibleCoursesContainingModules).not.toHaveBeenCalled();
  });

  it("med låser: tilgangen regnes ut bare for modulene som har en lås", async () => {
    findShownModuleMajors.mockResolvedValue([lock("a", "m", 1)]);
    findAccessibleCoursesContainingModules.mockResolvedValue(new Map([["m", ["a"]]]));
    expect(await resolveShownMajors(reader, ["m", "n"])).toEqual(new Map([["m", 1]]));
    expect(findAccessibleCoursesContainingModules).toHaveBeenCalledWith({ ...reader, moduleIds: ["m"] });
  });

  it("forberedelsen gir kursene deltakeren har modulen i, og en tom liste når hen ikke har noen", async () => {
    findShownModuleMajors.mockResolvedValue([lock("a", "m", 1)]);
    findAccessibleCoursesContainingModules.mockResolvedValue(new Map([["m", ["a", "b"]]]));
    expect(await prepareShownMajorScope(reader, "m")).toEqual(["a", "b"]);
    findAccessibleCoursesContainingModules.mockResolvedValue(new Map());
    expect(await prepareShownMajorScope(reader, "m")).toEqual([]);
  });
});

describe("#1140: findShownVersion", () => {
  const findFirst = vi.fn();
  const client = { moduleVersion: { findFirst } } as never;
  const active = { id: "aktiv", versionMajor: 2 };
  beforeEach(() => findFirst.mockReset());

  it("ingen lås, eller låsen er den aktives hovedversjon: den aktive, uten oppslag", async () => {
    expect(await findShownVersion(client, "m", null, active, { id: true })).toBe(active);
    expect(await findShownVersion(client, "m", 2, active, { id: true })).toBe(active);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("eldre hovedversjon: den publiserte med høyest mindre nummer", async () => {
    findFirst.mockResolvedValue({ id: "eldre" });
    expect(await findShownVersion(client, "m", 1, active, { id: true })).toEqual({ id: "eldre" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { moduleId: "m", versionMajor: 1, publishedAt: { not: null } },
      orderBy: { versionMinor: "desc" },
      select: { id: true },
    });
  });

  it("ingen publisert versjon med den hovedversjonen: den aktive", async () => {
    findFirst.mockResolvedValue(null);
    expect(await findShownVersion(client, "m", 7, active, { id: true })).toBe(active);
  });

  it("modulen har ingen aktiv versjon: ingen versjon, uten oppslag", async () => {
    expect(await findShownVersion(client, "m", 1, null, { id: true })).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
