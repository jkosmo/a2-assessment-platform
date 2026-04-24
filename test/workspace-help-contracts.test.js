import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAllWorkspaceHelpContextIds,
  getHelpUi,
  getOverviewContent,
  getWorkspaceHelpContent,
} from "../public/static/workspace-help-content.js";

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const pagesWithHelp = [
  "public/participant.html",
  "public/participant-completed.html",
  "public/profile.html",
  "public/review.html",
  "public/calibration.html",
  "public/results.html",
  "public/admin-platform.html",
  "public/admin-content-library.html",
  "public/admin-content.html",
  "public/admin-content-advanced.html",
  "public/admin-content-courses.html",
  "public/admin-content-calibration.html",
];

describe("workspace help contracts", () => {
  for (const relativePath of pagesWithHelp) {
    it(`loads shared workspace help on ${relativePath}`, () => {
      const html = readFile(relativePath);
      expect(html).toContain("/static/workspace-help.js");
    });
  }

  it("keeps localized content for every declared workspace help context", () => {
    const locales = ["en-GB", "nb", "nn"];
    for (const contextId of getAllWorkspaceHelpContextIds()) {
      for (const locale of locales) {
        const content = getWorkspaceHelpContent(contextId, locale);
        expect(content?.title).toBeTruthy();
        expect(content?.summary).toBeTruthy();
        expect(Array.isArray(content?.sections)).toBe(true);
        expect(content.sections.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps overview help localized for supported locales", () => {
    const locales = ["en-GB", "nb", "nn"];
    for (const locale of locales) {
      expect(getHelpUi(locale).openHelp).toBeTruthy();
      const content = getOverviewContent(locale);
      expect(content?.title).toBeTruthy();
      expect(content?.summary).toBeTruthy();
      expect(content?.sections?.length).toBeGreaterThan(0);
    }
  });
});
