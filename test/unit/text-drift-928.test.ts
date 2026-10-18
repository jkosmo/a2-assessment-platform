import { describe, expect, it } from "vitest";
import { isSubstantialTextChange, TEXT_DRIFT_THRESHOLD, textDriftScore } from "../../public/static/text-drift.js";

// #928: «er oppgaveteksten vesentlig endret siden kriteriene ble laget?» — ordlikhet, ikke hash.

const SCENARIO =
  "Du er prosjektleder i et byggeprosjekt. Kunden har bedt om en statusrapport innen fredag, og du skal bruke KI til å lage et utkast fra referatene og oppgavelista.";

describe("textDriftScore", () => {
  it("lik tekst er 1, uansett store bokstaver og tegnsetting", () => {
    expect(textDriftScore(SCENARIO, SCENARIO)).toBe(1);
    expect(textDriftScore("Hei, verden!", "hei verden")).toBe(1);
  });

  it("to tomme tekster er like; tom mot noe er 0", () => {
    expect(textDriftScore("", "")).toBe(1);
    expect(textDriftScore("", "noe")).toBe(0);
  });

  it("norske bokstaver er en del av ordet", () => {
    expect(textDriftScore("blåbær på ærfugl", "blåbær på ærfugl")).toBe(1);
    expect(textDriftScore("blåbær", "blabar")).toBe(0);
  });
});

describe("isSubstantialTextChange", () => {
  it("en rettet skrivefeil er stille", () => {
    const fixed = SCENARIO.replace("oppgavelista", "oppgavelisten");
    expect(textDriftScore(SCENARIO, fixed)).toBeGreaterThanOrEqual(TEXT_DRIFT_THRESHOLD);
    expect(isSubstantialTextChange(SCENARIO, fixed)).toBe(false);
  });

  it("et omskrevet scenario spør", () => {
    const rewritten =
      "Du leder et anbudsteam. Oppdragsgiver har sendt et konkurransegrunnlag på åtti sider, og du skal bruke KI til å lage en kravmatrise.";
    expect(isSubstantialTextChange(SCENARIO, rewritten)).toBe(true);
  });

  it("en delvis omskrevet tekst (samme rolle, ny oppgave) spør — grensen avgjør, ikke ytterpunktene", () => {
    const partly =
      "Du er prosjektleder i et byggeprosjekt. Kunden har bedt om en risikovurdering innen mandag, og du skal bruke KI til å finne risikoene i kontrakten og fremdriftsplanen.";
    const score = textDriftScore(SCENARIO, partly);
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(TEXT_DRIFT_THRESHOLD);
    expect(isSubstantialTextChange(SCENARIO, partly)).toBe(true);
  });

  it("ingen tekst før er ingen endring å varsle om (ny modul)", () => {
    expect(isSubstantialTextChange("", SCENARIO)).toBe(false);
    expect(isSubstantialTextChange("   ", SCENARIO)).toBe(false);
  });

  it("grensen kan settes; likhet akkurat på grensen er ikke vesentlig", () => {
    // 3 av 4 ord felles: likhet 3/5 = 0,6.
    expect(isSubstantialTextChange("a b c d", "a b c e", 0.6)).toBe(false);
    expect(isSubstantialTextChange("a b c d", "a b c e", 0.61)).toBe(true);
  });
});
