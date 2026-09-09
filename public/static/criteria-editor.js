/**
 * Kriterieredigereren: hva som er endret i vurderingskriteriene, og hvordan de tegnes.
 *
 * Trukket ut av `admin-content-shell.js` etter steg 1 i `doc/SHELL_EXTRACTION_PLAN.md`.
 *
 * ⚠️ HVORFOR NETTOPP DISSE. Planen ble skrevet om én gang, og det viktigste den lærte oss var at
 * mønsteret er å trekke ut REN LOGIKK, ikke seksjoner. En seksjon på 600 linjer der alt rører
 * `sessionState` og `document` kan ikke flyttes, uansett hvor lite den kobler til naboene.
 *
 * Disse seks hører sammen som én oppgave — regne ut hva som er endret, og bygge redigereren — og
 * ingen av dem leser modulnivå-tilstand. `captureLatestCriteriaState` rører DOM, men bare den
 * beholderen den får inn, og er derfor testbar med en fikstur.
 *
 * ⚠️ Uttrekket var ikke mulig før `driftText` sluttet å lese `contentLocale` fra modulen. Den
 * gjorde `computeCriteriaDiff` og `buildDriftDiffModalHtml` urene gjennom et mellomledd, uten at
 * renhetsskanneren så det — den leser bare funksjonens egen tekst.
 *
 * Testene i `test/dom/criteria-editor.dom.test.js` ble skrevet FØR flyttingen. Uten dem hadde
 * uttrekket bare vært en flytting, og logikken hadde fortsatt bare vært nådd gjennom e2e.
 */
import { escapeHtml } from "./html-escape.js";
import { localizeValueForLocale } from "./admin-content-preview.js";

/**
 * #1049-oppfoelging / uttrekksplanen steg 1: spraaket sendes INN, det leses ikke fra modulen.
 *
 * ⚠️ Denne leste `contentLocale` — en modulnivaa-binding — og gjorde dermed BAADE
 * `computeCriteriaDiff` og `buildDriftDiffModalHtml` urene gjennom et mellomledd.
 * Renhetsskanneren saa det ikke, fordi den bare leser funksjonens egen tekst. Nettopp det advarer
 * `doc/SHELL_EXTRACTION_PLAN.md` mot.
 *
 * Ingen atferdsendring: kallerne sender den samme `contentLocale` som foer.
 */
export function driftText(value, locale) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return localizeValueForLocale(value, locale) ?? "";
}

export function humaniseCriterionId(id) {
  return String(id).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function computeCriteriaDiff(existing, next, locale) {
  const existingIds = new Set(Object.keys(existing ?? {}));
  const nextIds = new Set(Object.keys(next ?? {}));
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const id of nextIds) {
    if (!existingIds.has(id)) {
      added.push({ id, next: next[id] });
      continue;
    }
    const a = existing[id] ?? {};
    const b = next[id] ?? {};
    // QA round 5: proposals are locale objects now, and `String({...})` is "[object Object]" for
    // every one of them — so two different proposals compared EQUAL and a text-only change was
    // filed as unchanged, which "accept selected" then left out. Compare the language on screen.
    const labelChanged = driftText(a.label, locale) !== driftText(b.label, locale);
    const descChanged = driftText(a.description, locale) !== driftText(b.description, locale);
    const scoreChanged = Number(a.maxScore ?? 0) !== Number(b.maxScore ?? 0);
    const visChanged = Boolean(a.candidateVisible) !== Boolean(b.candidateVisible);
    if (labelChanged || descChanged || scoreChanged || visChanged) {
      changed.push({ id, prev: a, next: b, fields: { labelChanged, descChanged, scoreChanged, visChanged } });
    } else {
      unchanged.push({ id, prev: a, next: b });
    }
  }
  for (const id of existingIds) {
    if (!nextIds.has(id)) {
      removed.push({ id, prev: existing[id] });
    }
  }
  return { added, removed, changed, unchanged };
}

