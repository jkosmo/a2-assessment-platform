import { escapeHtml } from "./html-escape.js";
/**
 * admin-content-preview.js
 *
 * Shared participant-preview rendering for admin-content pages.
 * Used by both the conversational shell and the advanced editor.
 *
 * Exports:
 *   localizeValueForLocale(value, locale) → string
 *   buildPreviewHtml(data, opts)          → HTML string
 */


/**
 * Resolve a potentially-localized field value to a plain string for the given locale.
 * Accepts: plain string, JSON-encoded localized object, or a localized object.
 *
 * v1.2.29 (#361 follow-up): fallback-kjeden bruker truthy-sjekk i stedet for ??-coalesce
 * så tomme strenger ("") behandles som "mangler for denne locale" og faller til neste.
 * Tidligere returnerte locale-objekt-shape `{en-GB:"X", nb:"", nn:""}` på nb-locale tom
 * streng (riktig per ??-semantikk siden "" ikke er nullish) — som ga blank tittel i
 * preview-pane når kun en locale var fylt ut.
 */
function pickFirstNonEmpty(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  const any = Object.values(obj).find((v) => typeof v === "string" && v.trim().length > 0);
  return any ?? "";
}

export function localizeValueForLocale(value, locale) {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return pickFirstNonEmpty(parsed, [locale, "nb", "en-GB"]);
      }
    } catch {
      // plain string — return as-is
    }
    return value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return pickFirstNonEmpty(value, [locale, "nb", "en-GB"]);
  }
  return String(value);
}

function localizeOptionList(options, locale) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => localizeValueForLocale(option, locale)).filter(Boolean);
}

function renderPreviewMcqQuestions(questions, locale, t, tf) {
  if (!Array.isArray(questions) || questions.length === 0) return "";
  const localize = (v) => localizeValueForLocale(v, locale);

  const questionItems = questions
    .map((question, index) => {
      const stem = localize(question?.stem ?? "");
      const rationale = localize(question?.rationale ?? "");
      const correctAnswer = localize(question?.correctAnswer ?? "");
      const options = localizeOptionList(question?.options, locale);
      const optionItems = options
        .map((option) => {
          const isCorrect = correctAnswer && option === correctAnswer;
          return `<li class="preview-mcq-option${isCorrect ? " correct" : ""}">${escapeHtml(option)}</li>`;
        })
        .join("");

      const rationaleHtml = rationale
        ? `<div class="preview-mcq-meta">
            <span class="preview-mcq-meta-label">${escapeHtml(t("shell.preview.rationale"))}</span>
            <span>${escapeHtml(rationale)}</span>
          </div>`
        : "";

      return `
        <article class="preview-mcq-item">
          <div class="preview-mcq-question-header">${escapeHtml(tf("shell.preview.questionNumber", { number: index + 1 }))}</div>
          <div class="preview-mcq-stem">${escapeHtml(stem)}</div>
          <ol class="preview-mcq-options" type="A">
            ${optionItems}
          </ol>
          <div class="preview-mcq-meta">
            <span class="preview-mcq-meta-label">${escapeHtml(t("shell.preview.correctAnswer"))}</span>
            <span>${escapeHtml(correctAnswer)}</span>
          </div>
          ${rationaleHtml}
        </article>`;
    })
    .join("");

  return `
    <div class="preview-section-label">${escapeHtml(t("shell.preview.mcqSection"))}</div>
    <div class="preview-mcq-list">
      ${questionItems}
    </div>`;
}

/**
 * Build the full preview panel innerHTML from module data.
 *
 * @param {object} data
 *   title           – string or localized object
 *   description     – string or localized object (optional)
 *   taskText        – string or localized object (optional)
 *   assessorExpectedContent    – string or localized object (optional, assessor-only)
 *   candidateTaskConstraints – string or localized object (optional, visible to candidate)
 *   mcqQuestions    – array (optional)
 *   versionChain    – string, e.g. "Modul v2 · MCQ v1" (optional)
 *   badgeClass      – "live" | "draft" | "shell"
 *   badgeText       – string
 *   emptyText       – string shown when nothing is loaded (optional)
 * @param {object} opts
 *   locale          – string, preview locale
 *   t(key)          – translation function
 *   tf(key, vars)   – interpolating translation function
 */
