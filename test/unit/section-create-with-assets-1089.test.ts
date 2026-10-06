// #1089: `createSectionWithAssets` lagrer figurenes filer FØR seksjonen og radene skrives i én
// transaksjon. Ruller transaksjonen tilbake, peker ingen rad på filene — og de må fjernes, ellers
// blir de liggende i lageret for alltid, uten at noe i databasen vet om dem.
//
// At en avvist figur ikke etterlater noen seksjon, måles mot ekte database i
// test/m2-section-asset-layouts-1079.test.ts. Det som måles her, er den ene veien som ikke lar seg
// framprovosere der: transaksjonen selv feiler etter at filene er lagret.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

const reclaimAssetBlobs = vi.fn();
const stageSectionAssets = vi.fn();
const runInTransaction = vi.fn();
const findUniqueOrThrow = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({ prisma: { courseSection: { findUniqueOrThrow } } }));
vi.mock("../../src/db/transaction.js", () => ({ runInTransaction }));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("../../src/modules/course/contentLifecycle.js", () => ({
  assertSectionNotInAnyCourse: vi.fn(),
  assertSectionNotInIssuedCertificate: vi.fn(),
}));
vi.mock("../../src/modules/course/assetCommands.js", () => ({
  collectSectionAssetBlobPaths: vi.fn(),
  reclaimAssetBlobs,
  stageSectionAssets,
}));
vi.mock("../../src/modules/content/contentOwnershipService.js", () => ({ addContentOwner: vi.fn() }));

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(async () => {
  await import("../../src/modules/course/sectionCommands.js");
});

const figur = { sourceId: "flyt", filename: "flyt.svg", mimeType: "image/svg+xml", sizeBytes: 10, contentBase64: "PHN2Zy8+" };

describe("#1089 createSectionWithAssets — filene fjernes når transaksjonen feiler", () => {
  beforeEach(() => {
    reclaimAssetBlobs.mockReset().mockResolvedValue(undefined);
    runInTransaction.mockReset();
    findUniqueOrThrow.mockReset();
    stageSectionAssets.mockReset().mockResolvedValue([
      { sourceId: "flyt", blobPaths: ["sections/s/flyt.svg", "sections/s/flyt.narrow.svg"], rowData: {} },
      { sourceId: "tre", blobPaths: ["sections/s/tre.svg"], rowData: {} },
    ]);
  });

  it("transaksjonen feiler: alle filene som ble lagret, fjernes, og feilen går videre uendret", async () => {
    const { createSectionWithAssets } = await import("../../src/modules/course/sectionCommands.js");
    const feil = new Error("databasen svarte ikke");
    runInTransaction.mockRejectedValue(feil);

    await expect(createSectionWithAssets({ title: "Saksgang", bodyMarkdown: "![f](asset:flyt)", assets: [figur] })).rejects.toBe(feil);

    expect(reclaimAssetBlobs).toHaveBeenCalledTimes(1);
    expect(reclaimAssetBlobs).toHaveBeenCalledWith(["sections/s/flyt.svg", "sections/s/flyt.narrow.svg", "sections/s/tre.svg"]);
    // Ingenting leses tilbake: det finnes ingen seksjon å lese.
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("figurene avvises: ingenting er lagret, så transaksjonen åpnes aldri og ingenting fjernes", async () => {
    const { createSectionWithAssets } = await import("../../src/modules/course/sectionCommands.js");
    const avvist = new Error("asset_layout_text_mismatch");
    stageSectionAssets.mockRejectedValue(avvist);

    await expect(createSectionWithAssets({ title: "Saksgang", bodyMarkdown: "![f](asset:flyt)", assets: [figur] })).rejects.toBe(avvist);

    expect(runInTransaction).not.toHaveBeenCalled();
    expect(reclaimAssetBlobs).not.toHaveBeenCalled();
  });

  it("kontroll: når alt går, fjernes ingen filer", async () => {
    const { createSectionWithAssets } = await import("../../src/modules/course/sectionCommands.js");
    runInTransaction.mockResolvedValue({ heldBackByTranslationGate: false, translationGateIssues: [] });
    findUniqueOrThrow.mockResolvedValue({ id: "s", title: "Saksgang" });

    const resultat = await createSectionWithAssets({ title: "Saksgang", bodyMarkdown: "![f](asset:flyt)", assets: [figur] });

    expect(Object.keys(resultat.assetMap).sort()).toEqual(["flyt", "tre"]);
    expect(reclaimAssetBlobs).not.toHaveBeenCalled();
  });
});
