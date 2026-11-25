import { describe, expect, it } from "vitest";
import { dueAtDiffers, effectiveDeadline } from "../../src/modules/course/effectiveDeadline.js";

// #1192 punkt 2, skive 2b: regelen for gjeldende frist, uten database.
const d = (iso: string) => new Date(iso);

describe("effectiveDeadline", () => {
  it("en tildeling vinner, også uten frist", () => {
    expect(effectiveDeadline({ individual: { source: "INDIVIDUAL", dueAt: null }, classes: [{ dueAt: d("2026-01-01") }] })).toEqual({ dueAt: null, dueSetAt: null, from: "individual" });
    expect(effectiveDeadline({ individual: { source: "DEPARTMENT", dueAt: d("2027-01-01"), dueSetAt: d("2026-11-24") }, classes: [{ dueAt: d("2026-01-01") }] })).toEqual({ dueAt: d("2027-01-01"), dueSetAt: d("2026-11-24"), from: "individual" });
  });

  it("en SELF-påmelding er ikke en tildeling: klassens frist gjelder", () => {
    expect(effectiveDeadline({ individual: { source: "SELF", dueAt: null }, classes: [{ dueAt: d("2026-01-01") }] })).toMatchObject({ dueAt: d("2026-01-01"), from: "class" });
  });

  it("den tidligste fristen fra aktive klasser; en arkivert klasse teller ikke", () => {
    const out = effectiveDeadline({ classes: [{ dueAt: d("2026-03-01") }, { dueAt: d("2026-01-01"), archived: true }, { dueAt: d("2026-02-01") }, { dueAt: null }] });
    expect(out).toMatchObject({ dueAt: d("2026-02-01"), from: "class" });
  });

  it("lik dato: det seneste dueSetAt følger med, uansett rekkefølge", () => {
    const gammel = { dueAt: d("2026-05-01"), dueSetAt: null };
    const ny = { dueAt: d("2026-05-01"), dueSetAt: d("2026-11-24T10:00:00Z") };
    expect(effectiveDeadline({ classes: [gammel, ny] }).dueSetAt).toEqual(d("2026-11-24T10:00:00Z"));
    expect(effectiveDeadline({ classes: [ny, gammel] }).dueSetAt).toEqual(d("2026-11-24T10:00:00Z"));
  });

  it("ingen klasse og ingen tildeling: ingen frist; en tildeling uten frist bærer ikke dueSetAt", () => {
    expect(effectiveDeadline({})).toEqual({ dueAt: null, dueSetAt: null, from: "none" });
    expect(effectiveDeadline({ individual: { source: "INDIVIDUAL", dueAt: null, dueSetAt: d("2026-11-24") } }).dueSetAt).toBeNull();
  });

  it("dueAtDiffers tar med rader der fristen er NULL", () => {
    expect(dueAtDiffers(null)).toEqual({ dueAt: { not: null } });
    expect(dueAtDiffers(d("2026-01-01"))).toEqual({ OR: [{ dueAt: null }, { dueAt: { not: d("2026-01-01") } }] });
  });
});
