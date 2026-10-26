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

/** The scale («0–4» → {min:0,max:4}, or from `maxScore`) and which steps the text describes. */
export function describedSteps(criterion, primary) {
  const text = criterionText(criterion, primary);
  const maxScore = criterion && typeof criterion === "object" && Number.isInteger(criterion.maxScore) ? criterion.maxScore : null;
  // `maxScore` is the scale when it is given; then «a–b» is read only where it repeats that scale —
  // «artikkel 6-1» in a description is not one.
  const found = RANGE.exec(text);
  const range = found && (maxScore === null || (Number(found[1]) === 0 && Number(found[2]) === maxScore)) ? found : null;
  const min = range ? Number(range[1]) : 0;
  const max = range ? Number(range[2]) : maxScore;
  if (max === null || max <= min) return { min, max, described: [] };
  const rest = range ? text.slice(0, range.index) + " " + text.slice(range.index + range[0].length) : text;
  const described = [];
  for (let step = min; step <= max; step++) {
    if (new RegExp(`(?<![\\d–-])${step}\\s*(?:=|:|\\)|poeng\\s*:|p\\s*:)`).test(rest)) described.push(step);
  }
  return { min, max, described };
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
