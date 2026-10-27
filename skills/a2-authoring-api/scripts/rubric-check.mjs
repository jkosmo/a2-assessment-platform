// #1122: every assessment criterion describes its scale — what earns the lowest score, the highest,
// and at least one step between. One line for the whole scale («0–4: Reglene er konkrete …») leaves
// the assessor (and the AI assessor) to guess what separates 1 from 3, and the feedback goes vague.
//
// Measured on the 15 stage courses (2026-10-26, 74 criteria): 55 had one line for the scale, 14
// described every step («0 = ingen kontroll; 1 = sier generelt …; 2 = …»), 5 described the ends and the
// middle («0 = mangler, 2 = …, 4 = …») — those pass too.
//
// ONE file for the skill and the platform (`#rubric-check` in package.json, like `#mcq-cue`). The skill
// stops on a finding; the platform shows it as a warning.
//
// A criterion is a string («0–4: …») or an object with `description` (and `label`, `maxScore`); either
// may be a localized map. The scale is `maxScore` when given (0 to it), else the first «a–b» in the
// text; a step is the number followed by «=», «:», «)» or «poeng:», anywhere else in the text.
//
// Node stdlib only, pure.

const RANGE = /(\d+)\s*[–-]\s*(\d+)/;

function textOf(value, primary) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const lang of [primary, "nb", "nn", "en-GB"]) if (lang && typeof value[lang] === "string") return value[lang];
    const first = Object.values(value).find((v) => typeof v === "string");
    if (first) return first;
  }
  return "";
}

/** The text that describes a criterion: the string itself, or its `description`. */
export function criterionText(criterion, primary) {
  if (criterion && typeof criterion === "object" && "description" in criterion) return textOf(criterion.description, primary);
  return textOf(criterion, primary);
}

// A step: the number, not part of another number or a range, followed by «=», «:», «)» or «poeng:».
function stepMarker(step) {
  return new RegExp(`(?<![\\d–-])${step}\\s*(?:=|:|\\)|poeng\\s*:|p\\s*:)`, "g");
}

function scaleOf(criterion, text) {
  const maxScore = criterion && typeof criterion === "object" && Number.isInteger(criterion.maxScore) ? criterion.maxScore : null;
  // `maxScore` is the scale when it is given; then «a–b» is read only where it repeats that scale —
  // «artikkel 6-1» in a description is not one.
  const found = RANGE.exec(text);
  const range = found && (maxScore === null || (Number(found[1]) === 0 && Number(found[2]) === maxScore)) ? found : null;
  const min = range ? Number(range[1]) : 0;
  const max = range ? Number(range[2]) : maxScore;
  return { min, max, range };
}

/** The scale («0–4» → {min:0,max:4}, or from `maxScore`) and which steps the text describes. */
export function describedSteps(criterion, primary) {
  const text = criterionText(criterion, primary);
  const { min, max, range } = scaleOf(criterion, text);
  if (max === null || max <= min) return { min, max, described: [] };
  const rest = range ? text.slice(0, range.index) + " " + text.slice(range.index + range[0].length) : text;
  const described = [];
  for (let step = min; step <= max; step++) {
    if (stepMarker(step).test(rest)) described.push(step);
  }
  return { min, max, described };
}

// Ends of a piece of text: separators and the punctuation between steps («; », «. », «— »).
function tidy(value) {
  return value.replace(/\s+/g, " ").replace(/^[\s,;:.=–—-]+|[\s,;:.–—-]+$/g, "");
}

/**
 * #1124: the steps in the criterion's own words, for the participant — read with the SAME syntax as
 * `describedSteps`, so what the check calls «described» is what the participant sees.
 *
 * `{ min, max, intro, steps: [{ step, text }] }`: `intro` is what the text says before the first step,
 * without the scale («Behov, 0–3 poeng.» → «Behov»). A text with no scale is read on `defaultMax`
 * (the platform scores 0–4) — «0 = …; 2 = …; 4 = …» describes steps whether or not it names the range.
 * Steps are found in order: step k is looked for after step k−1, so a number inside a step's text is
 * not taken for an earlier step.
 */
