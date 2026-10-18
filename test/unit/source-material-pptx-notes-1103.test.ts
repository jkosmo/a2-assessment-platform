import { describe, expect, it } from "vitest";
import { buildPptx, shape } from "../support/buildPptx.js";
import { extractSourceMaterialText } from "../../src/modules/adminContent/sourceMaterialExtractionService.js";

// #1103 (rest fra #1079): når en .pptx brukes som kilde ved KI-generering av moduler, kommer
// talenotatene med? Lysbilder er ofte stikkord; forklaringen står i notatene. Målt med den ekte
// tolkeren (officeparser), ikke en etterligning av den.

describe("kildemateriale fra PowerPoint (#1103)", () => {
  it("talenotatene kommer med i teksten, ved siden av teksten på lysarket", async () => {
    const pptx = buildPptx([
      {
        shapes: [shape([60, 40, 800, 80], { text: ["Tre kilder i et referat"] })],
        notes: "Forklar at notatene fra møtet er den viktigste kilden, fordi de viser hva som faktisk ble bestemt.",
      },
      { shapes: [shape([60, 40, 800, 80], { text: ["Uten notater"] })] },
    ]);
    const result = await extractSourceMaterialText({
      fileName: "kilde.pptx",
      contentBase64: pptx.toString("base64"),
    });
    expect(result.extractedText).toContain("Tre kilder i et referat");
    expect(result.extractedText).toContain("Uten notater");
    expect(result.extractedText).toContain("den viktigste kilden");
  });
});
