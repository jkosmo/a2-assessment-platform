import { beforeEach, describe, expect, it, vi } from "vitest";

import { missingLocalesFor } from "../../src/modules/adminContent/contentValidationService.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #892: renaming a module used to write the author's single title into en-GB, nb AND nn. Every
// title then looked translated, participants were served the wrong language with no signal, and
// the "still needs translating" state became undetectable. These tests pin the honest behaviour:
// a plain string is stored as a plain string; a localized object still merges per locale.

const findModuleTitle = vi.fn();
const updateModuleTitleRepo = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/modules/adminContent/adminContentRepository.js", () => ({
  adminContentRepository: {
    findModuleTitle: (...args: unknown[]) => findModuleTitle(...args),
  },
  createAdminContentRepository: () => ({
    updateModuleTitle: (...args: unknown[]) => updateModuleTitleRepo(...args),
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}));

vi.mock("../../src/db/transaction.js", () => ({
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

async function rename(existingTitle: string | null, patch: unknown) {
  findModuleTitle.mockResolvedValue({ id: "m1", title: existingTitle });
  updateModuleTitleRepo.mockImplementation((_id: string, title: string) => ({ id: "m1", title }));
  const { updateModuleTitle } = await import("../../src/modules/adminContent/adminContentCommands.js");
  await updateModuleTitle("m1", patch as never, "actor-1");
  return updateModuleTitleRepo.mock.calls.at(-1)?.[1] as string;
}

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/adminContent/adminContentCommands.js"));

describe("updateModuleTitle — localization honesty (#892)", () => {
  beforeEach(() => {
    vi.resetModules();
    findModuleTitle.mockReset();
    updateModuleTitleRepo.mockReset();
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
  });

  it("stores a plain-string rename as a plain string, not one copy per locale", async () => {
    const stored = await rename("Test, Klassisk LLM", "Klassisk LLM");

    // The regression: {"en-GB":"Klassisk LLM","nb":"Klassisk LLM","nn":"Klassisk LLM"}
    expect(stored).toBe("Klassisk LLM");
    expect(stored.startsWith("{")).toBe(false);
  });

  it("does not fabricate a translation when the previous title was already localized", async () => {
    const existing = JSON.stringify({ "en-GB": "Classic LLM", nb: "Klassisk LLM", nn: "Klassisk LLM" });
    const stored = await rename(existing, "Store språkmodeller");

    expect(stored).toBe("Store språkmodeller");
    // Crucially: nn must NOT silently claim to hold a Norwegian-Nynorsk translation of the new title.
    expect(stored).not.toContain("nn");
  });

  it("keeps merging a localized object patch so translating one language leaves the others alone", async () => {
    const existing = JSON.stringify({ "en-GB": "Classic LLM", nb: "Klassisk LLM" });
    const stored = await rename(existing, { nn: "Klassisk LLM (nn)" });

    expect(JSON.parse(stored)).toEqual({
      "en-GB": "Classic LLM",
      nb: "Klassisk LLM",
      nn: "Klassisk LLM (nn)",
    });
  });

  it("ignores blank entries in an object patch rather than storing empty translations", async () => {
    const existing = JSON.stringify({ nb: "Klassisk LLM" });
    const stored = await rename(existing, { nn: "   ", "en-GB": "Classic LLM" });

    const parsed = JSON.parse(stored);
    expect(parsed["en-GB"]).toBe("Classic LLM");
    expect(parsed.nn).toBeUndefined();
  });

  it("a stored plain string is what makes 'needs translation' detectable at all", async () => {
    // The point of the fix, stated as a test: after a plain rename the value carries no locale
    // claim, so a future translation-status check (#894) can tell it apart from a real translation.
    const plain = await rename(null, "Kunnskapskilder");
    const localized = await rename(null, { nb: "Kunnskapskilder", nn: "Kunnskapskjelder" });

    expect(plain.startsWith("{")).toBe(false);
    expect(localized.startsWith("{")).toBe(true);
  });
});

// #981: the fan-out removed from the patch side in #892 survived on the SEED side. An object patch
// merged onto a stored PLAIN STRING seeded the base with that string copied into all three locales,
// so `PATCH {nn}` came out as {en-GB: source, nb: source, nn: translation}. The publish gate then
// saw a fully translated module and served an en-GB participant a Norwegian title.
describe("updateModuleTitle — an object patch never merges onto a plain string (#981)", () => {
  beforeEach(() => {
    vi.resetModules();
    findModuleTitle.mockReset();
    updateModuleTitleRepo.mockReset();
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
  });

  it("translating one locale of an untranslated title leaves the other two genuinely missing", async () => {
    // "Tryggleik i praksis" is stored as a plain string: one language, and the data does not say
    // which. The author translates ONLY nn.
    const stored = await rename("Tryggleik i praksis", { nn: "Tryggleik i praksis (nynorsk)" });

    // Asserted first because it is the consequence that matters: the publish gate must be able to
    // see the two holes. Before the fix this was [] and a half-translated module went live.
    expect(missingLocalesFor(stored).sort()).toEqual(["en-GB", "nb"]);

    // The regression: {"en-GB":"Tryggleik i praksis","nb":"Tryggleik i praksis","nn":"…(nynorsk)"}
    expect(JSON.parse(stored)).toEqual({ nn: "Tryggleik i praksis (nynorsk)" });
    expect(stored).not.toContain("\"en-GB\"");
    expect(stored).not.toContain("\"nb\"");
  });

  it("CONTROL: a patch that really does fill all three locales is still stored as complete", async () => {
    // Without this makker the test above only proves merging was switched off, not that the
    // invariant is what is being measured. A genuine full translation must still report 0 missing.
    const stored = await rename("Tryggleik i praksis", {
      "en-GB": "Safety in practice",
      nb: "Trygghet i praksis",
      nn: "Tryggleik i praksis (nynorsk)",
    });

    expect(JSON.parse(stored)).toEqual({
      "en-GB": "Safety in practice",
      nb: "Trygghet i praksis",
      nn: "Tryggleik i praksis (nynorsk)",
    });
    expect(missingLocalesFor(stored)).toEqual([]);
  });

  it("CONTROL: merging onto a real locale map is untouched — the other locales still survive", async () => {
    // #892's merge behaviour is the thing that must NOT regress: when the stored value names its
    // locales, a one-locale patch changes that one and leaves the rest alone.
    const existing = JSON.stringify({ "en-GB": "Safety in practice", nb: "Trygghet i praksis" });
    const stored = await rename(existing, { nn: "Tryggleik i praksis (nynorsk)" });

    expect(JSON.parse(stored)).toEqual({
      "en-GB": "Safety in practice",
      nb: "Trygghet i praksis",
      nn: "Tryggleik i praksis (nynorsk)",
    });
    expect(missingLocalesFor(stored)).toEqual([]);
  });

  it("CONTROL: a partially translated map stays partial and keeps reporting its hole", async () => {
    const existing = JSON.stringify({ nb: "Trygghet i praksis" });
    const stored = await rename(existing, { nn: "Tryggleik i praksis (nynorsk)" });

    expect(JSON.parse(stored)).toEqual({
      nb: "Trygghet i praksis",
      nn: "Tryggleik i praksis (nynorsk)",
    });
    expect(missingLocalesFor(stored)).toEqual(["en-GB"]);
  });

  it("a patch whose entries are all blank leaves the stored title alone instead of blanking it", async () => {
    // Dropping the seed means the merge can now come out empty. Serializing {} would store the
    // literal "{}" — the title every locale would then display.
    const stored = await rename("Tryggleik i praksis", { nn: "   " });

    expect(stored).toBe("Tryggleik i praksis");
  });
});
