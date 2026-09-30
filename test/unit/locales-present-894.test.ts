import { describe, expect, it } from "vitest";
import { localesPresent } from "../../src/i18n/content.js";

// #894: «hvilke språk finnes tittelen på?» er grunnlaget for «nn mangler» i listene.
//
// ⚠️ Hele grunnen til at saken var blokkert: fram til #892 ble titler skrevet identisk til alle tre
// språk, og da kunne ingen sjekk skille «bevisst lik» fra «aldri oversatt». Nå er lagringsformatet
// ærlig, og denne funksjonen leser FORMATET — ikke innholdet. Den gjetter aldri.

describe("#894 — hvilke språk en lagret tekst finnes på", () => {
  it("et språkkart svarer med språkene som har tekst", () => {
    expect(localesPresent(JSON.stringify({ nb: "Tittel", nn: "Tittel", "en-GB": "Title" })).sort())
      .toEqual(["en-GB", "nb", "nn"]);
  });

  it("tomme og blanke verdier teller ikke", () => {
    expect(localesPresent(JSON.stringify({ nb: "Tittel", nn: "", "en-GB": "   " }))).toEqual(["nb"]);
  });

  it("⚠️ en ren streng er ETT språk, ikke tre", () => {
    // Dette er kjernen. En streng er lagringsformatets måte å si «skrevet på ett språk, ikke
    // oversatt ennå» (#905/#930). Ville vi ha svart med alle tre her, hadde markeringen i lista
    // sagt «alt er oversatt» om nøyaktig det innholdet saken finnes for å avdekke.
    expect(localesPresent("Risikovurdering")).toEqual([]);
  });

  it("tomt, null og udefinert gir ingen språk", () => {
    expect(localesPresent(null)).toEqual([]);
    expect(localesPresent(undefined)).toEqual([]);
    expect(localesPresent("")).toEqual([]);
    expect(localesPresent("   ")).toEqual([]);
  });

  it("ødelagt JSON gir ingen språk i stedet for å kaste", () => {
    // Lista skal tegnes selv om én rad har et felt ingen klarer å lese.
    expect(localesPresent("{ikke gyldig json")).toEqual([]);
  });
});
