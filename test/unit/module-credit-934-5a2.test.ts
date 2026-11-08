import { describe, expect, it } from "vitest";
import {
  findVersionsStartingMajor,
  numberModuleVersions,
  type NumberingVersion,
  type RevisionTrailEvent,
} from "../../src/modules/adminContent/moduleVersioning.js";
import { passCountsForCourse } from "../../src/modules/course/moduleCredit.js";

// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): nummereringen og regelen, som rene funksjoner. Tilbakefyllingen og
// sammenligningsrapporten er fjernet 2026-11-08, med testene sine: de gjaldt bare med bryteren av.

const at = (day: number) => new Date(Date.UTC(2026, 0, day));

function version(no: number, over: Partial<NumberingVersion> = {}): NumberingVersion {
  return { id: `v${no}`, versionNo: no, publishedAt: at(no), createdAt: at(no), versionMajor: null, versionMinor: null, live: true, ...over };
}
const number = (map: Map<string, { major: number; minor: number }>, id: string) => {
  const n = map.get(id);
  return n ? `${n.major}.${n.minor}` : undefined;
};
/** Versjoner som ble revidert, uten tidspunkt: de står der de ble publisert. */
const revised = (...ids: string[]) => new Map<string, Date | null>(ids.map((id) => [id, null]));

describe("numberModuleVersions: nummer på historikken", () => {
  it("første versjon er 1.0, og de neste er mindre, i publiseringsrekkefølge", () => {
    const out = numberModuleVersions([version(3), version(1), version(2)], revised());
    expect([number(out, "v1"), number(out, "v2"), number(out, "v3")]).toEqual(["1.0", "1.1", "1.2"]);
  });

  it("en revisjon starter en ny hovedversjon, og teller mindre videre fra den", () => {
    const out = numberModuleVersions([version(1), version(2), version(3), version(4)], revised("v3"));
    expect([number(out, "v1"), number(out, "v2"), number(out, "v3"), number(out, "v4")]).toEqual(["1.0", "1.1", "2.0", "2.1"]);
  });

  it("den første versjonen er 1.0 også om den står som revisjon: det var ingen å ta noe fra", () => {
    expect(number(numberModuleVersions([version(1)], revised("v1")), "v1")).toBe("1.0");
  });

  it("rekkefølgen er publiseringen, ikke løpenummeret: et gammelt utkast publisert sist får det siste nummeret", () => {
    const out = numberModuleVersions([version(1, { publishedAt: at(9) }), version(2, { publishedAt: at(1) })], revised());
    expect([number(out, "v2"), number(out, "v1")]).toEqual(["1.0", "1.1"]);
  });

  it("et utkast får ikke nummer", () => {
    const out = numberModuleVersions([version(1), version(2, { live: false, publishedAt: null })], revised());
    expect(out.has("v2")).toBe(false);
  });

  it("en versjon som er ute uten publiseringstid (gamle rader), plasseres etter når den ble laget", () => {
    const out = numberModuleVersions([version(1, { publishedAt: null, createdAt: at(1) }), version(2)], revised());
    expect([number(out, "v1"), number(out, "v2")]).toEqual(["1.0", "1.1"]);
  });

  it("en versjon som har nummer, beholder det, og de neste bygger på det", () => {
    const out = numberModuleVersions(
      [version(1, { versionMajor: 3, versionMinor: 2 }), version(2), version(3)],
      revised("v3"),
    );
    expect(out.has("v1")).toBe(false);
    expect([number(out, "v2"), number(out, "v3")]).toEqual(["3.3", "4.0"]);
  });

  it("en ny kjøring gjør ingenting: alt har nummer", () => {
    const first = numberModuleVersions([version(1), version(2)], revised("v2"));
    const numbered = [version(1), version(2)].map((v) => {
      const n = first.get(v.id)!;
      return { ...v, versionMajor: n.major, versionMinor: n.minor };
    });
    expect(numberModuleVersions(numbered, revised("v2")).size).toBe(0);
  });

  it("gammel kode har publisert midt i: hullet fylles uten å kollidere med et nummer som er gitt", () => {
    // v2 ble publisert av gammel kode etter at v3 hadde fått 1.1 (bare mulig med rader uten publiseringstid). 1.1 er tatt.
    const out = numberModuleVersions(
      [version(1, { versionMajor: 1, versionMinor: 0 }), version(2), version(3, { versionMajor: 1, versionMinor: 1 })],
      revised(),
    );
    expect(number(out, "v2")).toBe("1.2");
  });

  it("en revisjon i et hull får en hovedversjon som er ledig", () => {
    const out = numberModuleVersions(
      [version(1, { versionMajor: 1, versionMinor: 0 }), version(2), version(3, { versionMajor: 2, versionMinor: 0 })],
      revised("v2"),
    );
    expect(number(out, "v2")).toBe("3.0");
  });

  it("revisjon på en versjon som alt var ute: ny hovedversjon, og de eldre ligger under den", () => {
    const out = numberModuleVersions([version(1), version(2)], new Map([["v2", at(5)]]));
    expect([number(out, "v1"), number(out, "v2")]).toEqual(["1.0", "2.0"]);
  });

  it("en eldre versjon aktivert på nytt med revisjon: plassert der revisjonen skjedde, så den den tok over for, ligger under", () => {
    const out = numberModuleVersions([version(1), version(2)], new Map([["v1", at(5)]]));
    expect([number(out, "v2"), number(out, "v1")]).toEqual(["1.0", "2.0"]);
  });

  it("en versjon publisert etter revisjonen kommer etter den", () => {
    const out = numberModuleVersions([version(1), version(2), version(4)], new Map([["v2", at(3)]]));
    expect([number(out, "v1"), number(out, "v2"), number(out, "v4")]).toEqual(["1.0", "2.0", "2.1"]);
  });

  it("en versjon som alt har nummer, får ikke ny hovedversjon av en revisjon: et nummer som er gitt, endres ikke", () => {
    const out = numberModuleVersions([version(1, { versionMajor: 1, versionMinor: 0 }), version(2, { versionMajor: 1, versionMinor: 1 })], new Map([["v2", at(5)]]));
    expect(out.size).toBe(0);
  });
});

