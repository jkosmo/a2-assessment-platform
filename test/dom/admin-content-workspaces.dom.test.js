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

  it("keeps one clear editing-mode switch and preview region in the advanced editor", () => {
    const body = mountPage("public/admin-content-advanced.html");

    expect(getByRole(body, "group", { name: "Redigeringsmodus" })).toBeTruthy();
    expect(getByRole(body, "button", { name: "Samtale" })).toBeTruthy();
    expect(getByRole(body, "button", { name: "Avansert" })).toBeTruthy();
    expect(getByText(body, "Special category data risk")).toBeTruthy();
    expect(getByRole(body, "button", { name: "Vis forhåndsvisning" })).toBeTruthy();
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
