import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #479: end-to-end coverage of the Azure OpenAI 429/5xx retry loop in callLlm — exercised through
// the exported condenseSourceMaterial (the simplest single-call consumer). Pins the actual fix:
// a transient 429 must be retried (honouring Retry-After) rather than aborting the whole authoring
// pipeline, which is what crashed the crawl→generate flow. env is parsed from process.env at import,
// so we stub the azure_openai config + reset modules before each dynamic import.

function okPayload(condensedText: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ condensedText }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("callLlm Azure OpenAI retry (via condenseSourceMaterial)", () => {
  beforeEach(() => {
    // env.ts process.exit(1)s if azure_openai is set without endpoint/key/deployment — stub all.
    vi.stubEnv("LLM_MODE", "azure_openai");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com");
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT", "gpt-test");
    vi.stubEnv("AZURE_OPENAI_API_VERSION", "2024-02-01");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "test-key");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries after a 429 (Retry-After honoured) and then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      // Retry-After: 0 → no real wait, keeps the test fast.
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(okPayload("Kondensert sammendrag."));
    vi.stubGlobal("fetch", fetchMock);

    const { condenseSourceMaterial } = await import(
      "../../src/modules/adminContent/llmContentGenerationService.js"
    );
    const result = await condenseSourceMaterial({
      sourceMaterial: "Lang kildetekst som må komprimeres. ".repeat(50),
      certificationLevel: "intermediate",
      locale: "nb",
    });

    expect(result.condensedText).toBe("Kondensert sammendrag.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the max attempts when 429 persists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { condenseSourceMaterial } = await import(
      "../../src/modules/adminContent/llmContentGenerationService.js"
    );

    await expect(
      condenseSourceMaterial({
        sourceMaterial: "Lang kildetekst. ".repeat(50),
        certificationLevel: "intermediate",
        locale: "nb",
      }),
    ).rejects.toThrow(/Azure OpenAI generation failed \(429\)/);
    // 4 attempts total (LLM_MAX_ATTEMPTS).
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("condenses oversized source in chunks (one request per chunk, then combines)", async () => {
    // 3 chunks at 30K-char chunking → 3 condense calls; combined stays small so no extra pass.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okPayload("Sammendrag bit 1."))
      .mockResolvedValueOnce(okPayload("Sammendrag bit 2."))
      .mockResolvedValueOnce(okPayload("Sammendrag bit 3."));
    vi.stubGlobal("fetch", fetchMock);

    const { condenseSourceMaterial } = await import(
      "../../src/modules/adminContent/llmContentGenerationService.js"
    );
    const result = await condenseSourceMaterial({
      sourceMaterial: "Avsnitt med innhold.\n\n".repeat(4000), // ~88K chars → 3 chunks
      certificationLevel: "intermediate",
      locale: "nb",
    });

    // One LLM request per chunk; no single request carried the whole oversized payload.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.condensedText).toContain("Sammendrag bit 1.");
    expect(result.condensedText).toContain("Sammendrag bit 3.");
    expect(result.originalLength).toBeGreaterThan(30_000);
  });

  it("does not retry a non-retryable 400", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { condenseSourceMaterial } = await import(
      "../../src/modules/adminContent/llmContentGenerationService.js"
    );

    await expect(
      condenseSourceMaterial({
        sourceMaterial: "Lang kildetekst. ".repeat(50),
        certificationLevel: "intermediate",
        locale: "nb",
      }),
    ).rejects.toThrow(/Azure OpenAI generation failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
