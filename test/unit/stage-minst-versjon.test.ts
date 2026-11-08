import { afterEach, describe, expect, it, vi } from "vitest";
import { forventMinstVersjon, sammenlignVersjon } from "../stage/versjon.js";

// Versjonssjekken alle release-filene i test/stage bruker (testgjennomgangen 2026-11, avsnitt 3.2). Den kjører bare mot stage,
// så en feil i den ville ikke vist seg før neste stage-runde — og da som at alle filene hoppet over, eller at alle slapp gjennom.

describe("sammenlignVersjon", () => {
  it("sammenligner tall for tall, ikke som tekst", () => {
    // Som tekst er "2.99.0" større enn "2.136.0".
    expect(sammenlignVersjon("2.99.0", "2.136.0")).toBeLessThan(0);
    expect(sammenlignVersjon("2.145.0", "2.136.0")).toBeGreaterThan(0);
    expect(sammenlignVersjon("3.0.0", "2.145.9")).toBeGreaterThan(0);
  });

  it("ser på tredje siffer", () => {
    expect(sammenlignVersjon("2.130.0", "2.130.1")).toBeLessThan(0);
    expect(sammenlignVersjon("2.130.1", "2.130.1")).toBe(0);
  });
});

describe("forventMinstVersjon", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stage = (version: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 })));

  it("slipper gjennom samme og nyere versjon, og gir versjonen tilbake", async () => {
    stage("2.136.0");
    await expect(forventMinstVersjon("https://stage", "2.136.0")).resolves.toBe("2.136.0");
    stage("2.145.0");
    await expect(forventMinstVersjon("https://stage", "2.136.0")).resolves.toBe("2.145.0");
  });

  it("stopper en eldre versjon med en lesbar melding", async () => {
    stage("2.135.9");
    await expect(forventMinstVersjon("https://stage", "2.136.0")).rejects.toThrow("stage er 2.135.9, testen krever minst 2.136.0");
  });

  it("stopper et svar som ikke er en versjon", async () => {
    stage(undefined);
    await expect(forventMinstVersjon("https://stage", "2.136.0")).rejects.toThrow("stage er undefined");
    stage("2.x.0");
    await expect(forventMinstVersjon("https://stage", "2.136.0")).rejects.toThrow("stage er 2.x.0");
  });
});
