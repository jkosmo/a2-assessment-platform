import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

// Prod 2.154.0 (2026-11-12): en forfatter åpnet en publisert modul, gikk til Innstillinger, krysset
// av «Vis deltakeren hvilke svar som ble feil …», og «Lagre» i hodet gjorde INGENTING — ingen melding,
// ikke noe kall til tjeneren.
//
// Årsaken: siden åpner i Rediger, og fanebyttet til Innstillinger legger skjemaet i `sessionDraft`
// når `editFormSnapshot().changed` er sant. For spørsmål av typene «flere riktige», «sett i
// rekkefølge» og «fyll inn» var den ALLTID sann uten at noe var endret: skjemaet leser spørsmålet
// tilbake med nøklene i en annen rekkefølge enn det ble tegnet med, og sammenligningen var
// JSON.stringify. Med et utkast tegner Innstillinger ingen «Lagre»-knapp (#settingsSave), og hodets
// «Lagre» klikket en knapp som ikke fantes.

const A = localizedText("Purpose");
const B = localizedText("Colour");
const C = localizedText("Legal basis");
const D = localizedText("Font");

type Q = Record<string, unknown>;
const single: Q = { stem: localizedText("Which one?"), options: [A, B, C, D], correctAnswer: B, rationale: localizedText("Because") };
const multiple: Q = { questionType: "multiple", stem: localizedText("Which ones?"), options: [A, B, C, D], correctAnswers: [A, C], correctAnswer: A, rationale: localizedText("Art. 30") };
const order: Q = { questionType: "order", stem: localizedText("Put in order"), options: [A, B, C], correctAnswer: A, rationale: localizedText("Steps") };
const fill: Q = {
  questionType: "fill",
  stem: { "en-GB": "The ___ must be stated (EN)", nb: "___ må oppgis (NB)", nn: "___ må oppgjevast (NN)" },
  options: [A],
  correctAnswer: A,
  rationale: localizedText("Art. 30"),
};

// Fritekst lagret slik tjeneren kan ha det, men som et tekstfelt aldri gir tilbake: linjeskift og
// mellomrom til slutt (skjemaet trimmer), og CRLF (et <textarea> gir alltid LF).
const trailingNewlineTask = { "en-GB": "Scenario (EN)\n\n", nb: "Scenario (NB)\n\n", nn: "Scenario (NN)\n\n" };
const crlfGuidance = { "en-GB": "Line one\r\nLine two (EN)", nb: "Linje en\r\nLinje to (NB)", nn: "Linje ein\r\nLinje to (NN)" };
const stemWithTrailingSpace: Q = { ...single, stem: { "en-GB": "Which one? (EN) ", nb: "Hvilken? (NB) ", nn: "Kva for ein? (NN) " } };

type Text = { taskText?: Record<string, string>; assessorExpectedContent?: Record<string, string> };

function publishedModule(mode: "MCQ_ONLY" | "FREETEXT_PLUS_MCQ", questions: Q[], text: Text = {}) {
  return buildMockModuleExport({
    id: "module-1",
    title: "Test: Frihet under ansvar",
    moduleVersionId: "module-1-version-1",
    activeVersionId: "module-1-version-1",
    assessmentMode: mode,
    ...(mode === "MCQ_ONLY" ? { taskText: {}, assessorExpectedContent: {} } : text),
    mcqQuestions: questions as never,
  });
}

async function openPublished(page: Page, mode: "MCQ_ONLY" | "FREETEXT_PLUS_MCQ", questions: Q[], path = "/admin-content/module/module-1/conversation", text: Text = {}) {
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Test: Frihet under ansvar", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": publishedModule(mode, questions, text) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saved: { payload: any } = { payload: null };
  await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
    saved.payload = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }) });
  });
  await page.goto(path);
  return saved;
}

const draftBlocksText = /unsaved draft in Edit|ulagret utkast i Rediger|ulagra utkast i Rediger/;

