// #1137: seilbåten på fremdriftslinja i «Mine kurs» (gamifisering, produkteier 2026-11-01/02).
//
// Båten seiler mot VENSTRE — 2-tallet styrer fra høyre, som i A-2-logoen — så linja fylles fra
// høyre: det fylte er kjølvannet bak båten, og båten står i forkant av det. Det er bevisst motsatt
// leseretningen. Bare kurs i gang har båt: ikke påbegynt er dagens tomme linje, fullført er en hel
// grønn linje uten båt. Øyeblikket et kurs fullføres i økta kommer båten i mål til venstre, feirer
// og glir ut (`launchCourseBoatCelebration`). Figuren er godkjent på skisse-lerretet (tavla
// «Fremdriftslinja»): lukket trekantseil med én tynn tverrstrek — sammen A-en — og 2-tallets hode ved
// roret. Fargene er portalens egne (CSS-variabler i participant.html), ikke hex her.

/** Under denne andelen har båten flatt seil og én fartsstripe; fra den er seilet fullt. */
export const COURSE_BOAT_FULL_SAIL_PCT = 30;

/** Hvor lenge feiringen står før båten har glidd ut (ms). Speiles av animasjonen i participant.html. */
export const COURSE_BOAT_CELEBRATION_MS = 4200;

// Båten er tegnet i egne enheter (100 × 84) og skalert til 27 px høy. Hekken (høyre ende av skroget,
// x = 96) står på grensa mellom tomt og fylt.
const SCALE = 0.32;
const BOAT_W = Math.round(100 * SCALE); // 32 px
const STERN_PX = Math.round(96 * SCALE); // 31 px

const SAILS = {
  // Flatt seil: rett bakkant. Tverrstreken (A-ens) går fra masta ut til bakkanten ved y = 37.
  sulten: { sail: "M42 6 L72 58 L42 58 Z", boom: "M40 58 L72 58", batten: "M42 37 L59.5 37" },
  // Fullt seil: bakkanten bukter. Tverrstreken ender der kurven krysser y = 37 (x ≈ 77,5).
  mett: { sail: "M42 6 Q90 24 74 58 L42 58 Z", boom: "M40 58 L74 58", batten: "M42 37 L77 37" },
};
SAILS.feirer = SAILS.mett;

const STRIPES = {
  sulten: "M37 14 L47 14",
  mett: "M35 8 L49 8 M39 14 L55 14 M35 20 L47 20",
};

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
  const s = SAILS[mood];
  const headY = mood === "feirer" ? 42 : 48;
  const confetti = mood === "feirer"
    ? `<g class="course-boat-confetti">
        <rect class="cb-c cb-c1" x="40" y="1" width="5" height="5" rx="1"></rect>
        <circle class="cb-c cb-c2" cx="48" cy="10" r="3"></circle>
        <rect class="cb-c cb-c3" x="56" y="4" width="5" height="5" rx="1"></rect>
        <circle class="cb-c cb-c4" cx="4" cy="16" r="2.5"></circle>
      </g>`
    : "";
  const stripes = STRIPES[mood] ? `<path class="cb-stripes" d="${STRIPES[mood]}"></path>` : "";
  return `<svg class="course-boat-svg" width="60" height="34" viewBox="0 0 60 34" focusable="false">
      ${stripes}
      <g transform="translate(0 1) scale(${SCALE})">
        <path class="cb-sail" d="${s.sail}"></path>
        <path class="cb-batten" d="${s.batten}"></path>
        <path class="cb-mast" d="M40 64 L40 4"></path>
        <path class="cb-boom" d="${s.boom}"></path>
        <path class="cb-hull" d="M6 62 L96 62 Q90 82 52 82 Q20 82 6 62 Z"></path>
        <circle class="cb-head" cx="86" cy="${headY}" r="10"></circle>
      </g>
      ${confetti}
    </svg>`;
}

// Hvor langt til høyre fra båtens venstrekant fartsstripene rekker (px). QA 2.130.0: med 1 av 300 steg sto
// båten ved `100% - 32px`, og stripa havnet utenfor linja, der foreldren klipper den bort.
const STRIPE_REACH_PX = { sulten: 48, mett: 56 };

/** Venstrekanten til båten: hekken på grensa, men aldri så langt til høyre at stripene klippes. */
function boatLeft(pct, mood) {
  const reach = Math.max(BOAT_W, STRIPE_REACH_PX[mood] ?? BOAT_W);
  return `clamp(0px, calc(${100 - pct}% - ${STERN_PX}px), calc(100% - ${reach}px))`;
}

/**
 * HTML for fremdriftslinja. `barAttrs` er progressbar-attributtene (rolle, verdier, etikett) og
 * brukes uendret — retningen og båten er bare visuelle, båten er aria-hidden.
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
 * Øyeblikket kurset fullføres: båten kommer i mål ytterst til venstre, feirer med konfetti og glir ut.
 * Med redusert bevegelse vises den ikke i det hele tatt — den «forsvinner med en gang» (#1137).
 * Returnerer båten (eller null), så kalleren kan vente på den.
 */
export function launchCourseBoatCelebration(progressEl, { reducedMotion } = {}) {
  if (!progressEl || reducedMotion) return null;
  progressEl.querySelector(".course-boat")?.remove();
  progressEl.classList.add("course-progress--celebrating");
  const boat = document.createElement("span");
  boat.className = "course-boat course-boat--feirer course-boat--leaving";
  boat.dataset.boatMood = "feirer";
  boat.setAttribute("aria-hidden", "true");
  boat.style.left = "0px";
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
  setTimeout(finish, COURSE_BOAT_CELEBRATION_MS + 400);
  return boat;
}
