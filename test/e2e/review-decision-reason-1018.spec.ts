import { test, expect, type Page, type Route } from "@playwright/test";

// #1018: sensorens og klagebehandlerens visning av avgjørelsens begrunnelse.
//
// ⚠️ HVORFOR DENNE FINNES VED SIDEN AV ENHETSTESTENE.
//
// Enhetstestene på `decision-reason.js` prøver REGLENE: hvilken kode gir hvilken setning, hvilken
// målgruppe får hvilke ord. De kan ikke se om review.js faktisk SPØR om dem. Det var nøyaktig den
// forskjellen som bet i #982 — en e2e som målte et fjerde sted, mens de tre endrede stedene kunne
// brytes uten at noe ble rødt.
//
// ⚠️ Og den prøver én ting til som bare finnes her: sensorflaten får avgjørelsesraden RÅTT fra
// databasen, der `decisionReasonParams` er en JSON-STRENG. Deltakerflaten får den tolket. Uten
// tolkning i modulen ville «poengsummen {totalScore} ligger i …» stått på skjermen.

const REVIEW_ID = "rev-1";

const DECISION = {
  id: "dec-1",
  decisionType: "AUTOMATIC",
  passFailTotal: false,
  totalScore: 64,
  finalisedAt: "2026-08-27T10:00:00.000Z",
  decisionReason: "Routed to manual review: total score 64 is in the borderline window [60, 70].",
  decisionReasonCode: "MANUAL_REVIEW_BORDERLINE",
  // Slik databasen lagrer den: tekst, ikke objekt.
  decisionReasonParams: JSON.stringify({ totalScore: 64, min: 60, max: 70 }),
};

const REVIEW = {
  id: REVIEW_ID,
  reviewStatus: "OPEN",
  // Kopien uten kode, tatt før #950 fantes.
  triggerReason: "Routed to manual review: total score 64 is in the borderline window [60, 70].",
  reviewerId: null,
  reviewedAt: null,
  createdAt: "2026-08-27T10:00:00.000Z",
  reviewer: null,
  submission: {
    id: "sub-1",
    submittedAt: "2026-08-27T09:00:00.000Z",
    deliveryType: "text",
    response: { response: "Et svar." },
    user: { id: "u-1", name: "Kandidat", email: "k@x.no", department: "Fag" },
    module: { id: "m-1", title: "Modul 3", description: null },
    moduleVersion: { id: "mv-1" },
    mcqAttempts: [],
    llmEvaluations: [],
    decisions: [DECISION],
    appeals: [],
  },
};

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockReviewWorkspace(page: Page, locale: string) {
  await page.addInitScript((loc) => {
    try { localStorage.setItem("participant.locale", loc); } catch { /* standardspråk */ }
  }, locale);

  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { reviewer: { userId: "rev-user", email: "r@x.no", name: "Sensor", roles: ["REVIEWER"] } },
    calibrationWorkspace: { accessRoles: [] },
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "rev-user", roles: ["REVIEWER"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/reviews?**", (r: Route) => r.fulfill(json({ reviews: [REVIEW] })));
  await page.route(`**/api/reviews/${REVIEW_ID}`, (r: Route) => r.fulfill(json({ review: REVIEW })));
  await page.route("**/api/appeals**", (r: Route) => r.fulfill(json({ appeals: [] })));
}

test.describe("#1018 — sensoren leser begrunnelsen på sitt eget språk", () => {
  test("begrunnelsen vises på norsk, med tallene fylt inn fra en JSON-streng", async ({ page }) => {
    await mockReviewWorkspace(page, "nb");
    await page.goto("/review");

    const details = page.locator("#manualReviewDetails");
    await expect(details).toContainText("Sendt til vurdering");

    // ⚠️ Påstand på TALLENE, ikke bare på at det står norsk. Uten tolkning av JSON-strengen ville
    // setningen kommet ut med «{totalScore}» synlig — og «Sendt til vurdering» ville stått der like
    // fullt, så en ren språksjekk hadde vært grønn for nettopp den feilen.
    await expect(details).toContainText("64");
    await expect(details).toContainText("60");
    await expect(details).not.toContainText("{totalScore}");

    // Og serverens engelske setning skal ikke lenger stå der.
    await expect(details).not.toContainText("Routed to manual review");
  });

  test("utløseren leses fra avgjørelsen, ikke fra tekstkopien uten kode", async ({ page }) => {
    await mockReviewWorkspace(page, "nb");
    await page.goto("/review");

    const details = page.locator("#manualReviewDetails");
    // `triggerReason` er en ren engelsk tekstkopi. Vises den rått, står den engelske setningen der.
    await expect(details).not.toContainText("borderline window");
    await expect(details).toContainText("grenseområdet");
  });

  // ⚠️ Blokkeringens makker: uten denne ville «ingen engelsk» vært sant også for en side som aldri
  // rendret detaljene i det hele tatt.
  test("detaljene rendres faktisk — kontrollcase", async ({ page }) => {
    await mockReviewWorkspace(page, "nb");
    await page.goto("/review");

    const details = page.locator("#manualReviewDetails");
    await expect(details).toContainText("Modul 3");
    await expect(details).toContainText("Kandidat");
  });
});
