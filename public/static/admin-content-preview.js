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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Resolve a potentially-localized field value to a plain string for the given locale.
 * Accepts: plain string, JSON-encoded localized object, or a localized object.
 */
export function localizeValueForLocale(value, locale) {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed[locale] ?? parsed["nb"] ?? parsed["en-GB"] ?? Object.values(parsed)[0] ?? "";
      }
    } catch {
      // plain string — return as-is
    }
    return value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value[locale] ?? value["nb"] ?? value["en-GB"] ?? Object.values(value)[0] ?? "";
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
 *   guidanceText    – string or localized object (optional)
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
    guidanceText = "",
    mcqQuestions = [],
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
  const localizedGuidance = localize(guidanceText);
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
  const guidanceTextHtml = localizedGuidance
    ? `<div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.guidanceText"))}</div>
       <div class="preview-text-block preview-text-secondary">${escapeHtml(localizedGuidance)}</div>`
    : "";
  const mcqCountHtml = mcqCount > 0
    ? `<p class="preview-meta">${escapeHtml(tf("shell.mcq.countLabel", { count: mcqCount }))}</p>`
    : "";
  const mcqHtml = renderPreviewMcqQuestions(mcqQuestions, locale, t, tf);

  return `
    <div class="preview-module-header">
      ${titleHtml}
      <span class="module-status-badge ${escapeHtml(badgeClass)}">${escapeHtml(badgeText)}</span>
    </div>
    ${descriptionHtml}
    ${versionChainHtml}
    ${taskTextHtml}
    ${guidanceTextHtml}
    ${mcqCountHtml}
    ${mcqHtml}
  `.trim();
}
