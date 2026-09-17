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

  // #896 S1: the shell's mode switch became a tablist of three views. #1046 (14.09): fanelinja
  // tegnes av form-page.js (som på kurs, seksjon og klasse), så kontrakten testes der den bor —
  // med modulens tre faner og paneler.
  it("exposes the three module views as one tablist with Rediger selected", async () => {
    const body = mountPage("public/admin-content.html");
    const host = body.querySelector("#moduleFormHead");
    expect(host).toBeTruthy();
    const { createFormPage } = await import("../../public/static/form-page.js");
    const fp = createFormPage({
      host,
      texts: { back: "← Tilbake", typeLabel: "Modul", untitled: "Ny modul", savedAll: "Alt lagret", unsaved: "Ulagret", save: "Lagre", cancel: "Avbryt", leaveConfirm: "?", contentLocale: "Innholdsspråk:", required: "" },
      backHref: "/admin-content",
      title: () => "",
      tabs: {
        label: "Modulvisning",
        items: () => [
          { id: "edit", label: "Rediger", panel: "tabPanelModule" },
          { id: "preview", label: "Forhåndsvisning", panel: "tabPanelModule" },
          { id: "settings", label: "Innstillinger", panel: "tabPanelSettings" },
        ],
        initial: "edit",
      },
      save: { onSave: async () => {} },
      body: () => "",
    });
    fp.render();

    const tablist = getByRole(body, "tablist", { name: "Modulvisning" });
    expect(tablist).toBeTruthy();
    expect(queryAllByRole(body, "tablist", { name: "Modulvisning" })).toHaveLength(1);

    const tabs = queryAllByRole(body, "tab");
    // #1046 (13.09): samme rekkefølge som seksjonene — Rediger først.
    expect(tabs.map((tab) => tab.textContent.trim())).toEqual([
      "Rediger",
      "Forhåndsvisning",
      "Innstillinger",
    ]);
    // Rediger is the default view, and each tab points at the panel it controls.
    expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(getByRole(body, "tab", { name: "Rediger" }).getAttribute("aria-selected")).toBe("true");
    // Én tabstopp: bare den valgte fanen ligger i tabrekkefølgen.
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      expect(body.querySelector(`#${panelId}`)).toBeTruthy();
    }

    // #1046 steg 2: samtaleloggen (role="log") er borte; lesestatus-regionen for skjermlesere står.
    expect(body.querySelector('[role="log"]')).toBeNull();
    expect(getByRole(body, "status")).toBeTruthy();
  });

  // #896 S3c: this used to mount `public/admin-content-advanced.html` and assert the
  // Samtale/Avansert switch. That page is deleted — the tablist above IS the switch now — so the
  // test read a file that no longer exists and failed with ENOENT rather than a verdict. What it
  // was actually protecting, and what survives the move, is the privacy warning: it followed the
  // authoring surface here, and it must not be lost in the shuffle.
  it("keeps the special-category warning on the authoring surface", () => {
    // Produkteier 13.09: varselet ligger i redigeringsskjemaet (under oppgavefeltet), tegnet av
    // skallet — ikke som fast boks i sida. Sida har derfor bare stilen; skallet har teksten.
    const body = mountPage("public/admin-content.html");
    expect(body.querySelector("#privacyNotice")).toBeNull();
    const shellJs = fs.readFileSync(path.join(process.cwd(), "public/static/admin-content-shell.js"), "utf8");
    expect(shellJs).toContain('<details id="privacyNotice" class="privacy-notice"');
    expect(shellJs).toContain('t("adminContent.privacy.warning.body")');
  });

  // #926 (#896 §6 krav 2): the attention marker is a CSS ::after on [data-attention], so it can
  // only ever appear if the rule is in the page. A marker that silently stops rendering is worse
  // than none — the author is told nothing AND believes they would have been.
  it("styles the tab attention marker", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/admin-content.html"), "utf8");

    expect(html).toContain('.form-page-tab[data-attention="1"]::after');
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
