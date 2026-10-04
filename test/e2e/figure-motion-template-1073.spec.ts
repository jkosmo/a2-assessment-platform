import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { drawFlowFigure } from "../../skills/a2-authoring-api/scripts/draw-flow-figure.mjs";
import { buildPreviewHtml, stillFigure } from "../../skills/a2-authoring-api/scripts/figure-preview.mjs";
import { sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

// #1073: `figure-motion-check.mjs` SAMMENLIGNER figurer med flytmalen i figure-design.md — den tolker
// ikke lenger stilregler. Da hviler alt på at malen selv gjør det den lover. Det måles her, i en
// ekte nettleser: nettleseren blir spurt hva som faktisk beveger seg.
//
// Enhetstesten vokter at figurer ER malen. Denne vokter at malen ER trygg.

function malen(): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const match = doc.split("### flow (animated)")[1]?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error("fant ikke den animerte flytmalen i figure-design.md");
  return match[1];
}

const åpne = (page: Page, svg: string) => page.goto(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

/** Det nettleseren selv sier om animasjonene i dokumentet. */
function animasjoner(page: Page) {
  return page.evaluate(() => document.getAnimations().map((a) => {
    const timing = a.effect!.getComputedTiming();
    return {
      navn: (a as CSSAnimation).animationName,
      element: ((a.effect as KeyframeEffect).target as Element).getAttribute("class"),
      runder: timing.iterations,
      slutt: Number(timing.endTime),
    };
  }));
}

test.describe("#1073 — flytmalen, målt i nettleseren", () => {
  test("hvert steg har sin animasjon, den går én gang, og alt er over innen 5 sekunder", async ({ page }) => {
    await åpne(page, malen());
    const funnet = await animasjoner(page);

    expect(funnet.map((a) => a.element).sort()).toEqual(["steg s1", "steg s2", "steg s3"]);
    for (const a of funnet) {
      expect(a.navn).toBe("lys");
      expect(a.runder, `${a.element}: skal gå én gang`).toBe(1);
      expect(a.slutt, `${a.element}: ferdig innen 5 sekunder`).toBeLessThanOrEqual(5000);
      expect(a.slutt, `${a.element}: har en varighet`).toBeGreaterThan(0);
    }
    // Stegene kommer etter tur, ikke samtidig: tre ulike sluttidspunkt.
    expect(new Set(funnet.map((a) => a.slutt)).size).toBe(3);
  });

  test("stillbildet er den vanlige flyten: når animasjonen er ferdig, har hver boks grunnfargen igjen", async ({ page }) => {
    await åpne(page, malen());
    const farger = () => page.locator("rect.steg").evaluateAll((bokser) => bokser.map((b) => getComputedStyle(b).fill));

    // Underveis lyser første steg opp — ellers ville «ferdig» og «aldri startet» sett like ut.
    await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 100; } });
    expect((await farger())[0]).not.toBe("rgb(238, 238, 255)");

    await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
    expect(await farger()).toEqual(["rgb(238, 238, 255)", "rgb(238, 238, 255)", "rgb(238, 238, 255)"]);
    // …og ingenting er skjult.
    const synlige = await page.locator("rect, text, line").evaluateAll((els) => els.filter((el) => {
      const stil = getComputedStyle(el);
      return stil.display !== "none" && stil.visibility !== "hidden" && Number(stil.opacity) > 0;
    }).length);
    expect(synlige).toBe(await page.locator("rect, text, line").count());
  });

  test("med «redusert bevegelse» beveger ingenting seg når figuren åpnes direkte", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await åpne(page, malen());
    expect(await animasjoner(page)).toEqual([]);
  });

  test("kontroll: uten malens regel for redusert bevegelse fortsetter animasjonen — regelen er det som stopper den", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await åpne(page, malen().replace(/@media \(prefers-reduced-motion: reduce\)[^\n]*\n/, ""));
    expect((await animasjoner(page)).length).toBe(3);
  });
});

