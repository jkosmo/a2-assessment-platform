import { describe, expect, it } from "vitest";
// @ts-expect-error — skriptet er ren JavaScript uten typer.
import { normalizeName } from "../../scripts/maintenance/registerExternalCompletions.mjs";

// #1145: skriptet godtar bare EKSAKT likt navn. Brukersøket er delstreng, så «Anne Berg» ville ellers truffet «Anne Bergersen».
describe("#1145: navnene fra arket mot brukerne", () => {
  it("store/små bokstaver, mellomrom og «Etternavn, Fornavn» er det samme navnet", () => {
    expect(normalizeName("  Kari   Nordmann ")).toBe("kari nordmann");
    expect(normalizeName("Nordmann, Kari")).toBe("kari nordmann");
    expect(normalizeName("ÅSE ØDEGÅRD")).toBe("åse ødegård");
  });

  it("et lengre navn eller bokstaver uten prikker/ring er IKKE det samme", () => {
    expect(normalizeName("Anne Bergersen")).not.toBe(normalizeName("Anne Berg"));
    expect(normalizeName("Ase Odegard")).not.toBe(normalizeName("Åse Ødegård"));
  });
});
