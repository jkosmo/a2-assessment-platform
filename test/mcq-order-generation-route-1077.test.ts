import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "./support/moduleGraphWarmup.js";

// #1077 leveranse 2b gjennom den EKTE ruta — 2.106.0 viste at tester forbi ruta ikke ser den: genereringen sier hvorfor
// det ikke ble noe «sett i riktig rekkefølge», og ruta sender det videre til editoren. Modellen byttes ut.

vi.mock("../src/modules/adminContent/llmContentGenerationService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/adminContent/llmContentGenerationService.js")>();
  return {
    ...actual,
    generateMcqQuestions: vi.fn(async () => ({
      questions: [{ stem: "Hva gjelder?", options: ["A", "B"], correctAnswer: "A", rationale: "Fordi." }],
      noOrderReason: "Kilden beskriver prinsipper, ikke steg.",
    })),
  };
});

// #994: grafen lastes på modulnivå, utenfor testenes tidsbudsjett (test/support/moduleGraphWarmup.ts).
warmModuleGraph(() => import("../src/app.js"));
const { app } = await import("../src/app.js");

const admin = { "x-user-id": "admin-1077-gen", "x-user-email": "admin.1077.gen@company.com", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

describe("#1077 leveranse 2b — generering gjennom ruta", () => {
  it("begrunnelsen for at det ikke ble noen rekkefølge, følger med i svaret", async () => {
    const res = await request(app).post("/api/admin/content/generate/mcq").set(admin).send({
      sourceMaterial: "Prinsippene for god forvaltning.",
      certificationLevel: "basic",
      locale: "nb",
      questionCount: 1,
      optionCount: 2,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.noOrderReason).toBe("Kilden beskriver prinsipper, ikke steg.");
    expect(res.body.questions).toHaveLength(1);
  });
});