export function buildPreviewHtml(data, { locale, t, tf }) {
  const localize = (v) => localizeValueForLocale(v, locale);
  const {
    title = "",
    description = "",
    taskText = "",
    assessorExpectedContent = "",
    candidateTaskConstraints = "",
    mcqQuestions = [],
    criteria = null,
    // B3 (#450): pre-built HTML for the drift banner rendered above criteria. Empty when
    // there is no drift. The shell is responsible for constructing this (i18n + handlers).
    driftBanner = "",
    versionChain = "",
    badgeClass = "shell",
    badgeText = "",
    emptyText = "",
  } = data;

  if (emptyText) {
    return `<p class="preview-empty">${escapeHtml(emptyText)}</p>`;
  }

  const localizedTitle = localize(title);
  const localizedDescription = localize(description);
  const localizedTask = localize(taskText);
  const localizedGuidance = localize(assessorExpectedContent);
  const localizedCandidateConstraints = localize(candidateTaskConstraints);
  const mcqCount = Array.isArray(mcqQuestions) ? mcqQuestions.length : 0;

  const titleHtml = localizedTitle
    ? `<div class="preview-module-title">${escapeHtml(localizedTitle)}</div>`
    : "";
  const descriptionHtml = localizedDescription
    ? `<p class="preview-description">${escapeHtml(localizedDescription)}</p>`
    : "";
  const versionChainHtml = versionChain
    ? `<p class="preview-version-chain">${escapeHtml(versionChain)}</p>`
    : "";
  const taskTextHtml = localizedTask
    ? `<div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.taskText"))}</div>
       <div class="preview-text-block">${escapeHtml(localizedTask)}</div>`
    : "";
  const candidateConstraintsHtml = localizedCandidateConstraints
    ? `<div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.candidateTaskConstraints"))}</div>
       <div class="preview-text-block preview-text-candidate-constraints">${escapeHtml(localizedCandidateConstraints)}</div>`
    : "";
  const assessorExpectedContentHtml = localizedGuidance
    ? `<div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.assessorExpectedContent"))}</div>
       <div class="preview-text-block preview-text-secondary">${escapeHtml(localizedGuidance)}</div>`
    : "";
  const mcqCountHtml = mcqCount > 0
    ? `<p class="preview-meta">${escapeHtml(tf("shell.mcq.countLabel", { count: mcqCount }))}</p>`
    : "";
  const mcqHtml = renderPreviewMcqQuestions(mcqQuestions, locale, t, tf);
  // v1.1.81: when shell signals criteria-generation in flight AND no persisted/draft
  // criteria exist yet, show a placeholder section so users see something is coming.
  const criteriaLoadingText = data.criteriaLoadingText ?? "";
  const hasCriteria = criteria && typeof criteria === "object" && Object.keys(criteria).length > 0;
  const criteriaHtml = hasCriteria
    ? renderPreviewCriteria(criteria, t, tf, localize)
    : (criteriaLoadingText
      ? `<div class="preview-section-label">${escapeHtml(t("shell.criteria.title").replace(/\s*\(\{count\}\)\s*/, ""))}</div>
         <p class="preview-criteria-loading">${escapeHtml(criteriaLoadingText)}</p>`
      : "");

  return `
    <div class="preview-module-header">
      ${titleHtml}
      <span class="module-status-badge ${escapeHtml(badgeClass)}">${escapeHtml(badgeText)}</span>
    </div>
    ${descriptionHtml}
    ${versionChainHtml}
    ${taskTextHtml}
    ${candidateConstraintsHtml}
    ${assessorExpectedContentHtml}
    ${mcqCountHtml}
    ${mcqHtml}
    ${driftBanner}
    ${criteriaHtml}
  `.trim();
}

// B2 (#449 redesign): render assessment criteria as content in the preview pane.
// `criteria` is the record-keyed shape stored on RubricVersion: { id: { label, description,
// maxScore, weight, candidateVisible } }. Tolerates two historical shapes — rich (with label
// + description) from #378 auto-gen, and sparse ({ weight }) from generic defaults. Returns
// empty string when no criteria — section just doesn't render.
function renderPreviewCriteria(criteria, t, tf, localize = (v) => (typeof v === "string" ? v : "")) {
  if (!criteria || typeof criteria !== "object") return "";
  const entries = Object.entries(criteria);
  if (entries.length === 0) return "";

  // Generic-default rubrics store only `{ weight: 0.2 }` per criterion — no maxScore.
  // To still show a meaningful weight in read-only view, derive maxScore = round(weight × 10)
  // when missing. Result for default 0.2 weights: "Vekt: 2".
  const resolveMaxScore = (c) => {
    if (Number(c?.maxScore) > 0) return Number(c.maxScore);
    const weight = Number(c?.weight);
    if (weight > 0) return Math.max(1, Math.round(weight * 10));
    return 0;
  };

  const items = entries.map(([id, raw]) => {
    const c = raw && typeof raw === "object" ? raw : {};
    // v1.2.10: label + description kan være enten string (legacy auto-gen, direkte-edit)
    // eller locale-objekt (ekstern-LLM-handoff, fra v1.2.7+ prompt). Bruk localize-helperen
    // som håndterer begge format. Fallback til humaniseCriterionId hvis lokal-strengen er
    // tom — feks når LLM ikke fylte ut den valgte locale-en.
    const rawLabel = localize(c.label);
    const label = typeof rawLabel === "string" && rawLabel.trim()
      ? rawLabel
      : humaniseCriterionId(String(id));
    const description = (() => {
      const v = localize(c.description);
      return typeof v === "string" ? v : "";
    })();
    const maxScore = resolveMaxScore(c);
    const candidateVisible = Boolean(c.candidateVisible);
    const weightHtml = maxScore > 0
      ? `<span class="preview-criterion-weight">${escapeHtml(t("shell.criteria.weight"))}: ${maxScore}</span>`
      : "";
    const descHtml = description.trim()
      ? `<p class="preview-criterion-desc">${escapeHtml(description)}</p>`
      : "";
    const visibleHtml = candidateVisible
      ? `<p class="preview-criterion-visible">✓ ${escapeHtml(t("shell.criteria.visibleToCandidate"))}</p>`
      : "";
    return `
      <li class="preview-criterion">
        <div class="preview-criterion-header">
          <span class="preview-criterion-title">${escapeHtml(label)}</span>
          ${weightHtml}
        </div>
        ${descHtml}
        ${visibleHtml}
      </li>`;
  }).join("");

  const totalWeight = entries.reduce((sum, [, c]) => sum + resolveMaxScore(c), 0);
  const totalHtml = totalWeight > 0
    ? `<p class="preview-criteria-total"><strong>${escapeHtml(t("shell.criteria.totalWeight"))}:</strong> ${totalWeight}</p>`
    : "";

  return `
    <div class="preview-section-label">${escapeHtml(tf("shell.criteria.title", { count: entries.length }))}</div>
    <ul class="preview-criteria-list">${items}</ul>
    ${totalHtml}
  `;
}

function humaniseCriterionId(id) {
  return String(id).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
