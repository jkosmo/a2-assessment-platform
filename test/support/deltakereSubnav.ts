import { expect, type Page } from "@playwright/test";

// #1096: under Deltakere viste undermenyen rå nøkler (`area.classes`, `area.status`, …) i prod.
// Ordene kommer fra `content-area-nav-i18n.js` (admin-buntens `area.*`), men sidene Status,
// Resultater og Manuell behandling oversatte ALLE `[data-i18n]` med sin egen bunt etterpå — og der
// finnes ikke `area.*`, så oversetteren ga nøkkelen tilbake og skrev den over menyteksten.
//
// Brukt av deltakere-subnav-keys-1096.spec.ts (/deltakere/status) og page-title.spec.ts (/results, /review,
// /deltakere/aktivitet). Testgjennomgangen 2026-11 (4.1-2): de to filene lastet de samme ni sidene hver for seg.

const FORVENTET: Record<string, Record<string, string>> = {
  nb: { subnavKlasser: "Klasser", subnavStatus: "Status", subnavActivity: "Aktivitet", subnavReview: "Manuell behandling", subnavResults: "Resultater" },
  nn: { subnavKlasser: "Klassar", subnavStatus: "Status", subnavActivity: "Aktivitet", subnavReview: "Manuell behandling", subnavResults: "Resultat" },
  "en-GB": { subnavKlasser: "Classes", subnavStatus: "Status", subnavActivity: "Activity", subnavReview: "Manual review", subnavResults: "Results" },
};

/** Undermenyen viser ord på `locale`, ikke nøkler. Siden må være lastet. */
export async function forventUndermenyMedOrd(page: Page, locale: string) {
  const nav = page.locator("#deltakereSubnav");
  await expect(nav).toBeVisible();
  // Gi sidens egen oversettelse tid til å kjøre (den gikk etter menyens og skrev over den).
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  for (const [id, tekst] of Object.entries(FORVENTET[locale]!)) {
    const lenke = page.locator(`#${id}`);
    if ((await lenke.count()) === 0) continue; // rollestyrt bort
    await expect(lenke).toHaveText(tekst);
  }
  const alle = await nav.locator("a").allInnerTexts();
  expect(alle.filter((t) => t.trim().startsWith("area.")), "rå nøkler i undermenyen").toEqual([]);
}
