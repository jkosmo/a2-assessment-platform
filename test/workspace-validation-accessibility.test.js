import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("workspace validation accessibility", () => {
  it("keeps shared hint and validation state styles in shared CSS", () => {
    const css = readFile("public/static/shared.css");

    expect(css).toContain(".hint {");
    expect(css).toContain('.hint::before {');
    expect(css).toContain('content: "\\2139  ";');
    expect(css).toContain(".field-error {");
    expect(css).toContain(".field-warning {");
    expect(css).toContain(".field-success {");
    expect(css).toContain(".is-invalid {");
  });

  it("keeps validation wiring for participant and reviewer validation fields", () => {
    const participantHtml = readFile("public/participant.html");
    expect(participantHtml).toContain('aria-describedby="moduleSelectionHint"');
    expect(participantHtml).toContain('id="submissionValidationHint"');
    expect(participantHtml).not.toContain('id="reflectionText-hint"');
    expect(participantHtml).not.toContain('id="promptExcerpt-hint"');
    expect(participantHtml).not.toContain('id="ack-hint"');

    const appealHandlerHtml = readFile("public/appeal-handler.html");
    expect(appealHandlerHtml).toContain('aria-describedby="resolveValidationMessage"');

    const manualReviewHtml = readFile("public/manual-review.html");
    expect(manualReviewHtml).toContain('aria-describedby="overrideValidationMessage"');
  });

  it("keeps runtime alert and invalid-field hooks for validation errors", () => {
    const participantJs = readFile("public/participant.js");
    expect(participantJs).toContain('classList.add("field-error")');
    expect(participantJs).toContain('classList.add("field-success")');
    expect(participantJs).toContain('classList.add("is-invalid")');
    expect(participantJs).toContain('setAttribute("role", "alert")');

    const appealHandlerJs = readFile("public/appeal-handler.js");
    expect(appealHandlerJs).toContain('classList.add("field-error")');
    expect(appealHandlerJs).toContain('classList.add("is-invalid")');
    expect(appealHandlerJs).toContain('setAttribute("role", "alert")');

    const manualReviewJs = readFile("public/manual-review.js");
    expect(manualReviewJs).toContain('classList.add("field-error")');
    expect(manualReviewJs).toContain('classList.add("is-invalid")');
    expect(manualReviewJs).toContain('setAttribute("role", "alert")');
  });
});