const revision = (versionId: string, day: number, supersededCount: number): RevisionTrailEvent => ({ at: at(day), versionId, supersededCount });

describe("findVersionsStartingMajor: hvilke versjoner startet en ny hovedversjon", () => {
  it("en revisjon med beståtte, med tidspunktet", () => {
    expect([...findVersionsStartingMajor([revision("v2", 2, 3)], [])]).toEqual([["v2", at(2)]]);
  });

  it("en revisjon uten beståtte blir mindre: den rørte ingen", () => {
    expect(findVersionsStartingMajor([revision("v2", 2, 0)], []).size).toBe(0);
  });

  it("revidert flere ganger: den siste revisjonen avgjør, uansett rekkefølge i sporet", () => {
    expect(findVersionsStartingMajor([revision("v1", 9, 1), revision("v1", 3, 2)], []).get("v1")).toEqual(at(9));
    expect(findVersionsStartingMajor([revision("v1", 3, 2), revision("v1", 9, 1)], []).get("v1")).toEqual(at(9));
  });

  it("bare `supersededByVersionId`, uten rad i sporet: regnes som ny hovedversjon, uten tidspunkt", () => {
    expect([...findVersionsStartingMajor([], ["v5"])]).toEqual([["v5", null]]);
  });

  it("en rad med beståtte gir tidspunktet også når statusraden peker på versjonen", () => {
    expect([...findVersionsStartingMajor([revision("v2", 2, 3)], ["v2"])]).toEqual([["v2", at(2)]]);
  });

  it("en rad med null beståtte skjuler ikke at statusraden peker på versjonen: noen mistet en bestått", () => {
    expect([...findVersionsStartingMajor([revision("v2", 2, 0)], ["v2"])]).toEqual([["v2", null]]);
  });
});

describe("passCountsForCourse: regelen", () => {
  it.each([
    [{ invalidatedAt: null, versionMajor: 2 }, 2, true],
    [{ invalidatedAt: null, versionMajor: 3 }, 2, true],
    [{ invalidatedAt: null, versionMajor: 1 }, 2, false],
    [{ invalidatedAt: at(1), versionMajor: 2 }, 1, false],
    [{ invalidatedAt: null, versionMajor: null }, 1, false],
    [{ invalidatedAt: null, versionMajor: 1 }, undefined, false],
  ])("%j mot krav %s → %s", (pass, requirement, expected) => {
    expect(passCountsForCourse(pass, requirement)).toBe(expected);
  });
});
