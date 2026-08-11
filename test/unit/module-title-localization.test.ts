import { beforeEach, describe, expect, it, vi } from "vitest";

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
