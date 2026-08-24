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

    items.push({ id, path, labelKey, requiredRoles });
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
      active: normalizePath(item.path) === normalizedPath,
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
  const appealUnlocked = resultStatus === "COMPLETED";

  let assessmentHintKey = "flow.assessmentReady";
  if (!hasSubmission) {
    assessmentHintKey = "flow.assessmentLockedNeedsSubmission";
  } else if (requiresMcq && !hasMcqSubmission) {
    assessmentHintKey = "flow.assessmentLockedNeedsMcq";
  }

  const checkAssessmentHintKey = checkAssessmentUnlocked
    ? "flow.checkAssessmentReady"
    : "flow.checkAssessmentLockedNeedsQueue";

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
