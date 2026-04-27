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

  it("keeps one clear editing-mode switch and live region in the conversational shell", () => {
    const body = mountPage("public/admin-content.html");

    const modeGroup = getByRole(body, "group", { name: "Redigeringsmodus" });
    expect(modeGroup).toBeTruthy();

    expect(getByRole(body, "button", { name: "Samtale" })).toBeTruthy();
    expect(getByRole(body, "button", { name: "Avansert" })).toBeTruthy();
    expect(getByRole(body, "log")).toBeTruthy();
    expect(getByRole(body, "status")).toBeTruthy();
    expect(queryAllByRole(body, "group", { name: "Redigeringsmodus" })).toHaveLength(1);
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
