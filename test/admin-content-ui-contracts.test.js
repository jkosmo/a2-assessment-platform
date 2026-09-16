import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const allAdminContentPages = [
  "public/admin-content.html",
  // #896 S3c: public/admin-content-advanced.html er slettet. Sto her til 2026-08-18.
  "public/admin-content-library.html",
  "public/admin-content-courses.html",
];

describe("admin content workspace UI contracts", () => {
  for (const relativePath of allAdminContentPages) {
    it(`keeps shared workspace chrome in ${relativePath}`, () => {
      const html = readFile(relativePath);
      expect(html).toContain('class="skip-nav"');
      expect(html).toContain('id="workspaceNav"');
      expect(html).toContain('id="appVersion"');
      expect(html).toContain('id="localeSelect"');
      expect(html).toContain('id="main-content"');
    });
  }

  // #896 S3c: this was "state-rail parity between the two module workspaces". There is one
  // workspace now, so parity is not the question — presence is.
  it("the module workspace carries its state in the shared header, not a state rail (#1046)", () => {
    const shellHtml = readFile("public/admin-content.html");
    expect(shellHtml).not.toContain('id="stateRail"');
    // #1046 (14.09): hodet (navn, merker, Lagre/Avbryt, handlinger, språk, faner) tegnes av form-page.js
    // i #moduleFormHead — modulen har ikke lenger et eget hode i HTML-en.
    expect(shellHtml).toContain('id="moduleFormHead"');
    for (const id of ["moduleWorkspaceTitle", "moduleLifecycleBadge", "moduleDirtyBadge", "workspaceActions", "previewLocaleBar", "tabEdit"]) {
      expect(shellHtml).not.toContain(`id="${id}"`);
    }
    expect(shellHtml).toContain('id="previewShows"');
    const shellJs = readFile("public/static/admin-content-shell.js");
    expect(shellJs).toContain('import { createFormPage } from "./form-page.js"');
    expect(shellJs).toMatch(/formPage = createFormPage\(\{\s*\n\s*host: moduleFormHost/);
    // Lagre/Avbryt, «ulagret» og fanelinja er form-page sine — skallet har ingen egne.
    for (const own of ["moduleSaveBtn", "moduleCancelBtn", "moduleDirtyBadge", "tabButtons", "renderPreviewLocaleBar"]) {
      expect(shellJs).not.toContain(own);
    }
  });

  // #896 S3c: this test guarded the handoff BETWEEN the shell and Avansert — the mode switch, the
  // "back to chat" link, `settingsOpenAdvanced`. All of it is deleted; there is nothing to hand
  // off to. What survives is the structure that replaced it, and the assertion that the handoff
  // really is gone — a leftover entry point back into a deleted page is a 404 waiting for an
  // author, and the epic's whole point was one surface rather than two.
  it("keeps the workspace structure and no route back to the retired editor", () => {
    const shellHtml = readFile("public/admin-content.html");
    const shellJs = readFile("public/static/admin-content-shell.js");

    // Panelene står i sida; fanene tegnes av form-page.js (formTab-edit/preview/settings).
    expect(shellHtml).toContain('id="tabPanelModule"');
    expect(shellHtml).toContain('id="tabPanelSettings"');
    expect(shellJs).toMatch(/TAB_ORDER = \["edit", "preview", "settings"\]/);
    // #1046 steg 2: ingen samtalerute; spørsmål går i valgdialogen, kilde/plan i Generer-dialogen.
    expect(shellHtml).not.toContain('id="chatMessages"');
    expect(shellHtml).toContain('id="dialogChoice"');
    expect(shellHtml).toContain('id="dialogGeneratePlan"');
    expect(shellHtml).toContain('id="previewContent"');

    expect(shellHtml).not.toContain('id="settingsOpenAdvanced"');
    expect(shellHtml).not.toContain('id="modeSwitchAdvanced"');
    expect(shellJs).not.toContain("openAdvancedEditor");
    expect(shellJs).not.toContain("writeHandoff");
  });

  it("keeps shared list-view interaction styling between library and courses", () => {
    const libraryHtml = readFile("public/admin-content-library.html");
    const coursesHtml = readFile("public/admin-content-courses.html");

    expect(libraryHtml).toContain(".content-area-nav");
    expect(coursesHtml).toContain(".content-area-nav");
  });

  it("keeps course page semantics for list and detail flows", () => {
    const coursesHtml = readFile("public/admin-content-courses.html");
    const coursesJs = readFile("public/static/admin-content-courses.js");

    // Static HTML: dialog and nav elements
    expect(coursesHtml).toContain('id="deleteDialog"');
    expect(coursesHtml).toContain('id="deleteConfirmBtn"');
    expect(coursesHtml).toContain('id="deleteCancelBtn"');

    // Dynamic JS: the list is the shared list page (#1046, list-page.js); the detail view is the page's own.
    expect(coursesJs).toContain('createListPage({');
    expect(coursesJs).toContain('tbody: "coursesTableBody"');
    // #1046 nivå to: hodet (tilbake-lenke, tittel) tegnes av den felles skjemasida (form-page.js).
    expect(coursesJs).toContain("createFormPage({");
  });

  it("keeps the GDPR/privacy warning on the module workspace", () => {
    // Produkteier 13.09: varselet tegnes av skallet UNDER oppgavefeltet (én linje som folder ut),
    // ikke som fast boks i HTML-en. Det finnes bare der fritekst skrives — som er poenget.
    const shellJs = readFile("public/static/admin-content-shell.js");
    expect(shellJs).toContain('adminContent.privacy.warning.title');
    expect(shellJs).toContain('adminContent.privacy.warning.body');
    expect(shellJs).toContain('id="privacyNotice"');
    expect(readFile("public/admin-content.html")).not.toContain('id="privacyNotice"');
  });
});

// ---------------------------------------------------------------------------
// Courses conversational flow — CSS contracts
// ---------------------------------------------------------------------------

describe("courses form page", () => {
  // #1046 nivå to (1b): den samtalebaserte «Nytt kurs»-sida (#506) er borte — «Nytt kurs» åpner det
  // samme skjemaet tomt, på den felles skjemasida (form-page.js). Ingen egen CSS skal ligge igjen.
  it("has no leftover conversational-flow CSS or markup", () => {
    const html = readFile("public/admin-content-courses.html");
    const js = readFile("public/static/admin-content-courses.js");
    expect(html).not.toContain(".conv-");
    expect(js).not.toContain("renderNewCourseConversational");
    expect(js).toContain("createFormPage({");
  });

  // #1046 D5: regelen for .row-action-btn bor i shared.css ALENE. Moduler og Kurs hadde hver sin
  // ordrette kopi — «samme regel tre steder» — og disse to testene målte kopiene, ikke regelen.
  // Nå måles regelen der den bor, og at ingen side har fått en kopi tilbake.
  it("row-action-btn has width: auto in shared.css — prevents global button reset in flex rows", () => {
    const sharedCss = readFile("public/static/shared.css");
    expect(sharedCss).toMatch(/\.row-action-btn\s*\{[^}]*width\s*:\s*auto/);
  });

  it("row-action-btn has min-height: 0 in shared.css — prevents global button{min-height:40px} making <button> taller than sibling <a> elements", () => {
    const sharedCss = readFile("public/static/shared.css");
    // shared.css sets button { min-height: 40px }. Without min-height: 0 override, <button class="row-action-btn">
    // is 40px while <a class="row-action-btn"> is ~25px — visible height mismatch in the same row.
    expect(sharedCss).toMatch(/\.row-action-btn\s*\{[^}]*min-height\s*:\s*0/);
  });

  it("no list page carries its own copy of the .row-action-btn rule", () => {
    for (const side of ["library", "courses", "sections", "classes"]) {
      const html = readFile(`public/admin-content-${side}.html`);
      expect(html, `${side}: .row-action-btn skal ikke defineres lokalt`).not.toMatch(/\.row-action-btn\s*\{/);
    }
  });

  it("the add-row button has width: auto — prevents global reset collapsing the module search input", () => {
    // Same pattern as .conv-input-area button fix (v0.10.4): global button{width:100%} collapses
    // the adjacent input in a flex row unless the button explicitly sets width: auto.
    // #1046 G2: «legg til»-linja er den delte .form-add-row i shared.css, ikke sidens .combobox-row.
    const css = readFile("public/static/shared.css");
    expect(css).toMatch(/\.form-add-row\s*>\s*button[^{]*\{[^}]*width\s*:\s*auto/);
    expect(readFile("public/admin-content-courses.html")).not.toMatch(/\.combobox-row/);
  });

});

// ---------------------------------------------------------------------------
// Courses JS contracts
// ---------------------------------------------------------------------------

describe("courses JS contracts", () => {
  it("getHeaders is defined as a function, not a plain object — prevents apiFetch treating it as fetch options", () => {
    const js = readFile("public/static/admin-content-courses.js");
    // If getHeaders is a plain object, apiFetch treats it as the options arg and ignores
    // the actual method/body in the third argument — making every POST silently become a GET.
    expect(js).toMatch(/function getHeaders\s*\(\s*\)/);
    expect(js).not.toMatch(/^let getHeaders\s*=\s*\{/m);
  });

  it("courses admin exposes publish controls for saved unpublished courses", () => {
    const js = readFile("public/static/admin-content-courses.js");
    expect(js).toContain("function canPublishCourse(course)");
    expect(js).toContain('data-action="publish"');
    expect(js).toContain('id="publishCourseBtn"');
    expect(js).toContain('/publish`');
  });
});

// ---------------------------------------------------------------------------
// Library JS contracts
// ---------------------------------------------------------------------------

describe("library JS contracts", () => {
  it("getHeaders is defined as a function, not a plain object — prevents apiFetch treating it as fetch options", () => {
    const js = readFile("public/static/admin-content-library.js");
    // Same root cause as courses.js Bug G (v0.10.2): plain object causes apiFetch to treat it as
    // options arg and silently ignore the method/body in the 3rd arg — all POSTs become GETs.
    expect(js).toMatch(/function getHeaders\s*\(\s*\)/);
    expect(js).not.toMatch(/^let getHeaders\s*=\s*\{/m);
  });
});

// ---------------------------------------------------------------------------
// Shell JS contracts
// ---------------------------------------------------------------------------

describe("shell JS contracts", () => {
  it("loadModule unwraps bundle from moduleExport key — API returns { moduleExport: {...} }, not the bundle directly", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Without the unwrap, bundle.module is always undefined and the preview pane
    // shows "Ingen modul valgt" even after a module loads successfully.
    expect(js).toMatch(/bundle\s*=\s*\w+\?\.\s*moduleExport/);
  });

  it("translatePageStaticText iterates [data-i18n] so privacy warning translates on locale switch", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Must use querySelectorAll('[data-i18n]') loop, not just hardcoded element selectors.
    // Without this the privacy warning stays in English regardless of locale.
    expect(js).toContain('querySelectorAll("[data-i18n]")');
  });

  it("the module header translates with the UI locale (typen fra t(), hodet tegnes på nytt)", () => {
    // #1046 (14.09): hodet tegnes av form-page.js fra t(); ved menyspråkbytte tegnes det på nytt.
    const js = readFile("public/static/admin-content-shell.js");
    expect(js).toContain('typeLabel: t("shell.page.title")');
    expect(js).toMatch(/uiLocaleSelect\.addEventListener\("change"[\s\S]*?formPage\?\.render\(\)/);
  });

  it("#1046 steg 2: the source-material form is mounted in the Generate dialog, not a chat log", () => {
    const js = readFile("public/static/admin-content-shell.js");
    expect(js).not.toMatch(/function logForm\s*\(/);
    expect(js).toContain("entry.mount.replaceChildren(wrap)");
  });

  // v2.18.13 reversed this contract, so the test is inverted rather than deleted — the reason it
  // is gone matters more than the fact. Stage-tilbakemelding 2026-08-17: *«Åpner modul, den
  // havner på rediger fanen, men jeg kan ikke redigere før jeg trykker på 'Rediger direkte'.»*
  // The tab opens in edit mode now, so a "Rediger direkte" action would be a second door into
  // the room the author is standing in. Both models dropped it.
  it("no longer offers a directEdit action — the Rediger tab IS the form", () => {
    const js = readFile("public/static/admin-content-shell-state.js");
    expect(js).not.toContain('"directEdit"');
  });

  // -------------------------------------------------------------------------
  // #926 (#896 §6): samtalen foreslår — den overskriver aldri.
  //
  // The decision itself is one branch. What breaks is the SURFACE: four generation paths write
  // content back, and a fifth added later would bypass the gate without anyone noticing until an
  // author lost a scenario they had written by hand. That is the "correct fix, incomplete
  // surface" class CLAUDE.md names as this repo's recurring one, so the contract is on coverage,
  // not on the branch.
  // -------------------------------------------------------------------------
  describe("§6 — generated content goes through the propose/commit gate", () => {
    // QA 2026-08-18 fant at denne lista var på fire mens filen hadde SEKS skrivere. Kommentaren
    // over sa at «en femte produsent lagt til uten porten» var den sannsynlige regresjonen — den
    // femte og sjette fantes allerede, og en hardkodet liste kan per definisjon ikke oppdage det.
    //
    // Derfor står lista fortsatt, men med en dekningsvakt under: enhver funksjon som skriver til
    // `sessionDraft` via commitSessionDraftPatch må være her eller være unntatt med begrunnelse.
    const GENERATORS = [
      "generateDraftInBackground",
      "generateMcqInBackground",
      "reviseDraftInBackground",
      "reviseMcqInBackground",
      // QA-funn F1: begge nås fra samme chat-boks som de fire over, og begge bar taskText fra et
      // snapshot av utkastet — så en tittelendring eller en oversettelse slettet håndskrevet,
      // ulagret tekst uten å spørre.
      "applyStructuredTitleEditInBackground",
      "refreshLocalizedDraftInBackground",
    ];

    for (const fn of GENERATORS) {
      it(`${fn} lands its result through commitOrProposeGenerated`, () => {
        const js = readFile("public/static/admin-content-shell.js");
        const start = js.indexOf(`async function ${fn}(`);
        expect(start, `${fn} not found`).toBeGreaterThan(-1);
        // Bounded by the next top-level `async function` so the search cannot wander into the
        // neighbour's body and pass on ITS gate call.
        const next = js.indexOf("\nasync function ", start + 1);
        const body = js.slice(start, next === -1 ? js.length : next);

        expect(body).toContain("commitOrProposeGenerated");
        // The old shape. A direct assignment here means the result bypasses the gate — which is
        // precisely how it overwrote unsaved work before.
        expect(body).not.toMatch(/sessionDraft\s*=\s*buildPreviewCandidate\(/);
      });
    }

    // Dekningsvakten. Lista over kan ikke oppdage en produsent ingen har tenkt på — denne kan.
    // Den finner hvert kall til `commitSessionDraftPatch` i filen, slår opp hvilken funksjon det
    // står i, og krever at funksjonen enten ER porten, står i GENERATORS, eller er ført opp som et
    // begrunnet unntak. Et nytt kall et sted ingen har vurdert gjør testen rød.
    it("no writer reaches sessionDraft outside the gate without an explicit exemption", () => {
      // #1046 punkt 2: skallet er delt i moduler som får `commitSessionDraftPatch` gjennom ctx —
      // vakten leser dem alle. Én kilde til hvilke: ctx-blokkene i skallet nevner funksjonen.
      const SHELL_MODULES = [
        "public/static/admin-content-shell.js",
        "public/static/admin-content-publish.js",
        "public/static/admin-content-settings-tab.js",
        "public/static/admin-content-criteria.js",
      ];
      const js = SHELL_MODULES.map(readFile).join("\n");

      // Bevisste unntak, med grunn. Å legge noe til her er en avgjørelse, ikke en formalitet.
      const EXEMPT = {
        // Porten selv — den ER stedet patchen landes.
        commitOrProposeGenerated: "the gate itself",
        // «Oversett det som mangler» fra publiseringsgaten. Den fyller SPRÅK forfatteren aldri
        // skrev, på en blokkert publisering forfatteren nettopp ba om å få utbedret, og lagrer
        // umiddelbart etterpå. Et forslag her ville stått i veien for utbedringen det ble bedt om.
        // Merk at en åpen Rediger-form med ulagret tekst taper den teksten til lagringen som
        // følger — det er en egen vakt (advar før publisering med ulagrede endringer), ikke denne.
        translateMissingLocalesThenPublish: "explicit gap-fill remedy that saves immediately",
      };

      // Funksjonshoder i filene, i rekkefølge, så et kall kan tilordnes den som omslutter det.
      // Innrykk tillatt: i de utskilte modulene ligger funksjonene inne i en fabrikk.
      const heads = [...js.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)]
        .map((m) => ({ name: m[1], index: m.index }));
      const enclosing = (index) => {
        let found = null;
        for (const head of heads) {
          if (head.index > index) break;
          found = head.name;
        }
        return found;
      };

      const offenders = [];
      for (const match of js.matchAll(/commitSessionDraftPatch\(/g)) {
        const fn = enclosing(match.index);
        // The declaration itself, not a call.
        if (js.slice(Math.max(0, match.index - 9), match.index).includes("function ")) continue;
        if (fn && (EXEMPT[fn] || GENERATORS.includes(fn))) continue;
        offenders.push(fn ?? "<top level>");
      }

      expect(
        offenders,
        `writes to sessionDraft outside the §6 gate: ${offenders.join(", ")}. Route it through `
          + "commitOrProposeGenerated, or add it to EXEMPT with the reason.",
      ).toEqual([]);
    });

    it("#1046 steg 2: no proposal mechanism — the generated result goes into the form the dialog announced", () => {
    const body = readFile("public/static/admin-content-shell.js");
    expect(body).not.toContain("pendingProposal");
    expect(body).not.toContain("shell.proposal.");
    // Det skrevne tas med i utkastet før resultatet legges inn.
    expect(body).toMatch(/if \(hasOpenEditForm\(\)\) captureEditFormIntoDraft\(\);\s*\n\s*commitSessionDraftPatch\(patch/);
  });

    it("marks the Innstillinger tab when generated criteria land out of sight", () => {
      const js = readFile("public/static/admin-content-shell.js");
      expect(js).toContain("function markTabAttention(");
      // The TODO this replaced: "Still missing (§6): marking the Innstillinger tab when something
      // lands in a tab the author is not looking at."
      expect(js).not.toContain("Still missing (§6)");
      expect(js).toContain('markTabAttention("settings")');
      // Opening the tab is seeing it — the marker must not be able to stick.
      expect(js).toContain("clearTabAttention(tab)");
    });
  });

  it("shell.directEdit.* i18n keys exist in all three locales", () => {
    const i18n = readFile("public/i18n/admin-content-translations.js");
    const keys = [
      "shell.directEdit.action",
      "shell.directEdit.nameLabel",
      "shell.directEdit.submit",
      "shell.directEdit.translating",
    ];
    for (const key of keys) {
      // Must appear at least 3 times: en-GB base + nb override + nn override
      const count = (i18n.match(new RegExp(key.replace(/\./g, "\\."), "g")) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it("enterPreviewEditMode renders editable fields directly in preview pane", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Must use previewContent.innerHTML directly, not logForm — fields must be in preview pane.
    expect(js).toContain("function enterPreviewEditMode");
    expect(js).toContain("previewEditTitle");
    expect(js).toContain("previewEditTaskText");
    expect(js).toContain("previewEditGuidanceText");
    expect(js).toContain("preview-edit-textarea");
  });

  it("switching content language with an open edit form asks first and re-opens the form", () => {
    // Språkpillene er form-page sine; byttet går gjennom switchContentLocale, som spør (#920) når
    // et skjema med endringer ville blitt tegnet om, og åpner skjemaet igjen i det nye språket.
    // (Den gamle CSS-låsen `.preview-pane--editing .preview-locale-btn` traff aldri: pillene lå
    // utenfor forhåndsvisningsruten.)
    const js = readFile("public/static/admin-content-shell.js");
    const start = js.indexOf("function switchContentLocale(");
    const fn = js.slice(start, js.indexOf("\nfunction ", start + 1));
    expect(fn).toContain("if (!confirmLocaleSwitchDiscard()) return false;");
    expect(fn).toContain("enterPreviewEditMode({ force: true })");
    expect(js).toContain("onChange: switchContentLocale");
    expect(readFile("public/admin-content.html")).not.toContain("preview-locale-btn");
  });

  it("PATCH /modules/:id/title route exists in backend router", () => {
    const routes = readFile("src/routes/adminContent.ts");
    expect(routes).toContain('"/modules/:moduleId/title"');
    expect(routes).toContain("updateModuleTitle");
  });

  // #906: the rename used to be its own PATCH before the version was written, so a failed save
  // left the module renamed and nothing else changed. It now travels inside the composed save.
  it("saveDraftBundleInBackground sends the rename inside the composed version call", () => {
    const js = readFile("public/static/admin-content-shell.js");
    expect(js).toContain("sessionDraft?.title");
    expect(js).toContain("/versions`");
    // The title rides along in the composed body rather than as a separate PATCH.
    expect(js).toMatch(/titlePatch \? \{ title: titlePatch \}/);
  });
});