export function stepTexts(criterion, primary, { defaultMax = null } = {}) {
  const text = criterionText(criterion, primary);
  const scale = scaleOf(criterion, text);
  const { min, range } = scale;
  const max = scale.max ?? defaultMax;
  const introOf = (prefix) =>
    tidy(range && range.index < prefix.length
      ? prefix.slice(0, range.index) + " " + prefix.slice(range.index + range[0].length).replace(/^\s*(?:poeng|points?|p)?\s*[.:]?/i, "")
      : prefix);
  if (max === null || max <= min) return { min, max, intro: introOf(text) || null, steps: [] };
  // The range is blanked, not cut, so the positions below are positions in `text`.
  const masked = range ? text.slice(0, range.index) + " ".repeat(range[0].length) + text.slice(range.index + range[0].length) : text;
  const marks = [];
  let from = 0;
  for (let step = min; step <= max; step++) {
    const marker = stepMarker(step);
    marker.lastIndex = from;
    const found = marker.exec(masked);
    if (!found) continue;
    marks.push({ step, start: found.index, end: found.index + found[0].length });
    from = found.index + found[0].length;
  }
  const steps = marks
    .map((mark, i) => ({ step: mark.step, text: tidy(text.slice(mark.end, marks[i + 1]?.start ?? text.length)) }))
    .filter((s) => s.text);
  return { min, max, intro: introOf(marks.length ? text.slice(0, marks[0].start) : text) || null, steps };
}

/** The bottom, the top, and — on a scale with a middle — at least one step between. */
export function scaleIsDescribed({ min, max, described }) {
  if (max === null || max === undefined) return false;
  if (!described.includes(min) || !described.includes(max)) return false;
  return max - min < 2 || described.some((step) => step > min && step < max);
}

/** Findings for one rubric's criteria: [{ criterion, kind, detail }]. */
export function checkRubricScales(criteria, { primary } = {}) {
  const findings = [];
  for (const [name, criterion] of Object.entries(criteria ?? {})) {
    const steps = describedSteps(criterion, primary);
    if (scaleIsDescribed(steps)) continue;
    const scale = steps.max === null || steps.max === undefined ? "a scale" : `${steps.min}–${steps.max}`;
    findings.push({
      criterion: name,
      kind: "scale_not_described",
      detail: `«${name}» has one line for ${scale}. Describe what earns ${steps.min}, what earns ${steps.max ?? "the top"}, and a step between — «${steps.min} = …; ${Math.round(((steps.min ?? 0) + (steps.max ?? 4)) / 2)} = …; ${steps.max ?? 4} = …» — each something an assessor can see in an answer.`,
    });
  }
  return findings;
}

/** Every rubric in an authoring package or an export envelope: [{ path, title, criteria }]. */
export function collectRubrics(doc) {
  const rubrics = [];
  const from = (path, av, title) => {
    const criteria = av?.rubric?.criteria;
    if (criteria && typeof criteria === "object" && Object.keys(criteria).length > 0) rubrics.push({ path, ...(title ? { title } : {}), criteria });
  };
  if (Array.isArray(doc?.objects)) {
    for (const o of doc.objects) if (o?.type === "module") from(`objects[${o.clientRef ?? "?"}]`, o.payload?.activeVersion);
    return rubrics;
  }
  if (doc?.scope === "module") from("module", doc.module?.activeVersion, doc.module?.module?.title);
  if (doc?.scope === "course") {
    for (const [i, item] of (doc.course?.course?.items ?? []).entries()) {
      if (item?.type === "MODULE") from(`course.items[${i}]`, item.module?.activeVersion, item.module?.module?.title);
    }
    for (const [i, m] of (doc.course?.course?.modules ?? []).entries()) from(`course.modules[${i}]`, m?.activeVersion, m?.module?.title);
  }
  return rubrics;
}
