// @vitest-environment node
//
// 2.121.0: kursets navn i delingslenka (/kurs/<slug>), laget fra bokmålstittelen.

import { describe, expect, it } from "vitest";
import { slugifyCourseTitle } from "../../src/modules/course/courseSlug.js";

describe("slugifyCourseTitle", () => {
  it("bokmålstittelen fra språkkartet, med tegnsetting og tankestrek som bindestrek", () => {
    const title = JSON.stringify({ "en-GB": "Course 7 – What Exactly Is an AI Agent?", nb: "Kurs 7 – Hva er egentlig en KI-agent?", nn: "Kurs 7 – Kva er ein KI-agent?" });
    expect(slugifyCourseTitle(title)).toBe("kurs-7-hva-er-egentlig-en-ki-agent");
  });

  it("æ, ø og å skrives ae, o og a; aksenter fjernes", () => {
    expect(slugifyCourseTitle("Ærlig fører på Åsen")).toBe("aerlig-forer-pa-asen");
    expect(slugifyCourseTitle("Café crème — naïve")).toBe("cafe-creme-naive");
  });

  it("ren tekst uten språkkart brukes som den er", () => {
    expect(slugifyCourseTitle("Legacy Course 12")).toBe("legacy-course-12");
  });

  it("lange titler kuttes ved et ordskille, høyst 80 tegn", () => {
    const slug = slugifyCourseTitle("Et svært langt kursnavn som fortsetter og fortsetter langt forbi det noen ville skrevet i en lenke");
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
    expect("et-svaert-langt-kursnavn-som-fortsetter-og-fortsetter-langt-forbi-det-noen-ville-skrevet".startsWith(slug)).toBe(true);
  });

  it("uten bokstaver eller tall: «kurs»", () => {
    expect(slugifyCourseTitle("???")).toBe("kurs");
    expect(slugifyCourseTitle("")).toBe("kurs");
  });
});
