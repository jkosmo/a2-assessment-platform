import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "./support/moduleGraphWarmup.js";

// #1119 gjennom den EKTE ruta: KI-genererte spørsmål får samme hint-kontroll som skillet og importen,
// som varsel ved siden av #551. Lengden for hele settet meldes alt av #551, så den gjentas ikke.
// Modellen byttes ut.

vi.mock("../src/modules/adminContent/llmContentGenerationService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/adminContent/llmContentGenerationService.js")>();
  const q = (stem: string, options: string[]) => ({ stem, options, correctAnswer: options[0], rationale: "Fordi." });
  return {
    ...actual,
    generateMcqQuestions: vi.fn(async () => ({
      questions: [
        q("Hva anbefaler kurset før et kundemøte?", ["Avklare målet for møtet og hvem som bestemmer", "Lar KI styre møtet automatisk", "Sender agendaen alltid etterpå"]),
        q("Hvem eier rapporten?", ["Den som leverer den til kunden", "KI-verktøyet, uansett", "Aldri den som skrev den"]),
        q("Når deler du kundedata?", ["Når avtalen tillater det", "Alltid, når kunden spør", "Aldri, uten unntak"]),
        q("Hva gjør du med et utkast?", ["Leser det før det sendes", "Sender det automatisk", "Sletter det med en gang"]),
      ],
    })),
  };
});

warmModuleGraph(() => import("../src/app.js"));
const { app } = await import("../src/app.js");

const admin = { "x-user-id": "admin-1119-gen", "x-user-email": "admin.1119.gen@company.com", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

describe("#1119 — hint-kontrollen på KI-genererte spørsmål", () => {
  it("svaret bærer funnene, uten settets lengdefunn", async () => {
    const res = await request(app).post("/api/admin/content/generate/mcq").set(admin).send({
      sourceMaterial: "Kundemøter og KI.",
      certificationLevel: "basic",
      locale: "nb",
      questionCount: 4,
      optionCount: 3,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cueWarnings).toEqual(expect.arrayContaining([
      { code: "stem_about_course", question: 1 },
      { code: "absolute_words", question: null, count: 7 },
    ]));
    expect((res.body.cueWarnings as Array<{ code: string }>).map((w) => w.code)).not.toContain("length_bias");
  });
});
