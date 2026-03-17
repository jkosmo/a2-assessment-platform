import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspacePages = [
  "public/participant.html",
  "public/admin-content.html",
  "public/appeal-handler.html",
  "public/calibration.html",
  "public/manual-review.html",
  "public/participant-completed.html",
];

function readWorkspaceHtml(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("workspace HTML i18n fallbacks", () => {
  for (const relativePath of workspacePages) {
    it(`keeps inline en-GB fallback copy in ${relativePath}`, () => {
      const html = readWorkspaceHtml(relativePath);
      const textMatches = [...html.matchAll(/<([a-z0-9-]+)\b[^>]*data-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi)];

      expect(textMatches.length).toBeGreaterThan(0);

      for (const [, , key, innerHtml] of textMatches) {
        const text = innerHtml.replace(/<[^>]+>/g, "").trim();
        expect(text, `${relativePath} -> ${key}`).not.toBe("");
      }

      const placeholderMatches = [...html.matchAll(/<(?:input|textarea)\b[^>]*data-i18n-placeholder="([^"]+)"[^>]*placeholder="([^"]*)"[^>]*\/?>/gi)];
      const expectedPlaceholderCount = (html.match(/data-i18n-placeholder="/g) ?? []).length;

      expect(placeholderMatches.length, `${relativePath} placeholder count`).toBe(expectedPlaceholderCount);

      for (const [, key, placeholder] of placeholderMatches) {
        expect(placeholder.trim(), `${relativePath} -> ${key} placeholder`).not.toBe("");
      }
    });
  }
});
