import { afterEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// Infrastrukturkoden (Bicep) setter nå alltid AZURE_OPENAI_ASSESSMENT_DEPLOYMENT og
// AZURE_OPENAI_AUTHORING_DEPLOYMENT — tom når miljøet ikke har en egen modell. En tom streng skal bety
// «ikke satt», så vurderingen faller tilbake til AZURE_OPENAI_DEPLOYMENT i stedet for å kalle uten
// modell (`""` går forbi `??`).

const saved = { ...process.env };

warmModuleGraph(() => import("../../src/config/env.js"));

async function lesEnv(verdier: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(verdier)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return (await import("../../src/config/env.js")).env;
}

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe("modellinnstillingene for vurdering og forfatting", () => {
  it("tom eller bare mellomrom = ikke satt", async () => {
    const env = await lesEnv({ AZURE_OPENAI_ASSESSMENT_DEPLOYMENT: "", AZURE_OPENAI_AUTHORING_DEPLOYMENT: "   " });
    expect(env.AZURE_OPENAI_ASSESSMENT_DEPLOYMENT).toBeUndefined();
    expect(env.AZURE_OPENAI_AUTHORING_DEPLOYMENT).toBeUndefined();
  });

  it("en verdi beholdes (uten mellomrom rundt)", async () => {
    const env = await lesEnv({ AZURE_OPENAI_ASSESSMENT_DEPLOYMENT: " a2-assessment-stg-gpt-5.4-mini ", AZURE_OPENAI_AUTHORING_DEPLOYMENT: undefined });
    expect(env.AZURE_OPENAI_ASSESSMENT_DEPLOYMENT).toBe("a2-assessment-stg-gpt-5.4-mini");
    expect(env.AZURE_OPENAI_AUTHORING_DEPLOYMENT).toBeUndefined();
  });
});
