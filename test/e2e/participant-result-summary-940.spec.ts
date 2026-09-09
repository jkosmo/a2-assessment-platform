import { test, expect, type Page, type Route } from "@playwright/test";

// #940: resultatskjermen, kjørt gjennom den EKTE participant.js i Chromium.
//
// ⚠️ Hvorfor denne finnes ved siden av enhetstestene på result-summary.js.
//
// Enhetstestene prøver REGLENE: hvilket utfall, hvilken overskrift, hvilke rader. De kan ikke se om
// participant.js faktisk spør om dem. Nøyaktig den forskjellen bet i #982: jeg skrev en e2e som
// målte et FJERDE sted, fjernet oppførselen fra alle tre stedene jeg hadde endret, og testen forble
// grønn. Derfor kjøres bundlen her.
//
// Tilstandene som IKKE er dekket av participant-mcq-only.spec.ts (bestått, og de tre modultypene):
// ikke bestått, til manuell vurdering, og at «Vis detaljer» huskes.

async function mockBase(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
        },
        calibrationWorkspace: { accessRoles: [] },
        flow: { autoStartAfterMcq: false },
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            id: "m-mcq", title: "MCQ Modul", description: null, assessmentMode: "MCQ_ONLY",
            submissionSchema: null, assessmentPolicy: null, taskText: null,
            activeVersion: { versionNo: 1 }, participantStatus: null,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål 1", options: ["A", "B"] }] }),
    }),
  );
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

function resultBody(overrides: Record<string, unknown>) {
  return {
    submissionId: "cmt1wuwvq0013qqfi4tk4vsxu",
    status: "COMPLETED",
    assessmentMode: "MCQ_ONLY",
    decision: { passFailTotal: true, decisionType: "AUTOMATIC" },
    scoreComponents: { totalScore: 30, mcqScaledScore: 30, mcqPercentScore: 100, practicalScaledScore: 0 },
    requirement: { mcqMinPercent: 80, totalMin: null, practicalMinPercent: null },
    participantGuidance: { decisionReason: null, decisionReasonCode: null, decisionReasonParams: {}, confidenceNote: null },
    ...overrides,
  };
}

async function showResult(page: Page, body: Record<string, unknown>) {
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();
  return page.locator("#resultSummary");
}

/**
 * Minst én BRUKBAR vei videre. Påstanden er på antallet, ikke på én bestemt knapp — det er
 * dødlåsen som er feilen, ikke hvilken knapp som mangler.
 *
 * ⚠️ `isEnabled` teller med: en synlig, deaktivert knapp er ingen vei videre.
 */
async function expectAWayForward(page: Page) {
  const controls = ["#queueAssessment", "#checkAssessment", "#checkResult", "#resetSubmissionFlow"];
  const usable: string[] = [];
  for (const id of controls) {
    const locator = page.locator(id);
    if ((await locator.isVisible()) && (await locator.isEnabled())) usable.push(id);
  }
  expect(usable.length, `ingen vei videre: ${controls.join(", ")} er alle skjult eller deaktivert`).toBeGreaterThan(0);
}

const FAILED = resultBody({
  decision: { passFailTotal: false, decisionType: "AUTOMATIC" },
  scoreComponents: { totalScore: 18, mcqScaledScore: 18, mcqPercentScore: 60, practicalScaledScore: 0 },
  participantGuidance: {
    decisionReason: "Automatic fail: MCQ score 60% is below the required minimum of 80%.",
    decisionReasonCode: "MCQ_ONLY_FAIL",
    decisionReasonParams: { scorePercent: 60, minPercent: 80 },
    confidenceNote: null,
  },
});

const UNDER_REVIEW = resultBody({
  status: "UNDER_REVIEW",
  decision: { passFailTotal: false, decisionType: "AUTOMATIC" },
  participantGuidance: {
    decisionReason: "Routed to manual review: total score 64 is in the borderline window [60, 70].",
    decisionReasonCode: "MANUAL_REVIEW_BORDERLINE",
    decisionReasonParams: { totalScore: 64, min: 60, max: 70 },
    confidenceNote: null,
  },
});

