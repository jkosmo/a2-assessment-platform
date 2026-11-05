import { describe, expect, it } from "vitest";
import {
  findVersionsStartingMajor,
  numberModuleVersions,
  type NumberingVersion,
  type RevisionTrailEvent,
} from "../../src/modules/adminContent/moduleVersioning.js";
import { passCountsForCourse } from "../../src/modules/course/moduleCredit.js";
import { computeModulePasses, latestDecisionOf, type PassDecision, type PassSubmission } from "../../src/modules/course/moduleCreditBackfill.js";
import { classifyCreditDifference, EXPECTED_REASONS, type CreditFacts } from "../../src/modules/course/moduleCreditComparison.js";

// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): nummereringen, beståttene og årsakene i rapporten, som rene funksjoner.

const at = (day: number) => new Date(Date.UTC(2026, 0, day));

function version(no: number, over: Partial<NumberingVersion> = {}): NumberingVersion {
  return { id: `v${no}`, versionNo: no, publishedAt: at(no), createdAt: at(no), versionMajor: null, versionMinor: null, live: true, ...over };
}
const number = (map: Map<string, { major: number; minor: number }>, id: string) => {
  const n = map.get(id);
  return n ? `${n.major}.${n.minor}` : undefined;
};

describe("numberModuleVersions: nummer på historikken", () => {
  it("første versjon er 1.0, og de neste er mindre, i publiseringsrekkefølge", () => {
    const out = numberModuleVersions([version(3), version(1), version(2)], new Set());
    expect([number(out, "v1"), number(out, "v2"), number(out, "v3")]).toEqual(["1.0", "1.1", "1.2"]);
  });

  it("en revisjon starter en ny hovedversjon, og teller mindre videre fra den", () => {
    const out = numberModuleVersions([version(1), version(2), version(3), version(4)], new Set(["v3"]));
    expect([number(out, "v1"), number(out, "v2"), number(out, "v3"), number(out, "v4")]).toEqual(["1.0", "1.1", "2.0", "2.1"]);
  });

  it("den første versjonen er 1.0 også om den står som revisjon: det var ingen å ta noe fra", () => {
    expect(number(numberModuleVersions([version(1)], new Set(["v1"])), "v1")).toBe("1.0");
  });

  it("rekkefølgen er publiseringen, ikke løpenummeret: et gammelt utkast publisert sist får det siste nummeret", () => {
    const out = numberModuleVersions([version(1, { publishedAt: at(9) }), version(2, { publishedAt: at(1) })], new Set());
    expect([number(out, "v2"), number(out, "v1")]).toEqual(["1.0", "1.1"]);
  });

  it("et utkast får ikke nummer", () => {
    const out = numberModuleVersions([version(1), version(2, { live: false, publishedAt: null })], new Set());
    expect(out.has("v2")).toBe(false);
  });

  it("en versjon som er ute uten publiseringstid (gamle rader), plasseres etter når den ble laget", () => {
    const out = numberModuleVersions([version(1, { publishedAt: null, createdAt: at(1) }), version(2)], new Set());
    expect([number(out, "v1"), number(out, "v2")]).toEqual(["1.0", "1.1"]);
  });

  it("en versjon som har nummer, beholder det, og de neste bygger på det", () => {
    const out = numberModuleVersions(
      [version(1, { versionMajor: 3, versionMinor: 2 }), version(2), version(3)],
      new Set(["v3"]),
    );
    expect(out.has("v1")).toBe(false);
    expect([number(out, "v2"), number(out, "v3")]).toEqual(["3.3", "4.0"]);
  });

  it("en ny kjøring gjør ingenting: alt har nummer", () => {
    const first = numberModuleVersions([version(1), version(2)], new Set(["v2"]));
    const numbered = [version(1), version(2)].map((v) => {
      const n = first.get(v.id)!;
      return { ...v, versionMajor: n.major, versionMinor: n.minor };
    });
    expect(numberModuleVersions(numbered, new Set(["v2"])).size).toBe(0);
  });

  it("gammel kode har publisert midt i: hullet fylles uten å kollidere med et nummer som er gitt", () => {
    // v2 ble publisert av gammel kode etter at v3 hadde fått 1.1 (bare mulig med rader uten publiseringstid). 1.1 er tatt.
    const out = numberModuleVersions(
      [version(1, { versionMajor: 1, versionMinor: 0 }), version(2), version(3, { versionMajor: 1, versionMinor: 1 })],
      new Set(),
    );
    expect(number(out, "v2")).toBe("1.2");
  });

  it("en revisjon i et hull får en hovedversjon som er ledig", () => {
    const out = numberModuleVersions(
      [version(1, { versionMajor: 1, versionMinor: 0 }), version(2), version(3, { versionMajor: 2, versionMinor: 0 })],
      new Set(["v2"]),
    );
    expect(number(out, "v2")).toBe("3.0");
  });
});

