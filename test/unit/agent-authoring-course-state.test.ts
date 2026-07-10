// AA-6 (#762): unit tests for the a2-authoring-api content-preservation checks.
// Exercises the skill script directly (node stdlib, no DB), mirroring how
// agent-authoring-skill-import.test.ts imports import-package.mjs.

import { describe, expect, it } from "vitest";
import {
  reviewRevision,
  auditExport,
  checkGate6Readiness,
  reductionRatio,
  // @ts-expect-error — .mjs skill script consumed as a library (see import-package.mjs pattern)
} from "../../skills/a2-authoring-api/scripts/course-state.mjs";

// A fully-approved element: repeated explanation + a UNIQUE worked example + a formula + a
// mandatory checklist template, plus assessment criteria.
const approvedElement = {
  clientRef: "modul-avvik",
  type: "module",
  title: "Avvikshåndtering",
  status: "approved",
  content: [
    "Et personvernbrudd er en sikkerhetshendelse som rammer personopplysninger.",
    "Et personvernbrudd er altså en hendelse som går ut over personopplysninger (gjentakelse).",
    "Eksempel: en e-post med 200 kunders fødselsnummer sendes til feil mottaker.",
    "Risikoformel: risiko = sannsynlighet * konsekvens.",
    "Sjekkliste ved brudd: 1) varsle personvernombud, 2) dokumentér hendelsen, 3) vurder melding til Datatilsynet innen 72 timer.",
    "Vurderingskriterium: kandidaten kjenner 72-timersfristen.",
  ].join("\n\n"),
  mandatory: {
    examples: ["en e-post med 200 kunders fødselsnummer sendes til feil mottaker"],
    formulas: ["risiko = sannsynlighet * konsekvens"],
    templates: ["Sjekkliste ved brudd: 1) varsle personvernombud, 2) dokumentér hendelsen, 3) vurder melding til Datatilsynet innen 72 timer"],
    tasks: [],
    assessmentCriteria: ["kandidaten kjenner 72-timersfristen"],
    terms: ["personvernbrudd"],
  },
  deliberatelyRemoved: [],
};

describe("#762 content preservation — reviewRevision (gate 4)", () => {
  it("1. an approved section rewritten as a short summary FAILS", () => {
    const summary = "Avvikshåndtering handler om å varsle raskt ved personvernbrudd.";
    const result = reviewRevision(approvedElement, summary);
    expect(result.blocks).toBe(true);
    expect(result.lostMandatory.length).toBeGreaterThan(0);
    expect(result.reductionRatio).toBeGreaterThan(0.2);
  });

  it("2. removing redundancy while KEEPING the unique example/formula PASSES", () => {
    // Drop only the repeated definition sentence; keep example, formula, checklist, criterion.
    const deduped = [
      "Et personvernbrudd er en sikkerhetshendelse som rammer personopplysninger.",
      "Eksempel: en e-post med 200 kunders fødselsnummer sendes til feil mottaker.",
      "Risikoformel: risiko = sannsynlighet * konsekvens.",
      "Sjekkliste ved brudd: 1) varsle personvernombud, 2) dokumentér hendelsen, 3) vurder melding til Datatilsynet innen 72 timer.",
      "Vurderingskriterium: kandidaten kjenner 72-timersfristen.",
    ].join("\n\n");
    const result = reviewRevision(approvedElement, deduped);
    expect(result.blocks).toBe(false);
    expect(result.lostMandatory).toEqual([]);
    expect(result.reductionRatio).toBeLessThanOrEqual(0.2);
  });

  it("3. a mandatory attachment/template reduced to a bare heading FAILS", () => {
    const gutted = [
      "Et personvernbrudd er en sikkerhetshendelse som rammer personopplysninger.",
      "Eksempel: en e-post med 200 kunders fødselsnummer sendes til feil mottaker.",
      "Risikoformel: risiko = sannsynlighet * konsekvens.",
      "## Sjekkliste ved brudd", // template collapsed to a heading only
      "Vurderingskriterium: kandidaten kjenner 72-timersfristen.",
    ].join("\n\n");
    const result = reviewRevision(approvedElement, gutted);
    expect(result.blocks).toBe(true);
    expect(result.lostMandatory.some((e: { category: string }) => e.category === "templates")).toBe(true);
  });

  it("5. a >20% reduction without approval FAILS; the SAME reduction WITH approval passes", () => {
    // Keep every mandatory item AND the unique term, but drop enough repeated prose to exceed 20%.
    const trimmed = [
      "Et personvernbrudd rammer personopplysninger.",
      "Eksempel: en e-post med 200 kunders fødselsnummer sendes til feil mottaker.",
      "Risikoformel: risiko = sannsynlighet * konsekvens.",
      "Sjekkliste ved brudd: 1) varsle personvernombud, 2) dokumentér hendelsen, 3) vurder melding til Datatilsynet innen 72 timer.",
      "Vurderingskriterium: kandidaten kjenner 72-timersfristen.",
    ].join(" ");
    const withoutApproval = reviewRevision(approvedElement, trimmed);
    expect(withoutApproval.reductionRatio).toBeGreaterThan(0.2);
    expect(withoutApproval.requiresApproval).toBe(true);
    expect(withoutApproval.blocks).toBe(true);
    expect(withoutApproval.lostMandatory).toEqual([]); // mandatory all kept — it is the % that blocks

    const withApproval = reviewRevision(approvedElement, trimmed, { reductionApproved: true });
    expect(withApproval.requiresApproval).toBe(false);
    expect(withApproval.blocks).toBe(false);
  });

  it("content moved into attachments counts as kept (moved, not missing)", () => {
    const mainText = "Et personvernbrudd er en sikkerhetshendelse som rammer personopplysninger.";
    const attachments = [
      "Eksempel: en e-post med 200 kunders fødselsnummer sendes til feil mottaker.",
      "Risikoformel: risiko = sannsynlighet * konsekvens.",
      "Sjekkliste ved brudd: 1) varsle personvernombud, 2) dokumentér hendelsen, 3) vurder melding til Datatilsynet innen 72 timer.",
      "Vurderingskriterium: kandidaten kjenner 72-timersfristen.",
    ].join("\n\n");
    const result = reviewRevision(approvedElement, mainText, { attachmentsText: attachments, reductionApproved: true });
    expect(result.lostMandatory).toEqual([]);
    expect(result.movedCount).toBeGreaterThan(0);
    expect(result.blocks).toBe(false);
  });
});

