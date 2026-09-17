// #1046 punkt 2 (14.09): Innstillinger-fanen på modulsida, skilt ut fra admin-content-shell.js.
//
// Fanen tegner innstillingene for den lastede modulen (type, nivå, gyldighet, terskler, kriterier,
// vurderingsinstruks, innleveringsskjema, versjonshistorikk) og lagrer dem som ny modulversjon.
// Det den trenger fra skallet kommer inn som `ctx`: tilstanden (bundle, sessionDraft, contentLocale …)
// som get/set-egenskaper, og funksjonene den kaller (t, loadModule, logProgress …). Skallet kaller
// tilbake gjennom det som returneres (renderSettingsPanel, hasUnsavedSettingsEdits …).
//
// Kommentarene i kroppen er tatt med uendret fra skallet — de forklarer HVORFOR ting er som de er.

import { escapeHtml } from "./html-escape.js";
import { apiFetch } from "/static/api-client.js";
import { showToast } from "/static/toast.js";
import { localizeValueForLocale } from "/static/admin-content-preview.js";
import {
  buildCriteriaEditorHtml,
  buildEditorStateFromCriteriaRecord,
  captureLatestCriteriaState,
} from "/static/criteria-editor.js";
import { LEGACY_STRING_LOCALE, mergeLocaleInto } from "./localized-value.js";

/**
 * @param {object} ctx  se toppen av fila. Tilstand leses og skrives via egenskapene; funksjonene er
 *   skallets egne og kalles som før.
 */
