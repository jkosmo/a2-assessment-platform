import { describe, expect, it } from "vitest";
import { normalizeModuleTitlePatch, strictLocaleValue } from "/static/admin-content-localized-copy.js";

// ─────────────────────────────────────────────────────────────────────────────
// Steg 3 i `doc/SHELL_EXTRACTION_PLAN.md`: de små normalisererne.
//
// Begge handler om semantikken i lagret, flerspråklig tekst — det `admin-content-localized-copy.js`
// allerede eier. De flyttes dit framfor til en ny modul, slik at reglene om hva et delvis
// oversatt felt BETYR ligger ett sted.
//
// ⚠️ Testene er skrevet før flyttingen (disiplinregel 4). Ingen av dem hadde en enhetstest før.
// ─────────────────────────────────────────────────────────────────────────────

describe("strictLocaleValue — spør om språket FINNES, uten reservekjede", () => {
  it("⚠️ gir tom streng når språket mangler, i stedet for å falle tilbake", () => {
    // Dette er hele poenget med «strict». Publiseringsgaten og oversettelsesstatusen må kunne se
    // et HULL. En reservekjede her ville fylt hullet med et annet språk, og da ville #892-regelen
    // vært umulig å håndheve: en uoversatt tekst ville sett oversatt ut.
    const verdi = { nb: "Klarhet" };
    expect(strictLocaleValue(verdi, "nb")).toBe("Klarhet");
    expect(strictLocaleValue(verdi, "nn")).toBe("");
    expect(strictLocaleValue(verdi, "en-GB")).toBe("");
  });

  it("⚠️ en bar streng tilhører INGEN lokale", () => {
    // En streng er skrevet på ett språk, men sier ikke hvilket. Å regne den som «til stede» på
    // språket vi tilfeldigvis spør om, ville gjort en uoversatt tekst til en oversatt.
    expect(strictLocaleValue("bare tekst", "nb")).toBe("");
    expect(strictLocaleValue("bare tekst", "en-GB")).toBe("");
  });

  it("leser lagringsformatet når det kommer som JSON-streng", () => {
    // Lokaliserte felt lagres som tekst i databasen, ikke som objekt.
    expect(strictLocaleValue(JSON.stringify({ nb: "Klarhet", nn: "Klårleik" }), "nn")).toBe("Klårleik");
  });

  it("tåler tomt, lister og søppel uten å kaste", () => {
    expect(strictLocaleValue(null, "nb")).toBe("");
    expect(strictLocaleValue("", "nb")).toBe("");
    expect(strictLocaleValue(["a"], "nb")).toBe("");
    expect(strictLocaleValue(JSON.stringify(["a"]), "nb")).toBe("");
    expect(strictLocaleValue({ nb: 42 }, "nb")).toBe("");
  });
});

describe("normalizeModuleTitlePatch", () => {
  it("⚠️ lar en uoversatt tittel bli VÆRENDE en streng", () => {
    // #892: tidligere ble alle tre språk fylt med samme tekst, og tittelen så oversatt ut. En
    // streng betyr «skrevet på ett språk, ikke oversatt ennå», og det skal den fortsette å bety.
    expect(normalizeModuleTitlePatch("  Modul 1  ")).toBe("Modul 1");
  });

  it("beholder bare språkene som faktisk har tekst", () => {
    expect(normalizeModuleTitlePatch({ nb: "Modul", "en-GB": "  ", nn: "" })).toEqual({ nb: "Modul" });
  });

  it("trimmer hvert språk for seg", () => {
    expect(normalizeModuleTitlePatch({ nb: "  Modul  ", nn: " Modul " })).toEqual({ nb: "Modul", nn: "Modul" });
  });

  it("⚠️ gir null når det ikke er noe å skrive", () => {
    // Null betyr «ingen endring». Et tomt objekt ville blitt sendt som en patch og kunne slettet
    // tittelen — forskjellen mellom «ikke rør» og «sett til ingenting».
    expect(normalizeModuleTitlePatch(null)).toBeNull();
    expect(normalizeModuleTitlePatch("")).toBeNull();
    expect(normalizeModuleTitlePatch("   ")).toBeNull();
    expect(normalizeModuleTitlePatch({})).toBeNull();
    expect(normalizeModuleTitlePatch({ nb: "   " })).toBeNull();
    expect(normalizeModuleTitlePatch(42)).toBeNull();
  });

  it("ignorerer nøkler som ikke er støttede språk", () => {
    expect(normalizeModuleTitlePatch({ nb: "Modul", sv: "Modul" })).toEqual({ nb: "Modul" });
  });
});
