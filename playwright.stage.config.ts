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
  // Filene gaar parallelt, testene i en fil etter hverandre. Maalt 17.09: rapportflatene
  // (Resultater, Kullstatus) svarer paa 1–8 s alene, men med tre arbeidere paa samme fil passerte
  // de 20-sekundersgrensen og traff til slutt 429. Serielt i fila maaler vi produktet, ikke koeen.
  fullyParallel: false,
  // ⚠️ Stage kjorer paa EN B1-instans. Med standard arbeiderantall (en per kjerne) treffer ~10
  // nettlesere den samtidig, og tester som venter paa at en tabell fylles gaar i tidsavbrudd —
  // ikke fordi produktet er i stykker, men fordi instansen er metta.
  //
  // Malt 30.08.2026: ui-surfaces gikk 12/12 alene paa 37 s, og fikk 2 feil naar hele suiten kjorte.
  //
  // ⚠️ Dette SKJULER at appen er treg under last. Det er en reell opplysning, og den hoerer hjemme
  // i kapasitetssaken (#808) — ikke i en suite som skal svare paa om koden virker.
  workers: 3,
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
