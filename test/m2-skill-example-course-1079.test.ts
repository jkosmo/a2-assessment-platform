// #1079: eksempelkurset i skillet, produsert med skillets egen kommando og importert gjennom
// plattformens EGEN kursimport.
//
// Skillets kontroller måler mot skillets kopi av reglene. En enhetstest holder kopien opp mot
// skjemaet, men importen gjør mer enn å lese skjemaet: den renser hver SVG, lagrer hvert bilde,
// skriver om hver `asset:`-henvisning og nekter et smalt oppsett som ikke har samme etiketter som
// det brede. Det eneste som viser at et kurs fra skillet faktisk kommer inn, er å importere et.
//
// Testen ser også på det deltakeren får: at kort, uthevet boks, prompt-boks, tabell, ikon og bilde
// blir til HTML leseren kan vise — formene skillet skriver er valgt fordi plattformen tegner dem.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { getAsset } from "../src/modules/course/assetStorage.js";
import { renderSectionMarkdown } from "../src/modules/course/sectionContent.js";
import { ICON_SIZE } from "../skills/a2-authoring-api/scripts/pptx-extract.mjs";
import { produceCourse } from "../skills/a2-authoring-api/scripts/produce-course.mjs";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const EKSEMPEL = "skills/a2-authoring-api/examples/course-from-slides";
const SPRÅK = ["nb", "nn", "en-GB"] as const;