const published = (versionId: string, seq: number): RevisionTrailEvent => ({ action: "module_version_published", chainSeq: BigInt(seq), versionId, supersededCount: null });
const revision = (versionId: string, seq: number, supersededCount: number): RevisionTrailEvent => ({ action: "module_passes_superseded", chainSeq: BigInt(seq), versionId, supersededCount });

describe("findVersionsStartingMajor: hvilke versjoner startet en ny hovedversjon", () => {
  it("en revisjon med beståtte, der versjonen ble publisert for første gang i samme slengen", () => {
    // Revisjonen skrives før publiseringen i samme transaksjon (adminContentCommands.ts).
    expect([...findVersionsStartingMajor([published("v1", 1), revision("v2", 2, 3), published("v2", 3)], [])]).toEqual(["v2"]);
  });

  it("en revisjon uten beståtte blir mindre: den rørte ingen", () => {
    expect(findVersionsStartingMajor([revision("v2", 2, 0), published("v2", 3)], []).size).toBe(0);
  });

  it("revisjon på samme versjon: den var nummerert fra før, så ingen ny hovedversjon", () => {
    expect(findVersionsStartingMajor([published("v1", 1), revision("v1", 2, 4), published("v1", 3)], ["v1"]).size).toBe(0);
  });

  it("en versjon som ble aktivert på nytt med revisjon: samme svar", () => {
    const trail = [published("v1", 1), published("v2", 2), revision("v1", 3, 2), published("v1", 4)];
    expect(findVersionsStartingMajor(trail, ["v1"]).size).toBe(0);
  });

  it("bare `supersededByVersionId`, uten rad i sporet: regnes som ny hovedversjon", () => {
    expect([...findVersionsStartingMajor([], ["v5"])]).toEqual(["v5"]);
  });

  it("raden i sporet avgjør også når statusraden peker på versjonen", () => {
    expect([...findVersionsStartingMajor([revision("v2", 2, 3), published("v2", 3)], ["v2"])]).toEqual(["v2"]);
  });
});

function decision(id: string, over: Partial<PassDecision> = {}): PassDecision {
  return { id, moduleVersionId: "v1", passFailTotal: true, decisionType: "AUTOMATIC", finalisedAt: at(2), createdAt: at(2), parentDecisionId: null, ...over };
}
function submission(id: string, decisions: PassDecision[], over: Partial<PassSubmission> = {}): PassSubmission {
  return { id, moduleId: "m", submissionStatus: "COMPLETED", hasManualReview: false, decisions, ...over };
}
const compute = (submissions: PassSubmission[], status?: { status: "ACTIVE" | "DUE" | "EXPIRED" | "SUPERSEDED" | "NOT_CERTIFIED"; updatedAt: Date }, revisionAt?: Date) =>
  computeModulePasses({
    submissions,
    statusByModule: new Map(status ? [["m", status]] : []),
    latestRevisionAtByModule: new Map(revisionAt ? [["m", revisionAt]] : []),
  });

