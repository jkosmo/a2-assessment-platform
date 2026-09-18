import { describe, expect, it } from "vitest";
import {
  drawQuestionIds,
  parseQuestionOrder,
  questionsForAttempt,
  resolveMcqDrawPolicy,
  shuffleWith,
} from "../../src/modules/assessment/mcqDraw.js";

// #1062: trekket per forsøk. Ren funksjon med tilfeldigheten som parameter — så testene sier noe
// sikkert, ikke «det gikk bra denne gangen».

/** Deterministisk «tilfeldighet»: en liste tall i [0,1) som brukes i rekkefølge. */
function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}
const IDS = ["a", "b", "c", "d", "e", "f"];

describe("resolveMcqDrawPolicy — standardene", () => {
  it("ingen policy: alle spørsmål, stokket (produkteier 17.09: stokking er standard, også for gamle moduler)", () => {
    expect(resolveMcqDrawPolicy(null)).toEqual({ questionsPerAttempt: null, shuffleQuestions: true });
    expect(resolveMcqDrawPolicy({ passRules: { mcqMinPercent: 70 } })).toEqual({ questionsPerAttempt: null, shuffleQuestions: true });
  });

  it("stokking kan slås av per modul; «per forsøk» må være et positivt heltall for å telle", () => {
    expect(resolveMcqDrawPolicy({ mcq: { shuffleQuestions: false } }).shuffleQuestions).toBe(false);
    expect(resolveMcqDrawPolicy({ mcq: { questionsPerAttempt: 10 } }).questionsPerAttempt).toBe(10);
    expect(resolveMcqDrawPolicy({ mcq: { questionsPerAttempt: 0 } }).questionsPerAttempt).toBeNull();
    expect(resolveMcqDrawPolicy({ mcq: { questionsPerAttempt: 2.5 } }).questionsPerAttempt).toBeNull();
  });
});

describe("drawQuestionIds", () => {
  it("uten grense og med stokking: alle spørsmålene, ny rekkefølge", () => {
    const drawn = drawQuestionIds(IDS, { questionsPerAttempt: null, shuffleQuestions: true }, seq([0.9, 0.1, 0.5, 0.3, 0.7]));
    expect([...drawn].sort()).toEqual(IDS);
    expect(drawn).not.toEqual(IDS);
  });

  it("uten grense og uten stokking: alle, i lagret rekkefølge — uansett hva tilfeldigheten sier", () => {
    const drawn = drawQuestionIds(IDS, { questionsPerAttempt: null, shuffleQuestions: false }, seq([0.9, 0.1, 0.5]));
    expect(drawn).toEqual(IDS);
  });

  it("med grense: så mange som bedt om, alle ulike, alle fra banken", () => {
    const drawn = drawQuestionIds(IDS, { questionsPerAttempt: 4, shuffleQuestions: true }, seq([0.2, 0.8, 0.4, 0.6, 0.1]));
    expect(drawn).toHaveLength(4);
    expect(new Set(drawn).size).toBe(4);
    for (const id of drawn) expect(IDS).toContain(id);
  });

  it("med grense og uten stokking: utvalget er tilfeldig, men rekkefølgen er den lagrede", () => {
    const drawn = drawQuestionIds(IDS, { questionsPerAttempt: 3, shuffleQuestions: false }, seq([0.95, 0.05, 0.5, 0.3]));
    expect(drawn).toHaveLength(3);
    const positions = drawn.map((id) => IDS.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("banken er mindre enn grensen: hele banken, aldri en feil", () => {
    expect(drawQuestionIds(["a", "b"], { questionsPerAttempt: 10, shuffleQuestions: false }, seq([0.5]))).toEqual(["a", "b"]);
    expect(drawQuestionIds([], { questionsPerAttempt: 10, shuffleQuestions: true }, seq([0.5]))).toEqual([]);
  });

  it("utvalget følger tilfeldigheten — «de 10 første» er ikke det samme hver gang", () => {
    const a = drawQuestionIds(IDS, { questionsPerAttempt: 3, shuffleQuestions: false }, seq([0.99, 0.99, 0.99, 0.99, 0.99]));
    const b = drawQuestionIds(IDS, { questionsPerAttempt: 3, shuffleQuestions: false }, seq([0.01, 0.01, 0.01, 0.01, 0.01]));
    expect(a).not.toEqual(b);
  });
});

describe("shuffleWith / parseQuestionOrder / questionsForAttempt", () => {
  it("shuffleWith rører ikke inndata", () => {
    const input = ["x", "y", "z"];
    shuffleWith(input, seq([0.1, 0.9]));
    expect(input).toEqual(["x", "y", "z"]);
  });

  it("parseQuestionOrder: gyldig liste, ellers null (eldre forsøk = alle aktive)", () => {
    expect(parseQuestionOrder('["b","a"]')).toEqual(["b", "a"]);
    expect(parseQuestionOrder(null)).toBeNull();
    expect(parseQuestionOrder("not json")).toBeNull();
    expect(parseQuestionOrder('{"a":1}')).toBeNull();
    expect(parseQuestionOrder("[1,2]")).toBeNull();
  });

  it("questionsForAttempt: forsøkets rekkefølge, ukjente id-er hoppes over, null = alle", () => {
    const bank = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(questionsForAttempt(bank, ["c", "a", "zzz"]).map((q) => q.id)).toEqual(["c", "a"]);
    expect(questionsForAttempt(bank, null).map((q) => q.id)).toEqual(["a", "b", "c"]);
  });
});
