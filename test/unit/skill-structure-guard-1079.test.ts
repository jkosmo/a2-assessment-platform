import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT (#1079): skillets oppbygging.
//
// Skillet er en pakke som kjører hos en ekstern modell, i en sandkasse uten repoet. Det ble bygget
// om 2026-10-05 etter Anthropics retningslinjer for Skills, fordi forsiden var blitt 250 linjer med
// regler, historikk og saksnumre, og modellen fulgte den første regelen den fant i stedet for den
// som gjaldt. Vakta holder det som ble ryddet, ryddet:
//
//   · forsiden er en oversikt: kort, med beskrivelse som sier NÅR skillet skal brukes
//   · hver lenke treffer en fil i pakken — og en overskrift som finnes
//   · ingenting peker ut av pakken (repo-stier, saksnumre, datoer for hva som ble bestemt når)
//   · hver kommando teksten ber modellen kjøre, finnes og KAN kjøres fra kommandolinja
//
// Den siste er grunnen til at vakta finnes: den første nye forsiden sa «kjør dem, hver skriver OK
// eller FAIL» om fire skript som bare var biblioteker.
// ─────────────────────────────────────────────────────────────────────────────

const ROT = "skills/a2-authoring-api";

function filer(mappe: string): string[] {
  return readdirSync(mappe).flatMap((navn) => {
    const sti = join(mappe, navn);
    return statSync(sti).isDirectory() ? filer(sti) : [sti];
  });
}
const alle = filer(ROT).map((f) => f.replaceAll("\\", "/"));
const tekster = alle.filter((f) => f.endsWith(".md"));
const les = (fil: string) => readFileSync(fil, "utf8").replaceAll("\r\n", "\n");

/** Teksten uten kodeblokker og kode i linja: det som er igjen, er det modellen leser som prosa. */
function prosa(tekst: string) {
  return tekst.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/** Overskriftene i en fil, som ankrene de får. */
function ankre(tekst: string) {
  return new Set(
    [...tekst.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
      m[1]!
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-"),
    ),
  );
}

describe("#1079 — skillets forside", () => {
  const forside = les(`${ROT}/SKILL.md`);
  const hode = /^---\n([\s\S]*?)\n---\n/.exec(forside)?.[1] ?? "";
  const beskrivelse = (/^description:\s*>\n((?: {2}.*\n?)+)/m.exec(hode)?.[1] ?? "").replace(/\s+/g, " ").trim();

  it("har navn og en beskrivelse innenfor grensen på 1024 tegn — kontrollcase: den er lest", () => {
    expect(/^name: a2-authoring-api$/m.test(hode)).toBe(true);
    expect(beskrivelse.length).toBeGreaterThan(200);
    expect(beskrivelse.length).toBeLessThanOrEqual(1024);
  });

  it("beskrivelsen sier hva skillet gjør OG når det skal brukes, i tredje person", () => {
    expect(beskrivelse).toMatch(/^Builds /);
    expect(beskrivelse).toContain("Use when");
    // Ordene en forfatter faktisk bruker — uten dem velges ikke skillet når en presentasjon lastes opp.
    for (const ord of ["PowerPoint", ".pptx", "presentasjon", "kurs", "test"]) expect(beskrivelse).toContain(ord);
    expect(beskrivelse).not.toMatch(/\b(I|you|your)\b/);
  });

  it("sier hva som trengs for å kjøre skriptene", () => {
    expect(hode).toMatch(/^compatibility: .*Node\.js/m);
  });

  it("er en oversikt: under 150 linjer (retningslinjen sier under 500)", () => {
    expect(forside.split("\n").length).toBeLessThan(150);
  });

  it("lenker direkte til hvert kapittel og hver arbeidsflyt — ingen leses bare via et annet kapittel", () => {
    const lenket = new Set([...forside.matchAll(/\]\(([^)#\s]+)/g)].map((m) => m[1]));
    const skalLenkes = tekster.map((f) => relative(ROT, f).replaceAll("\\", "/")).filter((f) => /^(references|workflows)\//.test(f) || f === "examples/README.md");
    expect(skalLenkes.length).toBeGreaterThan(8);
    expect(skalLenkes.filter((f) => !lenket.has(f))).toEqual([]);
  });
});

describe("#1079 — lenker og pekere i skillet", () => {
  it("skillet har tekstfilene vi venter — kontrollcase mot en tom liste", () => {
    expect(tekster.length).toBeGreaterThanOrEqual(13);
    expect(tekster).toContain(`${ROT}/workflows/from-presentation.md`);
  });

  it("hver lenke treffer en fil i pakken, og hvert anker en overskrift i den fila", () => {
    const brudd: string[] = [];
    for (const fil of tekster) {
      for (const [, mål] of prosa(les(fil)).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|asset:|mailto:)/.test(mål!)) continue;
        const [sti, anker] = mål!.split("#");
        const målfil = sti ? resolve(dirname(fil), sti) : resolve(fil);
        if (relative(resolve(ROT), målfil).startsWith("..")) brudd.push(`${fil}: ${mål} peker ut av pakken`);
        else if (!existsSync(målfil)) brudd.push(`${fil}: ${mål} finnes ikke`);
        else if (anker && statSync(målfil).isFile() && !ankre(les(målfil)).has(anker)) brudd.push(`${fil}: #${anker} finnes ikke i ${sti || "fila selv"}`);
      }
    }
    expect(brudd).toEqual([]);
  });

  it("ingenting peker inn i repoet: skillet kjører der repoet ikke finnes", () => {
    const brudd: string[] = [];
    for (const fil of tekster) {
      const tekst = les(fil);
      for (const mønster of [/skills\/a2-authoring-api/, /\b(?:src|doc|test)\/[\w./-]+/, /npm run /]) {
        const treff = mønster.exec(tekst);
        if (treff) brudd.push(`${fil}: «${treff[0]}»`);
      }
    }
    expect(brudd).toEqual([]);
  });

  it("ingen historikk: verken saksnumre eller datoer for hva som ble bestemt når", () => {
    const brudd: string[] = [];
    for (const fil of tekster) {
      const tekst = prosa(les(fil));
      for (const treff of tekst.matchAll(/#\d{3,4}\b|\b20\d\d-\d\d-\d\d\b/g)) brudd.push(`${fil}: «${treff[0]}»`);
    }
    expect(brudd).toEqual([]);
  });

  it("et kapittel over 100 linjer åpner med en innholdsliste", () => {
    const uten = tekster
      .filter((f) => !f.endsWith("SKILL.md") && les(f).split("\n").length > 100)
      .filter((f) => !les(f).split("\n").slice(0, 6).some((linje) => linje.startsWith("Contents: ")));
    expect(uten).toEqual([]);
  });
});

describe("#1079 — kommandoene skillet ber modellen kjøre", () => {
  const kommandoer = tekster.flatMap((fil) => [...les(fil).matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map((m) => ({ fil, skript: m[1]! })));

  it("teksten nevner kommandoer — kontrollcase", () => {
    expect(new Set(kommandoer.map((k) => k.skript)).size).toBeGreaterThanOrEqual(9);
  });

  it("hver kommando er et skript som finnes og har en inngang fra kommandolinja", () => {
    const brudd = kommandoer
      .filter(({ skript }) => !existsSync(join(ROT, skript)) || !/process\.argv/.test(les(join(ROT, skript))))
      .map(({ fil, skript }) => `${fil}: node ${skript}`);
    expect(brudd).toEqual([]);
  });

  it("hvert skript med en inngang fra kommandolinja står i tabellen på forsiden", () => {
    const forside = les(`${ROT}/SKILL.md`);
    const kjørbare = alle.filter((f) => /\/scripts\/[\w-]+\.mjs$/.test(f) && /process\.argv/.test(les(f))).map((f) => f.slice(ROT.length + 1));
    expect(kjørbare.length).toBeGreaterThanOrEqual(10);
    expect(kjørbare.filter((skript) => !forside.includes(`node ${skript}`))).toEqual([]);
  });

  it("et skript som bare er et bibliotek, nevnes aldri som noe å kjøre", () => {
    const biblioteker = alle.filter((f) => /\/scripts\/[\w-]+\.mjs$/.test(f) && !/process\.argv/.test(les(f))).map((f) => f.slice(ROT.length + 1));
    expect(biblioteker).toEqual(expect.arrayContaining(["scripts/export-validate.mjs", "scripts/localization-check.mjs", "scripts/package-assets.mjs"]));
    const brudd = tekster.flatMap((fil) => biblioteker.filter((skript) => les(fil).includes(`node ${skript}`)).map((skript) => `${fil}: node ${skript}`));
    expect(brudd).toEqual([]);
  });
});

describe("#1079 — eksempelkurset henger sammen", () => {
  const mappe = `${ROT}/examples/course-from-slides`;

  it("hver fil pakken peker på, ligger i eksempelmappa", () => {
    const pekere = [...les(`${mappe}/package.json`).matchAll(/"file": "([^"]+)"/g)].map((m) => m[1]!);
    expect(pekere.length).toBeGreaterThanOrEqual(10);
    expect(pekere.filter((f) => !existsSync(join(mappe, f)))).toEqual([]);
  });

  it("lysarklista og tilstanden peker på elementer som er i pakken", () => {
    const refs = new Set((JSON.parse(les(`${mappe}/package.json`)).objects as Array<{ clientRef: string }>).map((o) => o.clientRef));
    const liste = JSON.parse(les(`${mappe}/treatment.json`)).slides as Array<{ in?: string }>;
    const tilstand = JSON.parse(les(`${mappe}/course-state.json`)) as { order: string[]; elements: Array<{ clientRef: string }> };
    expect(liste.filter((rad) => rad.in && !refs.has(rad.in))).toEqual([]);
    expect([...tilstand.order, ...tilstand.elements.map((e) => e.clientRef)].filter((ref) => !refs.has(ref))).toEqual([]);
  });
});