test.describe("#940 — utfallet avgjør hva som står åpent", () => {
  // ⚠️ DEN VIKTIGSTE. Strøk du, er begrunnelsen selve svaret og skal stå åpent. Bestod du, er den en
  // detalj. Testen krever begge retninger — bare den ene ville vært grønn for en skjerm som alltid
  // viser begrunnelsen, som er den gamle oppførselen.
  test("begrunnelsen står åpent når du ikke bestod, og bak detaljene når du bestod", async ({ page }) => {
    await mockBase(page);
    const failed = await showResult(page, FAILED);

    await expect(failed.locator(".result-headline")).toContainText("Ikke bestått");
    const openReason = failed.locator(".result-open");
    await expect(openReason).toContainText("Ikke bestått: du fikk 60 %");
    // Åpen betyr synlig UTEN å klikke — en rad inne i en lukket <details> ville også «finnes».
    await expect(openReason).toBeVisible();
  });

  test("bestått viser begrunnelsen først når detaljene åpnes", async ({ page }) => {
    await mockBase(page);
    const passed = await showResult(page, resultBody({
      participantGuidance: {
        decisionReason: "Automatic pass: MCQ score 100% meets the required minimum of 80%.",
        decisionReasonCode: "MCQ_ONLY_PASS",
        decisionReasonParams: { scorePercent: 100, minPercent: 80 },
        confidenceNote: null,
      },
    }));

    await expect(passed.locator(".result-headline")).toContainText("Bestått — 100 %");
    await expect(passed.locator(".result-open")).toHaveCount(0);

    const details = passed.locator(".result-details");
    await expect(details.locator(".summary-value").first()).toBeHidden();
    await details.locator("summary").click();
    await expect(details).toContainText("Bestått: du fikk 100 %");
  });

  // Denne beskjeden fantes ikke i det hele tatt før #940. «Avgjørelse: Sendt til manuell vurdering»
  // sto som én rad blant sju likestilte, og det som betyr noe — at du ikke skal gjøre noe, og at du
  // får beskjed — sto ingen steder.
  test("den som venter på en sensor får vite at hen ikke skal gjøre noe", async ({ page }) => {
    await mockBase(page);
    const review = await showResult(page, UNDER_REVIEW);

    const headline = review.locator(".result-headline");
    await expect(headline).toContainText("En sensor ser på besvarelsen din");
    await expect(headline).toContainText("Du får e-post");
    // ⚠️ Og ikke «Ikke bestått», selv om passFailTotal er false. Det er #978-invarianten.
    await expect(headline).not.toContainText("Ikke bestått");
    await expect(review.locator(".result-open")).toContainText("grenseområdet");
  });

  // ⚠️ QA-porten runde 3: overskrifta gikk utenom tallformateringen, så en norsk deltaker så
  // «66.67 %» med PUNKTUM mens delpoengene på SAMME underlinje sto med komma. Det rammer enhver
  // flervalgsmodul der antall spørsmål ikke går opp i 100 — altså de fleste.
  test("tallene i overskrifta skrives på deltakerens språk, ikke med punktum", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, resultBody({
      decision: { passFailTotal: false, decisionType: "AUTOMATIC" },
      scoreComponents: { totalScore: 20, mcqScaledScore: 20, mcqPercentScore: 66.66666, practicalScaledScore: 0 },
      requirement: { mcqMinPercent: 70.5, totalMin: null, practicalMinPercent: null },
      participantGuidance: {
        decisionReason: "Automatic fail: MCQ score 66.67% is below the required minimum of 70.5%.",
        decisionReasonCode: "MCQ_ONLY_FAIL",
        decisionReasonParams: { scorePercent: 66.66666, minPercent: 70.5 },
        confidenceNote: null,
      },
    }));

    const headline = result.locator(".result-headline");
    await expect(headline).toContainText("66,67");
    await expect(headline).toContainText("70,5");
    // Blokkeringens makker: uten denne ville testen vært grønn for en overskrift som ikke viste
    // tallene i det hele tatt.
    await expect(headline).toContainText("Ikke bestått");
    await expect(headline).not.toContainText("66.67");

    // ⚠️ Og BEGRUNNELSEN under skal skrive samme tall på samme måte. QA-porten runde 6 så «66,67 %»
    // i overskrifta og «66.67 %» i begrunnelsen — to skrivemåter for samme tall, på samme kort.
    // Begrunnelsen står ÅPENT for en stryk — det er hele poenget med den tilstanden.
    const reason = result.locator(".result-open");
    await expect(reason).toContainText("Ikke bestått: du fikk 66,67 %");
    await expect(reason).not.toContainText("66.67");
  });

  // ⚠️ «Vis detaljer» sier det samme enten panelet er åpent eller lukket. En seende bruker ser pila
  // snu; en skjermleserbruker hører bare det samme igjen.
  test("etiketten på «Vis detaljer» forteller hva et klikk vil gjøre", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, FAILED);
    await expect(result.locator(".result-headline")).toContainText("Ikke bestått");

    const summary = result.locator(".result-details summary");
    await expect(summary).toHaveAttribute("aria-label", "Vis detaljer");

    await summary.click();
    await expect(summary).toHaveAttribute("aria-label", "Skjul detaljer");

    await summary.click();
    await expect(summary).toHaveAttribute("aria-label", "Vis detaljer");
  });

  // ⚠️ Funnet ved å SE på den ekte siden: under «Ingenting mer å gjøre nå» sto den røde
  // «Slett innlevering»-knappen og ropte høyest på skjermen. Den motsier beskjeden, og et nytt
  // forsøk er ikke mulig mens en sensor har saken.
  //
  // Regelen er nå: fremtredende BARE etter en avgjort stryk, der et nytt forsøk faktisk er neste
  // steg. Testen krever begge retninger — én av dem alene ville vært grønn for en knapp som alltid
  // ser lik ut.
  test("«start på nytt» roper bare når et nytt forsøk er neste steg", async ({ page }) => {
    await mockBase(page);

    const failed = await showResult(page, FAILED);
    await expect(failed.locator(".result-headline")).toContainText("Ikke bestått");
    await expect(page.locator("#resetSubmissionFlow")).not.toHaveClass(/reset-flow-discreet/);

    const review = await showResult(page, UNDER_REVIEW);
    await expect(review.locator(".result-headline")).toContainText("En sensor");
    await expect(page.locator("#resetSubmissionFlow")).toHaveClass(/reset-flow-discreet/);
  });

  // ⚠️ #1019: konfidensraden gjettet tidligere på delstrenger i språkmodellens engelske frittekst.
  // Serveren sender nå nivået, og `null` når det ikke er noe forbehold. Testen krever BEGGE
  // retninger — bare den ene ville vært grønn for en rad som aldri vises, eller alltid vises.
  test("forbeholdet vises på norsk når det finnes, og ikke i det hele tatt når det ikke gjør det", async ({ page }) => {
    await mockBase(page);

    const withCaveat = await showResult(page, resultBody({
      participantGuidance: {
        decisionReason: null, decisionReasonCode: null, decisionReasonParams: {},
        // Fritteksten er fortsatt engelsk fra modellen — poenget er at den IKKE lenger vises.
        confidenceNote: "Low confidence due to sparse content; assessment is based on partial evidence.",
        confidenceLevel: "low",
      },
    }));
    await withCaveat.locator(".result-details summary").click();
    // #1019: setningen er ÅRSAKSNØYTRAL. Den gamle sa «på grunn av lite innhold» — en grunn
    // dataene ikke inneholder, og som QA-porten fant at vi dermed diktet opp.
    await expect(withCaveat).toContainText("lav sikkerhet");
    await expect(withCaveat).not.toContainText("Low confidence");
    await expect(withCaveat).not.toContainText("lite innhold");

    const without = await showResult(page, resultBody({
      participantGuidance: {
        decisionReason: null, decisionReasonCode: null, decisionReasonParams: {},
        confidenceNote: "High confidence: structured and sufficiently detailed submission.",
        confidenceLevel: null,
      },
    }));
    await without.locator(".result-details summary").click();
    await expect(without.locator(".result-headline")).toContainText("Bestått");
    await expect(without).not.toContainText("Konfidensnotat");
    await expect(without).not.toContainText("High confidence");
  });

  test("forsøks-ID-en er flyttet bak detaljene, ikke fjernet", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, FAILED);

    await expect(result.locator(".result-open")).not.toContainText("cmt1wuwvq");
    await result.locator(".result-details summary").click();
    await expect(result.locator(".result-details")).toContainText("cmt1wuwvq0013qqfi4tk4vsxu");
  });

  // ⚠️ DENNE VAR FALSKT GRØNN, og QA-porten runde 4 fant det. Fiksturet var et BESTÅTT resultat, og
  // for et avgjort utfall planlegges poengradene aldri — testen kunne ikke nå påstanden sin.
  //
  // Strekene levde i VENTE-tilstandene, bak «Vis detaljer»: «Total poengsum –», «MCQ-poeng –»,
  // «Beslutning Ukjent». Og siden utfellingen huskes, så en deltaker som hadde åpnet detaljene før,
  // dette uten å klikke.
  //
  // Testen kjører derfor begge: den tilstanden som PLANLEGGER poengrader, og den avgjorte.
  for (const [navn, body] of [
    ["behandles, uten tall ennå", resultBody({
      status: "PROCESSING",
      decision: null,
      scoreComponents: { totalScore: null, mcqScaledScore: null, mcqPercentScore: null, practicalScaledScore: null },
    })],
    ["bestått", resultBody({})],
  ] as const) {
    test(`rader uten innhold finnes ikke — ingen «–» som bruker plass (${navn})`, async ({ page }) => {
      await mockBase(page);
      const result = await showResult(page, body);

      await expect(result.locator(".result-headline")).not.toBeEmpty();
      const details = result.locator(".result-details");
      if (await details.count()) await details.locator("summary").click();

      await expect(result).not.toContainText("Konfidensnotat");
      const dashes = await result.locator(".summary-value").evaluateAll(
        (nodes) => nodes.filter((n) => (n.textContent ?? "").trim() === "-").map((n) => n.previousElementSibling?.textContent ?? "?"),
      );
      expect(dashes, `strek-rader: ${dashes.join(", ")}`).toEqual([]);
      // «Ukjent» er samme sak i ord: en rad som bruker plass på å si at den er tom.
      await expect(result).not.toContainText("Ukjent");
    });
  }

  test("«Vis detaljer» huskes til neste resultat", async ({ page }) => {
    await mockBase(page);
    const first = await showResult(page, FAILED);
    // ⚠️ Vent på at KORTET er der før detaljene måles. Uten dette treffer påstanden mellom to
    // rendringer, og feiler ujevnt — en test som feiler av og til lærer leseren å se bort fra rødt.
    await expect(first.locator(".result-headline")).toContainText("Ikke bestått");
    await expect(first.locator(".result-details")).not.toHaveAttribute("open", /.*/);

    await first.locator(".result-details summary").click();
    await expect(first.locator(".result-details")).toHaveAttribute("open", /.*/);

    // ⚠️ Vent på at valget er SKREVET, ikke bare på at panelet åpnet seg. Åpningen er en DOM-endring
    // som skjer med én gang; lagringen er en egen hendelse. Navigerer testen imellom, måler den at
    // valget ikke overlevde — og det ville vært en påstand om produktet basert på testens egen
    // timing. QA-porten runde 5 målte nettopp det: grønn alene, rød når fila kjøres samlet.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("participant.resultDetailsOpen")))
      .toBe("true");

    // Ny lasting av siden: valget skal ha overlevd.
    const second = await showResult(page, FAILED);
    await expect(second.locator(".result-headline")).toContainText("Ikke bestått");
    await expect(second.locator(".result-details")).toHaveAttribute("open", /.*/);
  });
});

