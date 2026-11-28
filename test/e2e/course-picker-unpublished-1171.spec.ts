import { expect, test, type Page } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1171 (2.193.0): en modul uten publisert versjon tilbys ikke i kursbyggerens søk (#440), men søket sier nå fra når den matcher,
// i stedet for at modulen bare ikke dukker opp. Linja er ikke et valg: pilene og klikk hopper over den, og «Legg til» blir ikke
// aktiv av den. En arkivert modul nevnes ikke.

const nb = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });

async function openBuilder(page: Page) {
  await mockCommonApis(page, {
    courses: [{ id: "course-1", title: "Informasjonssikkerhet", modules: [] } as never],
    libraryModules: [
      { id: "mod-live", title: "Phishing i praksis", status: "published" },
      { id: "mod-ny", title: "Phishing for ledere", status: "draft" },
      { id: "mod-ark", title: "Phishing før 2020", status: "archived" },
    ] as never,
  });
  await nb(page);
  await page.goto("/admin-content/courses/course-1");
  await page.locator("#comboboxInput").waitFor();
}

const hint = (page: Page) => page.locator("#comboboxDropdown .combobox-hint");

test("søket viser den publiserte modulen som valg, og sier fra om den som ikke er publisert; den arkiverte nevnes ikke", async ({ page }) => {
  await openBuilder(page);
  const input = page.locator("#comboboxInput");
  await input.click();
  await input.fill("phishing");
  await expect(page.locator("#comboboxDropdown .combobox-option")).toHaveCount(1);
  await expect(page.locator("#comboboxDropdown .combobox-option")).toContainText("Phishing i praksis");
  await expect(hint(page)).toHaveText("Ikke publisert, og kan ikke legges inn: «Phishing for ledere». Publiser modulen først.");
  await expect(hint(page)).not.toContainText("før 2020");
});

test("bare den upubliserte matcher: «ingen treff» og forklaringen; «Legg til» står av", async ({ page }) => {
  await openBuilder(page);
  const input = page.locator("#comboboxInput");
  await input.click();
  await input.fill("ledere");
  await expect(page.locator("#comboboxDropdown .combobox-empty")).toHaveText("Ingen moduler eller seksjoner matcher søket.");
  await expect(hint(page)).toContainText("«Phishing for ledere»");
  await hint(page).click();
  await expect(page.locator("#addItemBtn")).toBeDisabled();
});

test("uten søketekst, og når den publiserte er eneste treff: ingen forklaring", async ({ page }) => {
  await openBuilder(page);
  const input = page.locator("#comboboxInput");
  await input.click();
  await expect(page.locator("#comboboxDropdown .combobox-option").first()).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
  await input.fill("praksis");
  await expect(page.locator("#comboboxDropdown .combobox-option")).toHaveCount(1);
  await expect(hint(page)).toHaveCount(0);
});
