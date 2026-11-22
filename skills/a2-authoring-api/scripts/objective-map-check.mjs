// #1125: every test question is linked to a learning objective and to a section that teaches it,
// before the test; every objective is tested.
//
// What is tested is what the learner takes to be important. The course review (2026-10-26) found
// five questions on the routine for uploading files and none on the critical path, and a test that
// asked for a structure the course explained only after the test.
//
// WHERE THE LINK LIVES: in the skill's own course state, not in the import file. The platform's
// import has no field for it (a question carries stem, options, answer, rationale), and the author
// approves the objectives at gate 2 and the outline at gate 3 — the link is a record of what was
// approved, so the check reads that record instead of guessing from the text:
//
//   "learningObjectives": [ { "id": "mal-1", "text": "Etter dette kan deltakeren …" } ],
//   "elements": [ …, { "clientRef": "mod-x", "type": "module", …,
//     "questions": [
//       { "question": "<the stem as written, in the course's language>", "objective": "mal-1", "section": "sec-a" },
//       { "task": true, "objective": ["mal-1", "mal-2"], "section": ["sec-a", "sec-b"] } ] } ]
//
// WHY NOT FROM THE TEXT: measured on the 15 stage courses (306 multiple-choice questions, nb), a
// question's content words found in an earlier section: 290 at half or more, 1 only in a section
// after the test, 15 in none. The 15 were read: the ones looked at were all taught («Enhetstest»
// has a section of its own; «IT og OT» has a heading) — the question is a new situation, which is
// what a good question is (#1121), so its words are not the section's. A text rule would stop the
// good questions. The link has to be stated.
//
// STOP OR NOTE:
//   fail  a question or a free-text task with no link, a link to an objective or a section that is
//         not in the course, a section that comes after the test, a link to a question that is no
//         longer in the module. Each is the skill's own record out of step with the course — the
//         fix is always to write the link as it is — or a test that asks what is not yet taught.
//   note  an objective no question or task tests. The course design allows it («background may
//         need only a section»), and 9 of the 88 sections a stage test follows are matched by no
//         question — introductions and «about the sources». The author decides.
//
// Node stdlib only, pure apart from the command line at the bottom.

const norm = (text) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const list = (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).map((v) => String(v));
const short = (text) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
};

/**
 * @param {object} state  the course state: `learningObjectives` and the module elements' `questions`
 * @param {object} options
 *   order    [{ ref, type: "section" | "module" }] in course order — the package's course when there is
 *            one (what the learner gets), else the state's own `order`
 *   modules  [{ ref, questions: string[], hasTask: boolean }] from the package, or null: then only the
 *            links themselves are read (the plan check, before the package exists)
 *   partial  true when `modules` holds only some of the course's tests (adjusting a course: the changed
 *            and new ones) — an objective the others test cannot be counted, so none is reported
 * @returns {{ objectives: number, linked: number, findings: Array<{ severity: "fail" | "note", ref: string | null, detail: string }> }}
 */