// ── De åtte elementene ──────────────────────────────────────────────────────────────────────────
//
// ⚠️ DENNE TESTEN FINNES FORDI FRAVÆRET AV DEN KOSTET EN HEL RUNDE.
//
// Saken lister åtte elementer som skal bort. Første forsøk byttet ut innholdet i resultatkortet og
// lot flyten rundt stå — SEKS av de åtte overlevde, og alle enhetstestene og e2e-ene var grønne.
// De målte kortet; elementene lå utenfor det.
//
// Testen går derfor gjennom sakens liste ORDRETT, mot hele siden, ikke mot kortet. Legges det til
// et niende element som skal bort, hører det hjemme her.
// Sakens liste, ordrett, som data — slik at begge retningene måler NØYAKTIG de samme åtte.
// Legges det til et niende element som skal bort, hører det hjemme her.
const HIDDEN_WHEN_SETTLED = {
  "1 forsøks-ID": "#attemptIdLine",
  "2 innleverings-ID": "#submissionIdLine",
  "3 Sjekk framdrift": "#checkAssessment",
  "4 hintet som forklarer den": "#checkAssessmentHint",
  "5 Vurderingshandlinger er tilgjengelige": "#assessmentGateHint",
  "6 Vurdering er ferdig": "#assessmentProgressStatus",
  "7 Vis resultat": "#checkResult",
  "8 Resultatoppsummering:": "#resultSummaryLabel",
};