/**
 * #896 S3c: storage-shape criteria record → editor state.
 *
 * Lifted out of `enterPreviewEditMode`, where it closed over `editingLocale`. The locale is now a
 * parameter because the editor is moving to Innstillinger, which has no editing locale of its own
 * — it reads in the UI language. Same function, two callers, one behaviour.
 */
export function buildEditorStateFromCriteriaRecord(source, locale) {
  if (!source || typeof source !== "object") return [];
  return Object.entries(source).map(([id, raw]) => {
    const c = raw && typeof raw === "object" ? raw : {};
    // v1.1.78: for sparse legacy criteria with only `weight` (no maxScore), derive
    // maxScore from weight × 10 so the slider opens at a meaningful position.
    const derivedFromWeight = Number(c.weight) > 0 ? Math.max(1, Math.round(Number(c.weight) * 10)) : 0;
    const initialMaxScore = Number(c.maxScore) > 0
      ? Number(c.maxScore)
      : (derivedFromWeight > 0 ? derivedFromWeight : 5);
    // v1.2.10: c.label/c.description kan være string ELLER locale-objekt.
    // #902: read in the locale being edited — reading in the UI language put English criteria
    // beside Norwegian scenario text, and what was typed was written back as the edited language.
    const rawLabel = localizeValueForLocale(c.label, locale);
    const rawDesc = localizeValueForLocale(c.description, locale);
    return {
      id: String(id),
      label: typeof rawLabel === "string" && rawLabel.trim() ? rawLabel : humaniseCriterionId(String(id)),
      description: typeof rawDesc === "string" ? rawDesc : "",
      maxScore: Math.max(1, Math.min(10, initialMaxScore)),
      candidateVisible: Boolean(c.candidateVisible),
      // #902: the editor shows ONE language, but the stored value may hold three. Carry the whole
      // stored value and the locale it is being edited in, so the save can merge instead of
      // replacing — writing back a bare string deleted the two languages never shown.
      storedLabel: c.label ?? null,
      storedDescription: c.description ?? null,
      locale,
    };
  });
}

export function captureLatestCriteriaState(container, fallbackState) {
  if (!container) return Array.isArray(fallbackState) ? fallbackState.slice() : [];
  const cards = container.querySelectorAll(".vk-card");
  if (cards.length === 0) return [];
  return Array.from(cards).map((card, idx) => {
    const fallback = (Array.isArray(fallbackState) && fallbackState[idx]) ? fallbackState[idx] : {};
    return {
      id: fallback.id,
      label: card.querySelector(".vk-label")?.value.trim() ?? "",
      description: card.querySelector(".vk-description")?.value.trim() ?? "",
      maxScore: Math.max(1, Math.min(10, Number(card.querySelector(".vk-weight")?.value) || 5)),
      candidateVisible: card.querySelector(".vk-visible")?.checked ?? false,
      // #902: the DOM holds one language; the other two live only on the state object. Rebuilding
      // the item from the cards alone would drop them again on the way to the save — which is
      // exactly how the bare-string write survived the first fix.
      storedLabel: fallback.storedLabel,
      storedDescription: fallback.storedDescription,
      locale: fallback.locale,
    };
  });
}

