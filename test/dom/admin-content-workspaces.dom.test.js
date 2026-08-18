// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { getByRole, getByText, queryAllByRole } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

function readBody(relativePath) {
  const html = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match?.[1] ?? html;
}

function mountPage(relativePath) {
  document.body.innerHTML = readBody(relativePath);
  return document.body;
}

describe("admin content DOM accessibility contracts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // #896 S1: the shell's mode switch became a tablist of three views. The advanced page
  // keeps its own switch until S3 folds it into the Innstillinger tab.
  it("exposes the three module views as one tablist with Rediger selected", () => {
    const body = mountPage("public/admin-content.html");

    const tablist = getByRole(body, "tablist", { name: "Modulvisning" });
    expect(tablist).toBeTruthy();
    expect(queryAllByRole(body, "tablist", { name: "Modulvisning" })).toHaveLength(1);

    const tabs = queryAllByRole(body, "tab");
    expect(tabs.map((tab) => tab.textContent.trim())).toEqual([
      "Forhåndsvisning",
      "Rediger",
      "Innstillinger",
    ]);
    // Rediger is the default view, and each tab points at the panel it controls.
    expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(getByRole(body, "tab", { name: "Rediger" }).getAttribute("aria-selected")).toBe("true");
    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      expect(body.querySelector(`#${panelId}`)).toBeTruthy();
    }

    expect(getByRole(body, "log")).toBeTruthy();
    expect(getByRole(body, "status")).toBeTruthy();
  });

  // #896 S3c: this used to mount `public/admin-content-advanced.html` and assert the
  // Samtale/Avansert switch. That page is deleted — the tablist above IS the switch now — so the
  // test read a file that no longer exists and failed with ENOENT rather than a verdict. What it
  // was actually protecting, and what survives the move, is the privacy warning: it followed the
  // authoring surface here, and it must not be lost in the shuffle.
  it("keeps the special-category warning on the authoring surface", () => {
    const body = mountPage("public/admin-content.html");

    expect(getByText(body, "Special category data risk")).toBeTruthy();
    // Stage-tilbakemelding 2026-08-18: shown on Rediger only, so the tab handler needs a handle
    // on it. Without the id the notice is visible on all three tabs again.
    expect(body.querySelector("#privacyNotice")).toBeTruthy();
  });

  // #926 (#896 §6 krav 2): the attention marker is a CSS ::after on [data-attention], so it can
  // only ever appear if the rule is in the page. A marker that silently stops rendering is worse
  // than none — the author is told nothing AND believes they would have been.
  it("styles the tab attention marker", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/admin-content.html"), "utf8");

    expect(html).toContain('.module-tab[data-attention="1"]::after');
  });

  it("keeps course delete confirmation accessible and course navigation scaffolded", () => {
    const body = mountPage("public/admin-content-courses.html");

    expect(document.getElementById("deleteDialog")).toBeTruthy();
    expect(document.getElementById("deleteDialogTitle")?.textContent).toContain("Slett kurs");
    expect(document.getElementById("deleteConfirmBtn")?.textContent).toContain("Slett kurs");
    expect(document.getElementById("deleteCancelBtn")?.textContent).toContain("Avbryt");
    expect(getByRole(body, "main")).toBeTruthy();
  });
});