describe("computeModulePasses: siste vedtak per innlevering", () => {
  it("et bestått vedtak gir én rad, med versjonen fra vedtaket", () => {
    const rows = compute([submission("s", [decision("d", { moduleVersionId: "vX" })])]);
    expect(rows).toEqual([{ submissionId: "s", moduleId: "m", decisionId: "d", moduleVersionId: "vX", passedAt: at(2), invalidatedAt: null }]);
  });

  it("en innlevering uten vedtak gir ingen rad", () => {
    expect(compute([submission("s", [])])).toEqual([]);
  });

  it("stryk gir ingen rad", () => {
    expect(compute([submission("s", [decision("d", { passFailTotal: false })])])).toEqual([]);
  });

  it("en anke som snur en bestått: det siste vedtaket avgjør, og slektskapet går foran tidspunktet", () => {
    const parent = decision("d1", { finalisedAt: at(5), createdAt: at(5) });
    const child = decision("d2", { passFailTotal: false, parentDecisionId: "d1", decisionType: "APPEAL_RESOLUTION", finalisedAt: at(5), createdAt: at(5) });
    expect(compute([submission("s", [parent, child])])).toEqual([]);
    expect(latestDecisionOf([child, parent])?.id).toBe("d2");
    expect(latestDecisionOf([decision("a", { finalisedAt: at(1) }), decision("b", { finalisedAt: at(3) })])?.id).toBe("b");
  });

  it("et automatisk vedtak sendt til manuell vurdering teller ikke, selv om det sier bestått", () => {
    expect(compute([submission("s", [decision("d")], { hasManualReview: true, submissionStatus: "UNDER_REVIEW" })])).toEqual([]);
  });

  it("sensorens vedtak over det teller", () => {
    const rows = compute([
      submission("s", [decision("d1"), decision("d2", { decisionType: "MANUAL_OVERRIDE", parentDecisionId: "d1", finalisedAt: at(3) })], { hasManualReview: true }),
    ]);
    expect(rows.map((r) => r.decisionId)).toEqual(["d2"]);
  });

  it("en åpen anke på en bestått: beståtten står (innleveringen er UNDER_REVIEW, men gammel status sier bestått)", () => {
    expect(compute([submission("s", [decision("d")], { submissionStatus: "UNDER_REVIEW" })])).toHaveLength(1);
  });

  it("et forlatt forsøk (#951) er ikke et utfall", () => {
    expect(compute([submission("s", [decision("d")], { submissionStatus: "SUPERSEDED" })])).toEqual([]);
    expect(compute([submission("s", [decision("d")], { submissionStatus: "REJECTED" })])).toEqual([]);
  });

  it("vedtaket fattet før revisjonen ifølge sporet: ugyldiggjort, også på samme versjon", () => {
    const rows = compute([submission("s", [decision("d", { finalisedAt: at(2) })])], { status: "ACTIVE", updatedAt: at(9) }, at(3));
    expect(rows[0]?.invalidatedAt).toEqual(at(3));
  });

  it("vedtaket fattet etter revisjonen: ikke ugyldiggjort", () => {
    const rows = compute([submission("s", [decision("d", { finalisedAt: at(4) })])], { status: "ACTIVE", updatedAt: at(9) }, at(3));
    expect(rows[0]?.invalidatedAt).toBeNull();
  });

  it("raden står fortsatt som SUPERSEDED: ugyldiggjort, også uten spor", () => {
    const rows = compute([submission("s", [decision("d")])], { status: "SUPERSEDED", updatedAt: at(7) });
    expect(rows[0]?.invalidatedAt).toEqual(at(7));
  });

  it.each(["DUE", "EXPIRED"] as const)("gammel status %s er bestått, og raden står uten ugyldiggjøring", (status) => {
    const rows = compute([submission("s", [decision("d")])], { status, updatedAt: at(7) });
    expect(rows[0]?.invalidatedAt).toBeNull();
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

function facts(over: Partial<CreditFacts>): CreditFacts {
  return { oldCredit: false, status: null, requirement: 1, latestRevisionAt: undefined, latestDecisionFailedOnOtherSubmission: false, overturnedOnSameSubmission: false, passes: [], ...over };
}

describe("classifyCreditDifference: årsakene", () => {
  it("et nytt forsøk som strøk etter bestått: forventet", () => {
    const reason = classifyCreditDifference(facts({ status: "NOT_CERTIFIED", latestDecisionFailedOnOtherSubmission: true }));
    expect(reason).toBe("retake_failed_after_pass");
    expect(EXPECTED_REASONS.has(reason)).toBe(true);
  });

  it("en bestått på en gammel versjon, vurdert etter revisjonen: forventet", () => {
    const reason = classifyCreditDifference(facts({ oldCredit: true, status: "ACTIVE", requirement: 2, latestRevisionAt: at(3), passes: [{ versionMajor: 1, invalidatedAt: null, passedAt: at(4) }] }));
    expect(reason).toBe("pass_on_old_version_after_revision");
    expect(EXPECTED_REASONS.has(reason)).toBe(true);
  });

  it("samme, men vedtaket er fra før revisjonen: ikke forklart av den årsaken", () => {
    expect(classifyCreditDifference(facts({ oldCredit: true, status: "ACTIVE", requirement: 2, latestRevisionAt: at(3), passes: [{ versionMajor: 1, invalidatedAt: null, passedAt: at(2) }] }))).toBe("unexplained");
  });

  it.each([
    ["superseded_pass_counts_again", facts({ status: "SUPERSEDED" })],
    ["unexplained", facts({ status: null })],
    ["unexplained", facts({ status: "NOT_CERTIFIED", latestDecisionFailedOnOtherSubmission: false })],
    ["missing_requirement", facts({ oldCredit: true, status: "ACTIVE", requirement: undefined })],
    ["overturned_pass_kept_by_old_rule", facts({ oldCredit: true, status: "ACTIVE", overturnedOnSameSubmission: true })],
    ["pass_on_unnumbered_version", facts({ oldCredit: true, status: "ACTIVE", passes: [{ versionMajor: null, invalidatedAt: null, passedAt: at(4) }] })],
    ["invalidated_but_old_rule_counts", facts({ oldCredit: true, status: "ACTIVE", passes: [{ versionMajor: 1, invalidatedAt: at(4), passedAt: at(2) }] })],
    ["unexplained", facts({ oldCredit: true, status: "ACTIVE" })],
  ])("%s er ikke forventet", (reason, input) => {
    expect(classifyCreditDifference(input)).toBe(reason);
    expect(EXPECTED_REASONS.has(reason as never)).toBe(false);
  });
});
