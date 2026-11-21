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

// #1173 (rest): menyenes navn for skjermleseren sto på bokmål på elleve sider. En meny uten nøkkel kan ikke oversettes;
// en side med nøkkelen, men uten skriptet som leser den, oversetter den heller ikke. Modulsida (admin-content.html)
// oversetter `data-i18n-aria-label` selv, i `translatePageStaticText`.
describe("#1173 menyene har et navn som oversettes", () => {
  const navTag = /<nav\b[^>]*id="(contentAreaNav|deltakereSubnav)"[^>]*>/g;
  // `includes`, ikke `navTag.test`: en global regex husker `lastIndex` mellom kallene og hopper over sider.
  const pagesWithNav = htmlPages.filter((name) => {
    const html = fs.readFileSync(path.join(publicDir, name), "utf8");
    return html.includes('id="contentAreaNav"') || html.includes('id="deltakereSubnav"');
  });
  it("finner sidene med meny (kontroll: elleve i dag)", () => {
    expect(pagesWithNav.length).toBeGreaterThanOrEqual(11);
  });
  for (const name of pagesWithNav) {
    const html = fs.readFileSync(path.join(publicDir, name), "utf8");
    it(`${name}: menyen har en nøkkel, og sida laster det som oversetter den`, () => {
      // Minst ett treff: en side der `navTag` ikke kjenner igjen menyen, skal ikke slippe gjennom med en tom løkke.
      const tags = html.match(navTag) ?? [];
      expect(tags.length, `${name}: fant ikke menyens <nav>-tagg`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag).toMatch(/data-i18n-aria-label="area\.(contentNavAria|participantsNavAria)"/);
      }
      if (name !== "admin-content.html") expect(html).toContain('src="/static/content-area-nav-i18n.js"');
    });
  }
});

// #1173 (rest): bekreftelser og meldinger var skrevet rett inn i koden på bokmål. En tekst som står i selve kallet, kan
// ikke oversettes; den skal komme fra `t`/`tf`. Vakta ser bare på teksten utenom `${…}`: `${t("x")}: ${feil}` er lov.
describe("#1173 bekreftelser og meldinger i innholdsforvaltningen har ingen fast tekst", () => {
  const staticDir = path.join(publicDir, "static");
  const files = fs.readdirSync(staticDir).filter((name) => /^admin-content.*\.js$/.test(name) || name === "owner-panel.js");
  const call = /(?:window\.confirm|showToast)\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  it("finner filene (kontroll)", () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const name of files) {
    it(name, () => {
      const source = fs.readFileSync(path.join(staticDir, name), "utf8");
      const offenders = [...source.matchAll(call)]
        .map((match) => match[1])
        .filter((literal) => /\p{L}{2,}/u.test(literal.slice(1, -1).replace(/\$\{[^}]*\}/g, "")));
      expect(offenders).toEqual([]);
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
    // #1173 (rest)
    "classes.archiveConfirm", "classes.deleteConfirm", "classes.restoreConfirm",
    "library.deleteConfirm", "library.unpublishConfirm", "library.purge.title", "library.purge.intro",
    "library.purge.loading", "library.purge.willDelete", "library.purge.skipped", "library.purge.typeBefore",
    "library.purge.typeAfter", "library.purge.confirm", "library.purge.previewFailed", "library.purge.failed",
    "library.purge.doneWithFailures", "library.purge.done",
    "courses.unpublishConfirm", "courses.deleteDialog.title", "courses.deleteDialog.text", "courses.deleteDialog.confirm",
    "courses.delete.cascadeTitle", "courses.delete.summary", "courses.delete.cascadeDone",
    "area.contentNavAria", "area.participantsNavAria",
    "quality.aria.ownerFilter", "quality.aria.declarationTable", "quality.aria.answersTable",
    "shell.settings.rangeFrom", "shell.settings.rangeTo", "courses.translationMissing",
    // `library.purge.open` er med i e2e (ordet er likt på bokmål og nynorsk, men ikke på engelsk).
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
