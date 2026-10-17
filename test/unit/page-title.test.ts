import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Sidetittelen: «A-2 læringsplattform – Mine kurs», på brukerens språk, uten versjonsnummer.
//
// ⚠️ To kilder som må være like: den faste `<title>` i HTML-fila (det en lenkeforhåndsvisning leser,
// den kjører ikke skript) og bokmålsversjonen i public/static/page-title.js. Denne testen holder dem
// like, og sørger for at en ny side ikke glemmer å si hvilken side den er.

const PUBLIC = path.resolve(process.cwd(), "public");
const helper = fs.readFileSync(path.join(PUBLIC, "static", "page-title.js"), "utf8");

/** Sidene og bokmålsnavnet, lest fra hjelperen (den importerer fra /static/, så den kan ikke lastes her). */
function nbNames(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of helper.matchAll(/^\s*"?([a-z-]+)"?: \{ nb: "([^"]+)"/gm)) out[m[1]!] = m[2]!;
  return out;
}

const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));

describe("sidetittel", () => {
  it("hjelperen kjenner minst like mange sider som det finnes HTML-sider", () => {
    expect(Object.keys(nbNames()).length).toBeGreaterThanOrEqual(pages.length);
  });

  for (const file of pages) {
    it(`${file}: sier hvilken side den er, har fast bokmålstittel og laster hjelperen`, () => {
      const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
      const page = /<html[^>]*\sdata-page="([^"]+)"/.exec(html)?.[1];
      expect(page, "data-page på <html>").toBeTruthy();
      const name = nbNames()[page!];
      expect(name, `«${page}» finnes i page-title.js`).toBeTruthy();
      expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(`A-2 læringsplattform – ${name}`);
      expect(html).toContain('<script type="module" src="/static/page-title.js"></script>');
      expect(html, "ingen versjonsnummer i tittelen").not.toMatch(/<title>[^<]*v\d/);
    });
  }

  it("ingen side setter tittelen selv lenger (den kom med versjonsnummer)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "vendor") walk(p); continue; }
        if (!entry.name.endsWith(".js") || entry.name === "page-title.js") continue;
        if (/document\.title\s*=/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(PUBLIC, p));
      }
    };
    walk(PUBLIC);
    expect(offenders).toEqual([]);
  });
});
