import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { readFasit, sha256, SWAP_ROOT } from "../support/mascotFasit.js";
import {
  boatView,
  COURSES,
  mockCourses,
  mockProfile,
  normalizedDom,
  normalizedMarkup,
  progress,
  PROFILE_LOCALES,
  PROFILE_MOODS,
  startFrozenCelebration,
  type NormalizedNode,
} from "../support/mascotE2e.js";
import { loadMascotPack, resolveMascotRequest, type MascotPack } from "../../src/modules/mascot/mascotPack.js";

// Maskotpakken, skive 2 (doc/design/MASKOTPAKKE.md): et bytte endrer humørlinjene og bildene på Profil og figuren i
// «Mine kurs», og ingenting annet.
//
// Testpakken (test/fixtures/mascot-swap/mascots/testbat) serveres i stedet for seilbåten: alt nettleseren henter fra
// pakken, besvares med `resolveMascotRequest(testpakken, …)`, den samme funksjonen appen bruker. Så tegnes det samme som
// i fasiten, og to ting vises:
//   1. det som kommer fra pakken (linja, bildet, SVG-en, feiringens varighet), er testpakkens;
//   2. med testpakkens bidrag byttet tilbake til seilbåtens, er resultatet lik fasiten.

const testbat = loadMascotPack(SWAP_ROOT);
const seilbat = loadMascotPack(process.cwd());

/** Alt under /static/ som hører til pakken, kommer fra testpakken; resten fra testserveren som før. */
async function serveTestbat(page: Page) {
  await page.route("**/static/**", async (route) => {
    const hit = resolveMascotRequest(testbat, new URL(route.request().url()).pathname);
    if (!hit) return route.fallback();
    if (hit.kind === "body") return route.fulfill({ status: 200, contentType: hit.contentType, body: hit.body });
    return route.fulfill({ status: 200, path: hit.file });
  });
}

const imageHash = (pack: MascotPack, file: string) => {
  const bytes = readFileSync(path.join(pack.dir, "images", file));
  return { bytes: bytes.length, sha256: sha256(bytes) };
};
/** Humøret profilen viser: et humør klienten ikke kjenner, faller tilbake til «mett». */
const shownMood = (mood: string) => (mood in testbat.moods ? mood : "mett") as keyof MascotPack["moods"];

test.describe("maskotpakken, skive 2: et bytte på profilen og i «Mine kurs»", () => {
  test("profilen: linja og bildet er testpakkens, resten er fasiten", async ({ browser }) => {
    test.setTimeout(120_000);
    const actual: Record<string, Awaited<ReturnType<typeof boatView>>> = {};
    for (const mood of PROFILE_MOODS) {
      for (const locale of PROFILE_LOCALES) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await serveTestbat(page);
        await mockProfile(page, mood, locale);
        await page.goto("/profile");
        actual[`${mood} | ${locale}`] = await boatView(page);
        await context.close();
      }
    }

    // 1. Linja og bildet er testpakkens.
    for (const [name, view] of Object.entries(actual)) {
      const [mood, locale] = name.split(" | ") as [string, (typeof PROFILE_LOCALES)[number]];
      const own = testbat.moods[shownMood(mood)];
      expect(view.line, name).toBe(own.line[locale]);
      expect({ bytes: view.image.bytes, sha256: view.image.sha256 }, name).toEqual(imageHash(testbat, own.image));
    }

    // 2. Byttet tilbake er det fasiten.
    const reversed = Object.fromEntries(
      Object.entries(actual).map(([name, view]) => {
        const mood = shownMood(name.split(" | ")[0]!);
        const locale = name.split(" | ")[1] as (typeof PROFILE_LOCALES)[number];
        return [name, { ...view, line: seilbat.moods[mood].line[locale], image: { ...view.image, ...imageHash(seilbat, seilbat.moods[mood].image) } }];
      }),
    );
    expect(reversed).toEqual(readFasit("profile.json"));
  });

  test("«Mine kurs»: figuren og feiringen er testpakkens, resten er fasiten", async ({ page }) => {
    await serveTestbat(page);
    await mockCourses(page);
    await page.goto("/participant");
    await expect(progress(page, "c30").locator(".course-boat")).toHaveCount(1);

    const actual: Record<string, NormalizedNode> = {};
    for (const course of COURSES) actual[course.state] = await normalizedDom(page, course.id);
    await startFrozenCelebration(page);
    actual.feiring = await normalizedDom(page, "cDone");

    // Feiringen varer like lenge som i testpakken (3 s, ikke seilbåtens 4,2 s): figure.css er testpakkens.
    const duration = await progress(page, "cDone").locator(".course-boat").evaluate((el) => getComputedStyle(el).animationDuration);
    expect(duration).toBe(`${testbat.figure.celebrationMs / 1000}s`);

    // 1. Hver SVG på linja er testpakkens tegning for tilstanden. 2. Med SVG-ene tatt ut er alt likt fasiten.
    const svgFor: Record<string, "flatt" | "fullt" | "feiring"> = { "1 av 300": "flatt", "29 %": "flatt", "30 %": "fullt", feiring: "feiring" };
    const expected = readFasit<Record<string, NormalizedNode>>("figure-dom.json");
    const svgs = (node: NormalizedNode): NormalizedNode[] =>
      node.tag === "svg" ? [node] : node.children.flatMap((child) => (typeof child === "string" ? [] : svgs(child)));
    const withoutSvg = (node: NormalizedNode): NormalizedNode => ({
      ...node,
      children: node.children.map((child) => (typeof child === "string" ? child : child.tag === "svg" ? "[figuren]" : withoutSvg(child))),
    });
    for (const [state, tree] of Object.entries(actual)) {
      const own = svgs(tree);
      const state_ = svgFor[state];
      expect(own, state).toHaveLength(state_ ? 1 : 0);
      if (state_) {
        const svgFile = (pack: MascotPack) => readFileSync(path.join(pack.dir, pack.figure.states[state_]), "utf8").replace(/\r\n/g, "\n").trim();
        expect(own[0], state).toEqual(await normalizedMarkup(page, svgFile(testbat)));
        expect(svgs(expected[state]!)[0], `${state} i fasiten`).toEqual(await normalizedMarkup(page, svgFile(seilbat)));
      }
      expect(withoutSvg(tree), state).toEqual(withoutSvg(expected[state]!));
    }
    // Ingen tekst fra seilbåten er igjen på siden.
    expect(JSON.stringify(actual)).not.toContain("cb-hull");
  });
});
