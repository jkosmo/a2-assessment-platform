import { expect, test, type APIRequestContext } from "@playwright/test";

// Kontroller mot det UTRULLEDE artefaktet, ikke mot git. En feilslått build som serverer et gammelt
// bundle ser identisk ut i kildekoden — og de fleste punktene på produkteiers manuelle testliste er
// egentlig «kom endringen med?», ikke «virker den?».
//
// ⚠️ Stiene her er dyrekjøpte. På én natt bommet jeg på fire av dem:
//     /participant.js       -> 404, riktig er /static/participant.js
//     /healthz på parseren  -> 401, riktig er /health
//     /participant.html     -> 404, riktig er /participant
// Hver bom så ut som et FUNN: null treff på en grep leser som «endringen mangler». Testene under
// feiler på ikke-200 i stedet for å telle null treff i en tom respons.

const BASE = process.env.STAGE_BASE_URL
  ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";

async function fetchText(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(`${BASE}${path}`);
  expect(response.ok(), `${path} svarte ${response.status()}`).toBe(true);
  const body = await response.text();
  // Kontroll mot den stille varianten: en 200 med tom kropp ville ellers gitt null treff på alt,
  // og lest som «ingen av endringene er utrullet».
  expect(body.length, `${path} svarte 200 men tomt`).toBeGreaterThan(200);
  return body;
}

test.describe("utrullet stage — er endringene faktisk med?", () => {
  test("#929: «Avslutt kurset» og fullført-raden er i utrullet participant.js", async ({ request }) => {
    const js = await fetchText(request, "/static/participant.js");

    // Handlingen deltakeren gjør, og regelen for når den tilbys.
    expect(js).toContain("sectionReaderFinish");
    expect(js).toContain("outstandingBeforeFinish");

    // #936/#939: én definisjon av «fullført», delt av partisjonering, rad og feiring.
    expect(js).toContain("isCourseCompleted");
    expect(js).toContain("course-done-row");
    expect(js).toContain("course-group-divider");

    // ⚠️ Den stille lesemarkeringen skal bare finnes som gravskrift-kommentar. Fant vi den som
    // levende kode, ville et kursbevis igjen kunne utstedes ved å ÅPNE en side.
    const levende = js.split("\n").filter((l) => l.includes("markFinalSectionReadSilently") && !l.trim().startsWith("//"));
    expect(levende, `markFinalSectionReadSilently som levende kode:\n${levende.join("\n")}`).toEqual([]);
  });

  test("#937/#986: importfeilen er lesbar, og nynorsk er nynorsk", async ({ request }) => {
    const js = await fetchText(request, "/static/admin-content-sections.js");

    // Feilkoden slås opp lokalt — teksten kommer aldri fra serveren.
    expect(js).toContain("notAnEnvelope");
    expect(js).toContain("describeImportError");

    // Alle tre språk skal ha SIN egen tekst. Nøkkelparitet fanger ikke at innholdet er feil språk.
    expect(js).toContain('noCourses: "Not used in any course."');
    expect(js).toContain('noCourses: "Ikke brukt i noe kurs."');
    expect(js).toContain('noCourses: "Ikkje brukt i noko kurs."');
  });

  test(".hidden-fella er ikke utrullet i deltakerens markup", async ({ request }) => {
    const html = await fetchText(request, "/participant");

    // ⚠️ ARBEIDSDELING. OPPDAGELSEN hører hjemme i test/hidden-cascade-guard.test.js, som utleder
    // de display-settende klassene fra CSS-en. Denne testen sjekker bare at rettelsen KOM UT.
    //
    // Første utkast her hadde en hardkodet liste (`module-brief|row|card|content-card`) og ga fem
    // falske positive på `class="card hidden"` — `.card` setter nemlig ikke display i det hele tatt,
    // så den kombinasjonen er helt trygg. Den lokale vakta, som leser CSS-en, hadde rett.
    // (CLAUDE.md sin egen fellelist nevner `.card` og `.content-card`; ingen av dem setter display.
    // En nedskrevet liste råtner — en som utledes gjør ikke det.)
    const kjenteFikser = ['class="module-brief hidden"', 'class="module-brief-section hidden"'];
    const gjenstaar = kjenteFikser.filter((k) => html.includes(k));

    expect(
      gjenstaar,
      `Kjent .hidden-kollisjon er ikke utrullet ennå:\n${gjenstaar.join("\n")}\n`
        + "Elementet står synlig ved hver sidelast til JS-en rekker å rette det med setHidden.",
    ).toEqual([]);
  });

  test("#942: kursimport krever innlogging (vakta ligger bak den)", async ({ request }) => {
    // Selve eierskapsvakta kan ikke prøves uten en ikke-eiende SMO-sesjon; den er dekket av
    // integrasjonstester med mutasjonsverifisering. Her sjekkes bare at ruta ikke er åpen.
    const response = await request.post(`${BASE}/api/admin/content/courses/import`, {
      data: { payload: {}, mode: "createNew" },
    });
    expect(response.status(), "kursimport skal kreve innlogging").toBe(401);
  });
});