// Sjekken og nettleseren skal være enige. Testene over måler bare den ene publiserte malen; disse
// måler det som FÅR variere — og det QA-porten viste at en for romslig sjekk slapp gjennom.
test.describe("#1073 — sjekken og nettleseren er enige", () => {
  /** Hvor mye av grunnfargen som er synlig når alt er ferdig: 1 = helt, 0 = usynlig. */
  const alfaIStillbildet = (page: Page) => page.evaluate(() => {
    for (const a of document.getAnimations()) a.finish();
    return [...document.querySelectorAll("rect.steg")].map((boks) => {
      const m = getComputedStyle(boks).fill.match(/rgba?\(([^)]+)\)/);
      const deler = (m?.[1] ?? "").split(",").map((d) => Number(d.trim()));
      return deler.length === 4 ? deler[3] : 1;
    });
  });

  test("en variant sjekken godtar — andre farger, andre tider, fire steg — beveger seg slik malen lover", async ({ page }) => {
    const variant = malen()
      .replaceAll("#eef", "#E8F0FE").replace("#ffd166", "#fbbc04")
      .replace("lys 1.4s", "lys 0.8s").replace("1.2s", "0.9s").replace("2.4s", "1.8s")
      .replace(".s3 { animation-delay: 1.8s; }", ".s3 { animation-delay: 1.8s; }\n    .s4 { animation-delay: 2.7s; }")
      .replace("</svg>", `  <rect class="steg s4" x="350" y="70" width="120" height="8" rx="2"/>\n</svg>`);
    expect(checkFigureMotion(variant).issues.filter((i) => i.kind !== "sequence_not_animated")).toEqual([]);
    expect(checkFigureMotion(variant).animated).toBe(true);

    await åpne(page, variant);
    const funnet = (await animasjoner(page)).sort((a, b) => a.slutt - b.slutt);
    expect(funnet.map((a) => a.element)).toEqual(["steg s1", "steg s2", "steg s3", "steg s4"]);
    for (const a of funnet) expect(a.runder).toBe(1);
    expect(funnet.at(-1)!.slutt).toBeLessThanOrEqual(5000);
    expect(await alfaIStillbildet(page)).toEqual([1, 1, 1, 1]);
  });

  // Hver av disse er MÅLT ødelagt i nettleseren — og må derfor avvises av sjekken. Står en av dem
  // igjen som «godkjent», har sjekken et hull nettleseren ser og den ikke.
  const ødelagt: Array<[string, (m: string) => string, (page: Page) => Promise<void>]> = [
    ["en kommentar inne i varigheten: nettleseren forkaster deklarasjonen", (m) => m.replace("lys 1.4s", "lys 1/*x*/.4s"),
      async (page) => { expect(await animasjoner(page)).toEqual([]); }],
    ["en senere regel slår animasjonen av", (m) => m.replace("</style>", ".steg { animation: none; }</style>"),
      async (page) => { expect(await animasjoner(page)).toEqual([]); }],
    ["keyframes med annen bruk av store bokstaver: navnet finnes ikke", (m) => m.replace("@keyframes lys", "@keyframes Lys"),
      async (page) => { expect(await animasjoner(page)).toEqual([]); }],
    ["gjennomsiktig grunnfarge: boksene forsvinner fra stillbildet", (m) => m.replaceAll("#eef", "#0000"),
      async (page) => { expect(await alfaIStillbildet(page)).toEqual([0, 0, 0]); }],
    ["like forsinkelser: to steg lyser samtidig", (m) => m.replace("2.4s", "1.2s"),
      async (page) => { expect(new Set((await animasjoner(page)).map((a) => a.slutt)).size).toBe(2); }],
    ["en fjerde boks uten stegklasse: fire bokser, tre animasjoner", (m) => m.replace("</svg>", `  <rect x="350" y="70" width="120" height="8" rx="2" fill="#eef" stroke="#333"/>\n</svg>`),
      async (page) => { expect((await animasjoner(page)).length).toBe(3); expect(await page.locator("rect").count()).toBe(4); }],
    ["et fjerde steg tegnet som rombe: fire former, tre animasjoner", (m) => m.replace("</svg>", `  <polygon points="350,74 410,66 470,74 410,79" fill="#eef" stroke="#333"/>\n</svg>`),
      async (page) => { expect((await animasjoner(page)).length).toBe(3); expect(await page.locator("rect, polygon").count()).toBe(4); }],
    ["stilblokka gjelder bare utskrift: ingen animasjon, og boksene mister fargen", (m) => m.replace("<style>", `<style media="print">`),
      async (page) => {
        expect(await animasjoner(page)).toEqual([]);
        expect(await page.locator("rect.steg").first().evaluate((b) => getComputedStyle(b).fill)).toBe("rgb(0, 0, 0)");
      }],
    ["klassene på etikettene: det er teksten som animeres, ikke boksene", (m) => m.replace(/<rect class="steg s\d"/g, "<rect").replace(/<text /g, '<text class="steg" '),
      async (page) => { expect([...new Set((await page.evaluate(() => document.getAnimations().map((a) => ((a.effect as KeyframeEffect).target as Element).tagName))))]).toEqual(["text"]); }],
  ];

  for (const [navn, ødelegg, målIBrowser] of ødelagt) {
    test(`ødelagt i nettleseren, og avvist av sjekken: ${navn}`, async ({ page }) => {
      const figur = ødelegg(malen());
      expect(figur, "varianten må faktisk være en annen enn malen").not.toBe(malen());
      await åpne(page, figur);
      await målIBrowser(page);

      const r = checkFigureMotion(figur);
      expect(r.animated).toBe(false);
      expect(r.issues.map((i) => i.kind)).toContain("unsupported_animation_form");
    });
  }
});