const shapes: Array<{ name: string; mode: "MCQ_ONLY" | "FREETEXT_PLUS_MCQ"; questions: Q[]; text?: Text }> = [
  { name: "bare flervalg, vanlige spørsmål", mode: "MCQ_ONLY", questions: [single] },
  { name: "fritekst + flervalg, vanlige spørsmål", mode: "FREETEXT_PLUS_MCQ", questions: [single] },
  { name: "bare flervalg med «flere riktige»", mode: "MCQ_ONLY", questions: [single, multiple] },
  { name: "bare flervalg med «sett i rekkefølge»", mode: "MCQ_ONLY", questions: [single, order] },
  { name: "bare flervalg med «fyll inn»", mode: "MCQ_ONLY", questions: [single, fill] },
  { name: "fritekst + flervalg med «flere riktige»", mode: "FREETEXT_PLUS_MCQ", questions: [multiple] },
  { name: "fritekst + flervalg med «fyll inn»", mode: "FREETEXT_PLUS_MCQ", questions: [single, fill] },
  { name: "fritekst + flervalg, oppgavetekst med linjeskift til slutt", mode: "FREETEXT_PLUS_MCQ", questions: [single], text: { taskText: trailingNewlineTask } },
  { name: "fritekst + flervalg, vurderingsveiledning med CRLF", mode: "FREETEXT_PLUS_MCQ", questions: [single], text: { assessorExpectedContent: crlfGuidance } },
  { name: "fritekst + flervalg, spørsmålsstamme med mellomrom til slutt", mode: "FREETEXT_PLUS_MCQ", questions: [stemWithTrailingSpace] },
];

test.describe("prod 2.154.0: Lagre i hodet etter Rediger → Innstillinger", () => {
  for (const shape of shapes) {
    test(`${shape.name}: avkrysning i Innstillinger lagres fra hodet`, async ({ page }) => {
      const saved = await openPublished(page, shape.mode, shape.questions, undefined, shape.text);
      // Slik forfatteren kommer inn: sida åpner i Rediger med skjemaet åpent.
      await page.locator("#previewEditTitle").waitFor();
      await page.locator("#formTab-settings").click();

      // Ingenting er skrevet i Rediger, så ingenting skal være ulagret ennå.
      await expect(page.locator("#formSaveBtn")).toBeDisabled();

      await page.locator("#settingsMcqReview").check();
      await expect(page.locator("#formSaveBtn")).toBeEnabled();
      await page.locator("#formSaveBtn").click();

      // Symptomet fra prod: klikket sendte ingenting. Påstanden som skal bli rød uten rettingen.
      await expect.poll(() => saved.payload, { message: "Lagre i hodet sendte ingen lagring", timeout: 5000 }).not.toBeNull();
      expect(saved.payload.assessmentPolicy?.mcq?.reviewAfterSubmit).toBe(true);
      // Og årsaken: et utkast som ingen skrev, sperret Innstillinger.
      await expect(page.locator("#tabPanelSettings")).not.toContainText(draftBlocksText);
    });
  }

  // Del (b): med et EKTE utkast fra Rediger kan innstillingene ikke lagres for seg (det ville skrevet
  // det lagrede innholdet over utkastet). Da skal Lagre i hodet si hvorfor, ikke være et stille ingenting.
  test("et ekte utkast fra Rediger: Lagre i hodet sier hvorfor innstillingene ikke lagres", async ({ page }) => {
    const saved = await openPublished(page, "MCQ_ONLY", [single]);
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditMcqStem0").fill("A changed stem");
    await page.locator("#formTab-settings").click();
    await page.locator("#settingsMcqReview").check();
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
    await page.locator("#formSaveBtn").click();

    await expect(page.locator(".toast__message").filter({ hasText: draftBlocksText })).toBeVisible();
    expect(saved.payload).toBeNull();
  });

  // Omveien i prod-koden: last sida på nytt mens Innstillinger er valgt (adressen har ?tab=settings).
  // Da åpnes aldri skjemaet i Rediger, og ingen fanebytte lager et utkast.
  // Prøvd med den verste formen over (fritekst, «flere riktige», «fyll inn», linjeskift til slutt).
  test("omvei: last sida på nytt mens Innstillinger er valgt, kryss av igjen, Lagre", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    const saved = await openPublished(page, "FREETEXT_PLUS_MCQ", [multiple, fill], undefined, { taskText: trailingNewlineTask });
    // Slik forfatteren står nå: Rediger → Innstillinger, avkrysset, Lagre gjør ingenting.
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#formTab-settings").click();
    await page.locator("#settingsMcqReview").check();
    await expect(page).toHaveURL(/[?&]tab=settings/);
    // Omveien: oppdater sida (F5). Den åpner rett i Innstillinger, uten å gå via Rediger.
    await page.reload();
    await page.locator("#settingsMcqReview").waitFor();
    await expect(page.locator("#tabPanelSettings")).not.toContainText(draftBlocksText);
    await page.locator("#settingsMcqReview").check();
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => saved.payload, { timeout: 5000 }).not.toBeNull();
    expect(saved.payload.assessmentPolicy?.mcq?.reviewAfterSubmit).toBe(true);
  });
});
