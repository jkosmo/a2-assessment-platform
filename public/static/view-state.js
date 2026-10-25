// 2.101.0: en oversikt husker hvordan den sto når man går tilbake til den.
//
// Produkteier, 2026-10-25: «Hvis man står i moduloversikten, filtrerer, så går inn i en modul, gjør
// ting og går tilbake, da er ikke filtreringen der lengre. Dette er en almen regel, hvis man går
// tilbake så bør systemet huske hvilken state oversikten var i.»
//
// Lagres i sessionStorage: per fane, overlever at man går inn i noe og tilbake (også med en ny
// sidelasting), og er borte når fanen lukkes. Ikke localStorage — en oversikt som er filtrert neste
// uke uten at man husker hvorfor, er verre enn en som starter blank.
//
// Lagringen kan være blokkert (privat vindu, nettleserinnstillinger). Da huskes ingenting, og sida
// virker som før — derfor fanges hver lesing og skriving.

const PREFIX = "a2.viewState.";

/** Det som er lagret for `key`, eller null. Aldri en feil. */
export function readViewState(key) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Lagre tilstanden for `key`. Aldri en feil. */
export function writeViewState(key, value) {
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Blokkert eller full lagring: oversikten husker ikke, men virker.
  }
}