export function buildCriteriaEditorHtml(criteria, t, tf) {
  const items = criteria.map((c, i) => {
    const labelLabel = escapeHtml(t("shell.criteria.labelLabel"));
    const descLabel = escapeHtml(t("shell.criteria.descLabel"));
    const weightText = escapeHtml(t("shell.criteria.weight"));
    // B4 (#451) a11y: remove-button aria-label includes the criterion's title so screen
    // readers say "Fjern: Klar kommunikasjon" — not just "Fjern". Falls back to a
    // positional label when title is empty.
    const removeAria = escapeHtml(
      c.label?.trim()
        ? tf("shell.criteria.removeAriaWithLabel", { label: c.label })
        : tf("shell.criteria.removeAriaPositional", { index: i + 1 })
    );
    // B4 a11y: aria-valuetext is what screen readers announce. Localised "{value} av 10" /
    // "{value} of 10". The vk-weight input event listener updates this dynamically.
    const weightValueText = escapeHtml(tf("shell.criteria.weightOfTen", { value: c.maxScore }));
    // Stage-tilbakemelding 2026-08-17: "Vurderingskriterium tar veldig mye plass". Fire stablede
    // rader i en kolonne dobbelt så bred som innholdet trengte. Samme felt, samme redigerbarhet —
    // pakket i BREDDEN. Skyveknappen er byttet mot en teller (femtedel av plassen, treffer et helt
    // tall hver gang), og beskrivelsen er én linje som vokser når man klikker i den.
    //
    // `vk-weight` beholder `type="range"` og klassenavnet: totalvekt-utregningen, aria-oppdateringen
    // og fire e2e-er leser dem. Den er visuelt skjult og erstattet av tellerknappene, som skriver
    // til samme input — ett tall, én kilde.
    return `
      <li class="vk-card" data-criterion-index="${i}">
        <input class="vk-label" type="text" value="${escapeHtml(c.label)}"
               placeholder="${escapeHtml(t("shell.criteria.labelPlaceholder"))}"
               aria-label="${labelLabel}" />
        <span class="vk-stepper">
          <button type="button" class="vk-step" data-step="-1"
                  aria-label="${escapeHtml(tf("shell.criteria.weightDown", { label: c.label || String(i + 1) }))}">&minus;</button>
          <input class="vk-weight" type="range" min="1" max="10" step="1" value="${c.maxScore}"
                 aria-label="${weightText}"
                 aria-valuemin="1" aria-valuemax="10" aria-valuenow="${c.maxScore}"
                 aria-valuetext="${weightValueText}" />
          <span class="vk-weight-value">${c.maxScore}</span>
          <button type="button" class="vk-step" data-step="1"
                  aria-label="${escapeHtml(tf("shell.criteria.weightUp", { label: c.label || String(i + 1) }))}">+</button>
        </span>
        <button type="button" class="vk-visible-toggle" aria-pressed="${c.candidateVisible ? "true" : "false"}"
                title="${escapeHtml(t("shell.criteria.visibleToCandidate"))}"
                aria-label="${escapeHtml(t("shell.criteria.visibleToCandidate"))}">
          <input class="vk-visible" type="checkbox" ${c.candidateVisible ? "checked" : ""} tabindex="-1" aria-hidden="true" />
          <span aria-hidden="true">${c.candidateVisible ? "◉" : "○"}</span>
        </button>
        <button type="button" class="vk-remove" data-criterion-index="${i}"
                aria-label="${removeAria}">×</button>
        <textarea class="vk-description" rows="1"
                  placeholder="${escapeHtml(t("shell.criteria.descPlaceholder"))}"
                  aria-label="${descLabel}">${escapeHtml(c.description)}</textarea>
      </li>`;
  }).join("");
  const total = criteria.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0);
  return `
    <ul class="vk-list">${items}</ul>
    <p class="vk-total"><strong>${escapeHtml(t("shell.criteria.totalWeight"))}:</strong> <span class="vk-total-value">${total}</span></p>
    <div class="vk-actions-row">
      <button type="button" class="vk-add vk-add-btn">+ ${escapeHtml(t("shell.criteria.add"))}</button>
      <button type="button" class="vk-regenerate vk-add-btn">${escapeHtml(t("shell.criteria.regenerate"))}</button>
    </div>`;
}

/**
 * ⚠️ `t` og `tf` sendes INN, de leses ikke fra modulen — samme grunn som for `driftText`.
 * Uten det er funksjonen uren gjennom oversetterne, og kan ikke enhetstestes.
 * `buildCriteriaEditorHtml` tok dem allerede som parametre; dette gjør de to like.
 *
 * Ingen atferdsendring: kalleren sender de samme `t` og `tf` som før.
 */
