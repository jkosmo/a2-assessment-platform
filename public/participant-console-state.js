import { isAppealableFail, isSettledPass } from "/static/outcome.js";

const allowedMockRoles = new Set([
  "PARTICIPANT",
  "APPEAL_HANDLER",
  "ADMINISTRATOR",
  "REVIEWER",
  "REPORT_READER",
  "SUBJECT_MATTER_OWNER",
]);

const allowedAppealStatuses = new Set(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]);

export function sanitizeMockRolePresets(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim().toUpperCase();
    if (!allowedMockRoles.has(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return Array.from(unique);
}

export function resolveRoleSwitchState(config) {
  const authMode = config?.authMode === "entra" ? "entra" : "mock";
  const presets = sanitizeMockRolePresets(config?.mockRolePresets);
  const requested = config?.mockRoleSwitchEnabled !== false;
  const enabled = authMode === "mock" && requested && presets.length > 0;

  return {
    authMode,
    presets,
    enabled,
  };
}

export function findMatchingPreset(rolesValue, presets) {
  if (typeof rolesValue !== "string" || !Array.isArray(presets)) {
    return "";
  }

  const parts = rolesValue
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (parts.length !== 1) {
    return "";
  }

  return presets.includes(parts[0]) ? parts[0] : "";
}

export function sanitizeWorkspaceNavigationItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueIds = new Set();
  const items = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    const path = typeof item.path === "string" ? item.path.trim() : "";
    const labelKey = typeof item.labelKey === "string" ? item.labelKey.trim() : "";
    if (!id || !path || !labelKey || !path.startsWith("/") || uniqueIds.has(id)) {
      continue;
    }

    const requiredRoles = Array.isArray(item.requiredRoles)
      ? Array.from(
        new Set(
          item.requiredRoles
            .map((role) => (typeof role === "string" ? role.trim().toUpperCase() : ""))
            .filter((role) => allowedMockRoles.has(role)),
        ),
      )
      : [];

    // 2.126.0: områdets andre adresser, så punktet er markert på alle sidene i området.
    const areaPaths = Array.isArray(item.areaPaths)
      ? item.areaPaths.filter((p) => typeof p === "string" && p.startsWith("/")).map((p) => p.trim())
      : [];

    items.push({ id, path, labelKey, requiredRoles, ...(areaPaths.length > 0 ? { areaPaths } : {}) });
    uniqueIds.add(id);
  }

  return items;
}

function normalizePath(pathValue) {
  if (typeof pathValue !== "string") {
    return "";
  }

  const trimmed = pathValue.trim();
  if (!trimmed) {
    return "";
  }

  const withoutFragment = trimmed.split("#", 1)[0];
  const withoutQuery = withoutFragment.split("?", 1)[0];
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }

  return withoutQuery;
}

// 2.126.0 (produkteier 2026-11-01: «det bør uansett være tydelig hvor man er»): toppmenyen markerte
// bare punktet når adressen var NØYAKTIG lenkas. Innholdsforvaltning lenker til /admin-content/courses,
// så Moduler, Tema, Seksjoner og et åpent kurs viste ingen markering; det samme gjaldt Fullførte,
// Manuell behandling og Resultater. Et punkt er nå markert på lenka, på sidene under den, og på
// adressene området oppgir i `areaPaths`.
function isInArea(normalizedPath, paths) {
  return paths.some((p) => {
    const area = normalizePath(p);
    return Boolean(area) && (normalizedPath === area || normalizedPath.startsWith(`${area}/`));
  });
}

export function resolveWorkspaceNavigationItems(navigationItems, rolesValue, currentPath, fallbackItems = []) {
  const configured = sanitizeWorkspaceNavigationItems(navigationItems);
  const fallback = sanitizeWorkspaceNavigationItems(fallbackItems);
  const sourceItems = configured.length > 0 ? configured : fallback;

  const normalizedPath = normalizePath(currentPath);
  const roleSet = new Set(
    typeof rolesValue === "string"
      ? rolesValue
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
      : [],
  );

  return sourceItems.map((item) => {
    const requiredRoles = Array.isArray(item.requiredRoles) ? item.requiredRoles : [];
    const visible =
      requiredRoles.length === 0 ||
      requiredRoles.some((role) => roleSet.has(role));

    return {
      ...item,
      visible,
      active: isInArea(normalizedPath, [item.path, ...(item.areaPaths ?? [])]),
    };
  });
}

