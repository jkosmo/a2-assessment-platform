// AA-6 (#762): deterministic content-preservation checks for the a2-authoring-api skill.
//
// Problem this guards against: a long dialogue produces APPROVED content, then a later
// "remove redundancy" request silently rewrites elements as short summaries, dropping
// approved examples/formulas/work-steps/caveats/tasks/assessment-criteria/attachments. The
// resulting export is schema-valid but pedagogically incomplete.
//
// The skill maintains an authoritative course state + master (workdir/course-state.json +
// course-master.md, or a canonical "course master" block in a plain chat). This module is the
// deterministic half of that discipline: given the last-approved element and a proposed
// revision (or the produced export), it classifies content as preserved / moved / deliberately
// removed / UNEXPECTEDLY MISSING, measures reductions, and decides what BLOCKS production.
//
// Node stdlib only. No I/O here — callers pass in text; this stays pure and repo-testable
// (see test/unit/agent-authoring-course-state.test.ts), mirroring import-package.mjs.
//
// See references/content-preservation.md for the governing rules and the state shape.

// Categories whose loss BLOCKS production regardless of the reduction percentage.
// (Issue 1: "Any loss of mandatory examples/formulas/templates/tasks/assessment-criteria
// blocks production regardless of %.")
export const MANDATORY_CATEGORIES = Object.freeze([
  "examples",
  "formulas",
  "templates", // includes required attachments/templates
  "tasks",
  "assessmentCriteria",
  "figures", // #763 (Layer B): an approved figure's ref + labels — a diagram is unique content, not redundancy
]);

// Reductions larger than this fraction of the approved length require explicit approval
// before production (Issue 1).
export const REDUCTION_APPROVAL_THRESHOLD = 0.2;

// Whitespace-normalised length — a fair proxy for "how much content is left" that ignores
// reflowing/indentation churn.
export function contentLength(text) {
  if (text == null) return 0;
  return String(text).replace(/\s+/g, " ").trim().length;
}

// Fraction of approved content removed (0 = nothing removed, 1 = everything removed).
// Content moved into attachments still counts as kept, so pass the attachments text too.
export function reductionRatio(approvedText, revisedText, attachmentsText = "") {
  const before = contentLength(approvedText);
  if (before === 0) return 0;
  const after = contentLength(`${revisedText ?? ""} ${attachmentsText ?? ""}`);
  return Math.max(0, (before - after) / before);
}

