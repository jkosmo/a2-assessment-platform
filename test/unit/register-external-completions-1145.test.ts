import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — skriptet er ren JavaScript uten typer.
import { normalizeName, normalizeTitle, expiresAtMs, write, resolvePeople } from "../../scripts/maintenance/registerExternalCompletions.mjs";

describe("#1145: oppslaget av personer", () => {
  // Brukersøket er delstreng og tar med begge kontoene med samme navn (som på stage 2026-11-10).
  const users = [
    { id: "u-gmail", name: "Kari Nordmann", email: "kari.privat@example.com" },
    { id: "u-jobb", name: "Kari Nordmann", email: "kari@a-2.example" },
    { id: "u-berg", name: "Anne Bergersen", email: "anne@a-2.example" },
  ];
  const call = vi.fn(async (_method: string, route: string) => {
    const q = decodeURIComponent(route.split("q=")[1] ?? "").toLowerCase();
    return { users: users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) };
  });

  it("to kontoer med samme navn: uavklart, med begge som kandidater; ingen velges", async () => {
    const { matched, unresolved } = await resolvePeople(call, ["Kari Nordmann"]);
    expect(matched).toEqual([]);
    expect(unresolved).toEqual([expect.objectContaining({ name: "Kari Nordmann", reason: "flere_med_samme_navn" })]);
    expect(unresolved[0].candidates.map((c: { email: string }) => c.email).sort()).toEqual(["kari.privat@example.com", "kari@a-2.example"]);
  });

  it("e-postadresse i stedet for navnet: eksakt treff på e-post", async () => {
    const { matched, unresolved } = await resolvePeople(call, ["kari@a-2.example"]);
    expect(unresolved).toEqual([]);
    expect(matched).toEqual([{ name: "kari@a-2.example", userId: "u-jobb", email: "kari@a-2.example" }]);
  });

  it("delstreng er ikke treff: «Anne Berg» blir ikke «Anne Bergersen»", async () => {
    const { matched, unresolved } = await resolvePeople(call, ["Anne Berg"]);
    expect(matched).toEqual([]);
    expect(unresolved[0]).toMatchObject({ name: "Anne Berg", reason: "ingen_med_eksakt_navn" });
  });
});

describe("#1145: kurstitlene", () => {
  it("den arkiverte kopien med to mellomrom er samme tittel (prøvekjøringen på stage 2026-11-10)", () => {
    expect(normalizeTitle("Videregående generativ KI:  Repetisjon Modul 5 – Work i ChatGPT"))
      .toBe(normalizeTitle("Videregående generativ KI: Repetisjon Modul 5 – Work i ChatGPT"));
    expect(normalizeTitle("Repetisjon kurs 1 – Møtearbeid")).not.toBe(normalizeTitle("Repetisjon kurs 2 – Møtearbeid"));
  });
});

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
