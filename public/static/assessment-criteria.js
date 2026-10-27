// #1124: kriteriene for deltakeren — før levering («Slik vurderes svaret ditt») og etter vurdering
// (poeng per kriterium).
//
// ⚠️ HVA SOM VISES, AVGJØRES PÅ SERVEREN. `assessmentCriteria` og `criterionScores` har allerede
// latt skjulte kriterier (`candidateVisible: false`) være igjen, delt beskrivelsen i trinn og regnet
// vurdererens 0–4 om til kriteriets egen skala. Her tegnes bare det som kom. En klient som filtrerte
// selv, ville betydd at det skjulte allerede var sendt.
//
// Bygget med DOM-noder og `textContent`, ikke `innerHTML`: kriterietekstene er forfatterskrevet.
// Egen fil (ikke inne i participant.js) så tegningen kan prøves i jsdom for seg.

function fill(template, params) {
  let out = String(template ?? "");
  for (const [key, value] of Object.entries(params ?? {})) out = out.split(`{${key}}`).join(String(value));
  return out;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function head(doc, label, right, rightClass) {
  const row = el(doc, "div", "criteria-item-head");
  row.append(el(doc, "span", "criteria-item-label", label), el(doc, "span", rightClass, right));
  return row;
}

/**
 * Før levering: et sammenleggbart panel under oppgaveteksten. `null` når det ikke er noe å vise — da
 * står det ikke noe tomt panel på siden.
 *
 * @param {Document} doc
 * @param {Array<{id:string,label:string|null,scaleMax:number,intro:string|null,steps:Array<{score:number,text:string}>}>} criteria
 * @param {{ t: (key:string)=>string, labelFor: (id:string)=>string }} options
 */
export function buildCriteriaPanel(doc, criteria, { t, labelFor }) {
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  const panel = el(doc, "details", "criteria-panel");
  // Åpent: deltakeren skal se hva som gir poeng FØR hen skriver, ikke måtte lete etter det.
  panel.open = true;
  panel.appendChild(el(doc, "summary", "criteria-panel-summary", t("submission.criteria.title")));
  const body = el(doc, "div", "criteria-panel-body");
  body.appendChild(el(doc, "p", "criteria-panel-lead", t("submission.criteria.lead")));
  for (const criterion of criteria) {
    const item = el(doc, "section", "criteria-item");
    item.dataset.criterionId = criterion.id;
    item.appendChild(head(doc, criterion.label || labelFor(criterion.id), fill(t("submission.criteria.scale"), { max: criterion.scaleMax }), "criteria-item-scale"));
    if (criterion.intro) item.appendChild(el(doc, "p", "criteria-item-intro", criterion.intro));
    if (Array.isArray(criterion.steps) && criterion.steps.length > 0) {
      const list = el(doc, "ul", "criteria-steps");
      for (const step of criterion.steps) {
        const li = el(doc, "li");
        li.append(el(doc, "strong", "", String(step.score)), doc.createTextNode(` — ${step.text}`));
        list.appendChild(li);
      }
      item.appendChild(list);
    }
    body.appendChild(item);
  }
  panel.appendChild(body);
  return panel;
}

/**
 * Etter vurdering: ett kort per kriterium med «1 av 2», begrunnelsen, og — der deltakeren ikke fikk
 * fullt — hva toppnivået krever. Returnerer kortene og hvilke kriterier som er dekket, så kalleren kan
 * vise begrunnelsene for resten (kriterier uten poeng her) slik som før.
 *
 * @param {Document} doc
 * @param {Array<{id:string,label:string|null,score:number,maxScore:number,topStep:string|null}>} scores
 * @param {Record<string,string>|null} rationales
 * @param {{ t: (key:string)=>string, labelFor: (id:string)=>string }} options
 */
export function buildCriterionScoreList(doc, scores, rationales, { t, labelFor }) {
  if (!Array.isArray(scores) || scores.length === 0) return { list: null, covered: new Set() };
  const list = el(doc, "div", "criterion-score-list");
  const covered = new Set();
  for (const s of scores) {
    covered.add(s.id);
    const short = s.score < s.maxScore;
    const item = el(doc, "div", short ? "criterion-score is-short" : "criterion-score");
    item.dataset.criterionId = s.id;
    item.appendChild(head(doc, s.label || labelFor(s.id), fill(t("result.criteria.score"), { score: s.score, max: s.maxScore }), "criterion-score-value"));
    const rationale = rationales?.[s.id];
    if (rationale) item.appendChild(el(doc, "p", "criterion-score-rationale", String(rationale)));
    // Serveren sender `topStep` bare der deltakeren ikke fikk fullt (`buildCriterionScores`).
    if (s.topStep) {
      item.appendChild(el(doc, "p", "criterion-score-top", fill(t("result.criteria.topStep"), { max: s.maxScore, text: s.topStep })));
    }
    list.appendChild(item);
  }
  return { list, covered };
}
