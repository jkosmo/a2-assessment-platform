// 2.101.2: «systemet jobber» for handlinger som tar tid og ikke skal avbrytes — import, samlet publisering.
//
// Produkteier, 2026-10-25: «Når man importerer så jobber systemet uten at det markeres at det jobbes
// og UI er fortsatt responsivt.» En kursimport kan ta minutter. Uten tegn til arbeid trykket man igjen
// (to importer), eller gikk fra siden midt i.
//
// Mens arbeidet pågår:
//   - et modalt vindu med teksten og en spinner. `showModal` gjør resten av siden inert, så ingenting
//     annet kan klikkes; Esc lukker det ikke;
//   - musepekeren er en ventepeker over hele siden («Kursor bør spinne», produkteier);
//   - lukker eller laster man siden, spør nettleseren først (beforeunload).
// Vinduet fjernes når arbeidet er ferdig, også når det feiler — feilen går videre til kalleren.
//
// ⚠️ Naviger ETTER at `runWithWorkDialog` har returnert, ikke inne i `work`: ellers spør nettleseren
// «vil du forlate siden?» om selve navigasjonen som avslutter jobben.

let active = 0;

function onBeforeUnload(event) {
  event.preventDefault();
  // Eldre nettlesere krever en returverdi; teksten vises ikke lenger, nettleseren bruker sin egen.
  event.returnValue = "";
}

/**
 * @template T
 * @param {string} message  hva som skjer, på leserens språk, f.eks. «Importerer kurset …»
 * @param {() => Promise<T>} work
 * @param {{ detail?: string }} [options]  en linje til, f.eks. «Dette kan ta et par minutter.»
 * @returns {Promise<T>}
 */
export async function runWithWorkDialog(message, work, options = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "work-dialog";
  dialog.setAttribute("aria-live", "polite");
  dialog.setAttribute("aria-busy", "true");
  const spinner = document.createElement("span");
  spinner.className = "work-dialog-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("p");
  text.className = "work-dialog-text";
  text.textContent = message;
  dialog.append(spinner, text);
  if (options.detail) {
    const detail = document.createElement("p");
    detail.className = "work-dialog-detail";
    detail.textContent = options.detail;
    dialog.append(detail);
  }
  // Esc skal ikke lukke vinduet mens arbeidet går.
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");

  active += 1;
  if (active === 1) {
    window.addEventListener("beforeunload", onBeforeUnload);
    // Produkteier: «Kursor bør spinne» — pekeren er det man ser på når man venter.
    document.documentElement.classList.add("is-working");
  }
  try {
    return await work();
  } finally {
    active -= 1;
    if (active === 0) {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.documentElement.classList.remove("is-working");
    }
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    dialog.remove();
  }
}
