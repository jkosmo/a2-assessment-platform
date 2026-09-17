// #1046 punkt 2 (16.09): kriteriene og planavviket (#450 B3), skilt ut fra admin-content-shell.js.
//
// Kriterieeditoren (legg til/fjern/endre, ny id), «Behold kriteriene» / «Regenerer fra ny plan» /
// «Vis hva som ville endret seg» med diff-modalen, sammenslåing av foreslåtte kriterier og lagring
// som ny rubrikkversjon, og regenerering av kriterier fra oppgaveteksten. Brukes av Innstillinger-
// fanen og forhåndsvisningens avviksbanner. Det den trenger fra skallet kommer inn som `ctx`;
// koden er flyttet, ikke skrevet om — kommentarene følger med.

import { escapeHtml } from "./html-escape.js";
import { mergeLocaleInto } from "./localized-value.js";
import { apiFetch } from "/static/api-client.js";
import { showToast } from "/static/toast.js";
import { localizeValueForLocale } from "/static/admin-content-preview.js";
import { captureLatestCriteriaState, buildDriftDiffModalHtml, computeCriteriaDiff } from "/static/criteria-editor.js";

/**
 * @param {object} ctx  skallets tilstand som get/set-egenskaper og skallets funksjoner som referanser.
 */
export function createCriteriaTools(ctx) {
  const {
    t, tf, logProgress, logResolveSlot, apiErrorText, getHeaders, loadModule, renderPreview, refreshBlueprintHash, getActiveBlueprint, slugifyLabel, certificationLevelForGeneration,
  } = ctx;

  /**
   * A fresh criterion id that collides with nothing already in the editor.
   *
   * QA round 4 fixed "add, remove, add reuses an id" with a counter; QA round 5 pointed out the
   * counter restarts on page load, so a rubric that already contains `new_criterion_1` gets it
   * handed out a second time — and `Object.fromEntries` keeps only the last one. Check the state.
   */
  function freshCriterionId(existing) {
    const taken = new Set((existing ?? []).map((c) => String(c?.id ?? "")));
    let candidate;
    do {
      nextNewCriterionSeq += 1;
      candidate = `new_criterion_${nextNewCriterionSeq}`;
    } while (taken.has(candidate));
    return candidate;
  }

  let nextNewCriterionSeq = 0;

  function wireCriteriaEditor({ container, getState, setState, rerender, onRegenerate }) {
    if (!container) return;

    // QA 2026-08-16: this was a second, byte-for-byte copy of `captureLatestCriteriaState`, and when
    // that one learned to carry the locale metadata (#902) this one did not — so Add or Remove threw
    // `storedLabel` away and the next save wrote bare strings, deleting the other two languages.
    // Deduplicated rather than patched: two copies of a DOM read is how the bug happened.
    const captureFromDom = () => {
      setState(captureLatestCriteriaState(container, getState()));
    };

    container.addEventListener("input", (e) => {
      if (e.target.classList?.contains("vk-weight")) {
        const card = e.target.closest(".vk-card");
        const valueEl = card?.querySelector(".vk-weight-value");
        if (valueEl) valueEl.textContent = String(e.target.value);
        // B4 (#451) a11y: keep aria-valuenow + aria-valuetext in sync during drag/arrow-key use.
        e.target.setAttribute("aria-valuenow", String(e.target.value));
        e.target.setAttribute("aria-valuetext", tf("shell.criteria.weightOfTen", { value: e.target.value }));
        const total = Array.from(container.querySelectorAll(".vk-weight"))
          .reduce((sum, el) => sum + (Number(el.value) || 0), 0);
        const totalEl = container.querySelector(".vk-total-value");
        if (totalEl) totalEl.textContent = String(total);
      }
      // B4 (#451) a11y: the remove button must always say "Fjern: {current label}", not the name
      // it had at render time.
      if (e.target.classList?.contains("vk-label")) {
        const card = e.target.closest(".vk-card");
        const removeBtn = card?.querySelector(".vk-remove");
        if (removeBtn) {
          const idx = Number(card.dataset.criterionIndex ?? 0) + 1;
          const newLabel = String(e.target.value ?? "").trim();
          removeBtn.setAttribute(
            "aria-label",
            newLabel
              ? tf("shell.criteria.removeAriaWithLabel", { label: newLabel })
              : tf("shell.criteria.removeAriaPositional", { index: idx }),
          );
        }
      }
    });

    container.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      // The stepper and the visibility toggle write to the SAME `vk-weight` / `vk-visible` inputs the
      // save and the tests already read, then fire `input`/`change` so the existing listeners run.
      // One source of truth per value; the buttons are only a smaller way to reach it.
      if (btn.classList.contains("vk-step")) {
        const range = btn.closest(".vk-stepper")?.querySelector(".vk-weight");
        if (!range) return;
        const next = Math.max(1, Math.min(10, (Number(range.value) || 5) + Number(btn.dataset.step)));
        if (next === Number(range.value)) return;
        range.value = String(next);
        range.dispatchEvent(new Event("input", { bubbles: true }));
        range.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      if (btn.classList.contains("vk-visible-toggle")) {
        const box = btn.querySelector(".vk-visible");
        if (!box) return;
        box.checked = !box.checked;
        btn.setAttribute("aria-pressed", box.checked ? "true" : "false");
        const glyph = btn.querySelector("span[aria-hidden]");
        if (glyph) glyph.textContent = box.checked ? "◉" : "○";
        box.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      if (btn.classList.contains("vk-remove")) {
        captureFromDom();
        // QA round 6: removing the LAST criterion could not be saved. An empty list builds a `null`
        // record, and every save path reads `null` as "no criteria change" — so the deletion was
        // dropped and the old criterion came back, or Lagre said "ingen endringer". A rubric needs
        // at least one criterion, so say that instead of accepting an action that cannot take.
        if (getState().length <= 1) {
          showToast(t("shell.criteria.lastCriterionRequired"), "error");
          return;
        }
        const idx = Number(btn.dataset.criterionIndex);
        if (Number.isFinite(idx)) {
          const next = getState();
          next.splice(idx, 1);
          setState(next);
          rerender();
        }
      } else if (btn.classList.contains("vk-add")) {
        captureFromDom();
        const next = getState();
        // #902: a new criterion has nothing stored, but it IS being typed in a specific language,
        // so it is saved as a one-locale map rather than a bare string the reader would have to
        // guess at. `storedLabel: null` (not undefined) is what selects the merging path.
        next.push({
          // Not `new_criterion_${length + 1}`: the list SHRINKS on remove, so add, remove, add would
          // produce the same id twice — and `Object.fromEntries` keeps the last entry per key, so one
          // of the two would vanish at save time without a word.
          // A counter that only ever goes up cannot collide.
          id: freshCriterionId(next), label: "", description: "", maxScore: 5,
          candidateVisible: false, storedLabel: null, storedDescription: null, locale: ctx.contentLocale,
        });
        setState(next);
        rerender();
        const inputs = container.querySelectorAll(".vk-label");
        inputs[inputs.length - 1]?.focus();
      } else if (btn.classList.contains("vk-regenerate")) {
        captureFromDom();
        // No confirm here: nothing is persisted yet — close without saving and the edits are gone
        // anyway. The drift-banner confirm stays, because that one writes immediately.
        onRegenerate?.();
      }
    });
  }

  // B2 (#449 redesign): one-shot DOM-to-state capture, used when leaving edit mode. Re-reads
  // every visible criterion card and returns a fresh array; falls back to the closure's last
  // known state if the container has already been torn down. Same shape as criteriaEditorState
  // items but read from inputs to avoid stale-state bugs.

  // B2 (#449 redesign): transform editor-state array into storage-shape record (id-keyed).
  // Drops criteria with blank labels (they're noise). Auto-id new criteria from a slug of
  // the label, falling back to "criterion_N" if the slug ends up empty. Weight is computed
  // as a fraction of maxScore over the total — keeps the existing scalingRule.max_total math
  // happy. Returns null when no usable criteria, so callers can fall through to ensure-rubric.
  function buildCriteriaRecordFromEditorState(criteria) {
    const valid = (criteria ?? []).filter((c) => c && c.label && c.label.trim());
    if (valid.length === 0) return null;
    const totalMax = valid.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1;
    return Object.fromEntries(valid.map((c, idx) => {
      const baseId = c.id ?? slugifyLabel(c.label) ?? `criterion_${idx + 1}`;
      // #902: merge the edited language into whatever was stored. A criterion the editor never
      // localized (`storedLabel` absent — a brand-new one, or a caller that does not track it)
      // keeps the old bare-string behaviour, which the reader still understands as "one language".
      const locale = c.locale ?? ctx.contentLocale;
      // An UNTOUCHED field keeps its stored value byte for byte. Merging it would turn a bare
      // string — "one language, not translated yet" — into a two-locale map asserting the same
      // text is valid in both, which is a translation nobody made.
      const mergeIfEdited = (stored, edited) => {
        if (stored === undefined) return edited;
        if (edited === localizeValueForLocale(stored ?? "", locale)) return stored;
        return mergeLocaleInto(stored, locale, edited);
      };
      const label = mergeIfEdited(c.storedLabel, c.label) ?? c.label;
      const description = mergeIfEdited(c.storedDescription, c.description ?? "") ?? "";
      return [String(baseId), {
        label,
        description,
        maxScore: Number(c.maxScore),
        weight: Number(((Number(c.maxScore) || 0) / totalMax).toFixed(2)),
        candidateVisible: Boolean(c.candidateVisible),
        // B3 (#450): direct-edit always counts as manual editing — the user explicitly chose
        // these values. Used by the drift "Regenerer fra ny plan" confirm prompt so we warn
        // before overwriting. False positives (treating every edit as manual) are acceptable.
        manuallyEdited: true,
      }];
    }));
  }

  // B3 (#450): "Behold kriteriene" — patch the active rubric's blueprint-hash to the current
  // hash so the drift banner hides. Criteria unchanged.
  //
  // #915: the server now creates a NEW rubric version (same criteria, new hash) instead of patching
  // the old one in place — so a restored older module version keeps the hash it was authored with.
  // The bundle is patched to point at the new version, so the next save attaches it
  // (`latestRubricId` reads `cfg.rubricVersion.id`). Until saved, a reload shows the banner again —
  // correctly: the persisted draft still references the old rubric.
  async function handleDriftKeep() {
    if (!ctx.selectedModuleId) return;
    const hash = ctx.currentBlueprintHash;
    if (!hash) return;
    try {
      const result = await apiFetch(
        `/api/admin/content/modules/${encodeURIComponent(ctx.selectedModuleId)}/rubric-versions/sync-blueprint`,
        getHeaders,
        { method: "POST", body: JSON.stringify({ blueprintHash: hash, rubricVersionId: ctx.bundle?.selectedConfiguration?.rubricVersion?.id ?? undefined }) },
      );
      // Patch bundle in place so we don't clobber unsaved sessionDraft via full reload.
      const cfgRubric = ctx.bundle?.selectedConfiguration?.rubricVersion;
      if (cfgRubric && result?.rubricVersionId) {
        const previousId = cfgRubric.id;
        cfgRubric.id = result.rubricVersionId;
        if (typeof result.versionNo === "number") cfgRubric.versionNo = result.versionNo;
        cfgRubric.scalingRule = { ...(cfgRubric.scalingRule ?? {}), generated_from_blueprint_hash: hash };
        if (Array.isArray(ctx.bundle?.versions?.rubricVersions) && result.rubricVersionId !== previousId) {
          ctx.bundle.versions.rubricVersions.unshift({ ...cfgRubric });
        }
      }
      renderPreview();
      showToast(t("shell.drift.keep.success"), "success");
    } catch (err) {
      showToast(`${t("shell.drift.keep.error")}: ${apiErrorText(err)}`, "error");
    }
  }

  // B3 (#450): "Regenerer fra ny plan" — if any criterion was manually edited, confirm with
  // the user first (their edits will be overwritten). Then POST /rubric-versions/ensure with
  // force:true to generate + persist a new RubricVersion against the current blueprint, and
  // reload the module to pick up the new versionNo and stored hash.
  async function handleDriftRegenerate() {
    if (!ctx.selectedModuleId) return;
    if (hasManuallyEditedCriteria() && !window.confirm(t("shell.drift.regenerate.confirm"))) return;

    const moduleVersion = ctx.bundle?.selectedConfiguration?.moduleVersion;
    const taskText = localizeValueForLocale(
      ctx.sessionDraft?.taskText ?? moduleVersion?.taskText ?? "",
      ctx.contentLocale,
    );
    const assessorText = localizeValueForLocale(
      ctx.sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
      ctx.contentLocale,
    );
    const constraintsText = localizeValueForLocale(
      ctx.sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
      ctx.contentLocale,
    );
    if (!taskText || !assessorText) {
      showToast(t("shell.drift.regenerate.missingTask"), "error");
      return;
    }
    const blueprint = getActiveBlueprint();

    const slot = logProgress("shell.drift.regenerate.progress");
    try {
      await apiFetch(
        `/api/admin/content/modules/${encodeURIComponent(ctx.selectedModuleId)}/rubric-versions/ensure`,
        getHeaders,
        {
          method: "POST",
          body: JSON.stringify({
            taskText,
            assessorExpectedContent: assessorText,
            candidateTaskConstraints: constraintsText || undefined,
            certificationLevel: certificationLevelForGeneration(),
            locale: ctx.contentLocale,
            ...(blueprint ? { blueprint } : {}),
            force: true,
          }),
        },
      );
      logResolveSlot(slot, () => escapeHtml(t("shell.drift.regenerate.success")));
      // Clear any direct-edit override — the freshly persisted rubric is now the truth.
      if (ctx.sessionDraft?.criteria) {
        ctx.sessionDraft = { ...ctx.sessionDraft, criteria: null };
      }
      await loadModule(ctx.selectedModuleId);
      await refreshBlueprintHash();
    } catch (err) {
      logResolveSlot(slot, () =>
        `${escapeHtml(t("shell.drift.regenerate.error"))}: ${escapeHtml(apiErrorText(err))}`,
      );
    }
  }

  // B3 (#450): "Vis hva som ville endret seg" — call /generate/rubric (dry-run, doesn't
  // persist) to see what the LLM would now produce given the new blueprint. Diff against the
  // existing rubric criteria, then offer accept-all / accept-selected. User can also cancel.
  async function handleDriftShowDiff() {
    if (!ctx.selectedModuleId) return;
    const moduleVersion = ctx.bundle?.selectedConfiguration?.moduleVersion;
    const taskText = localizeValueForLocale(
      ctx.sessionDraft?.taskText ?? moduleVersion?.taskText ?? "",
      ctx.contentLocale,
    );
    const assessorText = localizeValueForLocale(
      ctx.sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
      ctx.contentLocale,
    );
    const constraintsText = localizeValueForLocale(
      ctx.sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
      ctx.contentLocale,
    );
    if (!taskText || !assessorText) {
      showToast(t("shell.drift.regenerate.missingTask"), "error");
      return;
    }
    const blueprint = getActiveBlueprint();

    // QA round 5: I changed this request to send `requestedLocale` without declaring it here — it
    // only existed inside regenerateCriteriaFromTask. Every "show what would change" threw a
    // ReferenceError that the catch below reported as a generation error, so the action was dead.
    const requestedLocale = ctx.contentLocale;
    const slot = logProgress("shell.drift.diff.progress");
    let result;
    try {
      result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          taskText,
          assessorExpectedContent: assessorText,
          candidateTaskConstraints: constraintsText || undefined,
          certificationLevel: certificationLevelForGeneration(),
          locale: requestedLocale,
          ...(blueprint ? { blueprint } : {}),
        }),
      });
    } catch (err) {
      logResolveSlot(slot, () =>
        `${escapeHtml(t("shell.drift.diff.error"))}: ${escapeHtml(apiErrorText(err))}`,
      );
      return;
    }
    logResolveSlot(slot, () => escapeHtml(t("shell.drift.diff.computed")));

    const newCriteriaArr = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
    // QA round 6: the request captured `requestedLocale`, but the response was tagged with the
    // LIVE locale. Switch language while the call is in flight and the generated text is filed
    // under a language it was never written in.
    const newCriteriaRecord = llmCriteriaArrayToStorageRecord(newCriteriaArr, requestedLocale);
    const existing = ctx.bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
    const diff = computeCriteriaDiff(existing, newCriteriaRecord, ctx.contentLocale);

    openDriftDiffModal(diff, newCriteriaRecord);
  }

  // B3 (#450): mirror of moduleRubricToStoragePayload's criteria branch. LLM returns an array
  // (with .id, .label, .description, .maxScore, .candidateVisible per item); storage wants a
  // record keyed by id with weight derived from maxScore.
  /**
   * @param locale the language the generator was ASKED for. Required: the record it produces is
   *   written straight to storage, and a bare string there means "one language, not translated" —
   *   which the reader resolves as bokmal. QA round 4: generating with an English UI therefore
   *   filed English criteria as Norwegian, and a later English edit produced a two-locale map whose
   *   Norwegian side was already the English text.
   */
  function llmCriteriaArrayToStorageRecord(arr, locale) {
    const valid = (arr ?? []).filter((c) => c && c.label && c.label.trim());
    const totalMax = valid.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1;
    const tag = (text) => (locale && text ? { [locale]: text } : text);
    return Object.fromEntries(valid.map((c, idx) => {
      const baseId = String(c.id ?? slugifyLabel(c.label) ?? `criterion_${idx + 1}`);
      return [baseId, {
        label: tag(c.label ?? ""),
        description: tag(c.description ?? ""),
        maxScore: Number(c.maxScore) || 0,
        weight: Number(((Number(c.maxScore) || 0) / totalMax).toFixed(2)),
        candidateVisible: Boolean(c.candidateVisible),
      }];
    }));
  }

  // B3 (#450): per-criterion diff — categorise each id as "added" (only in new), "removed"
  // (only in existing), "changed" (id present in both but label/description/maxScore differs),
  // or "unchanged". Returns parallel arrays keyed for easy modal rendering. Compares by `id`
  // so an LLM relabeling the same criterion would still match — risk we accept (id stability
  // is the LLM's job, not ours).
  /**
   * The readable text of a criterion field, whether it is a bare string or a locale map.
   *
   * The drift diff both COMPARES and RENDERS these values, and it used `String(...)` for each — fine
   * while everything was a bare string, useless the moment a locale object appears.
   */


  function hasManuallyEditedCriteria() {
    const criteria = ctx.bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
    return Object.values(criteria).some((c) => c && typeof c === "object" && c.manuallyEdited === true);
  }


  // B3 (#450): full-screen modal showing the diff. Accept-all triggers a single regenerate
  // against the LLM's proposal (writes a new RubricVersion with the proposed criteria).
  // Accept-selected lets the author pick a subset (checkboxes); the resulting rubric is a
  // merge of existing + selected proposals.
  function openDriftDiffModal(diff, proposedRecord) {
    // B4 (#451) a11y: remember the element that triggered the modal so focus can return
    // to it on close — without this, keyboard users lose their place.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overlay = document.createElement("div");
    overlay.className = "drift-diff-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "driftDiffTitle");
    overlay.innerHTML = buildDriftDiffModalHtml(diff, ctx.contentLocale, t, tf);
    document.body.appendChild(overlay);

    // B4 a11y: focus trap + ESC handler. The trap is implemented as a Tab/Shift-Tab handler
    // on the overlay that wraps focus inside the modal's focusable elements. ESC closes.
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusables = () => Array.from(overlay.querySelectorAll(focusableSelector))
      .filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);

    const keyHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener("keydown", keyHandler);

    const close = () => {
      overlay.removeEventListener("keydown", keyHandler);
      overlay.remove();
      // B4 a11y: return focus to the opener so keyboard users land back where they were.
      opener?.focus?.();
    };

    overlay.querySelector('[data-diff-action="close"]')?.addEventListener("click", close);
    overlay.querySelector('[data-diff-action="cancel"]')?.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    overlay.querySelector('[data-diff-action="accept-all"]')?.addEventListener("click", async () => {
      close();
      // #919: «godta alle» is the same decision as ticking every box, so it takes the same road.
      // Handing `proposedRecord` straight to the save skipped the locale merge entirely — and it is
      // the button an author in a hurry presses, so it was the likelier way to lose the two
      // languages that were not on screen.
      const allIds = new Set([
        ...diff.added.map(({ id }) => id),
        ...diff.removed.map(({ id }) => id),
        ...diff.changed.map(({ id }) => id),
      ]);
      await persistMergedRubric(mergeProposedCriteria(diff, proposedRecord, allIds));
    });

    overlay.querySelector('[data-diff-action="accept-selected"]')?.addEventListener("click", async () => {
      const acceptedIds = Array.from(overlay.querySelectorAll('input[data-diff-checkbox]:checked'))
        .map((input) => input.getAttribute("data-criterion-id"))
        .filter(Boolean);
      if (acceptedIds.length === 0) {
        showToast(t("shell.drift.diff.noneSelected"), "error");
        return;
      }
      close();
      const merged = mergeProposedCriteria(diff, proposedRecord, new Set(acceptedIds));
      await persistMergedRubric(merged);
    });

    // B4 a11y: focus the modal's first focusable on open (default: the close button) so
    // keyboard/screen-reader users land inside the dialog instead of staying outside.
    const initial = getFocusables()[0];
    initial?.focus?.();
  }


  // B3 (#450): build the storage-shape record from "merge existing criteria with the proposed
  // changes the user accepted". Logic per id:
  //   - added id, accepted     → use proposed
  //   - added id, not accepted → drop (not present in result)
  //   - removed id, accepted   → drop (user accepted the removal)
  //   - removed id, not accepted → keep existing
  //   - changed id, accepted   → proposed MERGED onto existing (#919 — see below)
  //   - changed id, not accepted → keep existing
  //   - unchanged              → keep existing
  // Weights are recomputed from the resulting maxScore totals so scalingRule.max_total stays
  // coherent — done downstream by the backend on POST, but we pre-normalise here too.
  function mergeProposedCriteria(diff, proposedRecord, acceptedIds) {
    const result = {};
    const existing = ctx.bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};

    for (const { id } of diff.unchanged) {
      result[id] = existing[id];
    }
    for (const { id, prev } of diff.removed) {
      if (!acceptedIds.has(id)) result[id] = prev;
    }
    for (const { id } of diff.changed) {
      result[id] = acceptedIds.has(id) ? mergeProposedCriterion(existing[id], proposedRecord[id]) : existing[id];
    }
    for (const { id } of diff.added) {
      // Nothing to merge against — a brand-new criterion exists in exactly the language the
      // generator was asked for, and `llmCriteriaArrayToStorageRecord` already tagged it as such.
      if (acceptedIds.has(id)) result[id] = proposedRecord[id];
    }

    const totalMax = Object.values(result).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
    for (const [id, c] of Object.entries(result)) {
      const maxScore = Number(c?.maxScore) || 0;
      result[id] = { ...c, weight: Number((maxScore / totalMax).toFixed(2)) };
    }
    return result;
  }

  /**
   * #919: fold an accepted drift proposal into the criterion it replaces, instead of replacing it.
   *
   * Same class as #892/#902/#905, and the same rule as the regeneration path got in v2.18.10: the
   * composition writes localized fields VERBATIM, so a surface that shows one language must merge
   * that language in itself. The generator is asked for `contentLocale` and answers in it —
   * `llmCriteriaArrayToStorageRecord` tags the answer `{[locale]: text}` — so accepting a proposal
   * wholesale wrote a one-locale map over a criterion that had three, and deleted two translations
   * the author never saw and never edited. See doc/FEATURE_SURFACE_MAP.md point 21.
   *
   * Everything that is NOT localized (maxScore, candidateVisible) comes from the proposal: that is
   * the change being accepted. Only `label` and `description` are merged.
   */
  function mergeProposedCriterion(stored, proposed) {
    if (!proposed || typeof proposed !== "object") return proposed;
    if (!stored || typeof stored !== "object") return proposed;
    return {
      ...proposed,
      label: mergeProposedLocalizedField(stored.label, proposed.label),
      description: mergeProposedLocalizedField(stored.description, proposed.description),
    };
  }

  /**
   * Merge every locale the proposal actually carries into the stored value, and leave the rest of
   * the stored value byte for byte. A stored value that does not exist has nothing to merge onto,
   * so the proposal stands as it is.
   */
  function mergeProposedLocalizedField(stored, proposed) {
    if (stored === undefined || stored === null || stored === "") return proposed;
    const entries = typeof proposed === "string"
      // A bare string from the generator carries no locale marker, and the one language it can
      // honestly be attributed to is the one it was asked for.
      ? [[ctx.contentLocale, proposed]]
      : Object.entries(proposed ?? {}).filter(([, text]) => typeof text === "string");
    if (entries.length === 0) return stored;
    let next = stored;
    for (const [locale, text] of entries) next = mergeLocaleInto(next, locale, text);
    return next ?? proposed;
  }

  // B3 (#450): POST the merged criteria as a new RubricVersion. Server-side createRubricVersion
  // bumps versionNo and stamps generated_from_blueprint_hash via scalingRule passed here.
  async function persistMergedRubric(criteriaRecord) {
    if (!ctx.selectedModuleId) return;
    const blueprintHash = ctx.currentBlueprintHash;
    const totalMax = Object.values(criteriaRecord).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
    const existingScalingRule = ctx.bundle?.selectedConfiguration?.rubricVersion?.scalingRule ?? {};
    const scalingRule = {
      ...existingScalingRule,
      // `|| 70` turned a legitimate 0 into 70: an author who deliberately set the practical weight
      // to zero got it silently restored the next time they accepted a criteria-drift suggestion.
      // Now that the weight is editable in Innstillinger (#896 S3c), 0 is a real value someone can
      // actually choose.
      practical_weight: Number.isFinite(Number(existingScalingRule.practical_weight))
        ? Number(existingScalingRule.practical_weight)
        : 70,
      max_total: totalMax,
    };
    if (blueprintHash) scalingRule.generated_from_blueprint_hash = blueprintHash;
    else delete scalingRule.generated_from_blueprint_hash;

    const slot = logProgress("shell.drift.diff.persisting");
    try {
      await apiFetch(
        `/api/admin/content/modules/${encodeURIComponent(ctx.selectedModuleId)}/rubric-versions`,
        getHeaders,
        {
          method: "POST",
          body: JSON.stringify({ criteria: criteriaRecord, scalingRule, active: true }),
        },
      );
      logResolveSlot(slot, () => escapeHtml(t("shell.drift.diff.persisted")));
      if (ctx.sessionDraft?.criteria) {
        ctx.sessionDraft = { ...ctx.sessionDraft, criteria: null };
      }
      await loadModule(ctx.selectedModuleId);
      await refreshBlueprintHash();
    } catch (err) {
      logResolveSlot(slot, () =>
        `${escapeHtml(t("shell.drift.diff.persistError"))}: ${escapeHtml(apiErrorText(err))}`,
      );
    }
  }

  // B2 (#449 redesign): fetch new criteria from /generate/rubric using the current taskText
  // and assessor expectations in the form (NOT the persisted versions — the user may have
  // edited them in this same direct-edit session). Calls onSuccess with the new criteria
  // array so the caller can update its state and re-render.
  async function regenerateCriteriaFromTask(criteriaContainer, onSuccess) {
    // QA 2026-08-16 round 3: these three inputs belong to the Rediger edit form, and since S3c the
    // ONLY Regenerate button lives in Innstillinger — where the form is not rendered. Every click
    // therefore took the "no task text" alert and never called the API: the button was dead.
    //
    // The form still wins when it is open (the author may have edited the scenario in this same
    // session and not saved it yet); otherwise fall back to the draft, then to what is stored.
    // The language this regeneration is FOR: it decides what text is sent, what the service is
    // asked to write, and what locale the result is stored under. All three must be the same value.
    const requestedLocale = ctx.contentLocale;
    const fieldOr = (id, stored) => {
      const el = document.getElementById(id);
      if (el) return el.value.trim();
      return localizeValueForLocale(stored ?? "", requestedLocale).trim();
    };
    const storedVersion = ctx.bundle?.selectedConfiguration?.moduleVersion ?? {};
    const taskText = fieldOr("previewEditTaskText", ctx.sessionDraft?.taskText ?? storedVersion.taskText);
    const assessorText = fieldOr(
      "previewEditGuidanceText",
      ctx.sessionDraft?.assessorExpectedContent ?? storedVersion.assessorExpectedContent,
    );
    const constraintsText = fieldOr(
      "previewEditCandidateTaskConstraints",
      ctx.sessionDraft?.candidateTaskConstraints ?? storedVersion.candidateTaskConstraints,
    );
    if (!taskText || !assessorText) {
      window.alert(t("shell.criteria.regenerateMissingTask"));
      return;
    }
    // Show inline progress in the criteria container.
    const originalHtml = criteriaContainer.innerHTML;
    criteriaContainer.innerHTML = `<p class="vk-total">${escapeHtml(t("shell.criteria.regenerating"))}</p>`;
    let blueprintObj = null;
    const bp = ctx.bundle?.selectedConfiguration?.moduleVersion?.assessmentBlueprint;
    if (bp) {
      if (typeof bp === "string") {
        try { blueprintObj = JSON.parse(bp); } catch { blueprintObj = null; }
      } else if (typeof bp === "object") {
        blueprintObj = bp;
      }
    }
    try {
      const result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          taskText,
          assessorExpectedContent: assessorText,
          candidateTaskConstraints: constraintsText || undefined,
          certificationLevel: certificationLevelForGeneration(),
          locale: ctx.contentLocale,
          ...(blueprintObj ? { blueprint: blueprintObj } : {}),
        }),
      });
      const generated = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
      // QA round 6: regeneration produces text in ONE language, and `storedLabel: null` told the
      // save "nothing to merge onto" — so regenerating with an English preview kept the English
      // criteria and deleted nb and nn. When the generator reuses an existing id, that criterion
      // still has the other two languages and they must survive; only a genuinely new id has
      // nothing behind it. The stage plan promises exactly this ("de andre språkene urørt").
      const storedCriteria = ctx.bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
      const mapped = generated.map((c) => {
        const id = String(c.id ?? slugifyLabel(c.label) ?? "criterion");
        const previous = storedCriteria[id];
        return {
          id,
          label: c.label ?? "",
          description: c.description ?? "",
          maxScore: Math.max(1, Math.min(10, Number(c.maxScore) || 5)),
          candidateVisible: Boolean(c.candidateVisible),
          // #902: one language, so the save writes `{<locale>: "..."}` rather than a bare string the
          // reader would have to guess the language of. QA round 4: this said `currentLocale` while
          // the REQUEST asked for `contentLocale`, so English text was filed as Norwegian. One
          // variable feeds both now.
          storedLabel: previous?.label ?? null,
          storedDescription: previous?.description ?? null,
          locale: requestedLocale,
        };
      });
      onSuccess(mapped);
      showToast(t("shell.criteria.regenerated"), "success");
    } catch (err) {
      const errMsg = apiErrorText(err);
      criteriaContainer.innerHTML = originalHtml;
      showToast(`${t("shell.criteria.regenerateError")}: ${errMsg}`, "error");
    }
  }

  return { wireCriteriaEditor, buildCriteriaRecordFromEditorState, regenerateCriteriaFromTask, handleDriftKeep, handleDriftRegenerate, handleDriftShowDiff, llmCriteriaArrayToStorageRecord };
}