describe("#1079 eksempelkurset fra skillet importeres som det er", () => {
  let courseId: string;
  let seksjoner: string[];
  let modulId: string;

  beforeAll(async () => {
    const ut = join(mkdtempSync(join(tmpdir(), "skill-eksempel-")), "kurs.json");
    const produsert = await produceCourse({
      packageFile: `${EKSEMPEL}/package.json`,
      outFile: ut,
      stateFile: `${EKSEMPEL}/course-state.json`,
      slidesFile: `${EKSEMPEL}/treatment.json`,
    });
    expect(produsert.ok, JSON.stringify(produsert.checks.filter((c) => c.status === "fail"))).toBe(true);

    // Fila sendes ordrett slik forfatteren ville lastet den opp.
    const res = await request(app)
      .post("/api/admin/content/courses/import")
      .set(admin)
      .send({ payload: JSON.parse(readFileSync(ut, "utf8")), mode: "createNew" });
    expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(201);
    courseId = res.body.courseId as string;

    const items = await request(app).get(`/api/admin/content/courses/${courseId}/items`).set(admin);
    expect(items.status).toBe(200);
    const rader = items.body.items as Array<{ type: string; sectionId?: string; moduleId?: string }>;
    expect(rader.map((r) => r.type)).toEqual(["SECTION", "SECTION", "MODULE"]);
    seksjoner = rader.filter((r) => r.type === "SECTION").map((r) => r.sectionId!);
    modulId = rader.find((r) => r.type === "MODULE")!.moduleId!;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const tekst = async (sectionId: string) => {
    const versjon = await prisma.courseSectionVersion.findFirst({ where: { sectionId }, orderBy: { versionNo: "desc" }, select: { bodyMarkdown: true } });
    return JSON.parse(versjon!.bodyMarkdown) as Record<(typeof SPRÅK)[number], string>;
  };

  it("kurset er et utkast — ingenting er publisert", async () => {
    const kurs = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { publishedAt: true } });
    expect(kurs.publishedAt).toBeNull();
  });

  it("figuren kom inn med begge oppsett og alle tre språk", async () => {
    const [figur, ...flere] = await prisma.sectionAsset.findMany({ where: { sectionId: seksjoner[0]! } });
    expect(flere).toEqual([]);
    expect(figur).toMatchObject({ mimeType: "image/svg+xml", sourceLocale: "nb", filename: "arbeidsgang.svg" });
    expect((await getAsset(figur!.blobPath)).toString("utf8")).toContain("formålet");

    const språk = figur!.localizedBlobPaths as Record<string, string>;
    expect(Object.keys(språk).sort()).toEqual(["en-GB", "nn"]);
    expect((await getAsset(språk["en-GB"]!)).toString("utf8")).toContain("purpose");

    const smal = (figur!.layoutVariants as { narrow: { blobPath: string; localizedBlobPaths: Record<string, string> } }).narrow;
    // Animasjonen er med: plattformens rensing har ikke fjernet stilblokken figuren lyser opp med.
    expect((await getAsset(smal.blobPath)).toString("utf8")).toMatch(/@keyframes lys/);
    expect(Object.keys(smal.localizedBlobPaths).sort()).toEqual(["en-GB", "nn"]);
    expect((await getAsset(smal.localizedBlobPaths.nn!)).toString("utf8")).toContain("føremålet");
  });

  it("ikonene og skjermbildet kom inn, og ikonene tåler plattformens rensing med størrelsen i behold", async () => {
    const assets = await prisma.sectionAsset.findMany({ where: { sectionId: seksjoner[1]! } });
    expect(assets.map((a) => a.mimeType).sort()).toEqual(["image/png", "image/svg+xml", "image/svg+xml", "image/svg+xml"]);
    for (const ikon of assets.filter((a) => a.mimeType === "image/svg+xml")) {
      const svg = (await getAsset(ikon.blobPath)).toString("utf8");
      expect(svg, ikon.filename).toContain("<path");
      expect(svg, ikon.filename).toMatch(new RegExp(`width="${ICON_SIZE}"`));
      // Et ikon har ingen etiketter: det skal ikke ha, og får ikke, språkvarianter.
      expect(ikon.localizedBlobPaths).toBeNull();
    }
    const bilde = assets.find((a) => a.mimeType === "image/png")!;
    expect(bilde.filename).toBe("slide-04-1.png");
    expect((await getAsset(bilde.blobPath)).equals(readFileSync(`${EKSEMPEL}/deck/images/slide-04-1.png`))).toBe(true);
  });

  it("hver henvisning i teksten peker på det importerte bildet — på alle tre språk", async () => {
    const assets = await prisma.sectionAsset.findMany({ where: { sectionId: seksjoner[1]! }, select: { id: true } });
    const body = await tekst(seksjoner[1]!);
    for (const språk of SPRÅK) {
      const vist = [...body[språk].matchAll(/\(asset:([^)]+)\)/g)].map((m) => m[1]!);
      expect(vist.sort(), språk).toEqual(assets.map((a) => a.id).sort());
    }
  });

  it("leseren får kort med ikon, uthevet boks, prompt-boks, tabell og bilde som HTML den kan vise", async () => {
    for (const språk of SPRÅK) {
      const html = renderSectionMarkdown((await tekst(seksjoner[1]!))[språk], språk);
      // Tre kort, hvert med ikonet først i overskriften.
      expect(html.match(/<h3[^>]*>\s*<img /g), språk).toHaveLength(3);
      // Prompten er en kodeblokk — teksten står ordrett, med linjeskift, og kan kopieres.
      expect(html, språk).toMatch(/<pre><code class="language-prompt">[^<]*\n[^<]*\n/);
      expect(html, språk).toContain("<table>");
      expect(html.match(/<tr>/g)!.length, språk).toBe(4);
      // Skjermbildet har alt-tekst; ikonene har tom.
      expect(html.match(/<img [^>]*alt="[^"]{20,}"/g), språk).toHaveLength(1);
      expect(html.match(/<img [^>]*alt=""/g), språk).toHaveLength(3);
      expect(html, språk).not.toContain("asset:");
    }
    const første = renderSectionMarkdown((await tekst(seksjoner[0]!)).nb, "nb");
    expect(første).toMatch(/<blockquote>\s*<p><strong>Husk:<\/strong> Du står ansvarlig/);
    expect(første).toMatch(/<ol>[\s\S]*<strong>Avklar formålet\.<\/strong>/);
  });

  it("modulen kom inn med alle fire spørsmålene på tre språk", async () => {
    const eksport = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(admin);
    expect(eksport.status).toBe(200);
    const modul = (eksport.body.envelope.course.course.items as Array<{ type: string; module?: { activeVersion: { mcqSet: { questions: Array<{ stem: Record<string, string>; options: unknown[] }> } } } }>).find((i) => i.type === "MODULE")!.module!;
    const spørsmål = modul.activeVersion.mcqSet.questions;
    expect(spørsmål).toHaveLength(4);
    for (const q of spørsmål) {
      expect(Object.keys(q.stem).sort()).toEqual(["en-GB", "nb", "nn"]);
      expect(q.options).toHaveLength(3);
    }
    expect(modulId).toBeTruthy();
  });
});
