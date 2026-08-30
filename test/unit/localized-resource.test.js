import { describe, expect, it } from "vitest";
import { lagLokalisertRessurs } from "../../public/static/localized-resource.js";

// #1042: én modul som eier de fire tingene hver flate hadde sin egen versjon av.
//
// ⚠️ HVORFOR DEN FINNES. Feilklassen «rettet ett sted, glemte de andre» har truffet sju ganger.
// I #1027 fikk `review.js` en ordentlig språkvakt, `results.js` bare et flagg, og profilens
// FØRSTEHENTING manglet vakta oppdateringen hadde fått. Tre dybder på samme mønster.
//
// Testene her er skrevet FØR modulen, ett per ansvar.

/** Liten hjelper: en henting vi kan holde igjen og slippe når vi vil. */
function styrbarHenting() {
  const ventende = [];
  const hent = (locale) =>
    new Promise((resolve) => {
      ventende.push({ locale, resolve });
    });
  return {
    hent,
    ventende,
    /** Slipp det eldste svaret for et gitt språk. */
    slipp(locale, verdi) {
      const i = ventende.findIndex((v) => v.locale === locale);
      if (i === -1) throw new Error(`ingen ventende henting for ${locale}`);
      const [v] = ventende.splice(i, 1);
      v.resolve(verdi ?? `data-${locale}`);
    },
  };
}

function lagFlate(startspråk = "en-GB") {
  let språk = startspråk;
  const tegnet = [];
  const h = styrbarHenting();
  const ressurs = lagLokalisertRessurs({
    hentSpråk: () => språk,
    hent: h.hent,
    tegn: (data) => tegnet.push(data),
  });
  return {
    ressurs,
    tegnet,
    h,
    settSpråk(nytt) {
      språk = nytt;
    },
  };
}

describe("#1042 — lokalisert ressurs", () => {
  it("bytte FØR første last henter ingenting", async () => {
    const f = lagFlate();

    f.settSpråk("nb");
    f.ressurs.oppdaterVedSpråkbytte();
    await Promise.resolve();

    // ⚠️ Ved oppstart er lista tom. En henting her er et kall ingen har bedt om — og på
    // sensorflaten gikk et slikt kall ut før roller og token fantes (#1039).
    expect(f.h.ventende).toHaveLength(0);
    expect(f.tegnet).toHaveLength(0);
  });

  it("bytte ETTER last henter én gang, i det nye språket", async () => {
    const f = lagFlate();

    const første = f.ressurs.last();
    f.h.slipp("en-GB");
    await første;
    expect(f.tegnet).toEqual(["data-en-GB"]);

    f.settSpråk("nb");
    f.ressurs.oppdaterVedSpråkbytte();
    await Promise.resolve();

    expect(f.h.ventende).toHaveLength(1);
    expect(f.h.ventende[0].locale).toBe("nb");
    f.h.slipp("nb");
    await new Promise((r) => setTimeout(r, 0));
    expect(f.tegnet).toEqual(["data-en-GB", "data-nb"]);
  });

  it("bytte UNDER pågående last blir ikke slukt", async () => {
    const f = lagFlate();

    const første = f.ressurs.last(); // henger i en-GB
    f.settSpråk("nb");
    f.ressurs.oppdaterVedSpråkbytte();

    // Slipp det gamle svaret først — det skal ikke bli det siste ordet.
    f.h.slipp("en-GB");
    await første;
    await new Promise((r) => setTimeout(r, 0));

    // ⚠️ Uten dette ville flagget «noe er hentet» blitt satt først når lasten er FERDIG, og
    // byttet ville sett et falskt «ingenting hentet ennå». Engelsk side, norske titler, stille.
    expect(f.h.ventende.some((v) => v.locale === "nb")).toBe(true);
    f.h.slipp("nb");
    await new Promise((r) => setTimeout(r, 0));
    expect(f.tegnet.at(-1)).toBe("data-nb");
  });

  it("et TREGT svar i gammelt språk overskriver ikke det brukeren står i", async () => {
    const f = lagFlate();

    const første = f.ressurs.last();
    f.h.slipp("en-GB");
    await første;

    f.settSpråk("nb");
    f.ressurs.oppdaterVedSpråkbytte();
    await Promise.resolve();

    // Brukeren ombestemmer seg mens den norske hentingen fortsatt går.
    f.settSpråk("en-GB");
    f.ressurs.oppdaterVedSpråkbytte();
    await Promise.resolve();

    // ⚠️ Modulen SERIALISERER med vilje: den venter på den pågående norske hentingen før den
    // henter engelsk. Begge finnes derfor ikke samtidig — første utgave av denne testen antok
    // det og feilet på sin egen antakelse, ikke på koden.
    //
    // Det norske svaret lander nå, i et språk brukeren har forlatt.
    f.h.slipp("nb", "data-nb-sent");
    await new Promise((r) => setTimeout(r, 0));

    // Det skal være forkastet, ikke tegnet.
    expect(f.tegnet).not.toContain("data-nb-sent");

    // Og den etterfølgende engelske hentingen skal ha startet av seg selv.
    f.h.slipp("en-GB", "data-en-GB-2");
    await new Promise((r) => setTimeout(r, 0));

    // ⚠️ Påstanden står ETTER at taperen har landet. En kappløpstest som måler før det trege
    // svaret er inne, sier bare at det nye språket kom fram — ikke at det gamle lot være.
    expect(f.tegnet).not.toContain("data-nb-sent");
    expect(f.tegnet.at(-1)).toBe("data-en-GB-2");
  });

  it("to bytter til SAMME språk mens en henting går, gir én henting", async () => {
    const f = lagFlate();

    const første = f.ressurs.last();
    f.h.slipp("en-GB");
    await første;

    f.settSpråk("nb");
    f.ressurs.oppdaterVedSpråkbytte();
    f.ressurs.oppdaterVedSpråkbytte();
    await Promise.resolve();

    expect(f.h.ventende.filter((v) => v.locale === "nb")).toHaveLength(1);
  });

  it("en feilet henting stopper ikke senere bytter", async () => {
    let språk = "en-GB";
    const tegnet = [];
    const feil = [];
    let skalFeile = true;
    const ressurs = lagLokalisertRessurs({
      hentSpråk: () => språk,
      hent: async () => {
        if (skalFeile) throw new Error("nettverk");
        return `data-${språk}`;
      },
      tegn: (d) => tegnet.push(d),
      påFeil: (e) => feil.push(e.message),
    });

    await ressurs.last();
    expect(feil).toEqual(["nettverk"]);

    // ⚠️ Kontrollcase: uten dette ville testen vært grønn også for en modul som låser seg etter
    // første feil — «ingen henting» ser identisk ut nedenfra.
    skalFeile = false;
    språk = "nb";
    ressurs.oppdaterVedSpråkbytte();
    await new Promise((r) => setTimeout(r, 0));
    expect(tegnet).toEqual(["data-nb"]);
  });
});