// #1079: malen har fått én form til — steg som sirkler, med fasens farge. Fargene står som
// variabler (`var(--grunn)`, `var(--lys)`) som hver fase gir verdi. Det er nytt for malen, så det
// samme spørsmålet stilles til nettleseren en gang til: gjør denne formen det sjekken lover?
function fasemalen(): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const match = doc.split("### flow with phases (animated)")[1]?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error("fant ikke fasemalen i figure-design.md");
  return match[1];
}

const FASE1 = { grunn: "rgb(217, 232, 221)", lys: "rgb(111, 174, 135)" };
const FASE2 = { grunn: "rgb(231, 226, 240)", lys: "rgb(169, 155, 201)" };

test.describe("#1079 — fasemalen, målt i nettleseren", () => {
  const fyll = (page: Page) => page.locator("circle").evaluateAll((sirkler) => sirkler.map((s) => getComputedStyle(s).fill));

  test("hver sirkel har sin animasjon, den går én gang, etter tur, og alt er over innen 5 sekunder", async ({ page }) => {
    await åpne(page, fasemalen());
    const funnet = await animasjoner(page);
    expect(funnet.map((a) => a.element).sort()).toEqual(["steg s1 fase1", "steg s2 fase1", "steg s3 fase2", "steg s4 fase2"]);
    for (const a of funnet) {
      expect(a.navn).toBe("lys");
      expect(a.runder).toBe(1);
      expect(a.slutt).toBeLessThanOrEqual(5000);
    }
    expect(new Set(funnet.map((a) => a.slutt)).size).toBe(4);
    expect(checkFigureMotion(fasemalen()).issues).toEqual([]);
  });

  test("hvert steg lyser opp i fasens sterke farge og hviler i fasens lyse", async ({ page }) => {
    await åpne(page, fasemalen());
    // Midt i sin egen opplysning (innen de første 70 %) har hvert steg fasens sterke farge.
    await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = Number(a.effect!.getComputedTiming().delay) + 100; } });
    expect(await fyll(page)).toEqual([FASE1.lys, FASE1.lys, FASE2.lys, FASE2.lys]);

    await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
    expect(await fyll(page)).toEqual([FASE1.grunn, FASE1.grunn, FASE2.grunn, FASE2.grunn]);
  });

  test("med «redusert bevegelse» står figuren stille, i fasenes farger", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await åpne(page, fasemalen());
    expect(await animasjoner(page)).toEqual([]);
    expect(await fyll(page)).toEqual([FASE1.grunn, FASE1.grunn, FASE2.grunn, FASE2.grunn]);
  });

  test("som bilde, etter plattformens rensing — slik deltakeren ser den — har stegene fasens farge", async ({ page }) => {
    const lagret = sanitizeSvg(fasemalen());
    expect(lagret).not.toBe("");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(`<img id="f" alt="" width="432" height="100">`);
    const farger = await page.evaluate((kilde) => new Promise<string[]>((ferdig, feil) => {
      const bilde = document.getElementById("f") as HTMLImageElement;
      bilde.onerror = () => feil(new Error("figuren lot seg ikke lese som bilde"));
      bilde.onload = () => {
        const lerret = document.createElement("canvas");
        lerret.width = 432; lerret.height = 100;
        const ctx = lerret.getContext("2d")!;
        ctx.drawImage(bilde, 0, 0, 432, 100);
        // Et punkt inne i hver sirkel, til side for tallet. Sentrum: (60 + i·104, 48), radius 22.
        ferdig([0, 1, 2, 3].map((i) => { const d = ctx.getImageData(60 + i * 104 - 12, 36, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; }));
      };
      bilde.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kilde)}`;
    }), lagret);
    // Et bilde får ikke leserens innstilling for bevegelse (#1073), så animasjonen går. Fargen er
    // derfor enten fasens lyse eller fasens sterke — aldri svart, og aldri en annen fases.
    for (const [i, fase] of [FASE1, FASE1, FASE2, FASE2].entries()) {
      expect([fase.grunn, fase.lys], `steg ${i + 1}`).toContain(farger[i]);
    }
  });

  const ødelagt: Array<[string, (mal: string) => string, (page: Page) => Promise<void>]> = [
    ["et steg uten faseklasse er svart", (m) => m.replace('class="steg s2 fase1"', 'class="steg s2"'),
      async (page) => { await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); }); expect((await fyll(page))[1]).toBe("rgb(0, 0, 0)"); }],
    ["en fase uten regel: stegene i den er svarte", (m) => m.replace(/\s*\.fase2 \{[^}]*\}/, ""),
      async (page) => { await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); }); expect((await fyll(page)).slice(2)).toEqual(["rgb(0, 0, 0)", "rgb(0, 0, 0)"]); }],
    ["samme farge i ro og opplyst: ingenting ses å bevege seg", (m) => m.replace("--lys: #6fae87", "--lys: #d9e8dd"),
      async (page) => {
        await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = Number(a.effect!.getComputedTiming().delay) + 100; } });
        expect((await fyll(page))[0]).toBe(FASE1.grunn);
      }],
    ["en sirkel uten stegklasse: fem sirkler, fire animasjoner", (m) => m.replace("</svg>", `  <circle cx="420" cy="80" r="8" fill="#eee"/>\n</svg>`),
      async (page) => { expect((await animasjoner(page)).length).toBe(4); expect(await page.locator("circle").count()).toBe(5); }],
  ];

  for (const [navn, ødelegg, målIBrowser] of ødelagt) {
    test(`ødelagt i nettleseren, og avvist av sjekken: ${navn}`, async ({ page }) => {
      const figur = ødelegg(fasemalen());
      expect(figur, "varianten må faktisk være en annen enn malen").not.toBe(fasemalen());
      await åpne(page, figur);
      await målIBrowser(page);

      const r = checkFigureMotion(figur);
      expect(r.animated).toBe(false);
      expect(r.issues.map((i) => i.kind)).toContain("unsupported_animation_form");
    });
  }
});

// #1079: `draw-flow-figure.mjs` tegner samme flyt i to oppsett. Det smale har noe det brede ikke
// har — to rader og en strek som går rundt fra den ene til den andre — så nettleseren blir spurt om
// begge: beveger hvert steg seg, etter tur, og er alt synlig når det er over?
test.describe("#1079 — det skriptet tegner, målt i nettleseren", () => {
  const beskrivelse = {
    name: "flyt",
    title: "Seks steg i tre faser",
    desc: "Seks steg i rekkefølge.",
    phases: {
      a: { label: "Først", grunn: "#d9e8dd", lys: "#6fae87" },
      b: { label: "Så", grunn: "#dce7f2", lys: "#7fa3c7" },
      c: { label: "Sist", grunn: "#e7e2f0", lys: "#a99bc9" },
    },
    steps: [
      { label: ["Steg", "en"], phase: "a" }, { label: ["Steg", "to"], phase: "a" }, { label: ["Steg", "tre"], phase: "b" },
      { label: ["Steg", "fire"], phase: "b" }, { label: ["Steg", "fem"], phase: "c" }, { label: ["Steg", "seks"], phase: "c" },
    ],
  };

  for (const oppsett of ["wide", "narrow"] as const) {
    test(`${oppsett}: seks steg lyser opp etter tur, én gang, og hviler i fasens farge med alt synlig`, async ({ page }) => {
      const figur = drawFlowFigure(beskrivelse)[oppsett];
      await åpne(page, figur);

      const funnet = await animasjoner(page);
      expect(funnet).toHaveLength(6);
      // Rekkefølgen i tid følger stegnumrene: s1 er først ferdig, s6 sist.
      const etterTur = [...funnet].sort((x, y) => x.slutt - y.slutt).map((a) => a.element?.split(" ")[1]);
      expect(etterTur).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
      for (const a of funnet) { expect(a.runder).toBe(1); expect(a.slutt).toBeLessThanOrEqual(5000); }

      await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
      const fyll = await page.locator("circle").evaluateAll((sirkler) => sirkler.map((s) => getComputedStyle(s).fill));
      expect(fyll).toEqual(["rgb(217, 232, 221)", "rgb(217, 232, 221)", "rgb(220, 231, 242)", "rgb(220, 231, 242)", "rgb(231, 226, 240)", "rgb(231, 226, 240)"]);

      // Alt som er tegnet, ligger innenfor figuren. Et radskifte som gikk utenfor, ville vært kuttet.
      const utenfor = await page.evaluate(() => {
        const ramme = document.documentElement.getBoundingClientRect();
        return [...document.querySelectorAll("circle, text, line, polyline")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < ramme.left - 0.5 || r.right > ramme.right + 0.5 || r.top < ramme.top - 0.5 || r.bottom > ramme.bottom + 0.5;
        }).map((el) => el.tagName + ":" + (el.textContent ?? "").trim());
      });
      expect(utenfor).toEqual([]);
    });
  }

  test("det smale oppsettet har to rader, det brede én", async ({ page }) => {
    const rader = async (svg: string) => {
      await åpne(page, svg);
      return new Set(await page.locator("circle").evaluateAll((sirkler) => sirkler.map((s) => Math.round(s.getBoundingClientRect().top)))).size;
    };
    const { wide, narrow } = drawFlowFigure(beskrivelse);
    expect(await rader(wide)).toBe(1);
    expect(await rader(narrow)).toBe(2);
  });
});

// Forhåndsvisningen fra `figure-preview.mjs`: sida forfatteren åpner for å SE figuren, og den
// stillestående fila for tegnere som ikke er nettlesere. Nettleseren blir spurt om begge.
test.describe("figure-preview — målt i nettleseren", () => {
  const beskrivelse = {
    name: "flyt", title: "Fire steg", desc: "Fire steg i to faser.",
    phases: { a: { label: "Først", grunn: "#d9e8dd", lys: "#6fae87" }, b: { label: "Så", grunn: "#e7e2f0", lys: "#a99bc9" } },
    steps: [{ label: ["Steg", "en"], phase: "a" }, { label: ["Steg", "to"], phase: "a" }, { label: ["Steg", "tre"], phase: "b" }, { label: ["Steg", "fire"], phase: "b" }],
  };

  test("den stillestående fila ser ut som figuren i ro: samme farger på hvert steg, uten stilblokk", async ({ page }) => {
    const { wide } = drawFlowFigure(beskrivelse);
    const farger = () => page.locator("circle").evaluateAll((sirkler) => sirkler.map((s) => `${getComputedStyle(s).fill} / ${getComputedStyle(s).stroke}`));

    await åpne(page, wide);
    await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
    const iRo = await farger();

    await åpne(page, stillFigure(wide));
    expect(await animasjoner(page)).toEqual([]);
    expect(await page.locator("style").count()).toBe(0);
    expect(await farger()).toEqual(iRo);
    // Kontroll: sammenligningen er ikke svart mot svart.
    expect(new Set(iRo).size).toBe(2);
    expect(iRo[0]).toBe("rgb(217, 232, 221) / rgb(111, 174, 135)");
  });

  test("forhåndsvisningssida viser hver figur som bilde, i bred og smal spalte, og knappen laster bildet på nytt", async ({ page }) => {
    const { wide, narrow } = drawFlowFigure(beskrivelse);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.setContent(buildPreviewHtml([{ name: "flyt.svg", svg: wide }, { name: "flyt.narrow.svg", svg: narrow }]));

    const bilder = page.locator("figure img");
    await expect(bilder).toHaveCount(4);
    const mål = await bilder.evaluateAll((els) => Promise.all(els.map(async (el) => {
      const img = el as HTMLImageElement;
      if (!img.complete) await new Promise((ferdig) => { img.onload = ferdig; img.onerror = ferdig; });
      return { lastet: img.naturalWidth > 0, bredde: Math.round(img.getBoundingClientRect().width), spalte: img.closest("figure")!.className };
    })));
    expect(mål.every((m) => m.lastet), "hvert bilde lar seg laste").toBe(true);
    // Telefonspalten er smalere enn den brede — ellers viser ikke sida det den lover.
    expect(mål.filter((m) => m.spalte === "phone").every((m) => m.bredde < 360)).toBe(true);
    expect(mål.filter((m) => m.spalte === "wide").every((m) => m.bredde > 400)).toBe(true);

    // Knappen laster figurens to bilder på nytt, så animasjonen går en gang til.
    await page.evaluate(() => {
      (window as unknown as { lastinger: number }).lastinger = 0;
      for (const img of document.querySelectorAll('img[data-figure="0"]')) img.addEventListener("load", () => { (window as unknown as { lastinger: number }).lastinger += 1; });
    });
    await page.locator('[data-replay="0"]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { lastinger: number }).lastinger)).toBe(2);
    // Sida henter ingenting utenfra.
    expect(await page.locator('script[src], link[href], img:not([src^="data:"])').count()).toBe(0);
  });
});
