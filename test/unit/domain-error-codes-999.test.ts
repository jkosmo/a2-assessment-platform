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

// ⚠️ RATSJ: tallet kan gå ned, aldri opp. Går det ned, settes TAK ned i SAMME commit — ellers
// måler den ingenting fra da av. Den skal altså feile i begge retninger.
const TAK = 15;

// HISTORIKK, så neste porsjon vet hvor den skal lete:
//
//   35  da saken ble skrevet
//   34  #1001 ga publiseringsporten en kode
//   30  de fire seksjonsvaktene — den siste norske prosaen i kastene
//   21  vedleggene: ni kast viste seg å være fem regler, tre av dem ordrette duplikater
//   14  påmelding, kursbevisbakgrunn, kaskadesletting, eksporttak, vedleggsimport
//   13  rapportrutene: fjorten svar var TO meldinger, «Invalid report query filters» sto tolv
//       ganger ordrett
//   15  ⚠️ OPP IGJEN, med vilje. To av kodene viste seg å være UNÅBARE: Zod avviser tilfellet på
//       ruta før tjenesten kalles. Målt mot stage 2026-09-10 — `class_name_required` og
//       `enrollment_target_missing` ga begge `validation_error` med `issues`. De er rullet tilbake
//       til vanlige vakter, og de seks tekstene er slettet.
//
//       ⚠️ RATSJEN SKAL IKKE PRESSE TALLET NED FOR ENHVER PRIS. En kode som aldri når en klient
//       lyver om sin egen rekkevidde, og neste leser tror den er brukervendt. Å telle den som
//       framgang gjør målet til tallet i stedet for det tallet skulle måle.
//
// ⚠️ TALLET DEKKET LENGE BARE HALVE SANNHETEN. Ratsjen talte først bare `new ValidationError(`,
// mens 25 ruter bygde svaret for hånd med `{ error: "validation_error", message }` — samme vei
// gjennom `api-error.js`, samme skade. Det sto som «2 igjen» mens 27 gjensto.
//
// ── HVA SOM STÅR IGJEN, OG HVORFOR ────────────────────────────────────────────────────────────
//
// ⚠️ DE 2 KASTEDE BLIR STÅENDE. En feilkode finnes for at klienten skal si det samme på brukerens
// språk. Disse to er ikke domeneregler noen kan handle på:
//
//   entraUserSyncService — en KONFIGURASJONSFEIL som navngir en miljøvariabel. Å oversette
//   «ENTRA_USER_SYNC_GROUP_ID er ikke satt» til nynorsk hjelper ingen.
//
//   submissionService — en INTERN INVARIANT. Fyrer den, er dataene inkonsistente, og svaret er en
//   feilrapport — ikke en setning som ber brukeren gjøre noe hen ikke kan gjøre.
//
// ⚠️ DE 11 HÅNDBYGDE ER EN ANNEN SAK. «url is required», «invalid locale», «validFrom/validTo må
// være ISO-verdier», «Missing file» er FORMVALIDERING, ikke domeneregler — forespørselen har feil
// form, ingen har brutt en regel om innholdet.
//
// #996 avgjorde allerede formen: Zod-svar bærer `issues`, får den generiske overskriften, og
// detaljene i detaljfeltet. Riktig fiks er å flytte dem inn i skjemaene — ikke å gi dem
// DomainRuleError-koder, som ville påstått at de er noe de ikke er. De ligger i adminContent (8),
// calibration (2) og adminSections (1).

describe("#999 — domenevaktene skal bære koder", () => {
  it("kontrollcase: vi leser faktisk kildekoden", () => {
    // Uten denne er hele vakta grønn hvis filsøket returnerer tomt: «null treff» og «alt er ryddet»
    // ser identiske ut nedenfra.
    expect(filer.length, "fant ingen .ts-filer under src/").toBeGreaterThan(50);
    expect(kilde).toContain("DomainRuleError");
  });

  it("⚠️ antallet generiske validation_error går bare ned", () => {
    // ⚠️ TO KILDER, IKKE ÉN. Ratsjen talte først bare `new ValidationError(`. Men 25 ruter bygger
    // svaret for hånd — `response.status(400).json({ error: "validation_error", message: … })` —
    // og de tar NØYAKTIG samme vei gjennom `api-error.js`: uten `issues` vises serverens setning
    // ordrett.
    //
    // Med bare kastene talt sto tallet på 2 og så nesten ferdig ut, mens 25 gjensto. En måling som
    // bare ser den ene halvdelen er verre enn ingen — den sier «vi er i mål» om noe som ikke er det.
    //
    // Zod-svarene (`issues` til stede) telles IKKE: de får den generiske overskriften med vilje,
    // og detaljene i detaljfeltet. Det er #996 sin avgjørelse og skal stå.
    const kastet = (kilde.match(/new ValidationError\(/g) ?? []).length;
    const direkte = kilde
      .split("\n")
      // ⚠️ KOMMENTARLINJER TELLES IKKE. Vakta talte sin egen forklaring i reports.ts, der frasen
      // står sitert. En vakt som teller prosa måler ikke oppførsel — samme feil som #1037-vakta
      // gjorde da den sto rød på sin egen kommentar.
      .filter((l) => {
        const t = l.trim();
        if (t.startsWith("//") || t.startsWith("*")) return false;
        return t.includes('error: "validation_error"') && !t.includes("issues");
      }).length;
    const antall = kastet + direkte;

    expect(
      antall,
      `Det er nå ${antall} generiske validation_error; taket er ${TAK}.\n` +
        `(${kastet} kastet, ${direkte} bygget for hånd i en rute — begge tar samme vei.)\n` +
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
    // ⚠️ AVGRENSET TIL `DomainRuleError`, OG DET ER RIKTIG SCOPE.
    //
    // Jeg utvidet den først til å ta ALLE `error: "kode"` i src. Da falt 56 koder ut som «mangler
    // tekst» — men de er maskinvendte: agent-token, signaturer, nonce, og `*_failed`-innpakninger
    // rundt interne feil. Å kreve nynorsk for `replayed_nonce` er meningsløst.
    //
    // `DomainRuleError` ER definisjonen på «en regel et menneske brøt og skal få vite om». Er en ny
    // kode brukervendt, skal den kastes som en — ikke bygges for hånd i en rute. Det var nettopp
    // det rapportkodene måtte rettes til.
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