export function checkObjectiveMap(state, { order = null, modules = null, partial = false } = {}) {
  const findings = [];
  const fail = (ref, detail) => findings.push({ severity: "fail", ref, detail });
  const elements = Array.isArray(state?.elements) ? state.elements : [];
  const byRef = new Map(elements.map((element) => [element?.clientRef, element]));
  const sequence = order ?? (state?.order ?? []).map((ref) => ({ ref, type: byRef.get(ref)?.type }));
  const position = new Map(sequence.map((item, index) => [item.ref, index]));
  const sections = new Set(sequence.filter((item) => item.type === "section").map((item) => item.ref));

  const objectives = Array.isArray(state?.learningObjectives) ? state.learningObjectives : [];
  const ids = new Set();
  for (const [index, objective] of objectives.entries()) {
    const id = typeof objective?.id === "string" ? objective.id : "";
    if (id.trim() === "" || typeof objective?.text !== "string" || objective.text.trim() === "") {
      fail(null, `learningObjectives[${index}] needs an "id" and a "text" — { "id": "mal-${index + 1}", "text": "Etter dette kan deltakeren …" }`);
    } else if (ids.has(id)) fail(null, `learningObjectives: the id "${id}" is used twice`);
    else ids.add(id);
  }
  if (objectives.length === 0) {
    fail(null, "the course state has no learningObjectives — write the objectives the author approved at gate 2, each with an id, and link every question to one (course-design.md#learning-objectives)");
  }

  const tested = new Set();
  let linked = 0;
  const moduleRefs = modules ? modules.map((m) => m.ref) : sequence.filter((item) => item.type === "module").map((item) => item.ref);
  const fromPackage = new Map((modules ?? []).map((m) => [m.ref, m]));
  for (const ref of moduleRefs) {
    const entries = Array.isArray(byRef.get(ref)?.questions) ? byRef.get(ref).questions : [];
    const at = position.get(ref) ?? Infinity;

    for (const entry of entries) {
      const what = entry?.task === true ? "the free-text task" : `«${short(entry?.question)}»`;
      const objectiveIds = list(entry?.objective);
      const sectionRefs = list(entry?.section);
      for (const id of objectiveIds) tested.add(id);
      if (objectiveIds.length === 0) fail(ref, `${what}: no objective — name the one it tests`);
      for (const id of objectiveIds) {
        if (!ids.has(id)) fail(ref, `${what} points at objective "${id}", which is not among the course's learningObjectives (${[...ids].join(", ") || "none"})`);
      }
      if (sectionRefs.length === 0) fail(ref, `${what}: no section — name the section that teaches what it asks`);
      for (const section of sectionRefs) {
        if (!sections.has(section)) fail(ref, `${what} points at "${section}", which is not a section in the course`);
        else if (position.get(section) > at) fail(ref, `${what} is taught in "${section}", which comes after the test — move the section before the test, or point at the section before it that teaches it`);
      }
    }

    // The plan check has no package to hold the links against; a test with no link at all is still
    // a test whose questions point nowhere.
    if (!modules && entries.length === 0) fail(ref, `no question is linked — add the module's "questions" to the course state, each with the objective it tests and the section that teaches it`);

    const written = fromPackage.get(ref);
    if (!written) continue;
    const linkedQuestions = new Set(entries.filter((e) => e?.task !== true).map((e) => norm(e?.question)));
    const stems = new Set(written.questions.map(norm));
    written.questions.forEach((stem, index) => {
      if (linkedQuestions.has(norm(stem))) linked += 1;
      else fail(ref, `question ${index + 1} («${short(stem)}») is not linked — add it to the module's "questions" in the course state with the objective it tests and the section that teaches it`);
    });
    for (const entry of entries) {
      if (entry?.task !== true && !stems.has(norm(entry?.question))) {
        fail(ref, `the course state links «${short(entry?.question)}», which is not a question in the module — write the question as it now stands, or take the link out`);
      }
    }
    if (written.hasTask) {
      if (entries.some((e) => e?.task === true)) linked += 1;
      else fail(ref, `the free-text task is not linked — add { "task": true, "objective": […], "section": […] } to the module's "questions" in the course state`);
    }
  }

  // An objective no question tests: across the whole course, so only when the whole course is read.
  if (!partial) {
    for (const objective of objectives) {
      if (typeof objective?.id === "string" && ids.has(objective.id) && !tested.has(objective.id)) {
        findings.push({ severity: "note", ref: null, detail: `objective "${objective.id}" («${short(objective.text)}») is tested by no question or task — add one, or tell the author it is taught and not tested` });
      }
    }
  }
  return { objectives: ids.size, linked, findings };
}

// ---------------------------------------------------------------------------
// Command line — the plan check, on the course state alone, before the package is built:
//   node scripts/objective-map-check.mjs work/course-state.json
// ---------------------------------------------------------------------------
export function formatObjectiveMap(result) {
  const lines = result.findings.map((f) => `${f.severity === "fail" ? "FAIL" : "NOTE"} ${f.ref ? `"${f.ref}": ` : ""}${f.detail}`);
  if (!result.findings.some((f) => f.severity === "fail")) lines.unshift(`OK   ${result.objectives} objective(s); every link points at an objective and a section before its test`);
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const [stateFile] = process.argv.slice(2);
  if (!stateFile) {
    console.error("usage: node scripts/objective-map-check.mjs work/course-state.json");
    process.exit(2);
  }
  const { readFileSync } = await import("node:fs");
  const result = checkObjectiveMap(JSON.parse(readFileSync(stateFile, "utf8")));
  console.log(formatObjectiveMap(result));
  process.exit(result.findings.some((f) => f.severity === "fail") ? 1 : 0);
}
