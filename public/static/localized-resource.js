/**
 * #1042 — én modul for «hent på nytt når språket byttes».
 *
 * ⚠️ HVORFOR DENNE FINNES. Serveren eier hvilket språk innhold vises på, og svarer på det når data
 * HENTES (#1027). Hver flate måtte derfor hente på nytt ved språkbytte — og hver flate fikk sin
 * egen håndlagde versjon av det. I #1027 endte det med tre ulike dybder på samme mønster:
 * `review.js` fikk en ordentlig språkvakt, `results.js` bare et flagg, og profilens FØRSTEHENTING
 * manglet vakta oppdateringen hadde fått.
 *
 * Feilklassen «rettet ett sted, glemte de andre» har truffet sju ganger. Den forsvinner ikke med
 * mer disiplin — arkitekturen krevde at samme mønster ble skrevet på nytt for hver flate.
 *
 * Modulen eier fire ting, og ingen flate skal implementere dem selv:
 *
 *   1. Ny henting BARE når noe faktisk er hentet
 *   2. Kappløpsvakt: et svar i feil språk forkastes
 *   3. Enkeltflyt nøklet på SPRÅK, ikke bare «en henting pågår»
 *   4. `setLocale` forblir uten bivirkning — den som BYTTER språk henter
 *
 * ⚠️ Punkt 4 er ikke stil. En henting inne i `setLocale` fyrer også ved oppstart, før roller og
 * token finnes. Det var #1039: 401 og rød feilmelding ved hver lasting av `/review`, for alle.
 *
 * @param {object} opts
 * @param {() => string} opts.hentSpråk  leser flatens gjeldende språk ved kalltid
 * @param {(locale: string) => Promise<unknown>} opts.hent
 * @param {(data: unknown) => void} opts.tegn
 * @param {(error: unknown) => void} [opts.påFeil]
 */
export function lagLokalisertRessurs({ hentSpråk, hent, tegn, påFeil }) {
  let harHentet = false;
  let pågående = null;
  let pågåendeSpråk = null;

  async function kjør(språk) {
    try {
      const data = await hent(språk);
      // ⚠️ Kappløpsvakta. Uten den vinner svaret som lander SIST, ikke språket brukeren står i:
      // bytt til nb (tregt svar), bytt raskt tilbake — og det norske svaret overskriver.
      if (hentSpråk() !== språk) return;
      tegn(data);
    } catch (error) {
      if (påFeil) påFeil(error);
      // ⚠️ Feilen skal ikke låse ressursen. Uten dette ville en enkelt nettverksfeil gjort at
      // senere språkbytter aldri hentet igjen — og «ingen henting» ser identisk ut med «alt i
      // orden» nedenfra.
    }
  }

  async function start() {
    const språk = hentSpråk();

    // ⚠️ Enkeltflyt nøklet på SPRÅK. En pågående henting kan gjenbrukes for samme språk, men aldri
    // for et annet: serveren baker inn språket ved henting, så to hentinger i ulike språk er ikke
    // like — selv om de spør etter samme rapport.
    //
    // Vakta som bare spurte «pågår en henting?» slukte språkbytter i #1027.
    if (pågående) {
      if (pågåendeSpråk === språk) return pågående;
      return pågående.then(() => start());
    }

    // Settes når hentingen STARTER, ikke når den er ferdig. Med den ved ferdigstillelse ville et
    // bytte midt i den aller første hentingen blitt slukt — flaten så et falskt «ingenting hentet
    // ennå» og lot være å hente på nytt.
    harHentet = true;
    pågåendeSpråk = språk;
    pågående = kjør(språk);
    try {
      return await pågående;
    } finally {
      pågående = null;
      pågåendeSpråk = null;
    }
  }

  return {
    /** Første henting, og enhver eksplisitt «hent på nytt» fra flaten. */
    last: start,

    /**
     * Kalles fra lytteren på språkvelgeren — aldri fra `setLocale`.
     *
     * Gjør ingenting før noe faktisk er hentet: ved oppstart er lista tom, og et kall der er et
     * kall ingen har bedt om.
     */
    oppdaterVedSpråkbytte() {
      if (!harHentet) return;
      void start();
    },

    /** Til tester og til flater som må vite om noe er lastet (f.eks. for en tomtilstand). */
    erLastet: () => harHentet,
  };
}
