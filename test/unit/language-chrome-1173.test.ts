import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — klientmodul uten typer
import { translations } from "../../public/i18n/admin-content-translations.js";

// #1173: vaktene som ikke trenger en nettleser. Oppførselen er festet i
// test/e2e/language-accessibility-1173.spec.ts; dette er dekningen for sider og nøkler ingen har
// laget ennå.

const publicDir = path.join(process.cwd(), "public");
const htmlPages = fs.readdirSync(publicDir).filter((name) => name.endsWith(".html"));

describe("#1173 rammen på hver side kan oversettes", () => {
  it("finner sidene (kontroll: lista er ikke tom)", () => {
    expect(htmlPages.length).toBeGreaterThan(10);
  });

  // Moduler, Seksjoner, Klasser og Tema hadde lenken; Klasser manglet attributtet, og ingen av de
  // fire oversatte det. En side uten attributtet kan ikke oversettes av noen.
  for (const name of htmlPages) {
    const html = fs.readFileSync(path.join(publicDir, name), "utf8");
    it(`${name}: hopp-lenken og etiketten på språkvelgeren har en nøkkel`, () => {
      for (const tag of html.match(/<a\b[^>]*class="skip-nav"[^>]*>/g) ?? []) {
        expect(tag).toContain('data-i18n="nav.skipToContent"');
      }
      for (const tag of html.match(/<label\b[^>]*for="localeSelect"[^>]*>/g) ?? []) {
        expect(tag).toContain('data-i18n="locale.label"');
      }
    });
  }
});

describe("#1173 nye nøkler finnes på alle tre språk, og bokmål er ikke engelsk", () => {
  // Bokmål og nynorsk bygges som engelsk + overstyringer, så paritetstesten i
  // admin-content-translations.test.js er grønn også når en nøkkel bare står på engelsk. Da får en
  // norsk side engelsk tekst — samme feil som saken, bare snudd.
  const keys = [
    "owners.title", "owners.loading", "owners.loadFailed", "owners.none", "owners.noneShort", "owners.edit",
    "owners.done", "owners.remove", "owners.searchPlaceholder", "owners.searchAria", "owners.noMatches",
    "owners.added", "owners.addFailed", "owners.removed", "owners.removeFailed",
    "classes.membersHeading", "classes.coursesHeading", "classes.deadlineOptional", "classes.saved",
    "classes.memberSearchLabel", "classes.courseSelectLabel",
    "courses.fallbackPlaceholder",
    "library.courseCountAria", "library.coursesPopoverAria", "library.unpublishedToast", "library.duplicatedToast",
    "shell.preview.paneAria",
  ];
  for (const key of keys) {
    it(key, () => {
      const en = translations["en-GB"][key];
      expect(en, `en-GB mangler ${key}`).toBeTypeOf("string");
      expect(translations.nb[key], `nb.${key} er den engelske teksten`).not.toBe(en);
      expect(translations.nn[key], `nn.${key} er den engelske teksten`).not.toBe(en);
    });
  }
});

describe("#1173 eierpanelet har ingen hardkodet tekst", () => {
  it("owner-panel.js har ingen norske bokstaver utenfor kommentarer", () => {
    const source = fs.readFileSync(path.join(publicDir, "static", "owner-panel.js"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code.match(/.*[æøåÆØÅ].*/g) ?? []).toEqual([]);
  });
});