export function buildModuleCardViewModels(modules, selectedModuleId) {
  if (!Array.isArray(modules)) {
    return [];
  }

  return modules
    .filter(
      (module) =>
        module &&
        typeof module.id === "string" &&
        module.id.trim().length > 0 &&
        typeof module.title === "string" &&
        module.title.trim().length > 0,
    )
    .map((module) => {
      const latestStatus =
        typeof module?.participantStatus?.latestStatus === "string"
          ? module.participantStatus.latestStatus.toUpperCase()
          : "";
      const completed = latestStatus === "COMPLETED";
      return {
        ...module,
        id: module.id,
        title: module.title,
        selected: module.id === selectedModuleId,
        completed,
        latestStatus,
      };
    })
    .sort((left, right) => {
      if (left.selected !== right.selected) {
        return left.selected ? -1 : 1;
      }
      if (left.completed !== right.completed) {
        return left.completed ? 1 : -1;
      }
      return left.title.localeCompare(right.title);
    });
}

export function resolveSelectedModule(modules, selectedModuleId) {
  const models = buildModuleCardViewModels(modules, selectedModuleId);
  return models.find((module) => module.selected) ?? null;
}

export function parseDraftEnvelope(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return { modules: {} };
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || !parsed.modules || typeof parsed.modules !== "object") {
      return { modules: {} };
    }
    return { modules: parsed.modules };
  } catch {
    return { modules: {} };
  }
}

export function pruneExpiredModuleDrafts(moduleDrafts, ttlMinutes, nowMs = Date.now()) {
  if (!moduleDrafts || typeof moduleDrafts !== "object") {
    return {};
  }

  const ttlMs = Math.max(1, Number(ttlMinutes) || 0) * 60 * 1000;
  const result = {};

  for (const [moduleId, draft] of Object.entries(moduleDrafts)) {
    if (!draft || typeof draft !== "object") {
      continue;
    }
    const updatedAtMs = Date.parse(draft.updatedAt ?? "");
    if (Number.isNaN(updatedAtMs)) {
      continue;
    }
    if (nowMs - updatedAtMs > ttlMs) {
      continue;
    }
    result[moduleId] = draft;
  }

  return result;
}

export function upsertModuleDraft(moduleDrafts, moduleId, draftData, nowMs = Date.now(), maxModules = 30) {
  if (!moduleId) {
    return moduleDrafts ?? {};
  }

  const base = { ...(moduleDrafts ?? {}) };
  base[moduleId] = {
    ...draftData,
    updatedAt: new Date(nowMs).toISOString(),
  };

  const ordered = Object.entries(base)
    .sort((left, right) => {
      const leftTime = Date.parse(left[1]?.updatedAt ?? "");
      const rightTime = Date.parse(right[1]?.updatedAt ?? "");
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })
    .slice(0, Math.max(1, Number(maxModules) || 30));

  return Object.fromEntries(ordered);
}

// #934 skive 5a-1: nøkler i en kladd som ikke er svarfelt.
/** 2.136.5: kladden lagres per felt-id, og en modul kan ha et felt som heter hva som helst. Svaret om KI må ikke overskrive deltakerens tekst. */
export const AI_DECLARATION_DRAFT_KEY = "__aiDeclaration";

const DRAFT_META_KEYS = new Set(["mcq", "submittedAs", "updatedAt", AI_DECLARATION_DRAFT_KEY]);

/**
 * Tekst i kladden til felt siden ikke lenger har. Kladden lagres per felt-id. Har oppgaven fått en ny versjon med andre
 * felt, eller blitt ren flervalg, ville teksten verken vises eller overleve neste lagring, rett etter at siden sa at
 * svaret var lagret som kladd.
 *
 * En kladd med `submittedAs` er restene av et svar som er levert. Den teksten trenger ikke reddes.
 *
 * @returns {{ id: string, text: string }[]}
 */