export function createSettingsTab(ctx) {
  const {
    t, tf, logProgress, buildCriteriaRecordFromEditorState, announceStatus, applyTabState, dropBlankLocales, logResolveSlot, apiErrorText, loadModule, settingsSelectedMode, getHeaders, switchToTab, certificationLevelValue, localizeValue, wireCriteriaEditor, parsePercentInRange, refreshModuleHeaderState, applyFieldStateValue, fieldStateValue, buildDefaultSubmissionSchema, regenerateCriteriaFromTask,
  } = ctx;

  // ---------------------------------------------------------------------------
  // #896 S3a: the Innstillinger read-out.
  //
  // Every value here sits in the bundle the shell loaded; every field is editable and saved as a
  // new module version through saveSettingsInBackground.
  // ---------------------------------------------------------------------------

  // #1046 A1 (produkteier 13.09): et nytt element har ingen versjon å vise innstillinger for. Det som
  // trengs først er navn, modultype og nivå — resten kommer når modulen finnes. Verdiene skrives rett
  // inn i utkastet; Lagre oppretter modulen med dem.
  function renderNewModuleSettings(host) {
    const mode = ctx.sessionDraft?.assessmentMode ?? "FREETEXT_ONLY";
    const level = ctx.sessionDraft?.certificationLevel ?? "";
    const name = localizeValueForLocale(ctx.sessionDraft?.title ?? "", ctx.contentLocale) || "";
    const modeOptions = ["FREETEXT_PLUS_MCQ", "FREETEXT_ONLY", "MCQ_ONLY"]
      .map((v) => `<option value="${v}"${v === mode ? " selected" : ""}>${escapeHtml(t(`shell.settings.mode.${v}`))}</option>`).join("");
    const levelOptions = ["", "basic", "intermediate", "advanced"]
      .map((v) => `<option value="${v}"${v === level ? " selected" : ""}>${escapeHtml(v ? t(`shell.certLevel.${v}`) : t("shell.settings.notSet"))}</option>`).join("");
    host.innerHTML = `<div class="settings-group">
      <h3 class="settings-group-title">${escapeHtml(t("shell.settings.groupModule"))}</h3>
      <dl class="settings-list">
        <dt>${escapeHtml(t("shell.directEdit.nameLabel"))} <span class="required-note">${escapeHtml(t("shell.directEdit.required"))}</span></dt>
        <dd><input id="settingsNewName" class="settings-input" type="text" value="${escapeHtml(name)}" autocomplete="off" /></dd>
        <dt>${escapeHtml(t("shell.settings.moduleType"))}</dt>
        <dd><select id="settingsModuleType" class="settings-input">${modeOptions}</select>
          <span class="settings-help">${escapeHtml(t("shell.settings.newModuleTypeHelp"))}</span></dd>
        <dt>${escapeHtml(t("shell.settings.certificationLevel"))}</dt>
        <dd><select id="settingsCertLevel" class="settings-input">${levelOptions}</select></dd>
      </dl>
    </div>`;
    host.querySelector("#settingsNewName")?.addEventListener("input", (e) => {
      const v = e.target.value.trim();
      ctx.sessionDraft = { ...ctx.sessionDraft, title: v ? { [ctx.contentLocale]: v } : "" };
      if (v) ctx.newModulePlaceholder = false;
      ctx.formPage?.refreshTitle();
      refreshModuleHeaderState();
    });
    host.querySelector("#settingsModuleType")?.addEventListener("change", (e) => {
      const v = e.target.value;
      ctx.sessionDraft = { ...ctx.sessionDraft, assessmentMode: v, ...(v === "MCQ_ONLY" ? { mcqMinPercent: ctx.SHELL_MCQ_ONLY_MIN_PERCENT } : {}) };
      if (v !== "MCQ_ONLY") delete ctx.sessionDraft.mcqMinPercent;
      ctx.newModulePlaceholder = false;
      refreshModuleHeaderState();
    });
    host.querySelector("#settingsCertLevel")?.addEventListener("change", (e) => {
      ctx.sessionDraft = { ...ctx.sessionDraft, certificationLevel: e.target.value || undefined };
      ctx.newModulePlaceholder = false;
      refreshModuleHeaderState();
    });
  }

  function renderSettingsPanel() {
    const host = document.getElementById("settingsSummary");
    if (!host) return;

    if (!ctx.bundle && ctx.sessionDraft && !ctx.selectedModuleId) {
      renderNewModuleSettings(host);
      return;
    }
    if (!ctx.bundle) {
      host.innerHTML = `<p class="settings-empty">${escapeHtml(t("shell.settings.noModule"))}</p>`;
      return;
    }

    const cfg = ctx.bundle.selectedConfiguration ?? {};
    const version = cfg.moduleVersion ?? null;
    const mod = ctx.bundle.module ?? {};
    const policy = version?.assessmentPolicy ?? null;
    const criteria = cfg.rubricVersion?.criteria ?? null;

    // The type the panel is DRAWING for: whatever is selected in the dropdown right now, falling
    // back to what is stored. #896 S3c: it read only the stored one, so picking "Bare flervalg" left
    // the criteria and instruction editors standing — editors the save then refuses to carry. The
    // panel has to show the consequences of the choice at the moment it is made, not after Lagre.
    const mode = settingsSelectedMode();
    const modeLabel = t(`shell.settings.mode.${mode}`);

    // #896 S3c: eleven rows in one undifferentiated list, with three full editors bolted on after
    // it, told the author nothing about what belongs together. Four groups: what the module IS, how
    // it is ASSESSED, what the participant SUBMITS, and the history — which is a log, not a setting,
    // and therefore sits on the far side of Lagre.
    //
    // `group()` opens a bucket; `row()` fills the open one. Rendering happens once at the end, so
    // the order of the groups on screen is the order they are opened here.
    const groups = new Map();
    let openGroup = null;
    const group = (labelKey) => {
      openGroup = [];
      groups.set(labelKey, openGroup);
    };
    // Stage-tilbakemelding 2026-08-17: poengreglene sier ikke hva de gjør. Forklaringen ligger bak
    // et i-ikon, åpnet med KLIKK — hover finnes ikke på nettbrett og kan ikke nås med tastatur.
    // Ingen innebygde hjelpetekster: forfatteren ba om den kompakte varianten.
    // #1046 D4: hjelpen står som én setning under feltet (tidligere et (i)-ikon med popover).
    const row = (labelKey, valueHtml, isEmpty = false, infoKey = null) => {
      const helpText = infoKey ? t(`shell.settings.info.${infoKey}`) : "";
      const help = helpText && !helpText.startsWith("shell.settings.info.")
        ? `<span class="settings-help" data-info="${escapeHtml(infoKey)}">${escapeHtml(helpText)}</span>`
        : "";
      openGroup.push(`<dt>${escapeHtml(t(labelKey))}</dt><dd${isEmpty ? ' class="settings-empty"' : ""}>${valueHtml}${help}</dd>`);
    };
    const emptyText = escapeHtml(t("shell.settings.notSet"));
    // #896 S3c: Innstillinger reads in the UI language, not the preview language. The summary rows
    // used localizeValue (preview locale) while the editors use ctx.currentLocale, so with the UI in
    // Norwegian and the preview in English the criteria summary showed English while "Endre
    // kriterier" opened the Norwegian values and said it was editing nb. One language per surface.
    const settingsValue = (value) => localizeValueForLocale(value, ctx.contentLocale);

    // #896 S3b: module type is editable, and first, as the issue specifies — it decides which
    // fields Rediger even shows. Only the types this module has the components for are offered;
    // the rest are disabled with the reason, rather than allowed and then rejected by the API.
    // Availability comes from the module's HISTORY, not from what the current version happens to
    // point at. Switching to MCQ-only writes a version without rubric or prompt pointers — reading
    // availability off that version would then disable every free-text mode and strand the module
    // in the type it was last saved as. The components still exist; the version simply stopped
    // referencing them, which is exactly what makes switching back possible.
    const rubricHistory = ctx.bundle.versions?.rubricVersions ?? [];
    const promptHistory = ctx.bundle.versions?.promptTemplateVersions ?? [];
    const mcqHistory = ctx.bundle.versions?.mcqSetVersions ?? [];
    const taskHistory = (ctx.bundle.versions?.moduleVersions ?? []).find((v) => !!settingsValue(v?.taskText));

    const hasRubric = rubricHistory.length > 0 || !!cfg.rubricVersion;
    const hasPrompt = promptHistory.length > 0 || !!cfg.promptTemplateVersion;
    const hasMcq = mcqHistory.length > 0 || !!cfg.mcqSetVersion;
    const hasTask = !!settingsValue(version?.taskText) || !!taskHistory;
    const freetextReady = hasTask && hasRubric && hasPrompt;

    // Stage-tilbakemelding 2026-08-19: suffikset listet TYPENS KRAV, ikke det som faktisk mangler.
    // En modul som er «Bare fritekst» har allerede oppgavetekst, rubrikk og vurderingsinstruks — den
    // mangler bare MCQ-settet. Likevel sto det «krever oppgavetekst, rubrikk og MCQ-sett» på
    // «Fritekst og flervalg», så forfatteren leste tre mangler der det var én, og hadde ingen måte å
    // se hvilken.
    //
    // Samme regel som publiseringsgaten i §4: meldingen skal navngi HULLET, ikke gjenta kravet.
    // Hva som mangler vet vi allerede — det er nettopp det `hasTask`/`hasRubric`/`hasPrompt`/`hasMcq`
    // er.
    const requirementsFor = (value) => {
      const freetext = [
        { ok: hasTask, key: "shell.settings.needs.taskText" },
        { ok: hasRubric, key: "shell.settings.needs.rubric" },
        { ok: hasPrompt, key: "shell.settings.needs.prompt" },
      ];
      const mcq = [{ ok: hasMcq, key: "shell.settings.needs.mcq" }];
      if (value === "MCQ_ONLY") return mcq;
      if (value === "FREETEXT_ONLY") return freetext;
      return [...freetext, ...mcq];
    };

    // «A», «A og B», «A, B og C» — listeform, ikke en kommaliste som slutter brått.
    const joinMissing = (parts) => {
      if (parts.length <= 1) return parts.join("");
      return `${parts.slice(0, -1).join(", ")} ${t("shell.settings.needs.and")} ${parts[parts.length - 1]}`;
    };

    const modeOptions = [
      { value: "FREETEXT_PLUS_MCQ", ok: freetextReady && hasMcq },
      { value: "FREETEXT_ONLY", ok: freetextReady },
      { value: "MCQ_ONLY", ok: hasMcq },
    ];
    const optionsHtml = modeOptions
      .map(({ value, ok }) => {
        const label = t(`shell.settings.mode.${value}`);
        const missing = requirementsFor(value).filter((r) => !r.ok).map((r) => t(r.key));
        const suffix = ok || value === mode || missing.length === 0
          ? ""
          : ` — ${tf("shell.settings.needsMissing", { missing: joinMissing(missing) })}`;
        const disabled = !ok && value !== mode ? " disabled" : "";
        const selected = value === mode ? " selected" : "";
        return `<option value="${value}"${disabled}${selected}>${escapeHtml(label + suffix)}</option>`;
      })
      .join("");
    group("shell.settings.groupModule");
    row(
      "shell.settings.moduleType",
      `<select id="settingsModuleType" class="settings-input">${optionsHtml}</select>`,
    );

    // #896 S3b: editable now that the composed save can write module-level fields. They were
    // create-only before — set once at creation and impossible to correct afterwards.
    //
    // A FIXED SCALE, not translatable text (produkteier 2026-08-17: "Nivå er ment som en fast skala
    // enkel→medium→vanskelig … dette er ikke noe som bør oversettes modul for modul"). The value is
    // one of three; the LABEL is translated at render, from `shell.certLevel.*`. A free-text input
    // let an author type anything into a field the generate endpoints validate as an enum.
    const certLevel = certificationLevelValue(mod.certificationLevel);
    const certOptions = [
      // "Not set" is offered only while nothing IS set. QA round 7: as a clearing action it sent
      // `certificationLevel: null`, and the composed-version schema takes a string or a record but
      // not null — a 400 every time. `description` right beside it in that schema is `.nullable()`
      // and can be cleared; this field is not, and making it so is a backend change that does not
      // belong in this diff. Better to not offer an action than to offer one that fails.
      ...(certLevel ? [] : [`<option value="" selected>${escapeHtml(t("shell.settings.notSet"))}</option>`]),
      ...ctx.CERTIFICATION_LEVELS.map((level) =>
        `<option value="${level}"${level === certLevel ? " selected" : ""}>${escapeHtml(t(`shell.certLevel.${level}`))}</option>`),
      // Existing data may hold something outside the scale — older modules were told "plain text,
      // e.g. foundation", and imports carry whatever they carry. Offer it back verbatim rather than
      // silently rewriting it to a neighbouring level the author never chose.
      ...(certLevel && !ctx.CERTIFICATION_LEVELS.includes(certLevel)
        ? [`<option value="${escapeHtml(certLevel)}" selected>${escapeHtml(certLevel)}</option>`]
        : []),
    ].join("");
    row(
      "shell.settings.certificationLevel",
      `<select id="settingsCertLevel" class="settings-input">${certOptions}</select>`,
    );

    // #1049: forventet svarlengde, ved siden av nivået fordi det er det paret som ble skilt.
    //
    // ⚠️ TOMT FELT BETYR «bruk nivåets standard», og det er derfor plassholderen viser tallet i
    // stedet for en instruksjon. En forfatter som lar feltet stå tomt skal se hva som da gjelder,
    // uten å måtte lete etter en tabell.
    //
    // Produkteier 2026-09-06: å skrive langt er ikke vanskeligere enn å være kort. Feltet finnes
    // nettopp for at et avansert nivå skal kunne be om et kort, presist svar.
    const standardOmfang = ctx.LEVEL_SCOPE_DEFAULTS[certLevel] ?? ctx.LEVEL_SCOPE_DEFAULTS.intermediate;
    row(
      "shell.settings.scopeWords",
      `<input id="settingsScopeMin" class="settings-input" type="number" min="20" max="5000"
         value="${mod.scopeMinWords ?? ""}" placeholder="${standardOmfang.minWords}" />
       <span aria-hidden="true">–</span>
       <input id="settingsScopeMax" class="settings-input" type="number" min="20" max="5000"
         value="${mod.scopeMaxWords ?? ""}" placeholder="${standardOmfang.maxWords}" />
       <span class="settings-hint">${escapeHtml(t("shell.settings.scopeWordsHint"))}</span>`,
    );

    // date inputs need yyyy-mm-dd, not a localized rendering
    const asDateValue = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
    row(
      "shell.settings.validity",
      `<input id="settingsValidFrom" class="settings-input" type="date" value="${escapeHtml(asDateValue(mod.validFrom))}" />
       <span aria-hidden="true">→</span>
       <input id="settingsValidTo" class="settings-input" type="date" value="${escapeHtml(asDateValue(mod.validTo))}" />`,
    );

    group("shell.settings.groupAssessment");
    const mcqMinPercent = policy?.passRules?.mcqMinPercent;
    if (mode !== "FREETEXT_ONLY") {
      row(
        "shell.settings.mcqThreshold",
        // QA round 7: this used to show 70 when nothing was stored, and the save copied whatever was
        // on screen into `passRules` — so changing a validity date on a module with no policy at all
        // silently gave it an MCQ pass mark of 70. A candidate with a good total but 69 % on the
        // multiple choice would then fail a module that had no such rule the day before.
        //
        // Blank means "not set", exactly like the other three pass rules. That consistency is the
        // point of the redesign; this field was the one left behaving differently.
        `<input id="settingsMcqMinPercent" class="settings-input" type="number" min="0" max="100"
          value="${Number.isFinite(mcqMinPercent) ? escapeHtml(String(mcqMinPercent)) : ""}"
          placeholder="${escapeHtml(t("shell.settings.noLimit"))}" /> %`,
        false,
        "mcqThreshold",
      );
    }

    // The rest of the pass rules — the overall pass mark is the field most likely to be adjusted
    // after a calibration round, so it must be editable here («ett sted å gjøre hver ting»).
    //
    // Blank means "not set": decisionService falls back to the platform rules, and writing a number
    // in would turn a deliberate default into a per-module override nobody chose.
    //
    // Stage-tilbakemelding 2026-08-17 avdekket at "tomt = plattformstandard" bare gjelder EN av de
    // fire. decisionService.ts:101-132: totalMin faller tilbake på plattformverdien, mens de tre
    // andre er AV når de er tomme — ingen sperre i det hele tatt. Plassholderen sier derfor hva
    // tomt faktisk gjør for nettopp det feltet, i stedet for en felles forklaring som er usann for
    // tre av dem. Å fylle inn verdiene i stedet, som først foreslått, ville slått PÅ en sperre som
    // er av — akkurat feilen QA fant på MCQ-feltet.
    const numberRow = (labelKey, id, value, placeholderText, infoKey, suffix = " %", wide = false) =>
      row(
        labelKey,
        `<input id="${id}" class="settings-input${wide ? " settings-input--wide" : ""}" type="number" min="0" max="100"
          value="${Number.isFinite(Number(value)) && value !== null && value !== undefined ? escapeHtml(String(value)) : ""}"
          placeholder="${escapeHtml(placeholderText)}" />${suffix}`,
        false,
        infoKey,
      );
    // The one rule with a platform fallback: show the number it falls back TO, without storing it.
    const platformTotalMin = ctx.bundle?.platformDefaults?.totalMin;
    numberRow(
      "shell.settings.totalMin",
      "settingsTotalMin",
      policy?.passRules?.totalMin,
      Number.isFinite(platformTotalMin)
        ? tf("shell.settings.platformDefault", { value: platformTotalMin })
        : t("shell.settings.notSet"),
      "totalMin",
      " %",
      // The only field whose placeholder is a sentence rather than a word.
      true,
    );
    if (mode !== "MCQ_ONLY") {
      numberRow(
        "shell.settings.practicalMin",
        "settingsPracticalMin",
        policy?.passRules?.practicalMinPercent,
        t("shell.settings.noLimit"),
        "practicalMin",
      );
    }
    // ⚠️ Grensesonen gjelder IKKE for rene flervalgsmoduler — `resolveMcqOnlyDecision` har ingen
    // manuell-vurdering-sti i det hele tatt; et felt her ville latt som om det virket.
    if (mode !== "MCQ_ONLY") {
      const borderline = policy?.passRules?.borderlineWindow;
      // Hva skjer hvis feltet står tomt? Plattformen sender da et bånd under terskelen til sensor —
      // og båndet regnes fra MODULENS terskel, ikke den globale. Plassholderen viser det tallparet.
      //
      // ⚠️ Plassholder, ikke verdi. Å fylle inn tallene ville gjort en bevisst standard om til en
      // per-modul-overstyring ingen valgte — nøyaktig feilen QA fant på MCQ-feltet i runde 7.
      const below = ctx.bundle?.platformDefaults?.borderlineBelowMin;
      const effectiveMin = policy?.passRules?.totalMin ?? ctx.bundle?.platformDefaults?.totalMin;
      const hasDefault = Number.isFinite(Number(below)) && Number(below) > 0 && Number.isFinite(Number(effectiveMin));
      const defaultLow = hasDefault ? Math.max(0, Number(effectiveMin) - Number(below)) : null;
      const placeholderLow = hasDefault
        ? tf("shell.settings.platformDefault", { value: defaultLow })
        : t("shell.settings.noneShort");
      const placeholderHigh = hasDefault
        ? tf("shell.settings.platformDefault", { value: effectiveMin })
        : t("shell.settings.noneShort");
      row(
        "shell.settings.borderlineWindow",
        `<input id="settingsBorderlineMin" class="settings-input settings-input--wide" type="number" min="0" max="100"
          value="${Number.isFinite(Number(borderline?.min)) ? escapeHtml(String(borderline.min)) : ""}"
          placeholder="${escapeHtml(placeholderLow)}" />
         <span aria-hidden="true">→</span>
         <input id="settingsBorderlineMax" class="settings-input settings-input--wide" type="number" min="0" max="100"
          value="${Number.isFinite(Number(borderline?.max)) ? escapeHtml(String(borderline.max)) : ""}"
          placeholder="${escapeHtml(placeholderHigh)}" /> %`,
        false,
        "borderlineWindow",
      );
    }

    // #896 S3c: NO summary rows for criteria, assessment instruction or submission schema.
    //
    // Each of them used to have a row here showing the value AND a section further down editing it.
    // Three duplications inside one panel — reported from stage as "vurderingskriteria ligger nå 4
    // steder". The editors below carry their own summary; the row was the redundant half.

    // The scaling rule's practical weight. `max_total` is NOT editable: it is derived from the
    // criteria and shown there, so an input for it would be a second, conflicting way to set it.
    if (mode !== "MCQ_ONLY") {
      const practicalWeight = Number(cfg.rubricVersion?.scalingRule?.practical_weight);
      row(
        "shell.settings.practicalWeight",
        `<input id="settingsPracticalWeight" class="settings-input" type="number" min="0" max="100"
          value="${escapeHtml(String(Number.isFinite(practicalWeight) ? practicalWeight : 70))}" /> %`,
        false,
        "practicalWeight",
      );
    }

    // An unsaved draft and a settings save would fight over the same next version: the settings
    // save carries the PERSISTED content forward, so it would quietly drop whatever is in the
    // draft. Blocking with a reason beats a silent loss.
    const draftBlocks = !!ctx.sessionDraft;
    const actionHtml = draftBlocks
      ? `<p class="settings-empty">${escapeHtml(t("shell.settings.draftBlocks"))}</p>`
      : `<button type="button" id="settingsSave" class="btn-primary">${escapeHtml(t("shell.settings.save"))}</button>`;

    // A group with nothing in it is not rendered: MCQ_ONLY has no submission schema and no
    // criteria, and an empty heading reads as something that failed to load.
    const settingsGroup = (labelKey, ...parts) => {
      const body = parts.filter(Boolean).join("");
      if (!body.trim()) return "";
      return `<section class="settings-group" aria-labelledby="${labelKey.replace(/\./g, "-")}">
        <h3 id="${labelKey.replace(/\./g, "-")}" class="settings-group-title">${escapeHtml(t(labelKey))}</h3>
        ${body}
      </section>`;
    };
    const groupList = (labelKey) => {
      const items = groups.get(labelKey) ?? [];
      return items.length > 0 ? `<dl class="settings-list">${items.join("")}</dl>` : "";
    };

    // Lagre sits after every setting and before the history — the author reads down, edits, saves,
    // and only then looks at what came before. Putting it mid-panel made the fields below it look
    // like they belonged to something else.
    host.innerHTML = [
      settingsGroup("shell.settings.groupModule", groupList("shell.settings.groupModule")),
      settingsGroup(
        "shell.settings.groupAssessment",
        // Stage-tilbakemelding 2026-08-17: fem tall uten kontekst. Det uklare er ikke hva hvert felt
        // heter, men at grensene legges OPPÅ hverandre og at totalen vektes — det forklares én gang
        // her, ikke gjentatt i fem verktøytips. Feltdetaljene ligger bak i-ikonene.
        `<p class="settings-group-explainer">${escapeHtml(t("shell.settings.assessmentExplainer"))}</p>`,
        groupList("shell.settings.groupAssessment"),
        renderCriteriaSection(),
        renderPromptSection(),
      ),
      // Innsendingsskjema and Versjonshistorikk already carry their own headings, so they ARE the
      // group — wrapping them would print the same word twice. CSS gives those two headings the
      // same weight as the group titles above, which is what makes the four levels read as peers.
      renderSubmissionSchemaSection(),
      actionHtml,
      renderVersionHistory(),
    ].join("");
    mountCriteriaSection();
    mountPromptSection();
    mountSubmissionSchemaSection();

    // Stamp what was rendered, so hasUnsavedSettingsEdits can tell an edited field from an
    // untouched one. Without this, restoring silently discarded typed-but-unsaved settings.
    stampRenderedValues(SETTINGS_INPUT_IDS.panel);
    // Typevelgeren tegnes med den VALGTE typen (panelet tegnes om ved bytte), så stempelet må være
    // den lagrede typen — ellers er et typebytte aldri «ulagret», og Lagre i hodet står grå.
    const typeEl = document.getElementById("settingsModuleType");
    const storedMode = ctx.bundle?.selectedConfiguration?.moduleVersion?.assessmentMode;
    if (typeEl && storedMode) typeEl.dataset.renderedValue = storedMode;
    // #896 S3c: put back anything the author had typed but not saved. Expanding a section re-renders
    // the WHOLE panel, so opening the criteria editor after typing a new validity date silently
    // reverted the date. `renderedValue` above is the stored value; this restores the typed one on
    // top of it, so the dirty-check still knows the difference.
    restoreSettingsDraftValues();

    // Changing the type changes which fields the save can carry, so the panel redraws to match.
    // Without this the author picked "Bare flervalg" and kept looking at a criteria editor whose
    // contents the save would refuse — the choice and its consequences on two different screens.
    document.getElementById("settingsModuleType")?.addEventListener("change", () => {
      captureSettingsDraftValues();
      // The criteria editor lives in the DOM until something reads it, and a re-render throws that
      // DOM away. Typing in a criterion and then changing the type would have lost the text —
      // including on the way BACK to a type that has criteria. Read it out first.
      if (settingsCriteriaState !== null) {
        settingsCriteriaState = captureLatestCriteriaState(
          document.getElementById("settingsCriteriaEditor"),
          settingsCriteriaState,
        );
      }
      renderSettingsPanel();
    });

    document.getElementById("settingsSave")?.addEventListener("click", (event) => {
      // Disabled on the first click, like the restore buttons. A double-click on a slow connection
      // sent two concurrent POSTs and produced either two identical versions or a confusing
      // conflict; the idempotency key inside handles the lost-response retry, which is a different
      // problem. Re-enabled on the failure paths, since success re-renders the panel.
      event.currentTarget.disabled = true;
      void saveSettingsInBackground();
    });
    host.querySelectorAll("[data-restore-version]").forEach((button) => {
      button.addEventListener("click", () => {
        // #896 S6 QA: a physical double-click produced two calls with two different Date.now() keys,
        // so idempotency could not help — either two versions, or the second failing on the unique
        // (moduleId, versionNo). Disabling every restore button on the first click is what makes
        // "exactly one new version" true from the author's side; the server key covers the
        // lost-response retry, which is a different problem.
        host.querySelectorAll("[data-restore-version]").forEach((other) => { other.disabled = true; });
        void restoreModuleVersionInBackground(button.dataset.restoreVersion);
      });
    });
  }


  /**
   * #896 S3c: unsaved settings values survive a panel re-render.
   *
   * The panel is rebuilt from `ctx.bundle` every time a section is expanded or collapsed. Without this,
   * typing a validity date and then opening the criteria editor reverted the date — the author would
   * not necessarily notice, because their eyes were on the section they just opened.
   *
   * Captured before the rebuild, reapplied after. `renderedValue` still holds the STORED value, so
   * `hasUnsavedSettingsEdits` keeps working.
   */
  /**
   * Every input in Innstillinger, grouped by the section that renders it.
   *
   * QA 2026-08-16 found the four pass-rule fields added in v2.18.9 missing from BOTH the draft
   * preservation and the dirty check: typing a new overall pass mark and then expanding the
   * assessment instruction silently reverted it, and leaving the tab warned about nothing. The
   * cause was that this id list existed in six places — a stamping loop per section, a dirty check
   * per section, and two panel-wide lists — so adding a field meant remembering all six. It is one
   * list now, and `stampRenderedValues` / `anyFieldDirty` are the only readers.
   */
  const SETTINGS_INPUT_IDS = {
    // Rendered by renderSettingsPanel itself, so always present when the tab is open.
    panel: [
      "settingsModuleType", "settingsCertLevel", "settingsValidFrom", "settingsValidTo",
      "settingsMcqMinPercent", "settingsTotalMin", "settingsPracticalMin",
      "settingsBorderlineMin", "settingsBorderlineMax", "settingsPracticalWeight",
    ],
    // Inside collapsible sections: absent from the DOM until the author expands them.
    prompt: ["settingsPromptSystem", "settingsPromptUser", "settingsPromptExamples"],
    schema: ["settingsSchemaLabel", "settingsSchemaPlaceholder"],
  };
  const SETTINGS_TEXT_INPUT_IDS = [
    ...SETTINGS_INPUT_IDS.panel, ...SETTINGS_INPUT_IDS.prompt, ...SETTINGS_INPUT_IDS.schema,
  ];

  /**
   * Record what the DOM was rendered with, so an edit can be told from an untouched field.
   *
   * Goes through `fieldStateValue` (#973) rather than reading `.value`: every field in the panel is
   * text, a number or a select TODAY, and the day one of them is a checkbox the dirty check must not
   * quietly start comparing the constant `"on"` with itself.
   */
  function stampRenderedValues(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.dataset.renderedValue = fieldStateValue(el);
    }
  }

  /** True when any of `ids` holds something other than what it was rendered with. */
  function anyFieldDirty(ids) {
    return ids.some((id) => {
      const el = document.getElementById(id);
      return el && el.dataset.renderedValue !== undefined && fieldStateValue(el) !== el.dataset.renderedValue;
    });
  }

  let settingsDraftValues = null;

  // The Save button is disabled on click to stop a double-submit. Every path that returns without
  // saving has to put it back, or the panel is dead until the next re-render.
  function reenableSettingsSave() {
    const btn = document.getElementById("settingsSave");
    if (btn) btn.disabled = false;
  }

  function captureSettingsDraftValues() {
    // QA 2026-08-16 round 3: this REPLACED the cache with whatever was on screen, so an edit made in
    // a section that is now collapsed — and therefore absent from the DOM — was thrown away the
    // moment a sibling section was opened. Editing the instruction, folding it, opening the answer
    // field and unfolding the instruction again silently restored the stored text.
    //
    // Start from what is already cached and let the live DOM override it: a field that is present
    // is authoritative for itself, and one that is absent keeps whatever was last typed into it.
    const dirty = { ...(settingsDraftValues ?? {}) };
    for (const id of SETTINGS_TEXT_INPUT_IDS) {
      const el = document.getElementById(id);
      if (!el || el.dataset.renderedValue === undefined) continue;
      if (fieldStateValue(el) !== el.dataset.renderedValue) dirty[id] = fieldStateValue(el);
      // Present and back to its stored value: the author undid the edit, so drop the stale entry
      // rather than resurrect it on the next render.
      else delete dirty[id];
    }
    settingsDraftValues = Object.keys(dirty).length > 0 ? dirty : null;
  }

  /**
   * The value of a settings field, whether or not its section is currently open.
   *
   * QA 2026-08-16 round 3: `promptDirty` and `schemaDirty` read only live DOM elements, so an edit
   * made and then folded away counted as no change at all — "ingen endringer" and no POST if it was
   * the only edit, or a save that wrote everything except it. Collapsing a section is not undoing it.
   */
  function settingsFieldValue(id) {
    const el = document.getElementById(id);
    if (el) return fieldStateValue(el);
    return settingsDraftValues?.[id];
  }

  /** True when this ONE field differs from what was stored, counting a collapsed section. */
  function fieldIsDirty(id) {
    const el = document.getElementById(id);
    if (el) return el.dataset.renderedValue !== undefined && fieldStateValue(el) !== el.dataset.renderedValue;
    return settingsDraftValues?.[id] !== undefined;
  }

  /**
   * Merge an edited localized field, or hand back the stored value untouched.
   *
   * QA round 5: a section is saved as a unit, so editing the system instruction ran
   * `mergeLocaleInto` over the user template too. A stored bare string means "one language, not
   * translated yet" — merging an untouched one turned it into `{nb: "…", "en-GB": "…"}` with the
   * same text in both, asserting an English translation nobody wrote. Same rule the criteria editor
   * already follows: only what changed is rewritten.
   */
  function mergeSettingsField(id, stored) {
    if (!fieldIsDirty(id)) return stored;
    return mergeLocaleInto(stored, ctx.contentLocale, settingsFieldValue(id) ?? "");
  }

  /** True when any of `ids` differs from its stored value, counting collapsed sections. */
  function anyFieldDirtyIncludingCollapsed(ids) {
    return ids.some((id) => {
      const el = document.getElementById(id);
      if (el) return el.dataset.renderedValue !== undefined && fieldStateValue(el) !== el.dataset.renderedValue;
      return settingsDraftValues?.[id] !== undefined;
    });
  }

  function restoreSettingsDraftValues() {
    if (!settingsDraftValues) return;
    for (const [id, value] of Object.entries(settingsDraftValues)) {
      const el = document.getElementById(id);
      // A field belonging to a collapsed section is simply not in the DOM; its value stays in
      // `settingsDraftValues` until the section is opened again.
      // Symmetrical with `captureSettingsDraftValues`, which stores what `fieldStateValue` read
      // (#973) — a cache written by one accessor and read back by another is how the state of a
      // tickable field gets lost on the way through.
      if (el) applyFieldStateValue(el, value);
    }
  }

  // #896 S3c: the criteria editor's state while Innstillinger is open. Module-level, because the
  // panel re-renders on every settings change and a closure would lose the author's edits each time.
  // `null` = not opened this visit; an array = opened, and whatever is in it is what will be saved.
  let settingsCriteriaState = null;
  // #896 S3c, forfatterbeslutning 2026-08-16: kriteriene står ALLTID åpne, så det finnes ingen
  // sammenslått tilstand å holde styr på. Spesifikasjonens begrunnelse for å flytte dem hit var at
  // de «endres sjelden etter at den er satt» — men i praksis varierer genererte moduler mye, så de
  // er verdt et blikk hver gang man er innom. Instruks og svarfelt er fortsatt sammenslått: de er
  // lange, og endres faktisk sjelden.

  function settingsCriteriaSource() {
    return ctx.sessionDraft?.criteria ?? ctx.bundle?.selectedConfiguration?.rubricVersion?.criteria ?? null;
  }

  // The record the section opened with, so the save can tell an edit from a visit.
  let settingsCriteriaBaseline = null;

  // What ctx.sessionDraft.criteria held when the panel was opened, so "Forkast" can put it back.
  // undefined = nothing captured yet; null = the draft had no criteria at all.
  let settingsCriteriaDraftBaseline;

  /**
   * #896 S3c: discard everything the Innstillinger panel is holding that is tied to one module.
   *
   * Five separate variables, cleared in one place because clearing four of five is the bug this
   * epic keeps producing. Called when a module is loaded (the state belongs to the previous one)
   * and after a settings save (what was typed is now what is stored).
   */
  /**
   * Throw away unsaved settings work, on purpose, because the author said so.
   *
   * Distinct from `resetSettingsPanelState`, which runs when the panel's subject changes. This one
   * is the answer to "Forkast": the criteria editor AND the cache that holds folded-away fields.
   * Clearing only what is on screen left the folded edits to reappear later — the author was told
   * their changes were discarded and they were not.
   */
  function discardSettingsEdits() {
    // QA round 6: criteria edits are absorbed into the session draft as they are made, so clearing
    // only the panel state left them in the draft — they came back and were saved, after the author
    // had confirmed "Forkast". Put the draft's criteria back to what they were when the panel was
    // opened, so discarding means the same thing for every field in it.
    if (ctx.sessionDraft && settingsCriteriaDraftBaseline !== undefined) {
      const restored = { ...ctx.sessionDraft };
      if (settingsCriteriaDraftBaseline === null) delete restored.criteria;
      else restored.criteria = settingsCriteriaDraftBaseline;
      ctx.sessionDraft = restored;
    }
    settingsCriteriaState = null;
    settingsCriteriaBaseline = null;
    settingsCriteriaDraftBaseline = undefined;
    settingsDraftValues = null;
  }

  function resetSettingsPanelState() {
    settingsCriteriaState = null;
    settingsCriteriaBaseline = null;
    // QA round 7: left behind, this belonged to the PREVIOUS module — and a later language switch
    // would write its criteria onto the new draft, or delete them when it was null.
    settingsCriteriaDraftBaseline = undefined;
    settingsPromptExpanded = false;
    settingsSchemaExpanded = false;
    settingsDraftValues = null;
  }

  function renderCriteriaSection() {
    if (!ctx.bundle) return "";
    // #665: MCQ-only modules have no rubric, so no criteria to show.
    if (settingsSelectedMode() === "MCQ_ONLY") return "";

    // Read the stored criteria the first time the panel renders them. Re-reading on every render
    // would discard edits, since the panel rebuilds whenever anything else in it changes.
    if (settingsCriteriaState === null) {
      settingsCriteriaState = buildEditorStateFromCriteriaRecord(settingsCriteriaSource(), ctx.contentLocale);
      settingsCriteriaBaseline = buildCriteriaRecordFromEditorState(settingsCriteriaState);
      settingsCriteriaDraftBaseline = ctx.sessionDraft?.criteria ?? null;
    }

    // Always open, and therefore no summary row above it: the editor IS the summary. A row listing
    // the criteria plus a section editing them was the duplication reported from stage.
    return `<section class="settings-criteria-section" aria-labelledby="settingsCriteriaHeading">
      <h3 id="settingsCriteriaHeading" class="settings-subsection-title">${
        escapeHtml(tf("shell.criteria.title", { count: settingsCriteriaState.length }))
      }</h3>
      <div id="settingsCriteriaEditor" class="settings-criteria-editor">${
        buildCriteriaEditorHtml(settingsCriteriaState, t, tf)
      }</div>
    </section>`;
  }

  /**
   * QA 2026-08-16: carry a criteria edit into the session draft while one exists.
   *
   * While there is an unsaved draft, Innstillinger has NO Lagre button — saving settings would
   * carry the persisted content forward and drop the draft, so it is deliberately blocked. But the
   * criteria editor still accepts edits, and they were written only to `settingsCriteriaState`.
   * Confirming the draft reads `ctx.sessionDraft.criteria`, so an author who generated a module and then
   * adjusted its criteria in Innstillinger saved the GENERATED criteria, silently, every time.
   *
   * `settingsCriteriaSource()` already prefers `ctx.sessionDraft.criteria` when reading; this is the
   * matching write. The baseline moves with it, because an edit that is safely in the draft is not
   * unsaved work and must not raise the exit warning.
   */
  function syncSettingsCriteriaToDraft() {
    if (!ctx.sessionDraft || settingsCriteriaState === null) return;
    // Typing into a label never reaches `settingsCriteriaState` — only add/remove do — so the live
    // DOM is the truth here, exactly as it is on the settings-save path.
    const state = captureLatestCriteriaState(
      document.getElementById("settingsCriteriaEditor"),
      settingsCriteriaState,
    );
    const record = buildCriteriaRecordFromEditorState(state);
    if (!record) return;
    settingsCriteriaState = state;
    ctx.sessionDraft = { ...ctx.sessionDraft, criteria: record };
    // The baseline deliberately does NOT move. It answers one question — "has the author changed
    // anything since the panel opened?" — and moving it on every sync made the answer always "no",
    // which let background generation overwrite manual edits and let a language switch roll them
    // back (QA round 7, three findings from this one line).
  }

  function mountCriteriaSection() {
    const container = document.getElementById("settingsCriteriaEditor");
    if (!container) return;

    // Typing never reaches the editor state — only Add and Remove do — so `change` (which fires on
    // blur, including the blur caused by clicking a tab) is when a typed criterion becomes part of
    // the draft. No-op when there is no draft.
    container.addEventListener("change", () => { syncSettingsCriteriaToDraft(); });

    wireCriteriaEditor({
      container,
      getState: () => settingsCriteriaState ?? [],
      // NO sync here. QA 2026-08-16 round 3: `syncSettingsCriteriaToDraft` re-reads the DOM, and
      // `setState` runs BEFORE `rerender` has drawn the new cards — so Add read one card too few and
      // dropped the new criterion, Remove read the removed card back in, and regeneration replaced
      // the generated list with the old DOM while still reporting success. The sync belongs at the
      // exits (`unsavedTabSwitchKind`, `applyTabState`), where state and DOM agree.
      setState: (next) => { settingsCriteriaState = next; },
      rerender: () => {
        container.innerHTML = buildCriteriaEditorHtml(settingsCriteriaState ?? [], t, tf);
        // After the redraw, so the sync reads the cards that now exist. Add and Remove go through
        // here, and doing it from setState (round 3) read the DOM one redraw too early.
        syncSettingsCriteriaToDraft();
      },
      onRegenerate: () => regenerateCriteriaFromTask(container, (newList) => {
        settingsCriteriaState = newList;
        container.innerHTML = buildCriteriaEditorHtml(settingsCriteriaState, t, tf);
        // After the redraw, not before: the DOM is what the sync reads.
        syncSettingsCriteriaToDraft();
      }),
    });
  }

  /** Has the author changed the criteria since the panel opened? Independent of where they land. */
  function settingsCriteriaEdited() {
    if (settingsCriteriaState === null) return false;
    const current = buildCriteriaRecordFromEditorState(
      captureLatestCriteriaState(document.getElementById("settingsCriteriaEditor"), settingsCriteriaState),
    );
    return JSON.stringify(current) !== JSON.stringify(settingsCriteriaBaseline);
  }

  /**
   * Is there criteria work a tab or language switch would DESTROY?
   *
   * Only when there is no session draft. With one, the edits are absorbed into it as they are made,
   * so the switch keeps them — and the dialog the author then sees says exactly that.
   */
  function hasUnsavedCriteriaEdits() {
    return settingsCriteriaEdited() && !ctx.sessionDraft;
  }

  /**
   * #896 S3c: the assessment instruction (prompt) editor.
   *
   * One language at a time, per §7 — the workspace edits in the content language and the other two
   * are merged, not overwritten.
   *
   * Examples stay a JSON textarea. They are an array of free-shaped objects
   * consumed by the LLM, and inventing a structured editor for them here would be a guess at a shape
   * nothing else in the system constrains.
   */
  let settingsPromptExpanded = false;

  function renderPromptSection() {
    if (!ctx.bundle) return "";
    // QA round 4: an MCQ-only version has no prompt, and the save omits the whole rubric/prompt
    // branch for it — but the editor was still drawn. Editing the instruction on an MCQ-only module
    // produced a new, identical version and a green confirmation, with the edit nowhere in the
    // payload and gone after reload. Same rule as the criteria editor: if the save cannot carry it,
    // do not offer it.
    if (settingsSelectedMode() === "MCQ_ONLY") return "";
    const prompt = ctx.bundle.selectedConfiguration?.promptTemplateVersion ?? null;
    const localeLabel = escapeHtml(tf("shell.settings.editingInLocale", { locale: ctx.contentLocale }));

    if (!settingsPromptExpanded) {
      return `<section class="settings-criteria-section">
        <div class="settings-criteria-head">
          <h3 class="settings-subsection-title">${escapeHtml(t("shell.settings.assessmentPrompt"))}</h3>
          <button type="button" id="settingsPromptToggle" class="btn-secondary settings-criteria-toggle"
            aria-expanded="false" aria-controls="settingsPromptEditor">${escapeHtml(t("shell.settings.promptEdit"))}</button>
        </div>
        <div id="settingsPromptEditor" hidden></div>
      </section>`;
    }

    const sys = escapeHtml(localizeValueForLocale(prompt?.systemPrompt ?? "", ctx.contentLocale));
    const user = escapeHtml(localizeValueForLocale(prompt?.userPromptTemplate ?? "", ctx.contentLocale));
    const examples = escapeHtml(JSON.stringify(prompt?.examples ?? [], null, 2));

    return `<section class="settings-criteria-section">
      <div class="settings-criteria-head">
        <h3 class="settings-subsection-title">${escapeHtml(t("shell.settings.assessmentPrompt"))}</h3>
        <button type="button" id="settingsPromptToggle" class="btn-secondary settings-criteria-toggle"
          aria-expanded="true" aria-controls="settingsPromptEditor">${escapeHtml(t("shell.settings.criteriaDone"))}</button>
      </div>
      <div id="settingsPromptEditor" class="settings-criteria-editor">
        <p class="settings-empty">${localeLabel}</p>
        <label class="settings-field-label" for="settingsPromptSystem">${escapeHtml(t("shell.settings.promptSystem"))}</label>
        <textarea id="settingsPromptSystem" class="settings-textarea" rows="4">${sys}</textarea>
        <label class="settings-field-label" for="settingsPromptUser">${escapeHtml(t("shell.settings.promptUser"))}</label>
        <textarea id="settingsPromptUser" class="settings-textarea" rows="4">${user}</textarea>
        <label class="settings-field-label" for="settingsPromptExamples">${escapeHtml(t("shell.settings.promptExamples"))}</label>
        <textarea id="settingsPromptExamples" class="settings-textarea settings-textarea--mono" rows="4">${examples}</textarea>
      </div>
    </section>`;
  }

  function mountPromptSection() {
    const toggle = document.getElementById("settingsPromptToggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      captureSettingsDraftValues();
      settingsPromptExpanded = !settingsPromptExpanded;
      renderSettingsPanel();
    });
    stampRenderedValues(SETTINGS_INPUT_IDS.prompt);
  }

  /**
   * #896 S3c: the submission schema — what the participant is asked to fill in.
   *
   * One field, per #901: the backend, the participant view and the assessment all support several,
   * but the admin UI clamps it to one and that limitation is tracked separately. Editing the first
   * field here rather than pretending the others do not exist: any extra fields are carried through
   * untouched, so a module authored via the API keeps them.
   */
  let settingsSchemaExpanded = false;

  function renderSubmissionSchemaSection() {
    if (!ctx.bundle) return "";
    const field = ctx.bundle.selectedConfiguration?.moduleVersion?.submissionSchema?.fields?.[0] ?? null;

    if (!settingsSchemaExpanded) {
      return `<section class="settings-criteria-section">
        <div class="settings-criteria-head">
          <h3 class="settings-group-title">${escapeHtml(t("shell.settings.submissionSchema"))}</h3>
          <button type="button" id="settingsSchemaToggle" class="btn-secondary settings-criteria-toggle"
            aria-expanded="false" aria-controls="settingsSchemaEditor">${escapeHtml(t("shell.settings.schemaEdit"))}</button>
        </div>
        <div id="settingsSchemaEditor" hidden></div>
      </section>`;
    }

    const label = escapeHtml(localizeValueForLocale(field?.label ?? "", ctx.contentLocale));
    const placeholder = escapeHtml(localizeValueForLocale(field?.placeholder ?? "", ctx.contentLocale));
    return `<section class="settings-criteria-section">
      <div class="settings-criteria-head">
        <h3 class="settings-group-title">${escapeHtml(t("shell.settings.submissionSchema"))}</h3>
        <button type="button" id="settingsSchemaToggle" class="btn-secondary settings-criteria-toggle"
          aria-expanded="true" aria-controls="settingsSchemaEditor">${escapeHtml(t("shell.settings.criteriaDone"))}</button>
      </div>
      <div id="settingsSchemaEditor" class="settings-criteria-editor">
        <p class="settings-empty">${escapeHtml(tf("shell.settings.editingInLocale", { locale: ctx.contentLocale }))}</p>
        <label class="settings-field-label" for="settingsSchemaLabel">${escapeHtml(t("shell.settings.schemaLabel"))}</label>
        <input id="settingsSchemaLabel" class="settings-input" type="text" value="${label}" />
        <label class="settings-field-label" for="settingsSchemaPlaceholder">${escapeHtml(t("shell.settings.schemaPlaceholder"))}</label>
        <input id="settingsSchemaPlaceholder" class="settings-input" type="text" value="${placeholder}" />
      </div>
    </section>`;
  }

  function mountSubmissionSchemaSection() {
    const toggle = document.getElementById("settingsSchemaToggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      captureSettingsDraftValues();
      settingsSchemaExpanded = !settingsSchemaExpanded;
      renderSettingsPanel();
    });
    stampRenderedValues(SETTINGS_INPUT_IDS.schema);
  }

  /**
   * #896 S5: the list of saved versions, and the way back to one of them.
   *
   * Every «Mellomlagring» already wrote a row — the data has been there since long before this UI.
   * What was missing was any way to SEE it, so "I liked the previous wording better" meant retyping
   * from memory.
   *
   * The current version has no restore button: restoring it would create an identical copy and
   * nothing else, which is a confusing way to spend a click.
   */
  function renderVersionHistory() {
    const versions = [...(ctx.bundle?.versions?.moduleVersions ?? [])].sort(
      (a, b) => (b?.versionNo ?? 0) - (a?.versionNo ?? 0),
    );
    if (versions.length === 0) return "";

    const currentId = ctx.bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
    const activeId = ctx.bundle?.module?.activeVersionId ?? null;

    const items = versions.map((version) => {
      const isCurrent = version.id === currentId;
      const isLive = version.id === activeId;
      const badges = [
        isLive ? `<span class="version-badge live">${escapeHtml(t("shell.versions.live"))}</span>` : "",
        isCurrent && !isLive ? `<span class="version-badge current">${escapeHtml(t("shell.versions.current"))}</span>` : "",
      ].join("");
      const when = version.createdAt
        ? `<span class="version-when">${escapeHtml(formatDateTime(version.createdAt))}</span>`
        : "";
      // No restore button on the version already loaded — it would copy the module onto itself.
      // aria-label carries the version number: a screen-reader user tabbing a list of five
      // identically-named "Restore" buttons has no way to tell which one goes where.
      const action = isCurrent
        ? ""
        : `<button type="button" class="btn-secondary version-restore" data-restore-version="${escapeHtml(version.id)}"
            aria-label="${escapeHtml(tf("shell.versions.restoreVersionAria", { versionNo: version.versionNo }))}">${
            escapeHtml(t("shell.versions.restore"))
          }</button>`;
      return `<li class="version-item">
        <span class="version-no">${escapeHtml(tf("shell.versions.versionNo", { versionNo: version.versionNo }))}</span>
        ${when}${badges}${action}
      </li>`;
    });

    return `<section class="version-history" aria-labelledby="versionHistoryHeading">
      <h3 id="versionHistoryHeading" class="settings-group-title">${escapeHtml(t("shell.versions.heading"))}</h3>
      <p class="settings-empty">${escapeHtml(t("shell.versions.explainer"))}</p>
      <ul class="version-list">${items.join("")}</ul>
    </section>`;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(ctx.currentLocale === "en-GB" ? "en-GB" : "nb-NO", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /**
   * #896 S5: restore. The server copies the chosen version forward into a NEW version — history is
   * append-only, so this is undoable by restoring whatever came before it.
   */
  async function restoreModuleVersionInBackground(sourceVersionId, idempotencyKey = null) {
    const moduleId = ctx.selectedModuleId;
    if (!moduleId || !sourceVersionId) return;

    // Unsaved work would be lost: the restore writes the next version from STORED content, so
    // whatever is only in the browser never reaches the database. That includes the settings inputs,
    // which are DOM-only until Lagre — `ctx.sessionDraft` says nothing about them.
    const losesWork = !!ctx.sessionDraft || hasUnsavedSettingsEdits();
    if (losesWork && !window.confirm(t("shell.versions.confirmDiscardDraft"))) return;

    // One key per restore ACTION, reused by the retry. Without it a lost response leaves the author
    // choosing between "retry and maybe get two versions" and "do not retry and maybe get none";
    // with it, the retry either finds the committed result or performs the restore once.
    const key = idempotencyKey ?? `restore-${moduleId}-${sourceVersionId}-${Date.now()}`;

    const slot = logProgress("shell.versions.restoreProgress");
    slot.abortBtn.remove();

    try {
      const result = await apiFetch(
        `/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions/${encodeURIComponent(sourceVersionId)}/restore`,
        getHeaders,
        { method: "POST", body: JSON.stringify({}), headers: { "Idempotency-Key": key } },
      );
      const restoredId = result?.moduleVersion?.id ?? null;
      ctx.latestSavedModuleVersionId = restoredId;
      ctx.sessionDraft = null;
      ctx.previewDraft = null;
      await loadModule(moduleId);
      // Restore is triggered from Innstillinger, but what the author wants to see afterwards is the
      // restored CONTENT.
      switchToTab("edit");

      // loadModule swallows its own fetch errors, so reaching this line does NOT prove the workspace
      // is showing the restored version. Saying "restored" over the previous content would be the
      // worst of both: the change happened, and the screen argues otherwise.
      const shown = ctx.bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
      if (restoredId && shown !== restoredId) {
        logResolveSlot(slot, () => escapeHtml(t("shell.versions.restoreReloadFailed")), [
          { labelKey: "shell.action.retry", action: () => loadModule(moduleId) },
        ]);
        showToast(t("shell.versions.restoreReloadFailed"), "error");
        return;
      }

      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.versions.restoreSuccess"))}</strong>`);
      showToast(t("shell.versions.restoreSuccess"), "success");
      announceStatus(t("shell.versions.restoreSuccess"));
    } catch (err) {
      const errMsg = apiErrorText(err);
      // The click disabled every restore button to stop a double-click. A success path reloads and
      // re-renders them; a failure has to put them back by hand, or the list is dead until reload.
      document.querySelectorAll("[data-restore-version]").forEach((button) => { button.disabled = false; });
      logResolveSlot(slot, () => `${escapeHtml(t("shell.versions.restoreError"))}${escapeHtml(errMsg)}`, [
        // Same key: a retry after a lost response must not create a second version.
        { labelKey: "shell.action.retry", action: () => restoreModuleVersionInBackground(sourceVersionId, key) },
      ]);
    }
  }

  // The settings inputs live only in the DOM until Lagre. Their rendered values are stamped on the
  // elements so anything that reloads the module can tell whether it would be throwing away edits.
  function hasUnsavedSettingsEdits() {
    // Every field in the panel — plus the ones inside COLLAPSED sections, which are not in the DOM
    // at all and whose typed values live only in `settingsDraftValues`.
    //
    // Only entries whose field is currently absent count from there. A field that is on screen is
    // judged by the DOM, because the snapshot is taken before a re-render and goes stale the moment
    // the author reverts the value by hand — trusting it would warn about an edit that is no longer
    // there, and a warning the author knows is wrong is a warning they learn to click through.
    const heldInCollapsedSection = Object.keys(settingsDraftValues ?? {}).some(
      (id) => document.getElementById(id) === null,
    );
    return anyFieldDirty(SETTINGS_TEXT_INPUT_IDS) || heldInCollapsedSection || hasUnsavedCriteriaEdits();
  }

  /**
   * #896 S3b: save the settings as a new module version.
   *
   * Everything not shown here is carried forward from the current version by reference, so the
   * save changes the setup and nothing else. Content belonging to a type that is being switched
   * away from is NOT deleted — it stays on the previous version, and switching back brings it
   * into view again. That is what "beholdes, ikke slettes" means in a versioned model.
   */
  async function saveSettingsInBackground() {
    const moduleId = ctx.selectedModuleId;
    if (!moduleId || !ctx.bundle) return;

    const cfg = ctx.bundle.selectedConfiguration ?? {};
    const version = cfg.moduleVersion ?? null;
    const mode = document.getElementById("settingsModuleType")?.value ?? version?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
    const thresholdInput = document.getElementById("settingsMcqMinPercent");
    // No `?? ctx.SHELL_MCQ_ONLY_MIN_PERCENT` here: that fallback made the guard below unreachable, so an
    // out-of-range or fractional threshold was silently saved as 70 — the exact behaviour the guard
    // was written to prevent.
    const mcqMinPercent = thresholdInput ? parsePercentInRange(thresholdInput.value, 0, 100) : null;

    const isMcqOnly = mode === "MCQ_ONLY";
    const isFreetextOnly = mode === "FREETEXT_ONLY";

    // Blank is a legitimate value — "no per-module override" — and must not be treated as invalid.
    // Only a filled field that does not parse is the author's mistake to see.
    const thresholdBlank = !thresholdInput || thresholdInput.value.trim() === "";
    // An out-of-range threshold is the author's mistake to see, not something to quietly turn
    // into 70. parsePercentInRange returns null for 101, for 72.5 and for gibberish alike.
    if (thresholdInput && !thresholdBlank && !isFreetextOnly && mcqMinPercent === null) {
      showToast(t("shell.settings.invalidThreshold"), "error");
      thresholdInput.focus();
      reenableSettingsSave();
      return;
    }

    // Falling back to history: switching back to a type needs the components the CURRENT version
    // stopped pointing at. Newest first, matching how the ctx.bundle orders them.
    const latestRubricId = cfg.rubricVersion?.id ?? ctx.bundle.versions?.rubricVersions?.[0]?.id;
    const latestPromptId = cfg.promptTemplateVersion?.id ?? ctx.bundle.versions?.promptTemplateVersions?.[0]?.id;
    const latestMcqId = cfg.mcqSetVersion?.id ?? ctx.bundle.versions?.mcqSetVersions?.[0]?.id;
    const latestTaskVersion = version?.taskText
      ? version
      : (ctx.bundle.versions?.moduleVersions ?? []).find((v) => !!localizeValue(v?.taskText));

    // The policy is carried whole. Sending only the MCQ rule would drop totalMin, the practical
    // minimum and the borderline window — pass/fail rules the author never touched, silently
    // reverting to platform defaults on a mode change.
    const existingPolicy = version?.assessmentPolicy ?? null;
    const passRules = { ...(existingPolicy?.passRules ?? {}) };
    if (isFreetextOnly || (thresholdInput && thresholdBlank)) {
      // Blank clears the override, the same as the other three pass rules. Before this, a module
      // with no policy showed a placeholder 70 that the save wrote in for real.
      delete passRules.mcqMinPercent;
    } else if (mcqMinPercent !== null) {
      passRules.mcqMinPercent = mcqMinPercent;
    }

    // #896 S3c: the rest of the pass rules, now editable here. An EMPTY field means "not set" and
    // removes the per-module override — decisionService then falls back to the platform rules. That
    // is a real, distinct choice from "set it to 0", so the two cannot be collapsed.
    const readOptionalPercent = (id) => {
      const el = document.getElementById(id);
      if (!el) return { present: false };
      const raw = el.value.trim();
      if (raw === "") return { present: true, value: null };
      const parsed = parsePercentInRange(raw, 0, 100);
      return { present: true, value: parsed };
    };
    const policyFieldSpecs = [
      { id: "settingsTotalMin", key: "totalMin" },
      { id: "settingsPracticalMin", key: "practicalMinPercent" },
    ];
    for (const { id, key } of policyFieldSpecs) {
      const read = readOptionalPercent(id);
      if (!read.present) continue;
      if (read.value === null && document.getElementById(id).value.trim() !== "") {
        showToast(t("shell.settings.invalidThreshold"), "error");
        document.getElementById(id).focus();
        // Without this the author fixes the number and finds Lagre dead — the click handler
        // disables it, so every early return has to hand it back.
        reenableSettingsSave();
        return;
      }
      if (read.value === null) delete passRules[key];
      else passRules[key] = read.value;
    }
    const bMin = readOptionalPercent("settingsBorderlineMin");
    const bMax = readOptionalPercent("settingsBorderlineMax");
    if (bMin.present || bMax.present) {
      if (bMin.value === null && bMax.value === null) {
        delete passRules.borderlineWindow;
      } else if (bMin.value === null || bMax.value === null || bMin.value > bMax.value) {
        // Half a window is not a window, and a reversed one silently matches nothing.
        showToast(t("shell.settings.invalidBorderline"), "error");
        document.getElementById("settingsBorderlineMin")?.focus();
        reenableSettingsSave();
      return;
      } else {
        passRules.borderlineWindow = { min: bMin.value, max: bMax.value };
      }
    }

    const policy = existingPolicy || Object.keys(passRules).length > 0
      ? { ...(existingPolicy ?? {}), passRules }
      : null;

    // Module-level fields. Sent only when the author actually changed them, so a mode switch
    // does not rewrite a description or a date the panel merely displayed.
    const certInput = document.getElementById("settingsCertLevel");
    const scopeMinInput = document.getElementById("settingsScopeMin");
    const scopeMaxInput = document.getElementById("settingsScopeMax");
    /** Tomt felt er `null` — «bruk nivåets standard» — ikke 0 og ikke «ingen endring». */
    const scopeVerdi = (el) => {
      const v = el?.value?.trim();
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };
    const mod = ctx.bundle.module ?? {};
    const fromInput = document.getElementById("settingsValidFrom");
    const toInput = document.getElementById("settingsValidTo");
    // One value, not one per language — see `certificationLevelValue`. The QA-round-2 defect was
    // that the comparison read a different locale than the one on screen, which made an untouched
    // level look changed; with a single value there is no locale to get wrong.
    const currentCert = certificationLevelValue(ctx.bundle.module?.certificationLevel);
    const currentFrom = ctx.bundle.module?.validFrom ? new Date(ctx.bundle.module.validFrom).toISOString().slice(0, 10) : "";
    const currentTo = ctx.bundle.module?.validTo ? new Date(ctx.bundle.module.validTo).toISOString().slice(0, 10) : "";

    if (fromInput?.value && toInput?.value && toInput.value < fromInput.value) {
      showToast(t("shell.settings.invalidValidity"), "error");
      toInput.focus();
      reenableSettingsSave();
      return;
    }

    const moduleFields = {
      // Replaced outright, and deliberately: the level is one value on a fixed scale, so there is
      // nothing from another language to preserve. (This is the opposite of the title, description
      // and criteria, which ARE prose and must be merged — the difference is what the field means,
      // not how it happens to be typed.)
      // Never `null`: the schema does not accept it (see the select above), and a blank selection
      // is only reachable when the level was already unset — in which case there is no change.
      ...(certInput && certInput.value.trim() && certInput.value.trim() !== currentCert
        ? { certificationLevel: certInput.value.trim() }
        : {}),
      // #1049: tomt felt = null = «tilbake til nivåets standard». Derfor sammenlignes mot den LAGREDE
      // verdien, ikke mot falsy: en forfatter som tømmer feltet ber om å angre, og det må sendes.
      ...(scopeMinInput && scopeVerdi(scopeMinInput) !== (mod.scopeMinWords ?? null)
        ? { scopeMinWords: scopeVerdi(scopeMinInput) } : {}),
      ...(scopeMaxInput && scopeVerdi(scopeMaxInput) !== (mod.scopeMaxWords ?? null)
        ? { scopeMaxWords: scopeVerdi(scopeMaxInput) } : {}),
      ...(fromInput && fromInput.value !== currentFrom ? { validFrom: fromInput.value || null } : {}),
      ...(toInput && toInput.value !== currentTo ? { validTo: toInput.value || null } : {}),
    };

    // Same rule as the edit form: nothing changed, nothing written. Without this, opening
    // Innstillinger and pressing Lagre out of habit creates a module version identical to the
    // last one — #896's "ingen endringer ⇒ ingen ny versjon" applies here too.
    const currentMode = version?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
    const currentThreshold = version?.assessmentPolicy?.passRules?.mcqMinPercent;
    const thresholdChanged = thresholdInput
      ? mcqMinPercent !== (Number.isFinite(currentThreshold) ? currentThreshold : ctx.SHELL_MCQ_ONLY_MIN_PERCENT)
      : false;
    // The whole pass-rule object, not just the MCQ threshold. Adding the other three rules to the
    // payload without adding them here meant editing the overall pass mark hit "no changes" and
    // nothing was written — the field existed and did nothing.
    const policyChanged = JSON.stringify(passRules) !== JSON.stringify(existingPolicy?.passRules ?? {});
    // #896 S3c: criteria edited here ride along as an INLINE rubric, exactly as the direct-edit save
    // does. Referencing `rubricVersionId` would carry the old criteria forward and quietly discard
    // what the author just typed.
    const criteriaRecord = hasUnsavedCriteriaEdits()
      ? buildCriteriaRecordFromEditorState(
          captureLatestCriteriaState(document.getElementById("settingsCriteriaEditor"), settingsCriteriaState),
        )
      : null;

    // #896 S3c: the practical weight lives on the rubric's scalingRule, so changing it means writing
    // a rubric — the criteria come along unchanged when they were not edited.
    const weightInput = document.getElementById("settingsPracticalWeight");
    const storedWeight = Number(cfg.rubricVersion?.scalingRule?.practical_weight);
    const practicalWeight = weightInput ? parsePercentInRange(weightInput.value, 0, 100) : null;
    const weightChanged = Boolean(
      weightInput && practicalWeight !== (Number.isFinite(storedWeight) ? storedWeight : 70),
    );
    if (weightInput && weightInput.value.trim() !== "" && practicalWeight === null) {
      // Out of range or not a whole number is the author's mistake to see, not something to round.
      showToast(t("shell.settings.invalidWeight"), "error");
      weightInput.focus();
      reenableSettingsSave();
      return;
    }

    // #896 S3c: the assessment instruction. Edited in ONE language, merged onto the stored value —
    // the composer writes it verbatim, so sending only the edited locale would delete the other two.
    const promptDirty = anyFieldDirtyIncludingCollapsed(SETTINGS_INPUT_IDS.prompt);
    let promptPayload = null;
    if (promptDirty) {
      const stored = cfg.promptTemplateVersion ?? {};
      const examplesRaw = settingsFieldValue("settingsPromptExamples");
      let examples = stored.examples ?? [];
      if (examplesRaw !== undefined) {
        try {
          const parsed = JSON.parse(examplesRaw || "[]");
          if (!Array.isArray(parsed)) throw new Error("not an array");
          examples = parsed;
        } catch {
          // Malformed JSON is the author's to see, not something to silently drop or guess at.
          // The field may be folded away, in which case there is nothing to focus — the message
          // still has to appear, or the save fails without a reason.
          showToast(t("shell.settings.promptExamplesInvalid"), "error");
          document.getElementById("settingsPromptExamples")?.focus();
          reenableSettingsSave();
          return;
        }
      }
      const systemPrompt = mergeSettingsField("settingsPromptSystem", stored.systemPrompt);
      const userPromptTemplate = mergeSettingsField("settingsPromptUser", stored.userPromptTemplate);
      if (!systemPrompt || !userPromptTemplate) {
        showToast(t("shell.settings.promptRequired"), "error");
        reenableSettingsSave();
      return;
      }
      promptPayload = { systemPrompt, userPromptTemplate, examples };
    }

    // #896 S3c: the submission schema. Only the FIRST field is editable (#901), and the rest are
    // carried through untouched — a module authored via the API can legitimately have several, and
    // rebuilding the array from one input would delete them.
    const schemaDirty = anyFieldDirtyIncludingCollapsed(SETTINGS_INPUT_IDS.schema);
    let submissionSchemaPayload = null;
    if (schemaDirty) {
      const existing = version?.submissionSchema ?? buildDefaultSubmissionSchema();
      const fields = (existing.fields ?? []).map((f) => ({ ...f }));
      const first = fields[0] ?? { id: "response", type: "textarea", required: true };
      const label = mergeSettingsField("settingsSchemaLabel", first.label);
      if (!label) {
        showToast(t("shell.settings.schemaLabelRequired"), "error");
        reenableSettingsSave();
      return;
      }
      const placeholder = mergeSettingsField("settingsSchemaPlaceholder", first.placeholder);
      fields[0] = { ...first, label, ...(placeholder ? { placeholder } : {}) };
      submissionSchemaPayload = { ...existing, fields };
    }

    // QA 2026-08-16: switching to MCQ-only in the SAME save as a criteria, instruction or weight
    // edit dropped the edit without a word. The version model keeps stored free-text content on the
    // previous version — switching back brings it into view — but an edit that was never saved has
    // no previous version to survive on, so it is simply gone, and switching back shows the OLD
    // criteria as if nothing had been typed. Refusing is the only honest option: the author can
    // save the edit first, or undo it, and both are recoverable. Guessing is not.
    if (isMcqOnly && mode !== currentMode && (criteriaRecord || promptPayload || weightChanged)) {
      showToast(t("shell.settings.mcqOnlyDiscardsEdits"), "error");
      // Put the type back and redraw. Since the panel started following the dropdown, picking
      // MCQ-only hides the criteria and instruction editors — so a refusal that said "save them
      // first or undo them" left the author with no editor to do either in. Reverting restores the
      // editors WITH the edit still in them, which is what makes the message actionable.
      const typeInput = document.getElementById("settingsModuleType");
      if (typeInput) typeInput.value = currentMode;
      renderSettingsPanel();
      reenableSettingsSave();
      return;
    }

    if (
      mode === currentMode && !thresholdChanged && !criteriaRecord && !promptPayload
      && !submissionSchemaPayload && !weightChanged && !policyChanged && Object.keys(moduleFields).length === 0
    ) {
      showToast(t("shell.settings.noChanges"), "info");
      reenableSettingsSave();
      return;
    }

    const body = {
      ...moduleFields,
      assessmentMode: mode,
      ...(isMcqOnly ? {} : {
        // Same stripping here: this carries the STORED content forward, so any blank locale already
        // in the database would otherwise fail a settings-only save the author never touched.
        taskText: dropBlankLocales(latestTaskVersion?.taskText) ?? latestTaskVersion?.taskText,
        assessorExpectedContent:
          dropBlankLocales(latestTaskVersion?.assessorExpectedContent) ?? latestTaskVersion?.assessorExpectedContent,
        candidateTaskConstraints: dropBlankLocales(latestTaskVersion?.candidateTaskConstraints),
        // Inline rubric when the author edited criteria here, otherwise keep referencing the
        // existing one. Sending both would be ambiguous; sending only the id would drop the edit.
        // A rubric is written when the criteria OR the practical weight changed — both live on the
        // same row, so either one means a new version of it. `criteriaRecord` falls back to the
        // stored criteria so a weight-only change does not rewrite them.
        ...(criteriaRecord || weightChanged
          ? {
              rubric: (() => {
                const criteria = criteriaRecord
                  ?? buildCriteriaRecordFromEditorState(
                    buildEditorStateFromCriteriaRecord(cfg.rubricVersion?.criteria ?? null, ctx.contentLocale),
                  );
                return {
                  criteria,
                  scalingRule: {
                    ...(cfg.rubricVersion?.scalingRule ?? {}),
                    max_total: Object.values(criteria ?? {}).reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1,
                    practical_weight: weightChanged
                      ? practicalWeight
                      : (cfg.rubricVersion?.scalingRule?.practical_weight ?? 70),
                  },
                };
              })(),
            }
          : { rubricVersionId: latestRubricId }),
        // Same either/or as the rubric: a new inline prompt, or a reference to the existing one.
        ...(promptPayload ? { promptTemplate: promptPayload } : { promptTemplateVersionId: latestPromptId }),
      }),
      ...(isFreetextOnly ? {} : { mcqSetVersionId: latestMcqId }),
      ...(policy ? { assessmentPolicy: policy } : {}),
      ...(submissionSchemaPayload
        ? { submissionSchema: submissionSchemaPayload }
        : (version?.submissionSchema ? { submissionSchema: version.submissionSchema } : {})),
    };

    const slot = logProgress("shell.settings.saving");
    slot.abortBtn.remove();
    const versionBefore = version?.id ?? null;
    try {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/versions`, getHeaders, {
        method: "POST",
        // A lost response must not turn one Lagre into two versions on retry.
        headers: { "Idempotency-Key": `settings-${moduleId}-${Date.now()}` },
        body: JSON.stringify(body),
      });
      await loadModule(moduleId);
      // The criteria the author typed are now the stored ones, so the panel state is discarded and
      // the next render reads them back from the ctx.bundle. Keeping it would report unsaved edits
      // forever and warn on every exit from a tab with nothing left to lose. (loadModule above
      // already does this; the call is kept so the reset does not depend on that being true.)
      resetSettingsPanelState();
      renderSettingsPanel();
      // loadModule swallows its own fetch errors, so a 502 on the reload would leave the panel
      // showing the previous version under a green toast. Verify what came back instead of
      // trusting that it came back at all.
      const reloadedMode = ctx.bundle?.selectedConfiguration?.moduleVersion?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
      // Check the module-level fields too. When certification or validity was the only change,
      // comparing the mode alone always matched and a failed reload still showed green.
      // Both sides through the same reader, so the comparison cannot be confused by the shape the
      // value happens to be stored in. (Round 3 had this comparing a locale object against a
      // localized string, which was never equal — every successful edit reported a stale reload.)
      const reloadedCert = certificationLevelValue(ctx.bundle?.module?.certificationLevel);
      const savedCert = moduleFields.certificationLevel === undefined
        ? undefined
        : certificationLevelValue(moduleFields.certificationLevel);
      const certStale = savedCert !== undefined && reloadedCert !== savedCert;
      // Validity too. Checking mode and certification only meant a date-only change always compared
      // equal on the two fields that were checked, so a failed reload still showed green over the
      // old date — the exact hole the check was added to close, left open for one more field.
      const asDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
      const datesStale = ["validFrom", "validTo"].some(
        (field) => moduleFields[field] !== undefined && asDay(ctx.bundle?.module?.[field]) !== asDay(moduleFields[field]),
      );
      // The check above only looks at mode, certification and dates. A criteria-, prompt-, schema-
      // or weight-only save changes none of them, so a failed reload compared equal on everything
      // that WAS checked and reported success over the old configuration. Every successful save
      // writes a NEW module version, so the version id is the one signal that covers all of them.
      const reloadedVersionId = ctx.bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
      const versionStale = versionBefore !== null && reloadedVersionId === versionBefore;
      if (reloadedMode !== mode || certStale || datesStale || versionStale) {
        logResolveSlot(slot, () => escapeHtml(t("shell.settings.savedStale")));
        showToast(t("shell.settings.savedStale"), "info");
        return;
      }
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.settings.saved"))}</strong>`);
      showToast(t("shell.settings.saved"), "success");
    } catch (error) {
      // The composed save is all-or-nothing, so the module is untouched. Årsaken er som regel
      // handlingsbar, så den skal med — men #972: den skal komme fra klientens egen kodetabell, ikke
      // fra serverens `body.message`. Den forrige varianten (`error?.body?.message || …`) viste
      // engelsk servertekst i et konsoll forfatteren kanskje har satt til nynorsk.
      const message = apiErrorText(error);
      logResolveSlot(slot, () => escapeHtml(`${t("shell.settings.saveFailed")} ${message}`));
      showToast(t("shell.settings.saveFailed"), "error");
      reenableSettingsSave();
    }
  }

  return {
    renderSettingsPanel, syncSettingsCriteriaToDraft, resetSettingsPanelState, mergeSettingsField, captureSettingsDraftValues, hasUnsavedSettingsEdits, discardSettingsEdits, settingsCriteriaEdited,
    // Tilstand skallet trengte å nullstille eller lese utenfra — nå som metoder.
    /** Språkbytte: editorene ble sådd i det forrige språket; kast dem så neste tegning leser på nytt. */
    resetLocaleBoundState() {
      settingsCriteriaState = null;
      settingsCriteriaBaseline = null;
      settingsCriteriaDraftBaseline = undefined;
      settingsDraftValues = null;
    },
    /** Fanebytte bort fra Innstillinger: les kriterieeditoren ut av DOM-en før neste tegning kaster den. */
    captureCriteriaStateFromDom() {
      if (settingsCriteriaState !== null) {
        settingsCriteriaState = captureLatestCriteriaState(document.getElementById("settingsCriteriaEditor"), settingsCriteriaState);
      }
    },
    /** Avbryt i hodet på Innstillinger. */
    clearDraftValues() { settingsDraftValues = null; },
  };
}
