import { findMatchingPreset } from "/static/participant-console-state.js";

/**
 * #1046 — rollevelgeren for mock-innlogging, ett sted.
 *
 * ⚠️ HVORFOR DENNE FINNES. Funksjonen lå i FIRE kopier — `admin-platform.js`, `profile.js`,
 * `participant.js` og `participant-completed.js` — med 100 % identisk struktur, funnet av
 * `scripts/dev/similar-function-scan.mjs`.
 *
 * ⚠️ OG DE HADDE DRIFTET FRA HVERANDRE. To varianter:
 *
 *   9. mars  (participant, participant-completed): ingen null-vakter, ingen reservetekst
 *   22. mars (profile, admin-platform):            null-vakter og `?? ""`-reserver
 *
 * Den eldste ville KASTET hvis `mockRolePresetHint` eller `mockRolePresetContainer` manglet på
 * siden. Den nyeste tåler det. Fire kopier, to oppførsler, og ingen som visste om forskjellen.
 *
 * Denne modulen tar den nyeste, altså den forsvarlige.
 *
 * @param {object} opts
 * @param {HTMLSelectElement} opts.select
 * @param {HTMLElement | null} [opts.hint]
 * @param {HTMLElement | null} [opts.container]
 * @param {{ presets: string[], enabled: boolean }} opts.roleSwitchState
 * @param {string} opts.currentRoles  kommaseparert rolleliste fra skjemafeltet
 * @param {(key: string) => string} opts.t
 */
export function renderRolePresetControl({ select, hint, container, roleSwitchState, currentRoles, t }) {
  if (!select) return;

  select.innerHTML = "";

  const manual = document.createElement("option");
  manual.value = "";
  // Reserven kom med 22. mars-varianten. Uten den viser siden nøkkelen rått hvis oversettelsen
  // mangler — og to av de fire flatene gjorde nettopp det.
  manual.textContent = t("identity.rolePresetManual") ?? "— manual —";
  select.appendChild(manual);

  for (const role of roleSwitchState.presets) {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    select.appendChild(option);
  }

  select.value = findMatchingPreset(currentRoles, roleSwitchState.presets);

  const disabled = !roleSwitchState.enabled;
  select.disabled = disabled;

  if (hint) {
    hint.textContent = disabled
      ? (t("identity.rolePresetDisabledEntra") ?? "")
      : (t("identity.rolePresetHint") ?? "");
  }
  if (container) {
    container.hidden = roleSwitchState.presets.length === 0;
  }
}
