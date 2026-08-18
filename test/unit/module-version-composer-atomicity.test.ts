import { beforeEach, describe, expect, it, vi } from "vitest";

// #906 § 4: «Lagre» er én knapp, men var fem transaksjoner. `composeModuleVersion` samlet dem, og
// koden sier at rename, rubrikk, prompt, MCQ-sett og modulversjonen deler transaksjon — men
// ingenting festet det. En påstand om atomisitet som ingen test holder i, er en påstand som
// stille slutter å være sann neste gang noen legger til et steg.
//
// Testene her injiserer en feil i hvert ledd og krever to ting: at hele operasjonen kaster, og at
// alt arbeidet gikk gjennom SAMME transaksjonsklient. Det andre er det som faktisk avgjør om
// databasen ruller tilbake — et steg som skriver utenom `tx` overlever en rollback.

const updateModuleTitle = vi.fn();
const createRubricVersion = vi.fn();
const createPromptTemplateVersion = vi.fn();
const createMcqSetVersion = vi.fn();
const createModuleVersion = vi.fn();
const findModuleDetails = vi.fn();
const updateModuleDetails = vi.fn();

// The transaction client the composer must thread through every write.
const TX = { __tx: "the-one-transaction" };

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(TX)) },
}));

vi.mock("../../src/modules/adminContent/adminContentCommands.js", () => ({
  updateModuleTitle: (...args: unknown[]) => updateModuleTitle(...args),
  createRubricVersion: (...args: unknown[]) => createRubricVersion(...args),
  createPromptTemplateVersion: (...args: unknown[]) => createPromptTemplateVersion(...args),
  createMcqSetVersion: (...args: unknown[]) => createMcqSetVersion(...args),
  createModuleVersion: (...args: unknown[]) => createModuleVersion(...args),
}));

vi.mock("../../src/modules/adminContent/adminContentRepository.js", () => ({
  createAdminContentRepository: () => ({
    findModuleDetails: (...args: unknown[]) => findModuleDetails(...args),
    updateModuleDetails: (...args: unknown[]) => updateModuleDetails(...args),
  }),
}));

const { composeModuleVersion } = await import("../../src/modules/adminContent/moduleVersionComposer.js");

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: "module-1",
    actorId: "user-1",
    assessmentMode: "FREETEXT_PLUS_MCQ",
    title: { nb: "Fagforeninger" },
    taskText: { nb: "Scenario" },
    rubric: { criteria: { clarity: { label: "Klarhet", maxScore: 5 } }, scalingRule: { max_total: 5 } },
    promptTemplate: { systemPrompt: { nb: "System" }, userPromptTemplate: { nb: "Bruker" }, examples: [] },
    mcqSet: {
      title: { nb: "Sett" },
      questions: [{ stem: { nb: "Spm" }, options: [{ nb: "A" }, { nb: "B" }], correctAnswer: { nb: "B" } }],
    },
    ...overrides,
  } as never;
}

describe("#906 composeModuleVersion is one transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findModuleDetails.mockResolvedValue({ description: null, certificationLevel: null, validFrom: null, validTo: null });
    updateModuleTitle.mockResolvedValue(undefined);
    createRubricVersion.mockResolvedValue({ id: "rubric-2" });
    createPromptTemplateVersion.mockResolvedValue({ id: "prompt-2" });
    createMcqSetVersion.mockResolvedValue({ id: "mcq-2" });
    createModuleVersion.mockResolvedValue({ id: "version-2", versionNo: 2 });
  });

  it("threads the same transaction client through every write", async () => {
    await composeModuleVersion(baseInput());

    // The rename takes it as its last argument; the component writers as their second.
    expect(updateModuleTitle).toHaveBeenCalledWith("module-1", { nb: "Fagforeninger" }, "user-1", TX);
    expect(createRubricVersion).toHaveBeenCalledWith(expect.anything(), TX);
    expect(createPromptTemplateVersion).toHaveBeenCalledWith(expect.anything(), TX);
    expect(createMcqSetVersion).toHaveBeenCalledWith(expect.anything(), TX);
    expect(createModuleVersion).toHaveBeenCalledWith(expect.anything(), TX);
  });

  // The scenario #906 was written about: the LAST call fails. Before the composer, the four
  // before it had already committed — the module was renamed and had component versions with no
  // module version tying them together.
  it("propagates a failure in the final step so the whole transaction rolls back", async () => {
    createModuleVersion.mockRejectedValue(new Error("500 from the version writer"));

    await expect(composeModuleVersion(baseInput())).rejects.toThrow("500 from the version writer");

    // Everything before it still ran INSIDE the transaction — which is what makes the rollback
    // cover them. The test cannot observe the rollback itself (Prisma owns it); what it can
    // observe, and what actually breaks if someone reintroduces a stray write, is that no call
    // was made outside `tx`.
    for (const spy of [updateModuleTitle, createRubricVersion, createPromptTemplateVersion, createMcqSetVersion]) {
      expect(spy).toHaveBeenCalled();
      const usedTx = spy.mock.calls.every((call) => call.includes(TX));
      expect(usedTx, `${spy.getMockName()} wrote outside the transaction`).toBe(true);
    }
  });

  it("propagates a failure in an early step and never reaches the version write", async () => {
    createRubricVersion.mockRejectedValue(new Error("rubric writer exploded"));

    await expect(composeModuleVersion(baseInput())).rejects.toThrow("rubric writer exploded");
    expect(createModuleVersion).not.toHaveBeenCalled();
  });

  // The validity window is checked against the MERGED value, before anything is written — a
  // rejected window must not leave a rename behind.
  it("rejects an impossible validity window without writing the version", async () => {
    findModuleDetails.mockResolvedValue({
      description: null,
      certificationLevel: null,
      validFrom: new Date("2027-01-01"),
      validTo: null,
    });

    await expect(
      composeModuleVersion(baseInput({ validTo: new Date("2026-01-01") })),
    ).rejects.toThrow(/validTo/);

    expect(createModuleVersion).not.toHaveBeenCalled();
  });
});