export function buildDriftDiffModalHtml(diff, locale, t, tf) {
  const { added, removed, changed } = diff;
  const totalChanges = added.length + removed.length + changed.length;

  const renderRow = (id, kind, body) => `
    <li class="drift-diff-row drift-diff-row--${kind}">
      <label>
        <input type="checkbox" data-diff-checkbox data-criterion-id="${escapeHtml(id)}" checked>
        <span class="drift-diff-row-body">${body}</span>
      </label>
    </li>
  `;

  const addedHtml = added.map(({ id, next }) => renderRow(id, "added", `
    <span class="drift-diff-row-tag drift-diff-row-tag--added">${escapeHtml(t("shell.drift.diff.added"))}</span>
    <strong>${escapeHtml(driftText(next?.label, locale) || id)}</strong>
    ${driftText(next?.description, locale) ? `<p class="drift-diff-row-desc">${escapeHtml(driftText(next.description, locale))}</p>` : ""}
  `)).join("");

  const removedHtml = removed.map(({ id, prev }) => renderRow(id, "removed", `
    <span class="drift-diff-row-tag drift-diff-row-tag--removed">${escapeHtml(t("shell.drift.diff.removed"))}</span>
    <strong>${escapeHtml(driftText(prev?.label, locale) || id)}</strong>
    ${driftText(prev?.description, locale) ? `<p class="drift-diff-row-desc">${escapeHtml(driftText(prev.description, locale))}</p>` : ""}
  `)).join("");

  const changedHtml = changed.map(({ id, prev, next, fields }) => {
    const parts = [];
    if (fields.labelChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.label"))}:</em> <s>${escapeHtml(driftText(prev?.label, locale))}</s> → <strong>${escapeHtml(driftText(next?.label, locale))}</strong></p>`);
    if (fields.descChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.description"))}:</em> ${escapeHtml(driftText(next?.description, locale))}</p>`);
    if (fields.scoreChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.maxScore"))}:</em> ${escapeHtml(String(prev?.maxScore ?? ""))} → ${escapeHtml(String(next?.maxScore ?? ""))}</p>`);
    if (fields.visChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.candidateVisible"))}:</em> ${Boolean(prev?.candidateVisible) ? "✓" : "—"} → ${Boolean(next?.candidateVisible) ? "✓" : "—"}</p>`);
    return renderRow(id, "changed", `
      <span class="drift-diff-row-tag drift-diff-row-tag--changed">${escapeHtml(t("shell.drift.diff.changed"))}</span>
      <strong>${escapeHtml(driftText(next?.label, locale) || id)}</strong>
      ${parts.join("")}
    `);
  }).join("");

  const emptyHtml = totalChanges === 0
    ? `<p class="drift-diff-empty">${escapeHtml(t("shell.drift.diff.noChanges"))}</p>`
    : "";

  return `
    <div class="drift-diff-modal">
      <header class="drift-diff-modal-header">
        <h2 id="driftDiffTitle">${escapeHtml(t("shell.drift.diff.title"))}</h2>
        <button type="button" class="drift-diff-close" data-diff-action="close" aria-label="${escapeHtml(t("shell.drift.diff.close"))}">×</button>
      </header>
      <p class="drift-diff-modal-summary">${escapeHtml(tf("shell.drift.diff.summary", { added: added.length, removed: removed.length, changed: changed.length }))}</p>
      <ul class="drift-diff-list">
        ${addedHtml}
        ${changedHtml}
        ${removedHtml}
      </ul>
      ${emptyHtml}
      <footer class="drift-diff-modal-footer">
        <button type="button" class="btn-secondary" data-diff-action="cancel">${escapeHtml(t("shell.drift.diff.cancel"))}</button>
        <button type="button" class="btn-secondary" data-diff-action="accept-selected">${escapeHtml(t("shell.drift.diff.acceptSelected"))}</button>
        <button type="button" class="btn-primary" data-diff-action="accept-all">${escapeHtml(t("shell.drift.diff.acceptAll"))}</button>
      </footer>
    </div>
  `;
}
