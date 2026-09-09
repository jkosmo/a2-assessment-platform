import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// #999: koden er kontrakten, ikke teksten.
//
// ⚠️ HVA SOM GÅR GALT UTEN EN KODE. En `ValidationError` gir `validation_error` UTEN `issues`, og
// da viser `api-error.js` serverens `message` ordrett. Zod produserer alltid `issues`, så fraværet
// er signalet om at en DOMENEREGEL sa nei — og da er serverens setning det eneste vi har.
//
// Konsekvensen er at en norsk setning dukker opp midt i et engelsk forfattergrensesnitt, og en
// engelsk setning midt i et norsk. Med en kode slår klienten den opp i sin egen tabell.
//
// ⚠️ DENNE VAKTA MÅLER EN RETNING, IKKE EN TILSTAND. #999 lar seg ikke lukke i én runde — det var
// 35 steder da saken ble skrevet. Ratsjen under låser framgangen: tallet kan gå ned, aldri opp.
// Går det ned, settes tallet ned med samme commit.
// ─────────────────────────────────────────────────────────────────────────────

const ROT = new URL("../../src/", import.meta.url);
const les = (u: URL) => readFileSync(u, "utf8");

function alleTsFiler(dir: URL): URL[] {
  const ut: URL[] = [];
  for (const post of readdirSync(dir, { withFileTypes: true })) {
    const barn = new URL(post.name + (post.isDirectory() ? "/" : ""), dir);
    if (post.isDirectory()) ut.push(...alleTsFiler(barn));
    else if (post.name.endsWith(".ts")) ut.push(barn);
  }
  return ut;
}

const filer = alleTsFiler(ROT);
const kilde = filer.map((f) => les(f)).join("\n");

// ⚠️ Taket senkes når tallet går ned. Det er en RATSJ: den skal feile i begge retninger, så en
// forbedring ikke går ubemerket forbi og en forverring ikke sniker seg inn.
const TAK = 30;

describe("#999 — domenevaktene skal bære koder", () => {
  it("kontrollcase: vi leser faktisk kildekoden", () => {
    // Uten denne er hele vakta grønn hvis filsøket returnerer tomt: «null treff» og «alt er ryddet»
    // ser identiske ut nedenfra.
    expect(filer.length, "fant ingen .ts-filer under src/").toBeGreaterThan(50);
    expect(kilde).toContain("DomainRuleError");
  });

  it("⚠️ antallet ValidationError uten kode går bare ned", () => {
    const antall = (kilde.match(/new ValidationError\(/g) ?? []).length;

    expect(
      antall,
      `Det er nå ${antall} ValidationError uten kode; taket er ${TAK}.\n` +
        "Hver av dem viser serverens egen setning ordrett i brukerens grensesnitt, uansett språk.\n" +
        "Trenger den nye virkelig å være uten kode? Domeneregler skal kaste DomainRuleError.",
    ).toBeLessThanOrEqual(TAK);

    expect(
      antall,
      `Bare ${antall} igjen — bra jobba. Sett TAK ned til ${antall} i denne fila, ellers måler\n` +
        "ratsjen ingenting fra nå av.",
    ).toBeGreaterThanOrEqual(TAK);
  });

  it("⚠️ ingen domenevakt kaster NORSK prosa", () => {
    // Den skarpeste formen for feilen, og den saken navnga: norsk setning i et engelsk grensesnitt.
    // Engelsk prosa til en norsk bruker er like galt, men det fanges av tellingen over.
    const norske: string[] = [];
    for (const fil of filer) {
      const linjer = les(fil).split("\n");
      linjer.forEach((linje, i) => {
        // ⚠️ BARE `ValidationError`. En `DomainRuleError` BÆRER en kode, og teksten dens er kun
        // reserven en API-konsument uten oversettelsestabell får — brukeren ser den kodebaserte
        // teksten fra tabellen (se AppError.ts). Første utgave av denne vakta flagget begge og sto
        // rød på `contentLifecycle.ts`, som allerede er riktig. En vakt som roper på det som er i
        // orden, lærer oss å ignorere den.
        if (!linje.includes("new ValidationError(")) return;
        if (!/(ikke|Seksjonen|Kurset|Modulen|allerede|finnes|før du)/.test(linje)) return;
        if (linje.trim().startsWith("//")) return;
        norske.push(`${fil.pathname.split("/src/")[1]}:${i + 1} ${linje.trim().slice(0, 90)}`);
      });
    }

    expect(
      norske.join("\n"),
      "En norsk setning fra serveren vises ordrett i det engelske forfattergrensesnittet.\n" +
        "Gi vakta en kode og legg teksten i alle tre språktabellene.",
    ).toBe("");
  });

  it("⚠️ hver kode i src har tekst i ALLE tre språktabellene", () => {
    // Samme regel på N steder, håndhevet på N−1. En kode uten tekst er verre enn prosa: klienten
    // faller tilbake til den generiske «noe i skjemaet er feil utfylt», som er feil diagnose.
    const koder = [...kilde.matchAll(/new DomainRuleError\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(koder.length, "fant ingen koder — kontrollcase").toBeGreaterThan(4);

    const tabell = readFileSync(
      fileURLToPath(new URL("../../public/i18n/participant-translations.js", import.meta.url)),
      "utf8",
    );
    const mangler = [...new Set(koder)].filter(
      (k) => (tabell.split(`"errors.api.${k}"`).length - 1) < 3,
    );

    expect(
      mangler.join(", "),
      "Disse kodene mangler tekst i en eller flere av de tre språktabellene.",
    ).toBe("");
  });
});
