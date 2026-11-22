// #1137: figuren på fremdriftslinja i «Mine kurs» (gamifisering, produkteier 2026-11-01/02).
//
// Bare kurs i gang har figur: ikke påbegynt er dagens tomme linje, fullført er en hel grønn linje uten figur.
// Øyeblikket et kurs fullføres i økta kommer figuren i mål til venstre, feirer og glir ut
// (`launchCourseBoatCelebration`).
//
// Selve figuren kommer fra maskotpakken (doc/design/MASKOTPAKKE.md): SVG-en for hver tilstand og målene, som
// serveren leverer som JS-modul (/static/mascot/figure.js), så tegningen er synkron. SVG-en settes rett inn i siden,
// aldri som <img>, så stilen (/static/mascot/figure.css) og animasjonen virker. Seilbåten seiler mot VENSTRE — 2-tallet
// styrer fra høyre, som i A-2-logoen — så linja fylles fra høyre: det fylte er kjølvannet bak båten, og båten står i
// forkant av det. Det er bevisst motsatt leseretningen. Klassenavnene og `data-boat-mood` er de samme for alle pakker.

import { FIGURE } from "/static/mascot/figure.js";

/** Under denne andelen har figuren flatt seil og én fartsstripe; fra den er seilet fullt. Felles for alle pakker. */
export const COURSE_BOAT_FULL_SAIL_PCT = 30;

/** Hvor lenge feiringen står før figuren har glidd ut (ms). Speiles av animasjonen i pakkens figure.css. */
export const COURSE_BOAT_CELEBRATION_MS = FIGURE.celebrationMs;

/** Humøret på linja (`data-boat-mood`) → figurens tilstand i pakken. */
const FIGURE_STATE = { sulten: "flatt", mett: "fullt", feirer: "feiring" };

/**
 * Hvordan linja skal se ut for et kurs.
 * @param {{ completed: boolean, stepsDone: number, pct: number }} input
 * @returns {{ variant: "empty" | "boat" | "done", mood: "sulten" | "mett" | null }}
 */
export function courseBoatState({ completed, stepsDone, pct }) {
  if (completed) return { variant: "done", mood: null };
  // «Første steg tatt» telles i steg, ikke i avrundet prosent: 1 av 300 steg er 0 % men et steg.
  if (!(stepsDone > 0)) return { variant: "empty", mood: null };
  return { variant: "boat", mood: pct >= COURSE_BOAT_FULL_SAIL_PCT ? "mett" : "sulten" };
}

function boatSvg(mood) {
  return FIGURE.svg[FIGURE_STATE[mood]];
}

/**
 * Venstrekanten til figuren: hekken (`sternPx` fra venstrekanten) på grensa mellom tomt og fylt (hekkregelen), men
 * aldri så langt til høyre at fartsstripene klippes (stripegrensen). QA 2.130.0: med 1 av 300 steg sto båten ved
 * `100% - 32px`, og stripa havnet utenfor linja, der foreldren klipper den bort.
 *
 * Stripegrensen gjelder bare når linja er minst like bred som stripenes rekkevidde. På en smalere linje (kraftig zoom)
 * ville `100% - <rekkevidde>` blitt negativ og låst båten til venstre kant uansett fremdrift (#1137); der får stripene
 * uansett ikke plass, og hekkregelen alene bestemmer. Det avgjøres i CSS, uten måling: det andre leddet i `max()` er
 * negativt når linja er bred nok (da vinner stripegrensen), og svært stort når den er smalere (da løftes grensa ut av
 * veien). Faktoren gjør overgangen brå: allerede en sekstifiredels piksel under rekkevidden gir over 150 px.
 */
function boatLeft(pct, mood) {
  const reach = Math.max(FIGURE.widthPx, FIGURE.stripeReachPx[FIGURE_STATE[mood]] ?? FIGURE.widthPx);
  const stern = `calc(${100 - pct}% - ${FIGURE.sternPx}px)`;
  const stripeLimit = `max(calc(100% - ${reach}px), calc((${reach}px - 100%) * 10000))`;
  return `clamp(0px, ${stern}, ${stripeLimit})`;
}

/**
 * HTML for fremdriftslinja. `barAttrs` er progressbar-attributtene (rolle, verdier, etikett) og
 * brukes uendret — retningen og figuren er bare visuelle, figuren er aria-hidden.
 */
export function renderCourseProgress({ completed, stepsDone, pct, barAttrs }) {
  const state = courseBoatState({ completed, stepsDone, pct });
  const width = state.variant === "done" ? 100 : pct;
  const fillClass = state.variant === "done" ? "course-progress-fill completed" : "course-progress-fill";
  const bar = `<div class="course-progress-bar" ${barAttrs}><div class="${fillClass}" style="width:${width}%"></div></div>`;
  const boat = state.variant === "boat"
    ? `<span class="course-boat course-boat--${state.mood}" data-boat-mood="${state.mood}" style="left:${boatLeft(pct, state.mood)}" aria-hidden="true">${boatSvg(state.mood)}</span>`
    : "";
  return `<div class="course-progress course-progress--${state.variant}">${bar}${boat}</div>`;
}

/**
 * Øyeblikket kurset fullføres: figuren kommer i mål ytterst til venstre, feirer med konfetti og glir ut.
 * Med redusert bevegelse vises den ikke i det hele tatt — den «forsvinner med en gang» (#1137).
 * Returnerer figuren (eller null), så kalleren kan vente på den.
 *
 * `elapsedMs`: feiringen har allerede vart så lenge, og fortsetter der den var (#1137: lista ble tegnet på nytt midt i
 * feiringen, etter et språk- eller visningsbytte). Animasjonen startes med negativ forsinkelse, og sikkerhetsnettet
 * kortes ned tilsvarende, så feiringen er over når den opprinnelige tiden er ute. Kalleren starter den bare mens det
 * er tid igjen.
 */
export function launchCourseBoatCelebration(progressEl, { reducedMotion, elapsedMs = 0 } = {}) {
  if (!progressEl || reducedMotion) return null;
  progressEl.querySelector(".course-boat")?.remove();
  progressEl.classList.add("course-progress--celebrating");
  const boat = document.createElement("span");
  boat.className = "course-boat course-boat--feirer course-boat--leaving";
  boat.dataset.boatMood = "feirer";
  boat.setAttribute("aria-hidden", "true");
  boat.style.left = "0px";
  if (elapsedMs > 0) boat.style.animationDelay = `-${Math.round(elapsedMs)}ms`;
  boat.innerHTML = boatSvg("feirer");
  progressEl.appendChild(boat);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    boat.remove();
    progressEl.classList.remove("course-progress--celebrating");
  };
  boat.addEventListener("animationend", (event) => {
    if (event.target === boat) finish();
  });
  // Sikkerhetsnett: en fane i bakgrunnen kan holde igjen animasjonshendelsen.
  setTimeout(finish, COURSE_BOAT_CELEBRATION_MS - elapsedMs + 400);
  return boat;
}