test.describe("#940 — de åtte elementene fra saken", () => {
  test("alle åtte er borte fra skjermen når resultatet står der", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, FAILED);
    await expect(result.locator(".result-headline")).toContainText("Ikke bestått");

    // Blokkeringens makker: uten denne ville «alt er skjult» også vært sant for en side som aldri
    // rendret vurderingsseksjonen i det hele tatt.
    await expect(page.locator("#assessmentSection")).toBeVisible();
    await expect(page.locator("#resetSubmissionFlow")).toBeVisible();

    // ⚠️ `toHaveCount(1)` FØR hver skjul-påstand. `toBeHidden()` er også sant for et element som
    // ikke finnes, og `applyResultChrome` hopper stille over null-noder — så en omdøpt id i
    // participant.html ville gitt en synlig knapp og en grønn test. QA-porten fant nettopp det.
    for (const [nr, id] of Object.entries(HIDDEN_WHEN_SETTLED)) {
      await expect(page.locator(id), `element ${nr} (${id}) finnes ikke — er id-en døpt om?`).toHaveCount(1);
      await expect(page.locator(id), `element ${nr} (${id}) skulle vært skjult`).toBeHidden();
    }
  });

  // ⚠️ DENNE TESTEN VOKTER EN DØDLÅS SOM FAKTISK BLE INNFØRT, og som QA-porten målte i Chromium.
  //
  // Et resultat som fortsatt BEHANDLES rendrer også et kort. Første utkast nøklet skjulingen på
  // «står det et kort der», og skjulte da «Start vurdering», «Sjekk framdrift» og «Vis resultat» —
  // samtidig som «Slett innlevering og start på nytt» er skjult av gatingen fordi statusen ikke er
  // ferdig. Null kontroller igjen, og ingen vei videre.
  //
  // Veien inn er ikke eksotisk: autoløkka gir opp etter 90 sekunder, som er vanlig LLM-tid på en
  // delt B1-instans, og deltakeren klikker «Vis resultat».
  test("et resultat som fortsatt behandles låser ikke deltakeren ute", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, resultBody({
      status: "PROCESSING",
      decision: null,
      scoreComponents: { totalScore: null, mcqScaledScore: null, mcqPercentScore: null, practicalScaledScore: null },
    }));

    await expect(result.locator(".result-headline")).toContainText("blir vurdert");

    // Minst én vei videre må finnes. Påstanden er på ANTALLET synlige kontroller, ikke på én
    // bestemt knapp — det er dødlåsen som er feilen, ikke hvilken knapp som mangler.
    await expectAWayForward(page);
  });

  // ⚠️ Samme felle, en annen dør: en AVGJORT status uten vedtak. Ingen kodesti skriver REJECTED i
  // dag (#953), men «unknown»-grenen er ny kode, og et utfall vi ikke kjenner skal ikke rydde bort
  // deltakerens siste vei ut.
  test("en avgjort status uten vedtak låser heller ikke deltakeren ute", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, resultBody({ status: "REJECTED", decision: null }));

    await expect(result.locator(".result-headline")).toBeVisible();
    await expectAWayForward(page);
  });

  // ⚠️ Motsatt retning, og den er ikke pynt: skjules kontrollene for godt, kan ingen starte et nytt
  // forsøk etterpå. Det ville vært en verre feil enn den vi rettet.
  //
  // Turen går gjennom «Slett innlevering og start på nytt» — den ekte veien tilbake — og krever at
  // hvert av de skjulte elementene faktisk kommer igjen.
  test("kontrollene kommer tilbake når resultatet forsvinner", async ({ page }) => {
    await mockBase(page);
    const result = await showResult(page, FAILED);
    await expect(result.locator(".result-headline")).toContainText("Ikke bestått");
    await expect(page.locator("#checkResult")).toBeHidden();

    await page.locator("#resetSubmissionFlow").click();

    for (const [nr, id] of Object.entries(HIDDEN_WHEN_SETTLED)) {
      await expect(page.locator(id), `element ${nr} (${id}) kom ikke tilbake`).not.toHaveAttribute("hidden", /.*/);
    }
  });
});
