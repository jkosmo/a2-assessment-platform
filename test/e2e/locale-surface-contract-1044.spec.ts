import { test, expect, type Page, type Route } from "@playwright/test";

// #1044 — én kontrakt, alle flater med språkvelger.
//
// ⚠️ HVORFOR DENNE FILA FINNES. Det som gjorde #1027 dyr var ikke at fiksene var vanskelige. Det
// var at HVER FLATE måtte oppdages på nytt, én per QA-runde, over seks runder. Saken navnga tre
// flater; det var seks, pluss fire klientparsere og to søkefiltre.
//
// Her legges en ny flate til ved å utvide LISTA. Glemmer noen det, er det ÉN ting å se etter i en
// kodegjennomgang — ikke fire ting spredt utover en fil man ikke visste fantes.
//
// ⚠️ OG PUNKT 3 ER GRUNNEN TIL AT KONTRAKTEN MÅLER GLIMT, IKKE SLUTTILSTAND. Ressursen
// serialiserer: uten kappløpsvakt tegnes feil språk og deretter riktig over, så SLUTTEN er riktig
// uansett. Jeg skrev den falskt grønne varianten tre ganger i #1027 og #1042 før jeg så det.
//
// Det brukeren ser i et kappløp er glimtet.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

type Flate = {
  navn: string;
  rute: string;
  roller: string[];
  /** Beholderen innholdet tegnes i — den observeres for glimt. */
  beholder: string;
  /** Tekst som skal stå der, per språk. */
  tekst: Record<string, string>;
  /** Rutene som svarer ULIKT per språk. */
  data: Array<{ mønster: string; svar: (locale: string) => unknown }>;
  /** Ruter som ikke varierer med språk, men må finnes. */
  ekstra?: Array<{ mønster: string; svar: unknown }>;
  /** Noen flater krever et klikk før de henter. */
  forbered?: (page: Page) => Promise<void>;
};

const TITTEL: Record<string, string> = { nb: "Hendelseshåndtering", "en-GB": "Incident response" };

