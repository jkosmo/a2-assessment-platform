// #1046 punkt 2 (16.09): publisering og publiseringsgaten, skilt ut fra admin-content-shell.js.
//
// Publiser siste lagrede utkast, avpubliser, og gaten som stopper publisering når et språk
// mangler (#896 S4): hvilke felt som mangler hvilket språk, teksten som forklarer det, og
// «Oversett det som mangler» som fyller hullene, lagrer og publiserer. Det den trenger fra skallet
// kommer inn som `ctx`; koden er flyttet, ikke skrevet om — kommentarene følger med.

import { escapeHtml } from "./html-escape.js";
import { LEGACY_STRING_LOCALE } from "./localized-value.js";
import { supportedLocales } from "/static/i18n/admin-content-translations.js";
import { apiFetch } from "/static/api-client.js";
import { showToast } from "/static/toast.js";
import { apiErrorCodeText } from "/static/api-error.js";
import { localizeValueForLocale } from "/static/admin-content-preview.js";
import { strictLocaleValue } from "/static/admin-content-localized-copy.js";

/**
 * @param {object} ctx  skallets tilstand som get/set-egenskaper og skallets funksjoner som referanser.
 */
export function createPublishFlow(ctx) {
  const {
    t, logBot, logProgress, logResolveSlot, announceStatus, apiErrorText, getHeaders, loadModule, saveDraftBundleInBackground, showModuleActions, startDirectEditFlow, commitSessionDraftPatch,
  } = ctx;


  // #896 S4: which locale a value ACTUALLY has, with no fallback. localizeValueForLocale falls
  // back to nb/en-GB by design so the preview is never blank — exactly wrong when the question is
  // "is this locale missing?", because the fallback answers "no" for every locale.

  // The stored value read as one language. A bare string is legacy content read as nb — see
  // LEGACY_STRING_LOCALE in localized-value.js for why the client must agree with the server here.
  function sourceTextForLocale(value, locale) {
    const strict = strictLocaleValue(value, locale);
    if (strict.trim()) return strict;
    if (locale === LEGACY_STRING_LOCALE && typeof value === "string") return value;
    return "";
  }

  // The text fields the gate covers. Must stay in step with the server's field set — the two lists
  // disagreeing means the author is offered a fix for a gap that is not the one blocking them.
  const TRANSLATION_GATE_FIELDS = ["title", "description", "taskText", "assessorExpectedContent", "candidateTaskConstraints"];

  // The stored value as a locale map holding only the locales that really have text. A plain string
  // is recorded under `sourceLocale` — it has to land somewhere, and the author's working language
  // is the only honest guess available at this point.
  function localeMapOf(value) {
    const map = {};
    for (const locale of supportedLocales) {
      const existing = strictLocaleValue(value, locale);
      if (existing.trim()) map[locale] = existing;
    }
    if (Object.keys(map).length === 0 && typeof value === "string" && value.trim()) {
      // Legacy bare string: label it with the locale the server reads it as, not with whatever the
      // author happens to be looking at. Anything else silently relabels the text's language.
      map[LEGACY_STRING_LOCALE] = value;
    }
    return map;
  }

  function fillLocaleGap(map, locale, text) {
    if (map[locale]?.trim()) return;
    if (typeof text === "string" && text.trim()) map[locale] = text;
  }

  // #905: a locale with no text gets no entry — never a copy of the source. Note what this does NOT
  // do: it does not collapse a single-locale map back to a bare string. A bare string is content
  // whose language is unrecorded, which is what forced the gate to guess "nb" and mislabel an
  // author working in English. `{nb: "..."}` says the same thing and says which language.
  function collapseLocaleMap(map) {
    return Object.keys(map).length === 0 ? "" : map;
  }

  // #913: MCQ fields now take partial maps too, so a half-successful translation keeps what
  // succeeded. This used to collapse anything short of all three locales back to the source
  // language, which threw away the locales that DID translate — the author paid for a translation,
  // was told it was saved, and the next publish attempt asked for it again.

  function translationGateIssuesFrom(error) {
    const issues = error?.body?.issues;
    if (!Array.isArray(issues)) return [];
    return issues.filter((issue) => issue?.code === "translation_incomplete" && Array.isArray(issue.missingLocales));
  }

  function translationGateFieldLabel(field) {
    // MCQ issues are per question, so the field name carries an index: mcq.question3. There is no
    // key per question — the label is built from the pattern.
    const mcq = /^mcq\.question(\d+)$/.exec(String(field ?? ""));
    if (mcq) return t("shell.publish.field.mcqQuestion").replace("{n}", mcq[1]);
    const label = t(`shell.publish.field.${field}`);
    // An unknown field must still be NAMED — a silent omission would tell the author the module is
    // complete while publishing keeps failing. Falling back to the raw key is ugly but truthful.
    return label.startsWith("shell.publish.field.") ? String(field) : label;
  }

  function describeTranslationGate(issues, otherBlockers = []) {
    const lines = issues.map((issue) => {
      const label = translationGateFieldLabel(issue.field);
      return t("shell.publish.translationGate.item")
        .replace("{field}", label)
        .replace("{locales}", issue.missingLocales.join(", "));
    });
    // A publish response can carry a blueprint mismatch alongside the translation gaps. Showing only
    // the gaps meant the author translated, retried, and failed again on a blocker they were never
    // told about — the gate would have taught them to distrust it.
    // #914: koden og `params` er sannheten; serverens `message` er reserve.
    //
    // Bruker den DELTE `apiErrorCodeText`, som #980 alt hadde bygget for publiseringsdialogen. Den
    // slaar opp `errors.api.<kode>` (med variant naar koden trenger det) og fyller plassholderne.
    //
    // Foerste utgave av #914 lagde en egen `describeGateIssue` med egne `adminContent.validation.*`
    // -noekler. Det var en ANDRE mekanisme for samme jobb, med sin egen ordlyd — «Restore it before
    // publishing» mot #980 sin «Restore it before you publish». Nettopp den driften saken skal fjerne.
    const others = otherBlockers
      .map((issue) => {
        // `item_archived` slaas opp som `errors.api.item_archived.module` / `.section`, fordi den
        // brukes for begge med ulik tekst (#980). Varianten staar i `params.itemType`.
        //
        // ⚠️ Uten dette faller nettopp den koden tilbake paa serverens `message` — som er hardkodet
        // NORSK. En engelsk forfatter fikk da norsk tekst for arkiverte moduler, mens alt annet paa
        // samme skjerm var oversatt. Kursvisningen tok varianten fra RADEN og var derfor riktig, saa
        // feilen fantes bare i denne ene veien.
        const variant = typeof issue?.params?.itemType === "string" ? [issue.params.itemType.toLowerCase()] : [];
        return apiErrorCodeText(issue?.code ?? null, t, variant, issue?.params ?? null) || issue?.message;
      })
      .filter(Boolean);
    return `<strong>${escapeHtml(t("shell.publish.translationGate.heading"))}</strong><ul>${
      [...lines, ...others].map((line) => `<li>${escapeHtml(line)}</li>`).join("")
    }</ul>`;
  }

  // Blocking issues from the same publish response that are NOT translation gaps. "Translate what is
  // missing" cannot clear these, so they are listed but not acted on.
  function otherBlockingIssuesFrom(error) {
    const issues = error?.body?.issues;
    if (!Array.isArray(issues)) return [];
    return issues.filter((issue) => issue?.code !== "translation_incomplete" && issue?.severity === "blocking");
  }

  // #896 S4: "Oversett det som mangler" — fills only the holes. Every locale that already has
  // content keeps exactly the text it has; the author's own wording is never overwritten by a
  // machine translation of itself. What is translated goes through the ordinary save, so the
  // result is a normal new version, and then publish is retried.
  async function translateMissingLocalesThenPublish(issues) {
    const moduleId = ctx.selectedModuleId;
    if (!moduleId) return;

    const moduleVersion = ctx.bundle?.selectedConfiguration?.moduleVersion;
    const current = {
      title: ctx.sessionDraft?.title ?? ctx.bundle?.module?.title ?? "",
      description: ctx.sessionDraft?.description ?? ctx.bundle?.module?.description ?? "",
      taskText: ctx.sessionDraft?.taskText ?? moduleVersion?.taskText ?? "",
      assessorExpectedContent: ctx.sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
      candidateTaskConstraints: ctx.sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
    };
    const currentMcq = ctx.sessionDraft?.mcqQuestions?.length
      ? ctx.sessionDraft.mcqQuestions
      : (ctx.bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? []);

    // Translate FROM a locale that actually has the content — and "the content" means the fields
    // the gate actually complained about, not a fixed pair. Requiring taskText AND
    // assessorExpectedContent made this unusable for the two cases most likely to hit the gate: an
    // MCQ-only module (no task text at all) and a module whose only gap is the title.
    const gatedTextFields = TRANSLATION_GATE_FIELDS.filter((field) =>
      issues.some((issue) => issue.field === field),
    );
    const needsMcqSource = issues.some((issue) => String(issue.field ?? "").startsWith("mcq."));
    // #974: menyspråket sto som andre kandidat her. Regelen (se `contentLocale`) er at menyen aldri
    // styrer innhold — kildeteksten til en oversettelse er innhold.
    const preferredOrder = [ctx.contentLocale, "nb", "en-GB", "nn"];
    const sourceLocale = preferredOrder.find((locale) => {
      if (!locale) return false;
      if (!gatedTextFields.every((field) => sourceTextForLocale(current[field], locale).trim())) return false;
      if (needsMcqSource) {
        // EVERY required part, not just the stem. A question can legally be mixed — a stem localized
        // into three languages next to options still stored as legacy bare strings — and picking a
        // source from the stem alone produced a request the options could not satisfy. The call
        // failed validation, and the gap went unnoticed because the option had no source text to
        // count as missing.
        return currentMcq.every((question) => {
          if (!sourceTextForLocale(question?.stem ?? "", locale).trim()) return false;
          if (!sourceTextForLocale(question?.correctAnswer ?? "", locale).trim()) return false;
          if (!(question?.options ?? []).every((option) => sourceTextForLocale(option, locale).trim())) return false;
          // The rationale too, but only when the question HAS one. Since #913 a question can hold a
          // rationale in one language and its stem in another; picking the stem's locale as source
          // left the rationale's gap unfillable, because the source locale is excluded from the
          // target list and only targets are ever checked. The republish then hit the same gate.
          const hasRationale = supportedLocales.some((l) => strictLocaleValue(question?.rationale, l).trim())
            || (typeof question?.rationale === "string" && question.rationale.trim());
          return !hasRationale || Boolean(sourceTextForLocale(question?.rationale ?? "", locale).trim());
        });
      }
      return true;
    });
    if (!sourceLocale) {
      logBot(() => t("shell.publish.translationGate.noSource"));
      return;
    }

    const missingLocales = [...new Set(issues.flatMap((issue) => issue.missingLocales))]
      .filter((locale) => locale !== sourceLocale);
    if (missingLocales.length === 0) return;

    const slot = logProgress("shell.publish.translationGate.progress");
    slot.abortBtn.remove();

    // Start from the stored values as locale maps, so untouched locales survive the save.
    const merged = {};
    for (const field of TRANSLATION_GATE_FIELDS) {
      merged[field] = localeMapOf(current[field], sourceLocale);
    }

    const sourceDraft = {
      title: sourceTextForLocale(current.title, sourceLocale),
      taskText: sourceTextForLocale(current.taskText, sourceLocale),
      assessorExpectedContent: sourceTextForLocale(current.assessorExpectedContent, sourceLocale),
      candidateTaskConstraints: sourceTextForLocale(current.candidateTaskConstraints, sourceLocale),
    };

    // The module-draft localizer translates the scenario, answer key and constraints together, which
    // is what makes them read as one coherent whole — but its schema DEMANDS a non-empty task text
    // and answer key. An MCQ-only module has neither, and a free-text module need not have the
    // answer key, so calling it unconditionally 400s and took the rest of the fill down with it.
    const canUseDraftLocalizer = Boolean(sourceDraft.taskText.trim() && sourceDraft.assessorExpectedContent.trim());
    // Fields that localizer actually returns. `description` is NOT among them — it used to be asked
    // for and never delivered, so a description-only gap could never be filled and the automatic
    // republish hit the same 422 forever.
    const DRAFT_LOCALIZER_FIELDS = ["title", "taskText", "assessorExpectedContent", "candidateTaskConstraints"];
    // The per-field localizer has two slots: `title` for short text, `bodyMarkdown` for long.
    const LONG_TEXT_FIELDS = new Set(["taskText", "assessorExpectedContent", "candidateTaskConstraints"]);

    // MCQ questions are participant-facing content too, and for an MCQ-only module they ARE the
    // assessment. Same rule as the text fields: start from what exists, fill only the empty slots.
    const mergedMcq = currentMcq.map((question) => ({
      stem: localeMapOf(question?.stem),
      options: (question?.options ?? []).map((option) => localeMapOf(option)),
      correctAnswer: localeMapOf(question?.correctAnswer),
      rationale: localeMapOf(question?.rationale),
    }));
    const needsMcqFill = issues.some((issue) => String(issue.field ?? "").startsWith("mcq."));
    const gapFields = new Set(gatedTextFields);

    const failedLocales = [];
    for (const targetLocale of missingLocales) {
      const stillMissing = () =>
        [...gapFields].filter(
          (field) => !merged[field][targetLocale]?.trim() && merged[field][sourceLocale]?.trim(),
        );

      if (canUseDraftLocalizer && stillMissing().some((field) => DRAFT_LOCALIZER_FIELDS.includes(field))) {
        try {
          const result = await apiFetch("/api/admin/content/generate/module-draft/localize", getHeaders, {
            method: "POST",
            body: JSON.stringify({ ...sourceDraft, sourceLocale, targetLocale }),
          });
          const draft = result?.draft ?? result;
          if (!draft?.title) throw new Error("localize returned no title");
          // Only the holes. A locale that already had text keeps it — this is the whole point of
          // "translate what is missing" rather than "translate everything".
          for (const field of DRAFT_LOCALIZER_FIELDS) {
            if (gapFields.has(field)) fillLocaleGap(merged[field], targetLocale, draft[field]);
          }
        } catch {
          // Swallowed on purpose: the per-field pass below is the retry, and whether this locale
          // actually failed is decided at the END from the gaps that remain — not from whether a
          // call threw. Treating the exception as failure meant a fallback that filled every gap
          // still reported failure and skipped the automatic republish.
        }
      }

      // Whatever the draft localizer could not cover — because it was skipped, because it failed, or
      // because the field is outside its vocabulary (description) — is translated one field at a
      // time. Slower, but it works for every module type.
      for (const field of stillMissing()) {
        try {
          const key = LONG_TEXT_FIELDS.has(field) ? "bodyMarkdown" : "title";
          const result = await apiFetch("/api/admin/content/sections/localize", getHeaders, {
            method: "POST",
            body: JSON.stringify({ [key]: merged[field][sourceLocale], sourceLocale, targetLocale }),
          });
          const translated = result?.[key];
          if (typeof translated === "string" && translated.trim()) merged[field][targetLocale] = translated.trim();
        } catch {
          // Same reasoning: the gap either got filled or it did not, and that is what is checked.
        }
      }

      if (needsMcqFill && mergedMcq.length > 0) {
        try {
          const mcqResult = await apiFetch("/api/admin/content/generate/mcq/localize", getHeaders, {
            method: "POST",
            body: JSON.stringify({
              questions: currentMcq.map((question) => {
                // A question may legitimately have no rationale. Sending "" for it is not the same
                // as leaving it out — the endpoint rejects an empty string, so the whole fill died
                // before the model ran.
                const rationale = sourceTextForLocale(question?.rationale ?? "", sourceLocale);
                return {
                  stem: sourceTextForLocale(question?.stem ?? "", sourceLocale),
                  options: (question?.options ?? []).map((option) => sourceTextForLocale(option, sourceLocale)),
                  correctAnswer: sourceTextForLocale(question?.correctAnswer ?? "", sourceLocale),
                  ...(rationale.trim() ? { rationale } : {}),
                };
              }),
              sourceLocale,
              targetLocale,
            }),
          });
          const translatedQuestions = mcqResult?.questions ?? [];
          translatedQuestions.forEach((question, index) => {
            const target = mergedMcq[index];
            if (!target) return;
            fillLocaleGap(target.stem, targetLocale, question?.stem);

            // The save schema requires correctAnswer to be one of options, VERBATIM. A translator
            // that renders the answer "The members." and the option "The members" produces a 200
            // here and a 400 three steps later, surfacing as a generic save failure with no hint
            // that the translation was the cause.
            //
            // Only checked for the values actually being merged: the response always carries every
            // field, so an inconsistency in an answer this locale does not need must not discard a
            // stem or rationale translation it does.
            const fillingAnswer = !target.correctAnswer[targetLocale]?.trim();
            const fillingOptions = target.options.some((option) => !option[targetLocale]?.trim());
            if (fillingAnswer || fillingOptions) {
              const translatedOptions = question?.options ?? [];
              if (
                typeof question?.correctAnswer === "string"
                && !translatedOptions.some((option) => option === question.correctAnswer)
              ) {
                throw new Error("translated correctAnswer does not match any translated option");
              }
            }
            fillLocaleGap(target.correctAnswer, targetLocale, question?.correctAnswer);
            // Only if the question HAD a rationale. The localization response contract requires the
            // model to return one, so a question without a rationale gets an invented one — stored
            // under the target locales only, and therefore read back as a gap on the very next
            // publish attempt. Inventing assessor-facing text nobody wrote is worse than the loop.
            if (Object.keys(target.rationale).length > 0) {
              fillLocaleGap(target.rationale, targetLocale, question?.rationale);
            }
            (question?.options ?? []).forEach((option, optionIndex) => {
              if (target.options[optionIndex]) fillLocaleGap(target.options[optionIndex], targetLocale, option);
            });
          });
        } catch {
          // Checked below, not here.
        }
      }

      // A locale counts as failed only if something is STILL missing after every attempt. Deciding
      // from thrown exceptions instead meant a first-choice localizer that failed marked the locale
      // as failed even when the fallback filled every gap — the author was told the translation had
      // failed, and the automatic republish they had asked for never ran.
      // A part is missing this locale when it HAS text somewhere and not here. Keyed on "the map is
      // non-empty" rather than "the source locale has text": a part with no source text is still a
      // gap the fill did not close, and reading it as satisfied reported success over the very hole
      // that blocked publishing. A rationale that is absent everywhere is not a gap — it is a field
      // this question does not have.
      const mcqStillMissing =
        needsMcqFill
        && mergedMcq.some((question) =>
          [question.stem, question.correctAnswer, question.rationale, ...question.options].some(
            (map) => Object.keys(map).length > 0 && !map[targetLocale]?.trim(),
          ),
        );
      if (stillMissing().length > 0 || mcqStillMissing) failedLocales.push(targetLocale);
    }

    // #905: never store a source-language copy under a locale that failed. An empty field is
    // honest; a copy pretends the translation happened.
    const patch = {};
    for (const field of TRANSLATION_GATE_FIELDS) {
      const value = collapseLocaleMap(merged[field]);
      // An optional field the module does not have must stay ABSENT, not become "". Materializing it
      // makes the save send an empty string, which the localized-text schema rejects — so an
      // otherwise successful gap-fill would fail at the last step for every module that has no
      // description and no candidate constraints.
      if (value === "") continue;
      patch[field] = value;
    }
    if (needsMcqFill && mergedMcq.length > 0) {
      patch.mcqQuestions = mergedMcq.map((question) => {
        const rationale = collapseLocaleMap(question.rationale);
        return {
          stem: collapseLocaleMap(question.stem),
          options: question.options.map((option) => collapseLocaleMap(option)),
          correctAnswer: collapseLocaleMap(question.correctAnswer),
          // A question may legitimately have no rationale. `rationale: ""` is a different thing and
          // the save schema rejects it, so an otherwise successful fill would 400 at the last step
          // — taking the text translations from the same attempt down with it.
          ...(rationale === "" ? {} : { rationale }),
        };
      });
    }
    commitSessionDraftPatch(patch);

    if (failedLocales.length > 0) {
      logResolveSlot(slot, () => escapeHtml(t("shell.publish.translationGate.failed")), [
        { labelKey: "shell.action.retry", action: () => translateMissingLocalesThenPublish(issues) },
      ]);
      // Save what did succeed — the author should not lose the translations that worked — but do
      // not retry publish, since it would only hit the same gate.
      await saveDraftBundleInBackground();
      return;
    }

    logResolveSlot(slot, () => escapeHtml(t("shell.revision.translateReady")));
    await saveDraftBundleInBackground({ afterSave: publishLatestDraftInBackground });
  }

  async function publishLatestDraftInBackground() {
    const moduleId = ctx.selectedModuleId;
    const moduleVersionId = ctx.latestSavedModuleVersionId ?? ctx.bundle?.selectedConfiguration?.moduleVersion?.id;
    if (!moduleId || !moduleVersionId) {
      logBot(() => t("shell.publish.versionRequired"));
      return;
    }

    const slot = logProgress("shell.publish.progress");
    slot.abortBtn.remove();

    try {
      await apiFetch(
        `/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions/${encodeURIComponent(moduleVersionId)}/publish`,
        getHeaders,
        { method: "POST", body: JSON.stringify({}) },
      );
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.publish.success"))}</strong>`);
      showToast(t("shell.publish.success"), "success");
      announceStatus(t("shell.publish.success"));
      ctx.sessionDraft = null;
      ctx.previewDraft = null;
      ctx.latestSavedModuleVersionId = null;
      // UX: etter publisering, last modulen på nytt (nå Live) og vis modul-handlinger
      // ("Hva vil du gjøre med denne modulen?") i stedet for full modul-velger. loadModule
      // avslutter med showModuleActions() og bevarer kontekst til modulen man nettopp
      // publiserte; "Velg en annen modul" er fortsatt tilgjengelig derfra. Samme mønster
      // som unpublishModuleInBackground.
      await loadModule(moduleId);
    } catch (err) {
      // #896 S4: a half-translated module is not a failure to report as a stack of JSON — it is a
      // list of holes with an action that fills them.
      const gateIssues = translationGateIssuesFrom(err);
      if (gateIssues.length > 0) {
        const otherBlockers = otherBlockingIssuesFrom(err);
        logResolveSlot(slot, () => describeTranslationGate(gateIssues, otherBlockers), [
          { labelKey: "shell.publish.translationGate.fillGaps", action: () => translateMissingLocalesThenPublish(gateIssues) },
          { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
        ]);
        return;
      }
      const errMsg = apiErrorText(err);
      logResolveSlot(slot, () => `${escapeHtml(t("shell.publish.errorPrefix"))}${escapeHtml(errMsg)}`, [
        { labelKey: "shell.action.retry", action: publishLatestDraftInBackground },
      ]);
    }
  }

  async function unpublishModuleInBackground() {
    const moduleId = ctx.selectedModuleId;
    if (!moduleId) return;

    const slot = logProgress("shell.unpublish.progress");
    slot.abortBtn.remove();

    try {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/unpublish`, getHeaders, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadModule(moduleId);
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.unpublish.success"))}</strong>`);
      showToast(t("shell.unpublish.success"), "success");
      announceStatus(t("shell.unpublish.success"));
    } catch (err) {
      const errMsg = apiErrorText(err);
      logResolveSlot(slot, () => `${escapeHtml(t("shell.unpublish.errorPrefix"))}${escapeHtml(errMsg)}`, [
        { labelKey: "shell.action.retry", action: unpublishModuleInBackground },
      ]);
    }
  }

  return { publishLatestDraftInBackground, unpublishModuleInBackground };
}
