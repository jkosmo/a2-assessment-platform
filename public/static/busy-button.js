/**
 * #1046 — én knapp-i-arbeid-hjelper.
 *
 * ⚠️ HVORFOR DENNE FINNES. Den lå som tre nesten identiske lokale kopier: `participant.js`,
 * `participant-completed.js` og `profile.js`. Den eneste forskjellen var at én av dem tok et
 * `after`-kall.
 *
 * ⚠️ OG HVA DET KOSTET. `results.js` hadde ingen kopi, og brukte `showLoading(knappen)` i stedet.
 * Den erstatter elementets `innerHTML` med skjelettlinjer — og `hideLoading` rydder bare klasser,
 * den gjenoppretter ikke innhold. **Teksten på «Last resultater» forsvant derfor permanent** ved
 * første klikk, helt til et språkbytte kalte `applyTranslations()` og skrev den tilbake.
 *
 * Feilen har ligget der siden mars, og ble funnet av produkteier 30.08 — ikke av noen test.
 *
 * Forskjellen er verdt å merke seg: `showLoading` er for BEHOLDERE som skal fylles med innhold.
 * En knapp har allerede innholdet sitt, og skal bare markeres som opptatt.
 *
 * @param {HTMLButtonElement | null} button
 * @param {() => Promise<unknown>} action
 * @param {() => void} [after] kjøres etter at knappen er frigjort, uansett utfall
 */
export async function runWithBusyButton(button, action, after = () => {}) {
  if (!button || button.dataset.busy === "true") return;

  const wasDisabled = button.disabled;
  button.dataset.busy = "true";
  button.disabled = true;
  button.classList.add("button-busy");
  button.setAttribute("aria-busy", "true");

  try {
    await action();
  } finally {
    button.dataset.busy = "";
    button.classList.remove("button-busy");
    button.removeAttribute("aria-busy");
    button.disabled = wasDisabled;
    after();
  }
}
