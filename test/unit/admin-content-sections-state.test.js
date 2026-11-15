import { describe, expect, it } from "vitest";
import {
  SECTION_EDITOR_LOCALES,
  nonEmptyLocales,
  hasSavableContent,
  detectSectionRoute,
  safeReturnTo,
  sectionRevisionFields,
  showsSectionDraftLine,
} from "../../public/static/admin-content-sections-state.js";

// #524 (U1): coverage for the section editor's pure locale-validation logic. This is the class of bug
// the manual retest kept finding — most notably «empty locale → 400»: sending a locale key with an
// empty/whitespace string makes the API reject the save. nonEmptyLocales must drop those; the editor
// must refuse to save until BOTH title and body have at least one real locale.

describe("section editor locale validation (#524)", () => {
  it("exposes the three editor locales", () => {
    expect(SECTION_EDITOR_LOCALES).toEqual(["nb", "nn", "en-GB"]);
  });

  describe("nonEmptyLocales", () => {
    it("keeps only locales with real (trimmed, non-empty) content", () => {
      expect(nonEmptyLocales({ nb: "Hei", nn: "", "en-GB": "   " })).toEqual({ nb: "Hei" });
    });

    it("drops whitespace-only locales (the «empty locale → 400» guard)", () => {
      expect(nonEmptyLocales({ nb: "\n\t ", nn: "", "en-GB": "" })).toEqual({});
    });

    it("keeps all filled locales and never emits an empty string", () => {
      const result = nonEmptyLocales({ nb: "a", nn: "b", "en-GB": "c" });
      expect(result).toEqual({ nb: "a", nn: "b", "en-GB": "c" });
      expect(Object.values(result).every((v) => v.length > 0)).toBe(true);
    });

    it("tolerates missing/undefined input", () => {
      expect(nonEmptyLocales(undefined)).toEqual({});
      expect(nonEmptyLocales({})).toEqual({});
    });
  });

  describe("hasSavableContent", () => {
    it("requires at least one non-empty locale in BOTH title and body", () => {
      expect(hasSavableContent({ nb: "T" }, { nb: "B" })).toBe(true);
      expect(hasSavableContent({ nb: "T" }, { nb: "", nn: "  " })).toBe(false); // body empty
      expect(hasSavableContent({ nb: "" }, { nb: "B" })).toBe(false); // title empty
      expect(hasSavableContent({}, {})).toBe(false);
    });

    it("allows title and body to be filled in different locales (partial object is valid)", () => {
      expect(hasSavableContent({ nb: "Tittel" }, { "en-GB": "Body" })).toBe(true);
    });
  });

  describe("detectSectionRoute", () => {
    it("routes ?new to a blank editor", () => {
      // ⚠️ #1052: `returnTo` er en del av formen nå. At disse tre brakk er vakta som virker —
      // en ny nøkkel i en rute som styrer navigasjon skal ikke gli inn ubemerket.
      expect(detectSectionRoute("?new")).toEqual({ view: "editor", sectionId: null, returnTo: null });
    });

    it("routes ?id=… to the editor for that section", () => {
      expect(detectSectionRoute("?id=sec-123")).toEqual({ view: "editor", sectionId: "sec-123", returnTo: null });
    });

    it("routes an empty/unknown query to the list", () => {
      expect(detectSectionRoute("")).toEqual({ view: "list", returnTo: null });
      expect(detectSectionRoute("?foo=bar")).toEqual({ view: "list", returnTo: null });
      expect(detectSectionRoute(undefined)).toEqual({ view: "list", returnTo: null });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #1052: «Tilbake» skal føre dit du kom fra — og bare dit.
//
// ⚠️ SAKEN ER VERRE PÅ DEN ENE VEIEN INN. Kursets elementliste åpner elementet med `target="_blank"`.
// I en fersk fane finnes ingen nettleserhistorikk, så appens egen «Tilbake» er det ENESTE som
// finnes — og den gikk til seksjonslista. Forfatteren sto igjen uten vei tilbake til kurset.
//
// ⚠️ OG EN ÅPEN OMDIRIGERING ER DET LETTESTE Å GJØRE FEIL. `returnTo` kommer fra URL-en, altså fra
// hvem som helst som får en forfatter til å klikke. Uten kontroll ville vår egen tilbakeknapp blitt
// et phishing-hopp fra en side hen stoler på.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1052 — safeReturnTo slipper bare interne stier gjennom", () => {
  it("⚠️ godtar en sti under /admin-content/", () => {
    expect(safeReturnTo("/admin-content/courses/abc123")).toBe("/admin-content/courses/abc123");
  });

  it("⚠️ avviser en absolutt URL til en annen vert", () => {
    expect(safeReturnTo("https://ondsinnet.example/logg-inn")).toBeNull();
    expect(safeReturnTo("http://ondsinnet.example")).toBeNull();
  });

  it("⚠️ avviser `//vert`, som SER relativ ut men forlater siden", () => {
    // Den starter med `/`, så en sjekk på «starter med skråstrek» alene ville sluppet den gjennom.
    // Nettleseren leser den som protokollrelativ og går til ondsinnet.example.
    expect(safeReturnTo("//ondsinnet.example/logg-inn")).toBeNull();
    expect(safeReturnTo("/\ondsinnet.example")).toBeNull();
  });

  it("avviser javascript: og andre skjemaer", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBeNull();
    expect(safeReturnTo("data:text/html,<script>")).toBeNull();
  });

  it("⚠️ avviser en sti som SER intern ut men løses ut av forfatterflaten", () => {
    // ⚠️ MUTASJONSTESTING FANT DENNE, IKKE LESING. Min første utgave hadde en sjekk mot
    // protokollrelative stier med en selvsikker kommentar om at den var nødvendig — men den var
    // død kode, siden prefikssjekken allerede avviste alt slikt. Da jeg fjernet den, ble ingen
    // test rød.
    //
    // Den ekte veien ut sto åpen: dette består `startsWith("/admin-content/")`, og nettleseren
    // løser det til `/evil`. En sjekk på hva strengen SER UT SOM er ikke en sjekk på hva
    // nettleseren GJØR med den.
    expect(safeReturnTo("/admin-content/../../evil")).toBeNull();
    expect(safeReturnTo("/admin-content/../login")).toBeNull();
    // Kodede segmenter løses ikke av URL(), så de må avvises for seg.
    expect(safeReturnTo("/admin-content/..%2f..%2fevil")).toBeNull();
  });

  it("⚠️ men en ekte, dyp sti under forfatterflaten slipper fortsatt gjennom — kontrollcase", () => {
    // Blokkeringens makker. Uten denne kunne valideringen blitt så streng at INGEN returnTo virket,
    // og alle testene over ville sett like grønne ut mens funksjonen var ubrukelig.
    expect(safeReturnTo("/admin-content/courses/abc123")).toBe("/admin-content/courses/abc123");
    expect(safeReturnTo("/admin-content/module/m1/conversation")).toBe("/admin-content/module/m1/conversation");
  });

  it("avviser interne stier UTENFOR forfatterflaten", () => {
    // ⚠️ Hviteliste, ikke svarteliste. `/participant` er vår egen side, men den er ikke et sted en
    // «Tilbake» fra en seksjon skal kunne sende noen — og listen skal være kort nok til å lese.
    expect(safeReturnTo("/participant")).toBeNull();
    expect(safeReturnTo("/admin-contentX/noe")).toBeNull();
  });

  it("tomt og manglende gir null", () => {
    expect(safeReturnTo("")).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
  });
});

describe("#1052 — ruten bærer returnTo videre", () => {
  it("⚠️ i redigeringsvisningen, som er der tilbakeknappen står", () => {
    const r = detectSectionRoute("?id=sec1&returnTo=%2Fadmin-content%2Fcourses%2Fk1");
    expect(r.view).toBe("editor");
    expect(r.sectionId).toBe("sec1");
    expect(r.returnTo).toBe("/admin-content/courses/k1");
  });

  it("⚠️ og en ugyldig returnTo faller til null — ruten ellers er urørt", () => {
    // Kontrollcase: uten dette kunne valideringen ha ødelagt selve rutingen, og testen over
    // ville ikke merket det.
    const r = detectSectionRoute("?id=sec1&returnTo=https%3A%2F%2Fondsinnet.example");
    expect(r.view).toBe("editor");
    expect(r.sectionId, "ruten skal fortsatt finne seksjonen").toBe("sec1");
    expect(r.returnTo).toBeNull();
  });

  it("uten returnTo er den null, ikke undefined", () => {
    expect(detectSectionRoute("?id=sec1").returnTo).toBeNull();
    expect(detectSectionRoute("").returnTo).toBeNull();
  });
});

// #1163: det redigereren tar vare på fra en seksjonsdetalj — det fanen så (sendes med ved lagring og publisering) og det
// deltakerne ser (stripen).
describe("#1163 — revisjonen og stripen i seksjonsredigereren", () => {
  it("tar versjonen, den rå tittelen og det deltakerne ser fra detaljen", () => {
    const detail = { versionNo: 3, title: '{"nb":"A"}', publishedVersionNo: 2, draftSavedAt: "2026-11-15T10:00:00.000Z" };
    expect(sectionRevisionFields(detail)).toEqual({ versionNo: 3, loadedTitle: '{"nb":"A"}', publishedVersionNo: 2, draftSavedAt: "2026-11-15T10:00:00.000Z" });
  });

  it("et felt svaret ikke har, står som før — men et felt som er null, er null", () => {
    const før = { versionNo: 3, loadedTitle: "T", publishedVersionNo: 2, draftSavedAt: "x" };
    // Publiseringens svar: ingen tittel og ikke noe utkast.
    expect(sectionRevisionFields({ versionNo: 3, publishedVersionNo: 3, draftSavedAt: null }, før)).toEqual({ versionNo: 3, loadedTitle: "T", publishedVersionNo: 3, draftSavedAt: null });
    expect(sectionRevisionFields({}, før)).toEqual(før);
  });

  it("stripen står bare for en publisert seksjon med et utkast over, når versjonen deltakerne ser er kjent", () => {
    expect(showsSectionDraftLine({ published: true, hasUnpublishedChanges: true, publishedVersionNo: 1 })).toBe(true);
    // Kontroller: ingen utkast; aldri publisert; ukjent versjon.
    expect(showsSectionDraftLine({ published: true, hasUnpublishedChanges: false, publishedVersionNo: 1 })).toBe(false);
    expect(showsSectionDraftLine({ published: false, hasUnpublishedChanges: true, publishedVersionNo: 1 })).toBe(false);
    expect(showsSectionDraftLine({ published: true, hasUnpublishedChanges: true, publishedVersionNo: null })).toBe(false);
  });
});
