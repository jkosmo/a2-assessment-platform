// #934 skive 3, 4b og 5b: valget mellom mindre versjon og hovedversjon for et kurs. Flyttet hit fra admin-content-courses.js i skive 5b,
// fordi moduldialogen på modulsiden og «Publiser nye versjoner» på kurssiden bruker det samme valget, én gang per kurs.
//
// Produkteier 2026-11-01 (doc/DESIGN_934.md): når innholdet i et publisert kurs endres, velger forfatteren mindre versjon (rettelser,
// kursbevisene gjelder som før) eller hovedversjon (nytt innhold deltakerne må ta). Standard er mindre; hovedversjon krever et bevisst
// klikk. Tjeneren eier reglene (og gjør en hovedversjon uten kursbevis til mindre). Tallene (`certificateHolders`,
// `majorEmailRecipients`, `published`) kommer fra serveren og regnes aldri ut her.

import { escapeHtml } from "./html-escape.js";
import { setHidden } from "/static/dom-visibility.js";

// #934 skive 4b: over så mange mottakere krever en hovedversjon et ekstra «ja» (produkteier 2026-11-03). Samme tall som serveren
// (`MAJOR_EMAIL_CONFIRM_THRESHOLD`); serveren teller på nytt og avviser med 409 uten bekreftelsen.
const MAJOR_EMAIL_CONFIRM_THRESHOLD = 200;

/** Hvor mange en hovedversjon sender e-post til, eller null når serveren ikke sier det (eldre server). */
function majorEmailRecipients(course) {
  return Number.isInteger(course?.majorEmailRecipients) ? course.majorEmailRecipients : null;
}

function selectedCourseVersion(host, name) {
  return host?.querySelector(`input[name="${name}"]:checked`)?.value === "major" ? "major" : "minor";
}

/** Svaret som felt i et kall: `{ [versionField]: "major" | "minor", confirmEmailRecipients? }`, eller ingenting. */
export function versionRequestBody(answer, versionField) {
  if (!answer) return {};
  return {
    [versionField]: answer.version,
    ...(answer.confirmEmailRecipients !== undefined ? { confirmEmailRecipients: answer.confirmEmailRecipients } : {}),
  };
}

export function courseVersionLabel(course) {
  if (!Number.isInteger(course?.versionMajor)) return "";
  return `v${course.versionMajor}.${Number.isInteger(course.versionMinor) ? course.versionMinor : 0}`;
}

