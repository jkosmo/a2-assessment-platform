import { defineConfig, devices } from "@playwright/test";

// Kjører mot et UTRULLET miljø. Ingen `webServer`: det er hele poenget — vi tester artefaktet som
// faktisk kjører i Azure, ikke en lokal statisk server med mockede API-er.
//
// `retries: 1` fordi nettet er ekte her. En enkelt tapt forespørsel mot Azure er støy, ikke et
// funn, og en suite som feiler tilfeldig blir en suite ingen tror på. Ekte feil overlever ett
// forsøk til.
export default defineConfig({
  testDir: "test/stage",
  timeout: 45000,
  fullyParallel: true,
  retries: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    trace: "on-first-retry",
    // Ingen baseURL: hver test bygger URL-en fra STAGE_BASE_URL, slik at den samme suiten kan
    // pekes mot prod uten at noe i konfigurasjonen må endres.
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
