import { describe, expect, it } from "vitest";
import { sortCoursesForParticipant } from "../../src/modules/course/courseOrdering.js";

// #1093: «Mine kurs» lå i publiseringsrekkefølge, eldst først, og det eneste som flyttet et kurs
// var å avpublisere og publisere på nytt. Nå: satt rekkefølge først, resten alfabetisk på tittelen
// i deltakerens språk, tallbevisst. Fullførte kurs deles ut av klienten etterpå, uten å sortere om.

const kurs = (title: string, sortOrder: number | null = null) => ({ title, sortOrder });
const titler = (liste: Array<{ title: string }>) => liste.map((k) => k.title);

describe("rekkefølgen i «Mine kurs» (#1093)", () => {
  it("alfabetisk på tittelen når ingen har en satt rekkefølge — kontrollcase: inndata er ikke sortert", () => {
    const inn = [kurs("Tilbudsarbeid"), kurs("Møtearbeid"), kurs("Rapportskriving"), kurs("Årsrapport")];
    expect(titler(inn)).not.toEqual(["Møtearbeid", "Rapportskriving", "Tilbudsarbeid", "Årsrapport"]);
    expect(titler(sortCoursesForParticipant(inn, "nb"))).toEqual(["Møtearbeid", "Rapportskriving", "Tilbudsarbeid", "Årsrapport"]);
  });

  it("tallbevisst: «Modul 2» kommer før «Modul 10», og store og små bokstaver skilles ikke", () => {
    const inn = [kurs("Modul 10 – Oppsummering"), kurs("modul 2 – Tilbud"), kurs("Modul 1 – Møter")];
    expect(titler(sortCoursesForParticipant(inn, "nb"))).toEqual(["Modul 1 – Møter", "modul 2 – Tilbud", "Modul 10 – Oppsummering"]);
  });

  it("norske bokstaver sorteres på norsk i nb og nn, og på engelsk vis i en-GB", () => {
    const inn = [kurs("Økonomi"), kurs("Årshjul"), kurs("Zebra"), kurs("Ærend")];
    expect(titler(sortCoursesForParticipant(inn, "nb"))).toEqual(["Zebra", "Ærend", "Økonomi", "Årshjul"]);
    expect(titler(sortCoursesForParticipant(inn, "nn"))).toEqual(["Zebra", "Ærend", "Økonomi", "Årshjul"]);
    // Engelsk sorterer Æ, Ø og Å som A, O og A — ikke etter Z.
    expect(titler(sortCoursesForParticipant(inn, "en-GB"))[3]).toBe("Zebra");
  });

  it("kurs med satt rekkefølge kommer først, stigende; resten alfabetisk etterpå", () => {
    const inn = [kurs("Tilbudsarbeid"), kurs("Velkommen", 1), kurs("Møtearbeid"), kurs("Grunnkurs KI", 2), kurs("Arbeidsformer")];
    expect(titler(sortCoursesForParticipant(inn, "nb"))).toEqual(["Velkommen", "Grunnkurs KI", "Arbeidsformer", "Møtearbeid", "Tilbudsarbeid"]);
  });

  it("to kurs med samme rekkefølgetall sorteres alfabetisk seg imellom", () => {
    const inn = [kurs("Zebra", 5), kurs("Anker", 5), kurs("Midt", 3)];
    expect(titler(sortCoursesForParticipant(inn, "nb"))).toEqual(["Midt", "Anker", "Zebra"]);
  });

  it("en rekkefølge som ikke er et tall, regnes som ikke satt; inndata røres ikke", () => {
    const inn = [kurs("B", Number.NaN), kurs("A", undefined as unknown as null), kurs("C", 0)];
    const ut = sortCoursesForParticipant(inn, "nb");
    expect(titler(ut)).toEqual(["C", "A", "B"]);
    expect(titler(inn)).toEqual(["B", "A", "C"]);
  });

  it("et ukjent språk gir norsk sortering, ikke en feil", () => {
    expect(titler(sortCoursesForParticipant([kurs("Økonomi"), kurs("Zebra")], "xx-ZZ-ugyldig-"))).toEqual(["Zebra", "Økonomi"]);
  });
});
