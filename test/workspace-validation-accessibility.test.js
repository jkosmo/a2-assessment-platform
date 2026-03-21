import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("workspace validation accessibility", () => {
  it("shared CSS defines hint and validation state classes", () => {
    const css = readFile("public/static/shared.css");

    // Smoke: class names exist — not tied to formatting or brace style
    expect(css).toContain(".hint");
    expect(css).toContain(".field-error");
    expect(css).toContain(".field-warning");
    expect(css).toContain(".field-success");
    expect(css).toContain(".is-invalid");

    // Smoke: hint pseudo-element carries an icon character (ℹ U+2139)
    expect(css).toContain("\\2139");
  });

  it("keeps validation wiring for participant and reviewer validation fields", () => {
    const participantHtml = readFile("public/participant.html");
    // Accessibility: module selection and submission validation must remain wired up
    expect(participantHtml).toContain('aria-describedby="moduleSelectionHint"');
    expect(participantHtml).toContain('id="submissionValidationHint"');

    const appealHandlerHtml = readFile("public/appeal-handler.html");
    expect(appealHandlerHtml).toContain('aria-describedby="resolveValidationMessage"');

    const manualReviewHtml = readFile("public/manual-review.html");
    expect(manualReviewHtml).toContain('aria-describedby="overrideValidationMessage"');
    expect(manualReviewHtml).toContain('id="reviewActionSequenceHint"');
  });

  it("keeps runtime alert and invalid-field hooks for validation errors", () => {
    const participantJs = readFile("public/participant.js");
    // Smoke: CSS class names are referenced — not tied to exact classList API call pattern
    expect(participantJs).toContain("field-error");
    expect(participantJs).toContain("field-success");
    expect(participantJs).toContain("is-invalid");
    expect(participantJs).toContain("alert");

    const appealHandlerJs = readFile("public/appeal-handler.js");
    expect(appealHandlerJs).toContain("field-error");
    expect(appealHandlerJs).toContain("is-invalid");
    expect(appealHandlerJs).toContain("alert");

    const manualReviewJs = readFile("public/manual-review.js");
    expect(manualReviewJs).toContain("field-error");
    expect(manualReviewJs).toContain("is-invalid");
    expect(manualReviewJs).toContain("alert");
    // Contract: reviewer identity functions exist (owns the claim-check logic)
    expect(manualReviewJs).toContain("isSelectedReviewClaimedByCurrentUser");
    expect(manualReviewJs).toContain("getCurrentReviewerEmail");
  });
});