function normalizeForSearch(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Is `needle` (an approved example/formula/term/…) still present in `haystack`?
// Substring match on whitespace-normalised, case-folded text — deterministic and robust to
// reflowing. The skill supplies the concrete strings that MUST survive; this verifies them.
export function contains(haystack, needle) {
  const n = normalizeForSearch(needle);
  if (n.length === 0) return true; // nothing to look for
  return normalizeForSearch(haystack).includes(n);
}

// Classify every tracked item of an element against the produced (main) text + attachments.
//   preserved            — found in the main text
//   moved                — found only in attachments (kept, but relocated)
//   deliberatelyRemoved  — absent, but the author explicitly approved dropping it
//   unexpectedlyMissing  — absent and NOT approved for removal (this is the silent-drop bug)
// Mandatory categories may only be preserved or moved: a deliberate OR unexpected loss of a
// mandatory item is still a loss and blocks (see mandatoryLosses below).
export function classifyItems({ mandatory = {}, deliberatelyRemoved = [], figures = [] }, mainText, attachmentsText = "") {
  const removedSet = new Set((deliberatelyRemoved ?? []).map(normalizeForSearch));
  const result = { preserved: [], moved: [], deliberatelyRemoved: [], unexpectedlyMissing: [] };
  const categories = new Set([...MANDATORY_CATEGORIES, ...Object.keys(mandatory ?? {})]);

  const classify = (entry) => {
    if (contains(mainText, entry.item)) result.preserved.push(entry);
    else if (contains(attachmentsText, entry.item)) result.moved.push(entry);
    else if (removedSet.has(normalizeForSearch(entry.item))) result.deliberatelyRemoved.push(entry);
    else result.unexpectedlyMissing.push(entry);
  };

  for (const category of categories) {
    if (category === "figures") continue; // figures are objects, expanded below — not string items
    for (const item of mandatory?.[category] ?? []) {
      classify({ category, item, mandatory: MANDATORY_CATEGORIES.includes(category) });
    }
  }

  // #763 (Layer B): an approved figure is mandatory content. Each figure contributes its markdown
  // REF (`asset:<sourceId>`) AND every label text as mandatory "figures" items — a dropped figure
  // (ref gone) or an emptied/renamed label surfaces as an unexpectedly-missing mandatory loss.
  for (const figure of figures ?? []) {
    for (const item of figureItems(figure)) {
      classify({ category: "figures", item, mandatory: true, sourceId: figure.sourceId });
    }
  }
  return result;
}

// The mandatory strings a single approved figure must keep: its markdown ref token and each label.
function figureItems(figure) {
  const items = [];
  if (figure?.sourceId) items.push(`asset:${figure.sourceId}`);
  for (const label of figure?.labels ?? []) {
    if (typeof label === "string" && label.trim().length > 0) items.push(label);
  }
  return items;
}

// A mandatory item is "lost" if it is neither preserved nor moved (i.e. removed or missing).
// Any such loss blocks, regardless of the reduction percentage.
export function mandatoryLosses(classification) {
  return [...classification.deliberatelyRemoved, ...classification.unexpectedlyMissing].filter(
    (entry) => entry.mandatory,
  );
}

// Gate-4 revision review: compare the last-approved element to a proposed revision (the
// "remove redundancy" step). Returns everything the skill needs to decide whether to accept
// the revision, require approval, or block.
export function reviewRevision(element, revisedText, { attachmentsText = "", reductionApproved = false } = {}) {
  const classification = classifyItems(element, revisedText, attachmentsText);
  const ratio = reductionRatio(element.content, revisedText, attachmentsText);
  const lostMandatory = mandatoryLosses(classification);
  const lostUnique = classification.unexpectedlyMissing.filter((entry) => !entry.mandatory);
  const requiresApproval = ratio > REDUCTION_APPROVAL_THRESHOLD && !reductionApproved;

  const reasons = [];
  if (lostMandatory.length > 0) {
    reasons.push(
      `loss of mandatory ${[...new Set(lostMandatory.map((e) => e.category))].join(", ")} (blocks regardless of %)`,
    );
  }
  if (lostUnique.length > 0) {
    reasons.push(`${lostUnique.length} unique item(s) unexpectedly missing`);
  }
  if (requiresApproval) {
    reasons.push(`reduction ${(ratio * 100).toFixed(0)}% exceeds ${REDUCTION_APPROVAL_THRESHOLD * 100}% without approval`);
  }

  return {
    clientRef: element.clientRef,
    reductionRatio: ratio,
    requiresApproval,
    classification,
    lostMandatory,
    lostUnique,
    movedCount: classification.moved.length,
    preservedCount: classification.preserved.length,
    blocks: reasons.length > 0,
    reasons,
  };
}

// Pre-export loss audit (Issue 1): compare the authoritative master to the produced elements.
// `producedElements` is an array of { ref, text, attachmentsText? } — one per element that
// actually made it into the export. Callers build it with extractPackageElements /
// extractEnvelopeElements below, or by hand.
//
// Blocks when: an approved master element is absent from the export (element-level
// unexpectedlyMissing), OR any tracked item is unexpectedlyMissing, OR any mandatory item is
// lost. Deliberately-removed non-mandatory items are allowed (audit trail records them).
export function auditExport(master, producedElements) {
  const byRef = new Map((producedElements ?? []).map((e) => [e.ref, e]));
  const approved = (master.elements ?? []).filter((e) => e.status === "approved");

  const missingElements = [];
  const perElement = [];
  const totals = { preserved: 0, moved: 0, deliberatelyRemoved: 0, unexpectedlyMissing: 0 };
  const lostMandatoryAll = [];

  for (const element of approved) {
    const produced = byRef.get(element.clientRef);
    if (!produced) {
      missingElements.push(element.clientRef);
      continue;
    }
    const classification = classifyItems(element, produced.text, produced.attachmentsText ?? "");
    for (const key of Object.keys(totals)) totals[key] += classification[key].length;
    const lost = mandatoryLosses(classification);
    lostMandatoryAll.push(...lost.map((e) => ({ clientRef: element.clientRef, ...e })));
    perElement.push({
      clientRef: element.clientRef,
      classification,
      lostMandatory: lost,
      unexpectedlyMissing: classification.unexpectedlyMissing,
    });
  }

  const unexpectedlyMissingItems = perElement.flatMap((e) =>
    e.unexpectedlyMissing.map((item) => ({ clientRef: e.clientRef, ...item })),
  );

  const reasons = [];
  if (missingElements.length > 0) reasons.push(`approved element(s) absent from export: ${missingElements.join(", ")}`);
  if (unexpectedlyMissingItems.length > 0) reasons.push(`${unexpectedlyMissingItems.length} item(s) unexpectedly missing`);
  if (lostMandatoryAll.length > 0) reasons.push(`${lostMandatoryAll.length} mandatory item(s) lost`);

  return {
    totals,
    missingElements,
    unexpectedlyMissingItems,
    lostMandatory: lostMandatoryAll,
    perElement,
    blocks: reasons.length > 0,
    reasons,
  };
}

// Gate 6 readiness: production must not start without a complete course master in final order.
// Verifies every approved element is placed in `order`, and `order` references only known,
// approved elements. Returns { ready, issues }.
export function checkGate6Readiness(master) {
  const issues = [];
  const elements = master.elements ?? [];
  const order = master.order ?? [];
  const byRef = new Map(elements.map((e) => [e.clientRef, e]));
  const approved = elements.filter((e) => e.status === "approved");

  const orderSet = new Set(order);
  for (const element of approved) {
    if (!orderSet.has(element.clientRef)) {
      issues.push(`approved element "${element.clientRef}" is not placed in the final order`);
    }
    if (contentLength(element.content) === 0) {
      issues.push(`element "${element.clientRef}" has no stored full-text content`);
    }
  }
  for (const ref of order) {
    const element = byRef.get(ref);
    if (!element) issues.push(`order references unknown element "${ref}"`);
    else if (element.status !== "approved") issues.push(`order includes non-approved element "${ref}" (status: ${element.status})`);
  }
  if (order.length === 0) issues.push("course master has no ordered elements");

  return { ready: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Extractors — turn a produced artifact into { ref, text, attachmentsText } rows.
// A full JSON serialisation of a payload is a robust "does this string appear anywhere"
// surface for the substring-based classifier above.
// ---------------------------------------------------------------------------

function payloadText(payload) {
  return JSON.stringify(payload ?? {});
}

// #763 (Layer B): a figure's label text lives inside a base64-encoded SVG, so the JSON payload text
// alone can't confirm a label survived. Decode each SVG asset (base + localized variants), strip
// tags to expose the label text, and append it (plus the `asset:<sourceId>` ref) so the substring
// classifier can verify approved figure refs + labels against the produced artifact.
function figureSearchText(payloadWithAssets) {
  const assets = payloadWithAssets?.assets ?? [];
  const parts = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    if (asset.sourceId) parts.push(`asset:${asset.sourceId}`);
    if (asset.mimeType !== "image/svg+xml") continue;
    parts.push(decodeSvgText(asset.contentBase64));
    for (const variant of asset.localizedVariants ?? []) parts.push(decodeSvgText(variant.contentBase64));
  }
  return parts.join(" ");
}

function decodeSvgText(contentBase64) {
  try {
    const svg = Buffer.from(String(contentBase64 ?? ""), "base64").toString("utf8");
    return svg.replace(/<[^>]*>/g, " "); // strip tags, keep <text>/<tspan> label content
  } catch {
    return "";
  }
}

// From an a2-authoring-package/v1 (objects[] carry clientRef) — the natural pre-export artifact.
// Section objects may carry inline figures; their decoded label text + refs are folded into `text`.
export function extractPackageElements(pkg) {
  return (pkg.objects ?? []).map((object) => ({
    ref: object.clientRef,
    text: `${payloadText(object.payload)} ${figureSearchText(object.payload)}`,
    attachmentsText: payloadText(object.payload?.attachments ?? object.payload?.activeVersion?.attachments),
  }));
}

// From a produced a2-content-export/v1 course envelope. The envelope is self-contained (no
// clientRef), so items are zipped to `order` by position — the master's final order is the
// contract that ties them together. Section figures' decoded labels + refs are folded into `text`.
export function extractEnvelopeElements(envelope, order) {
  const items = envelope?.course?.course?.items ?? [];
  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return sorted.map((item, index) => ({
    ref: order?.[index],
    text: `${payloadText(item.module ?? item.section ?? item)} ${figureSearchText(item.section)}`,
    attachmentsText: payloadText((item.module ?? item.section)?.attachments),
  }));
}