const FLATER: Flate[] = [
  {
    navn: "sensorkøen",
    rute: "/review",
    roller: ["REVIEWER"],
    beholder: "#manualReviewQueueBody",
    tekst: TITTEL,
    data: [{
      mønster: "**/api/reviews?**",
      svar: (locale) => ({
        reviews: [{
          id: "rev-1", reviewStatus: "OPEN", triggerReason: "manual", reviewerId: null, reviewedAt: null,
          createdAt: "2026-08-27T10:00:00.000Z", reviewer: null,
          submission: {
            id: "sub-1", submittedAt: "2026-08-27T09:00:00.000Z", deliveryType: "text",
            response: { response: "Et svar." },
            user: { id: "u-1", name: "Kandidat", email: "k@x.no", department: "Fag" },
            module: { id: "m-1", title: TITTEL[locale] ?? TITTEL["en-GB"], titleSearch: Object.values(TITTEL), description: null },
            moduleVersion: { id: "mv-1" }, mcqAttempts: [], llmEvaluations: [], decisions: [], appeals: [],
          },
        }],
      }),
    }],
    ekstra: [
      { mønster: "**/api/appeals**", svar: { appeals: [] } },
      // ⚠️ Sensorkonsollet AUTOVELGER første rad og henter detaljene. Uten denne ruta ga lastingen
      // 404 og en rød feilmelding — som er nettopp det kontraktens første punkt skal fange.
      {
        mønster: "**/api/reviews/rev-1",
        svar: {
          review: {
            id: "rev-1", reviewStatus: "OPEN", triggerReason: "manual", reviewerId: null, reviewedAt: null,
            createdAt: "2026-08-27T10:00:00.000Z", reviewer: null,
            submission: {
              id: "sub-1", submittedAt: "2026-08-27T09:00:00.000Z", deliveryType: "text",
              response: { response: "Et svar." },
              user: { id: "u-1", name: "Kandidat", email: "k@x.no", department: "Fag" },
              module: { id: "m-1", title: "Incident response", description: null },
              moduleVersion: { id: "mv-1" }, mcqAttempts: [], llmEvaluations: [], decisions: [], appeals: [],
            },
          },
        },
      },
    ],
  },
  {
    navn: "profilen",
    rute: "/profile",
    roller: [],
    beholder: "#coursesBody",
    tekst: { nb: "Viderekommen", "en-GB": "Advanced" },
    data: [{
      mønster: "**/api/courses/completions**",
      svar: (locale) => ({
        completions: [{
          courseId: "c-1", certificateId: "cert-1", completedAt: "2026-08-01T10:00:00.000Z",
          courseTitle: locale === "nb" ? "Endringsledelse" : "Change management",
          certificationLevel: locale === "nb" ? "Viderekommen" : "Advanced",
        }],
      }),
    }],
    ekstra: [{ mønster: "**/api/modules/completed**", svar: { modules: [] } }],
  },
  {
    navn: "fullførte moduler",
    rute: "/participant/completed",
    roller: [],
    beholder: "#courseCertList",
    tekst: { nb: "Viderekommen", "en-GB": "Advanced" },
    data: [{
      mønster: "**/api/courses/completions**",
      svar: (locale) => ({
        completions: [{
          courseId: "c-1", certificateId: "cert-1", completedAt: "2026-08-01T10:00:00.000Z",
          courseTitle: locale === "nb" ? "Endringsledelse" : "Change management",
          certificationLevel: locale === "nb" ? "Viderekommen" : "Advanced",
        }],
      }),
    }],
    ekstra: [{ mønster: "**/api/modules/completed**", svar: { modules: [] } }],
  },
  {
    navn: "resultatsiden",
    rute: "/results",
    roller: ["REPORT_READER"],
    beholder: "#completionBody",
    tekst: TITTEL,
    data: [
      { mønster: "**/api/reports/completion**", svar: (locale) => ({ rows: [{ moduleId: "m-1", moduleTitle: TITTEL[locale] ?? TITTEL["en-GB"], started: 3, completed: 2, passed: 2, failed: 0, underReview: 0, completionRate: 0.67 }] }) },
      { mønster: "**/api/reports/pass-rates**", svar: (locale) => ({ rows: [{ moduleId: "m-1", moduleTitle: TITTEL[locale] ?? TITTEL["en-GB"], attempts: 3, passes: 2, passRate: 0.67 }] }) },
    ],
    ekstra: [
      { mønster: "**/api/reports/courses**", svar: { rows: [] } },
      { mønster: "**/api/reports/participants**", svar: { rows: [] } },
    ],
    forbered: async (page) => { await page.click("#loadResults"); },
  },
];

async function mock(page: Page, flate: Flate, opts: { tregtSpråk?: string; tregMs?: number } = {}) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { reviewer: { userId: "u-1", email: "u@x.no", name: "Bruker", roles: flate.roller }, participant: { userId: "u-1", email: "u@x.no", name: "Bruker", roles: flate.roller } },
    calibrationWorkspace: { accessRoles: [] },
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "u-1", name: "Bruker", email: "u@x.no", roles: flate.roller },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));

  for (const e of flate.ekstra ?? []) {
    await page.route(e.mønster, (r: Route) => r.fulfill(json(e.svar)));
  }
  for (const d of flate.data) {
    await page.route(d.mønster, async (r: Route) => {
      const locale = r.request().headers()["x-locale"] ?? "en-GB";
      if (opts.tregtSpråk && locale === opts.tregtSpråk) {
        await new Promise((res) => setTimeout(res, opts.tregMs ?? 900));
      }
      return r.fulfill(json(d.svar(locale)));
    });
  }
}