/** Valget og tekstene på siden sitt språk. `t` og `tf` er sidens oversetter. */
export function createCourseVersionChoice({ t, tf }) {
  function courseVersionHoldersText(course) {
    const n = Number(course?.certificateHolders) || 0;
    return n === 1
      ? tf("courses.version.holdersOne", { major: course.versionMajor })
      : tf("courses.version.holdersMany", { n, major: course.versionMajor });
  }

  function courseVersionChoiceHtml(name, course) {
    const major = course.versionMajor;
    const minor = Number.isInteger(course.versionMinor) ? course.versionMinor : 0;
    return `<fieldset class="course-version-choices">
      <legend class="course-version-legend">${escapeHtml(t("courses.version.legend"))}</legend>
      <label class="course-version-choice"><input type="radio" name="${name}" value="minor" checked>
        <span><strong>${escapeHtml(tf("courses.version.minor", { next: `${major}.${minor + 1}` }))}</strong>
        <span class="course-version-hint">${escapeHtml(t("courses.version.minorHint"))}</span></span></label>
      <label class="course-version-choice"><input type="radio" name="${name}" value="major">
        <span><strong>${escapeHtml(tf("courses.version.major", { next: `${major + 1}.0` }))}</strong>
        <span class="course-version-hint">${escapeHtml(tf("courses.version.majorHint", { major }))}</span></span></label>
    </fieldset>
    <div class="course-version-consequence" data-version-consequence aria-live="polite"></div>`;
  }

  function majorEmailLineHtml(course, next) {
    const n = majorEmailRecipients(course);
    if (n === null) return "";
    const text = n === 0
      ? t("courses.version.majorEmailNone")
      : n === 1 ? tf("courses.version.majorEmailOne", { next }) : tf("courses.version.majorEmailMany", { n, next });
    const confirm = n > MAJOR_EMAIL_CONFIRM_THRESHOLD
      ? `<label class="course-version-email-confirm"><input type="checkbox" data-email-confirm>
        <span>${escapeHtml(tf("courses.version.majorEmailConfirm", { n }))}</span></label>
      <p class="course-version-email-missing" data-email-confirm-missing hidden>${escapeHtml(tf("courses.version.majorEmailConfirmMissing", { n }))}</p>`
      : "";
    return `<li>${escapeHtml(text)}${confirm}</li>`;
  }

  function renderCourseVersionConsequence(host, course, choice) {
    const box = host?.querySelector("[data-version-consequence]");
    if (!box) return;
    const major = course.versionMajor;
    const next = `${major + 1}.0`;
    box.classList.toggle("is-major", choice === "major");
    box.innerHTML = choice === "major"
      ? `<p><strong>${escapeHtml(tf("courses.version.majorConsequenceTitle", { next }))}</strong></p>
      <ul>
        <li>${escapeHtml(tf("courses.version.majorKeep", { major, next }))}</li>
        <li>${escapeHtml(tf("courses.version.majorCounts", { major }))}</li>
        <li>${escapeHtml(t("courses.version.majorReport"))}</li>
        ${majorEmailLineHtml(course, next)}
      </ul>`
      : `<p>${escapeHtml(t("courses.version.minorConsequence"))}</p>`;
  }

  /**
   * #934 skive 4b: svaret fra valget, klart til å sendes: `{ version, confirmEmailRecipients }`. Hovedversjon sender tallet dialogen
   * viste; serveren krever det over grensen. Mangler det ekstra «ja» over grensen, gir den `null`, viser hvorfor og flytter fokus til
   * avkrysningen. Da sendes ingenting.
   */
  function courseVersionAnswer(host, name, course) {
    const version = selectedCourseVersion(host, name);
    if (version !== "major") return { version };
    const n = majorEmailRecipients(course);
    if (n !== null && n > MAJOR_EMAIL_CONFIRM_THRESHOLD) {
      const box = host?.querySelector("[data-email-confirm]");
      if (!box?.checked) {
        setHidden(host?.querySelector("[data-email-confirm-missing]"), false);
        box?.focus();
        return null;
      }
    }
    return n === null ? { version } : { version, confirmEmailRecipients: n };
  }

  /**
   * Tegn valget i `host` og hold konsekvensen (og ev. en knappetekst) i takt med det. Lytteren står på `host`, ikke på knappene:
   * tegnes valget på nytt i samme `host`, er det fortsatt én lytter, og den gjelder de nye knappene.
   */
  function mountCourseVersionChoice(host, name, course, onChange) {
    host.innerHTML = courseVersionChoiceHtml(name, course);
    const update = () => {
      const choice = selectedCourseVersion(host, name);
      renderCourseVersionConsequence(host, course, choice);
      onChange?.(choice);
    };
    host.onchange = (event) => {
      if (event.target?.name === name) update();
    };
    update();
  }

  function courseStateChipHtml(course) {
    if (course.archived) return ` <span class="status-chip">${escapeHtml(t("courses.version.courseArchived"))}</span>`;
    if (course.published === false) return ` <span class="status-chip">${escapeHtml(t("courses.version.courseUnpublished"))}</span>`;
    return "";
  }

  function emailIfMajorText(course) {
    const n = majorEmailRecipients(course);
    if (n === null) return "";
    if (n === 0) return t("courses.version.emailIfMajorNone");
    return n === 1 ? t("courses.version.emailIfMajorOne") : tf("courses.version.emailIfMajorMany", { n });
  }

  function affectedCourseHtml(course, id, currentCourseId) {
    const holders = Number(course.certificateHolders) > 0;
    // 2.137.0: bare kursets eier velger hovedversjon. Et felt som mangler (gammel server), betyr som før.
    const mayChoose = course.canChooseVersion !== false;
    const chip = courseVersionLabel(course) ? ` <span class="status-chip course-version-chip">${escapeHtml(courseVersionLabel(course))}</span>` : "";
    const current = course.courseId === currentCourseId ? ` <span class="course-version-course-this">${escapeHtml(t("courses.version.thisCourse"))}</span>` : "";
    const facts = !mayChoose
      ? t("courses.version.otherOwners")
      : holders
        ? `${courseVersionHoldersText(course)} ${emailIfMajorText(course)}`
        : t("courses.version.noHolders");
    return `<section class="course-version-course" role="group" aria-labelledby="${id}" data-course-id="${escapeHtml(course.courseId)}">
      <h3 class="course-version-course-title" id="${id}"><span class="course-version-course-name">${escapeHtml(course.title || course.courseId)}</span>${current}${chip}${courseStateChipHtml(course)}</h3>
      <p class="course-version-course-facts">${escapeHtml(facts)}</p>
      ${holders && mayChoose ? "<div data-course-version-host></div>" : ""}
    </section>`;
  }

  /**
   * #934 skive 5b: ett valg per berørt kurs. Et kurs uten kursbevis får mindre versjon uansett (`resolveCourseVersionKind` på serveren),
   * og det samme gjør et kurs forfatteren ikke eier (2.137.0). De får ingen knapper å trykke på, bare beskjeden. Det kurset dialogen står i, kommer først.
   *
   * `read()` gir feltene til kallet, eller `null` når et kurs over 200 mottakere mangler det ekstra «ja». Da sendes ingenting. Det sendes
   * bare svar for kurs det ble spurt om: får et kurs kursbevis etter at dialogen ble vist, avviser serveren (`course_version_required`),
   * og forfatteren blir spurt. Et svar klienten fant på selv, ville gått gjennom uten at noen hadde tatt stilling.
   */
  function mountAffectedCourses(host, courses, { prefix, currentCourseId = null }) {
    const ordered = [...courses].sort((a, b) => Number(b.courseId === currentCourseId) - Number(a.courseId === currentCourseId));
    host.innerHTML = ordered.map((course, index) => affectedCourseHtml(course, `${prefix}-title-${index}`, currentCourseId)).join("");
    const sections = [...host.querySelectorAll("[data-course-id]")];
    const asked = [];
    ordered.forEach((course, index) => {
      const slot = sections[index]?.querySelector("[data-course-version-host]");
      if (!slot) return;
      const name = `${prefix}-${index}`;
      mountCourseVersionChoice(slot, name, course);
      asked.push({ course, slot, name });
    });
    return {
      read() {
        const courseVersions = {};
        const confirmEmailRecipients = {};
        const unanswered = [];
        for (const { course, slot, name } of asked) {
          const answer = courseVersionAnswer(slot, name, course);
          if (!answer) {
            unanswered.push(slot);
            continue;
          }
          courseVersions[course.courseId] = answer.version;
          if (answer.confirmEmailRecipients !== undefined) confirmEmailRecipients[course.courseId] = answer.confirmEmailRecipients;
        }
        if (unanswered.length > 0) {
          // Det øverste som mangler, ikke det siste `courseVersionAnswer` var innom.
          unanswered[0].querySelector("[data-email-confirm]")?.focus();
          return null;
        }
        return {
          courseVersions,
          expectedCourseIds: ordered.map((course) => course.courseId),
          ...(Object.keys(confirmEmailRecipients).length > 0 ? { confirmEmailRecipients } : {}),
        };
      },
    };
  }

  return { courseVersionHoldersText, courseVersionAnswer, mountCourseVersionChoice, mountAffectedCourses };
}