export function orphanedDraftTexts(draft, renderedFieldIds) {
  if (!draft || typeof draft !== "object" || draft.submittedAs) {
    return [];
  }
  const rendered = new Set(renderedFieldIds);
  return Object.entries(draft)
    .filter(([id, text]) => !DRAFT_META_KEYS.has(id) && !rendered.has(id) && typeof text === "string" && text.trim().length > 0)
    .map(([id, text]) => ({ id, text }));
}

/** Vurderingen er ferdig nok til at resultatet kan vises (også mens en sensor ser på den). */
export function isAssessmentResultReady(status) {
  const normalized = typeof status === "string" ? status.toUpperCase() : "";
  return normalized === "COMPLETED" || normalized === "UNDER_REVIEW" || normalized === "SCORED";
}

/**
 * 2.126.0 (produkteier 2026-11-01): «Man bør ha mulighet for å kunne senere anke på et resultat, det
 * bør ikke være en beslutning man må ta der og da.» Før ble modulen nullstilt hver gang den ble åpnet:
 * forrige resultat ble ikke lastet, anke-knappen kom aldri, og en flervalgsmodul startet et nytt forsøk
 * med en gang. Den eneste veien til en senere anke var «Fullførte»-siden.
 *
 * Nå vises siste resultat når modulen åpnes — UNNTATT når deltakeren har begynt på et nytt forsøk:
 * en kladd med innhold som ikke er det leverte svaret. En kladd lagret mens et svar var levert, bærer
 * id-en til det svaret (`submittedAs`); er den lik siste innlevering, er kladden bare restene av den.
 * En kladd uten merket (lagret før 2.126.0) regnes som et nytt forsøk — som før.
 *
 * @returns {string | null} innleveringen hvis resultat skal vises
 */
export function earlierResultToShow(participantStatus, draft, draftIsMeaningful) {
  const submissionId = participantStatus?.latestSubmissionId;
  // REJECTED er et endelig utfall (SETTLED_STATUSES i /static/outcome.js), selv om ingen kodesti skriver
  // den i dag — et avvist svar skal heller ikke gi et nytt forsøk av seg selv.
  const status = typeof participantStatus?.latestStatus === "string" ? participantStatus.latestStatus.toUpperCase() : "";
  if (typeof submissionId !== "string" || !submissionId || !(isAssessmentResultReady(status) || status === "REJECTED")) return null;
  if (draftIsMeaningful && draft?.submittedAs !== submissionId) return null;
  return submissionId;
}

/**
 * #934 skive 5a-3: modulen er åpnet fra et kurs som sier at den må tas på nytt. Siste vedtak sier bestått, men det gjaldt en versjon
 * som ikke lenger teller i dette kurset. Da skal siden starte et nytt forsøk, ikke vise det gamle resultatet som om alt var i orden.
 * Har deltakeren alt begynt på nytt (strøket, eller saken vurderes), går siden som vanlig: resultatet, med anke og «Prøv igjen».
 *
 * `retakeRequired` kommer bare fra kursdetaljen med den nye regelen. Uten den er oppførselen som før.
 */
export function courseRetakeApplies(retakeRequired, participantStatus) {
  if (retakeRequired !== true) return false;
  return isSettledPass({
    passFailTotal: participantStatus?.latestDecision?.passFailTotal,
    submissionStatus: participantStatus?.latestStatus,
  });
}

/** #934 skive 5a-3: krever dette kurset, slik serveren svarte, et nytt forsøk i modulen? */
export function courseStillRequiresRetake(course, moduleId) {
  return (course?.items ?? []).some((item) => item?.type === "MODULE" && item.moduleId === moduleId && item.retakeRequired === true);
}

/**
 * 2.134.1: går «KI skrev det meste» til sensor for denne modulen? Samme regel som `evaluateAiInfluence` på serveren: modulens egen
 * innstilling først, så den globale. I skyggemodus rutes ingen, og da skal siden ikke love det.
 */