/** Samler HVER tekst beholderen har hatt — ikke bare den siste. */
async function observerGlimt(page: Page, beholder: string) {
  await page.addInitScript((sel) => {
    const w = window as unknown as { __glimt: string[] };
    w.__glimt = [];
    const start = () => {
      const el = document.querySelector(sel);
      if (!el) return false;
      new MutationObserver(() => w.__glimt.push(el.textContent ?? "")).observe(el, { childList: true, subtree: true, characterData: true });
      return true;
    };
    if (!start()) document.addEventListener("DOMContentLoaded", start);
  }, beholder);
}

for (const flate of FLATER) {
  test.describe(`#1044 flatekontrakt — ${flate.navn}`, () => {
    test("lasting gir lesbar tekst, ingen rå JSON og ingen rød feilmelding", async ({ page }) => {
      await mock(page, flate);
      await page.goto(flate.rute);
      await flate.forbered?.(page);

      await expect(page.locator(flate.beholder)).toContainText(flate.tekst["en-GB"]);
      // ⚠️ Rå JSON på skjermen er det #1027 handlet om: `{"en-GB":"…"}` der det skulle stått tekst.
      await expect(page.locator(flate.beholder)).not.toContainText('"en-GB"');
      const feiltekster = await page.locator(".toast--error").allTextContents();
      expect(feiltekster, `røde feilmeldinger ved lasting: ${JSON.stringify(feiltekster)}`).toEqual([]);
    });

    test("språkbytte følges av innholdet, ikke bare av etikettene", async ({ page }) => {
      await mock(page, flate);
      await page.goto(flate.rute);
      await flate.forbered?.(page);
      await expect(page.locator(flate.beholder)).toContainText(flate.tekst["en-GB"]);

      await page.selectOption("#localeSelect", "nb");

      await expect(page.locator(flate.beholder)).toContainText(flate.tekst.nb);
      await expect(page.locator(flate.beholder)).not.toContainText(flate.tekst["en-GB"]);
    });

    test("et tregt svar i gammelt språk gir ikke et glimt av feil språk", async ({ page }) => {
      await observerGlimt(page, flate.beholder);
      await mock(page, flate, { tregtSpråk: "nb", tregMs: 900 });
      await page.goto(flate.rute);
      await flate.forbered?.(page);
      await expect(page.locator(flate.beholder)).toContainText(flate.tekst["en-GB"]);

      await page.selectOption("#localeSelect", "nb");
      await page.selectOption("#localeSelect", "en-GB");
      await page.waitForTimeout(1400);

      // ⚠️ Å måle SLUTTILSTANDEN her beviser ingenting — ressursen serialiserer, så slutten blir
      // engelsk uansett. Det er glimtet som avslører en manglende kappløpsvakt.
      const glimt = await page.evaluate(() => (window as unknown as { __glimt: string[] }).__glimt);
      expect(glimt.some((t) => t.includes(flate.tekst.nb)), `så norsk tekst i ${JSON.stringify(glimt)}`).toBe(false);
      await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    });

    // ⚠️ Fjerde punkt, og det jeg først GLEMTE å ta med — designnotatet listet fire sjekker, og
    // kontrakten hadde tre. Mutasjonstesten avslørte det: «enkeltflyt uten språk» drepte ingenting.
    //
    // Dette er saken der vakta som bare spør «pågår en henting?» slukte språkbyttet (#1027).
    test("et språkbytte UNDER første henting blir ikke slukt", async ({ page }) => {
      await mock(page, flate, { tregtSpråk: "en-GB", tregMs: 900 });
      await page.goto(flate.rute);
      await flate.forbered?.(page);

      // Byttet skjer mens den engelske hentingen fortsatt går.
      await page.selectOption("#localeSelect", "nb");

      await expect(page.locator(flate.beholder)).toContainText(flate.tekst.nb);
      await expect(page.locator(flate.beholder)).not.toContainText(flate.tekst["en-GB"]);
    });
  });
}
