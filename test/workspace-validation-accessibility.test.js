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

    const reviewHtml = readFile("public/review.html");
    expect(reviewHtml).toContain('aria-describedby="resolveValidationMessage"');
    expect(reviewHtml).toContain('aria-describedby="overrideValidationMessage"');
    expect(reviewHtml).toContain('id="reviewActionSequenceHint"');
  });

  it("exposes course surfaces in participant, admin-content, and results workspaces", () => {
    const participantHtml = readFile("public/participant.html");
    // Course accordion mount point must exist for the participant course flow
    expect(participantHtml).toContain('id="courseAccordion"');

    const adminContentHtml = readFile("public/admin-content.html");
    // Course tab must exist in the admin content tab shell
    expect(adminContentHtml).toContain('id="tabKurs"');
    expect(adminContentHtml).toContain('id="coursesTab"');

    const resultsHtml = readFile("public/results.html");
    // Course report body must be present in the results workspace
    expect(resultsHtml).toContain('id="courseReportBody"');
  });

  it("keeps runtime alert and invalid-field hooks for validation errors", () => {
    const participantJs = readFile("public/participant.js");
    // Smoke: CSS class names are referenced — not tied to exact classList API call pattern
    expect(participantJs).toContain("field-error");
    expect(participantJs).toContain("field-success");
    expect(participantJs).toContain("is-invalid");
    expect(participantJs).toContain("alert");

    const reviewJs = readFile("public/review.js");
    expect(reviewJs).toContain("field-error");
    expect(reviewJs).toContain("is-invalid");
    expect(reviewJs).toContain("alert");
    // Contract: reviewer identity functions exist (owns the claim-check logic)
    expect(reviewJs).toContain("isSelectedReviewClaimedByCurrentUser");
    expect(reviewJs).toContain("getCurrentReviewerEmail");
  });
});
