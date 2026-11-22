import { describe, expect, it } from "vitest";
import {
  buildParticipantUrl,
  findSequenceEntry,
  itemOfOpenEntry,
  readParticipantLocation,
  sameParticipantItem,
} from "../../public/static/participant-location.js";

// #1158: seksjonen og modulen står i adressen ved siden av kurset. Historikken selv (pushState/popstate) prøves i
// test/e2e/participant-item-url-1158.spec.ts; her er regelen for hva adressen betyr.

const BASE = "https://a2.example/participant";

describe("#1158 readParticipantLocation", () => {
  it("kurset alene", () => {
    expect(readParticipantLocation("?courseId=c1")).toEqual({ courseId: "c1", slug: null, threadId: null, item: null });
  });

  it("seksjonen i kurset", () => {
    expect(readParticipantLocation("?courseId=c1&sectionId=s1").item).toEqual({ type: "SECTION", id: "s1" });
  });

  it("modulen i kurset", () => {
    expect(readParticipantLocation("?courseId=c1&moduleId=m1").item).toEqual({ type: "MODULE", id: "m1" });
  });

  it("?moduleId= uten kurs er e-postlenka, ikke et åpent element", () => {
    const location = readParticipantLocation("?moduleId=m1");
    expect(location.courseId).toBeNull();
    expect(location.item).toBeNull();
  });

  it("en tom verdi er ingen verdi", () => {
    expect(readParticipantLocation("?courseId=&sectionId=s1")).toMatchObject({ courseId: null, item: null });
    expect(readParticipantLocation("?courseId=c1&sectionId=").item).toBeNull();
  });

  it("delingslenka og tråden leses som før", () => {
    expect(readParticipantLocation("?kurs=ki-grunnkurs")).toMatchObject({ slug: "ki-grunnkurs", courseId: null });
    expect(readParticipantLocation("?courseId=c1&threadId=t1")).toMatchObject({ courseId: "c1", threadId: "t1", item: null });
  });
});

describe("#1158 buildParticipantUrl", () => {
  it("kurset med seksjonen", () => {
    expect(buildParticipantUrl(`${BASE}?courseId=c1`, { courseId: "c1", item: { type: "SECTION", id: "s1" } }))
      .toBe("/participant?courseId=c1&sectionId=s1");
  });

  it("fra seksjon til modul: seksjonen forsvinner fra adressen", () => {
    expect(buildParticipantUrl(`${BASE}?courseId=c1&sectionId=s1`, { courseId: "c1", item: { type: "MODULE", id: "m1" } }))
      .toBe("/participant?courseId=c1&moduleId=m1");
  });

  it("lukket element: bare kurset står igjen", () => {
    expect(buildParticipantUrl(`${BASE}?courseId=c1&moduleId=m1`, { courseId: "c1" })).toBe("/participant?courseId=c1");
  });

  it("lista: verken kurs eller element", () => {
    expect(buildParticipantUrl(`${BASE}?courseId=c1&sectionId=s1`, { courseId: null })).toBe("/participant");
  });

  it("andre parametere står urørt", () => {
    expect(buildParticipantUrl(`${BASE}?debug=1&courseId=c1#x`, { courseId: "c2", item: { type: "SECTION", id: "s9" } }))
      .toBe("/participant?debug=1&courseId=c2&sectionId=s9#x");
  });

  it("et element uten kurs skrives ikke", () => {
    expect(buildParticipantUrl(`${BASE}?moduleId=m1`, { courseId: null, item: { type: "MODULE", id: "m1" } })).toBe("/participant");
  });

  it("adressen den bygger, leses tilbake til det samme", () => {
    for (const item of [{ type: "SECTION", id: "s 1/æ" }, { type: "MODULE", id: "m1" }]) {
      const url = buildParticipantUrl(`${BASE}`, { courseId: "c1", item });
      expect(readParticipantLocation(url.slice(url.indexOf("?"))).item).toEqual(item);
    }
  });
});

describe("#1158 findSequenceEntry, sameParticipantItem, itemOfOpenEntry", () => {
  const sequence = [
    { type: "SECTION", sectionId: "x", courseItemId: "i1" },
    { type: "MODULE", moduleId: "x", courseItemId: "i2" },
  ];

  it("typen avgjør: en modul og en seksjon med samme id er to elementer", () => {
    expect(findSequenceEntry(sequence, { type: "MODULE", id: "x" })).toBe(sequence[1]);
    expect(findSequenceEntry(sequence, { type: "SECTION", id: "x" })).toBe(sequence[0]);
  });

  it("et element som ikke står i kurset, gir null", () => {
    expect(findSequenceEntry(sequence, { type: "SECTION", id: "borte" })).toBeNull();
    expect(findSequenceEntry(undefined, { type: "SECTION", id: "x" })).toBeNull();
    expect(findSequenceEntry(sequence, null)).toBeNull();
  });

  it("likhet", () => {
    expect(sameParticipantItem({ type: "SECTION", id: "a" }, { type: "SECTION", id: "a" })).toBe(true);
    expect(sameParticipantItem({ type: "SECTION", id: "a" }, { type: "MODULE", id: "a" })).toBe(false);
    expect(sameParticipantItem(null, null)).toBe(true);
    expect(sameParticipantItem(null, { type: "SECTION", id: "a" })).toBe(false);
  });

  it("det åpne panelet i adressens form", () => {
    expect(itemOfOpenEntry({ type: "SECTION", sectionId: "s1", courseId: "c1" })).toEqual({ type: "SECTION", id: "s1" });
    expect(itemOfOpenEntry({ type: "MODULE", moduleId: "m1", courseId: "c1" })).toEqual({ type: "MODULE", id: "m1" });
    expect(itemOfOpenEntry(null)).toBeNull();
  });
});