describe("#762 content preservation — auditExport (before/after export)", () => {
  const master = {
    primaryLanguage: "nb",
    order: ["intro", "modul-avvik"],
    elements: [
      {
        clientRef: "intro",
        type: "section",
        status: "approved",
        content: "Introduksjon til personvern og prinsippene i GDPR artikkel 5.",
        mandatory: { terms: ["GDPR artikkel 5"] },
        deliberatelyRemoved: [],
      },
      approvedElement,
    ],
  };

  it("6. a complete export matching the master PASSES", () => {
    const produced = [
      { ref: "intro", text: JSON.stringify({ title: "Intro", body: master.elements[0].content }) },
      { ref: "modul-avvik", text: JSON.stringify({ payload: approvedElement.content }) },
    ];
    const audit = auditExport(master, produced);
    expect(audit.blocks).toBe(false);
    expect(audit.missingElements).toEqual([]);
    expect(audit.unexpectedlyMissingItems).toEqual([]);
  });

  it("4. a schema-valid export MISSING an approved element FAILS", () => {
    const produced = [
      { ref: "intro", text: JSON.stringify({ title: "Intro", body: master.elements[0].content }) },
      // modul-avvik dropped entirely
    ];
    const audit = auditExport(master, produced);
    expect(audit.blocks).toBe(true);
    expect(audit.missingElements).toContain("modul-avvik");
  });

  it("flags an item silently dropped from an otherwise-present element", () => {
    const produced = [
      { ref: "intro", text: JSON.stringify({ body: master.elements[0].content }) },
      { ref: "modul-avvik", text: JSON.stringify({ body: "Bare en overskrift, alt innhold borte." }) },
    ];
    const audit = auditExport(master, produced);
    expect(audit.blocks).toBe(true);
    expect(audit.unexpectedlyMissingItems.length).toBeGreaterThan(0);
    expect(audit.lostMandatory.length).toBeGreaterThan(0);
  });
});

describe("#762 gate-6 readiness", () => {
  it("blocks when an approved element is not placed in the final order", () => {
    const master = {
      order: ["intro"],
      elements: [
        { clientRef: "intro", status: "approved", content: "x", mandatory: {} },
        { clientRef: "modul-avvik", status: "approved", content: "y", mandatory: {} },
      ],
    };
    const readiness = checkGate6Readiness(master);
    expect(readiness.ready).toBe(false);
    expect(readiness.issues.join(" ")).toContain("modul-avvik");
  });

  it("passes for a complete master in final order", () => {
    const master = {
      order: ["intro", "modul-avvik"],
      elements: [
        { clientRef: "intro", status: "approved", content: "x", mandatory: {} },
        { clientRef: "modul-avvik", status: "approved", content: "y", mandatory: {} },
      ],
    };
    expect(checkGate6Readiness(master).ready).toBe(true);
  });
});

describe("#762 reductionRatio helper", () => {
  it("returns 0 when nothing is removed and ~1 when everything is", () => {
    expect(reductionRatio("abcdefghij", "abcdefghij")).toBe(0);
    expect(reductionRatio("abcdefghij", "")).toBeCloseTo(1, 5);
    expect(reductionRatio("abcdefghij", "abcde")).toBeCloseTo(0.5, 5);
  });
});