export function aiReviewRoutingLive(globalRules, module) {
  const own = module?.assessmentPolicy?.aiInfluence;
  const enabled = own?.enabled ?? globalRules?.enabled;
  const shadowMode = own?.shadowMode ?? globalRules?.shadowMode;
  return enabled === true && shadowMode !== true;
}

/**
 * 2.134.1: en innlevering er opprettet, så modulen er ikke lenger «ikke startet». Kursdetaljene i minnet hentes ellers bare på nytt
 * etter en bestått, så en sak hos sensor eller et stryk sto som «ikke startet» til siden ble lastet på nytt. Svarer med kursene som
 * ble endret. Samme overgang som serveren gjør (`moduleStatusOf` i routes/courses.ts).
 */
export function markCourseModuleStarted(courseDetails, moduleId) {
  const changed = [];
  for (const [courseId, course] of Object.entries(courseDetails ?? {})) {
    for (const list of [course?.items, course?.modules]) {
      for (const entry of list ?? []) {
        if (entry?.moduleId === moduleId && entry.moduleStatus === "NOT_STARTED") {
          entry.moduleStatus = "IN_PROGRESS";
          if (!changed.includes(courseId)) changed.push(courseId);
        }
      }
    }
  }
  return changed;
}

export function deriveParticipantFlowGateState(flowState, options = {}) {
  const hasSubmission = flowState?.hasSubmission === true;
  const hasMcqSubmission = flowState?.hasMcqSubmission === true;
  const assessmentQueued = flowState?.assessmentQueued === true;
  const resultStatus = typeof flowState?.resultStatus === "string" ? flowState.resultStatus : null;
  // #578: FREETEXT_ONLY modules have no MCQ, so the assessment unlocks as soon as the free-text
  // submission exists — there is no MCQ gate.
  const requiresMcq = options?.requiresMcq !== false;

  const assessmentUnlocked = hasSubmission && (!requiresMcq || hasMcqSubmission);
  const checkAssessmentUnlocked = assessmentUnlocked && assessmentQueued;
  // ⚠️ #1002: krevde `COMPLETED`. Produkteier 2026-08-24: *«Anke er kraftigere lut enn manuell
  // behandling … la oss ikke lage en regel uten skjellig grunn.»* Anken er ikke et neste steg etter
  // manuell vurdering — den er et sterkere virkemiddel, og serveren har alltid tillatt begge.
  //
  // ⚠️ Første forsøk løsnet bare `isAppealableFail`, som styrer om SEKSJONEN vises. Denne gaten
  // styrer om KNAPPEN virker, og den sto igjen — så regelen var løsnet ett sted og fortsatt låst
  // et annet. Funnet av QA-porten. De to leser nå samme regel.
  const appealUnlocked = isAppealableFail({
    passFailTotal: flowState?.resultPassFail ?? null,
    submissionStatus: resultStatus,
  });

  let assessmentHintKey = "flow.assessmentReady";
  if (!hasSubmission) {
    assessmentHintKey = "flow.assessmentLockedNeedsSubmission";
  } else if (requiresMcq && !hasMcqSubmission) {
    assessmentHintKey = "flow.assessmentLockedNeedsMcq";
  }

  const checkAssessmentHintKey = checkAssessmentUnlocked
    ? "flow.checkAssessmentReady"
    : "flow.checkAssessmentLockedNeedsQueue";

  // Hint-nøkkelen står: låst betyr fortsatt «det finnes ikke et strykvedtak å anke».
  const appealHintKey = appealUnlocked ? "flow.appealReady" : "flow.appealLockedNeedsCompleted";

  return {
    assessmentUnlocked,
    checkAssessmentUnlocked,
    appealUnlocked,
    assessmentHintKey,
    checkAssessmentHintKey,
    appealHintKey,
  };
}

export function sanitizeAppealStatuses(value, fallback = ["OPEN", "IN_REVIEW"]) {
  if (!Array.isArray(value)) {
    return Array.from(new Set(fallback.filter((status) => allowedAppealStatuses.has(status))));
  }

  const statuses = value
    .map((status) => (typeof status === "string" ? status.trim().toUpperCase() : ""))
    .filter((status) => allowedAppealStatuses.has(status));

  if (statuses.length === 0) {
    return Array.from(new Set(fallback.filter((status) => allowedAppealStatuses.has(status))));
  }

  return Array.from(new Set(statuses));
}

