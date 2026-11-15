import { describe, expect, it } from "vitest";
import { classifyMcqResume, resumableMcqDraft } from "../../public/participant-console-state.js";

// #1160: kan flervalgsforsøket i kladden fortsettes? Selve fortsettelsen (serveren spørres, avkrysningene settes inn igjen)
// prøves i test/e2e/participant-mcq-resume-1160-1161.spec.ts.

const draftWith = (mcq) => ({ updatedAt: "2026-11-15T08:00:00.000Z", mcq });
const MCQ = {
  attemptId: "a1",
  submissionId: "s1",
  moduleVersionId: "mv-2",
  questions: [{ id: "q1", stem: "?", options: ["A", "B"] }],
  responses: { q1: "B" },
};

describe("#1160 resumableMcqDraft", () => {
  it("forsøket, innleveringen og versjonen er kjent, og versjonen er den modulen har nå: fortsett", () => {
    expect(resumableMcqDraft(draftWith(MCQ), { moduleVersionId: "mv-2" })).toEqual({
      submissionId: "s1",
      attemptId: "a1",
      moduleVersionId: "mv-2",
      responses: { q1: "B" },
      locale: null,
    });
  });

  it("språket spørsmålene ble hentet på, følger med (avkrysningene er alternativenes tekst)", () => {
    expect(resumableMcqDraft(draftWith({ ...MCQ, locale: "nb" }), { moduleVersionId: "mv-2" })?.locale).toBe("nb");
    // En kladd uten språk (lagret før QA-rettelsen) leses som før.
    expect(resumableMcqDraft(draftWith(MCQ), { moduleVersionId: "mv-2" })?.locale).toBeNull();
  });

  it("modulen har fått en ny versjon: ikke fortsett (spørsmålene kan være andre)", () => {
    expect(resumableMcqDraft(draftWith(MCQ), { moduleVersionId: "mv-3" })).toBeNull();
  });

  it("modulen har ingen kjent versjon: ikke fortsett", () => {
    expect(resumableMcqDraft(draftWith(MCQ), {})).toBeNull();
  });

  it("en kladd fra før #1160 (uten innlevering og versjon) fortsettes ikke", () => {
    const old = { attemptId: "a1", questions: MCQ.questions, responses: { q1: "B" } };
    expect(resumableMcqDraft(draftWith(old), { moduleVersionId: "mv-2" })).toBeNull();
  });

  it("uten forsøk eller innlevering: ingenting å fortsette", () => {
    expect(resumableMcqDraft(draftWith({ ...MCQ, attemptId: "-" }), { moduleVersionId: "mv-2" })).toBeNull();
    expect(resumableMcqDraft(draftWith({ ...MCQ, submissionId: null }), { moduleVersionId: "mv-2" })).toBeNull();
    expect(resumableMcqDraft(draftWith(null), { moduleVersionId: "mv-2" })).toBeNull();
    expect(resumableMcqDraft(undefined, { moduleVersionId: "mv-2" })).toBeNull();
  });

  it("et påbegynt forsøk uten avkrysninger fortsetter også, så åpning ikke lager en ny innlevering hver gang", () => {
    expect(resumableMcqDraft(draftWith({ ...MCQ, responses: {} }), { moduleVersionId: "mv-2" }))
      .toMatchObject({ attemptId: "a1", responses: {} });
  });

  it("«velg alle» og rekkefølge følger med som lister", () => {
    const responses = { q1: ["A", "B"], q2: ["x", "y", "z"], q3: "ordet" };
    expect(resumableMcqDraft(draftWith({ ...MCQ, responses }), { moduleVersionId: "mv-2" })?.responses).toEqual(responses);
  });
});

// QA-porten 2.164.0: en feil som kan gå over, skal ikke koste svarene. Bare et endelig nei glemmer kladden.
describe("#1160 classifyMcqResume", () => {
  const body = { attemptId: "a1", questions: [{ id: "q1" }] };

  it("samme forsøk tilbake: fortsett", () => {
    expect(classifyMcqResume({ ok: true, body }, "a1")).toBe("resume");
  });

  it("et annet forsøk, eller et svar uten spørsmål: glem", () => {
    expect(classifyMcqResume({ ok: true, body: { ...body, attemptId: "a2" } }, "a1")).toBe("forget");
    expect(classifyMcqResume({ ok: true, body: { attemptId: "a1" } }, "a1")).toBe("forget");
  });

  it("de endelige avslagene fra tjeneren (404 en annens/ingen innlevering, 409 levert, 400 feil form): glem", () => {
    for (const status of [400, 404, 409]) expect(classifyMcqResume({ ok: false, status }, "a1"), String(status)).toBe("forget");
  });

  it("alt annet kan gå over: behold svarene og prøv igjen", () => {
    for (const status of [null, 401, 403, 408, 429, 500, 502, 503, 504]) {
      expect(classifyMcqResume({ ok: false, status }, "a1"), String(status)).toBe("retry");
    }
  });
});
