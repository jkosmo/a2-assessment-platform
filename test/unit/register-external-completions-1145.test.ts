import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — skriptet er ren JavaScript uten typer.
import { normalizeName, expiresAtMs, write } from "../../scripts/maintenance/registerExternalCompletions.mjs";

// #1145: skriptet godtar bare EKSAKT likt navn. Brukersøket er delstreng, så «Anne Berg» ville ellers truffet «Anne Bergersen».
describe("#1145: navnene fra arket mot brukerne", () => {
  it("store/små bokstaver, mellomrom og «Etternavn, Fornavn» er det samme navnet", () => {
    expect(normalizeName("  Kari   Nordmann ")).toBe("kari nordmann");
    expect(normalizeName("Nordmann, Kari")).toBe("kari nordmann");
    expect(normalizeName("ÅSE ØDEGÅRD")).toBe("åse ødegård");
  });

  it("et lengre navn eller bokstaver uten prikker/ring er IKKE det samme", () => {
    expect(normalizeName("Anne Bergersen")).not.toBe(normalizeName("Anne Berg"));
    expect(normalizeName("Ase Odegard")).not.toBe(normalizeName("Åse Ødegård"));
  });
});

describe("#1145: skrivingen", () => {
  const approved = {
    mode: "dry-run",
    createdAt: "2026-11-10T10:00:00.000Z",
    baseUrl: "https://stage.example.test",
    courses: [{ courseTitle: "K", courseId: "c1", relatedCourseIds: [], reference: "Ark, Modul 1", people: [{ name: "N", email: "n@x", userId: "u1", outcome: "would_create" }] }],
  };

  it("nekter å skrive når den godkjente rapporten gjelder et annet miljø enn innloggingen, og sender ingenting", async () => {
    const call = vi.fn();
    await expect(write(call, approved, { baseUrl: "https://prod.example.test", accessToken: "x" })).rejects.toThrow(/annet|gjelder/);
    await expect(write(call, { ...approved, baseUrl: undefined }, { baseUrl: "https://stage.example.test", accessToken: "x" })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it("samme miljø (også med skråstrek til slutt): sender bare `would_create`, med dryRun false", async () => {
    const call = vi.fn().mockResolvedValue({ results: [{ userId: "u1", outcome: "created" }] });
    const withSkipped = { ...approved, courses: [{ ...approved.courses[0]!, people: [...approved.courses[0]!.people, { name: "M", email: "m@x", userId: "u2", outcome: "exists" }] }] };
    const result = await write(call, withSkipped, { baseUrl: "https://stage.example.test/", accessToken: "x" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![2]).toMatchObject({ courseId: "c1", userIds: ["u1"], dryRun: false });
    expect(result.courses[0].people).toEqual([{ name: "N", email: "n@x", userId: "u1", outcome: "created" }]);
  });

  it("utløpet leses som ms, sekunder eller datotekst", () => {
    expect(expiresAtMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(expiresAtMs(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(expiresAtMs("2026-11-10T21:00:00.000Z")).toBe(Date.parse("2026-11-10T21:00:00.000Z"));
    expect(expiresAtMs(undefined)).toBeNull();
    expect(expiresAtMs("ikke en dato")).toBeNull();
  });
});