// ─────────────────────────────────────────────────────────────────────────────
// #992: ÉN definisjon av «tilgjengelig» og «ferdig» i kurssekvensen — klientens speilbilde av
// `src/modules/course/sectionAvailability.ts`.
//
// Fram til nå svarte fire steder i participant.js ulikt på det samme spørsmålet:
//
//   findNextIncompleteEntry   seksjon: !read           modul: !PASSED && available
//   raden (`available`)       seksjon: ALLTID true     modul: available !== false
//   nextEntryAfter            ingen sjekk              ingen sjekk
//   outstandingBeforeFinish   seksjon: !read           modul: !PASSED
//
// `isSection || entry.available !== false` ble skrevet den gang bare moduler hadde feltet. Da #944
// ga seksjoner ekte `available`, ble antakelsen en løgn — og klienten begynte å være uenig med
// serverens bevisport.
//
// ⚠️ Utfallet var en BLINDVEI som ikke fantes før 2.26.1: et kurs med en arkivert modul ga
// deltakeren «1 gjenstår» og ingen «Avslutt kurset»-knapp, mens serveren filtrerte samme modul bort
// og gjerne ville utstedt beviset. Lå modulen ETTER seksjonen, prøvde «Marker lest og gå videre» å
// åpne den — rett i 404-en #944 innførte.
//
// De bor her, ikke i participant.js, fordi de da kan testes som det de er: rene funksjoner.
// `test/participant-sequence-predicate-guard.test.js` holder dem alene om jobben.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kan deltakeren åpne dette elementet?
 *
 * ⚠️ `undefined` betyr «vis den», ikke «ukjent». DTO-en (`courseReadModels.ts`) har `available`
 * PÅKREVD på begge variantene, så feltet mangler bare når vi snakker med en eldre server — og all
 * oppførsel før #944 var nettopp å vise alt. Å tolke `undefined` som utilgjengelig ville skjult
 * hele kurset ved en versjonsmismatch, som er langt verre enn den blindveien vi retter.
 */
export function isEntryAvailable(entry) {
  return entry?.available !== false;
}

/** Ferdig: seksjon lest, eller modul bestått. */
export function isEntryDone(entry) {
  return entry?.type === "SECTION" ? entry.read === true : entry?.moduleStatus === "PASSED";
}

/**
 * Krever kursbeviset dette elementet?
 *
 * ⚠️ #996: dette er IKKE det samme som `isEntryAvailable`, og å blande dem var en blindvei.
 *
 *   arkivert modul     tilgjengelig: nei   påkrevd: NEI    (tatt ut av sirkulasjon)
 *   avpublisert modul  tilgjengelig: nei   påkrevd: JA     (midlertidig nede, teller fortsatt)
 *
 * Bevisporten på serveren filtrerer bare på `archivedAt`. Da `isEntryOutstanding` utledet «ikke
 * påkrevd» fra `available: false`, tilbød klienten «Avslutt kurset» i kurs serveren ikke ville
 * utstedt bevis for: klikket registrerte lesningen, og så skjedde ingenting. Nøyaktig samme stille
 * blindvei som #929 ble skrevet for å fjerne.
 *
 * `undefined` betyr «påkrevd», av samme grunn som `isEntryAvailable` defaulter til synlig: feltet er
 * påkrevd i DTO-en, så det mangler bare mot en eldre server. Da er «still kravet» det trygge svaret
 * — vi tilbyr heller ikke å avslutte enn å love et bevis som ikke kommer.
 */
export function isEntryRequired(entry) {
  return entry?.required !== false;
}

/**
 * Uferdig OG påkrevd — det eneste som skal kunne stoppe «Avslutt kurset».
 *
 * Merk at dette bruker `isEntryRequired`, ikke `isEntryAvailable`. Et element kan være utilgjengelig
 * og likevel stå i veien; da er riktig svar å nekte fullføring, ikke å late som kravet er borte.
 */
export function isEntryOutstanding(entry) {
  return isEntryRequired(entry) && !isEntryDone(entry);
}
