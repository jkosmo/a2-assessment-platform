// `npm run mascot:check`: sjekker alle maskotpakker i mascots/ og valget i mascot.config.json, og lister alle feil på
// én gang (doc/design/MASKOTPAKKE.md, «Sjekken»). Avslutter med kode 1 når noe er galt. Kjøres i CI av
// test/unit/mascot-check.test.ts.
//
// Rota er mappa skriptet kjøres fra (repoet), så testen kan kjøre det mot en kopi.
import { checkAllMascotPacks, formatMascotCheckReport, mascotCheckPassed } from "../modules/mascot/mascotCheck.js";

const report = checkAllMascotPacks(process.cwd());
const passed = mascotCheckPassed(report);
const text = formatMascotCheckReport(report);
if (passed) {
  process.stdout.write(`${text}\nMaskotpakkene er i orden.\n`);
} else {
  process.stderr.write(`${text}\nMaskotpakkene har feil (se over). Kravene står i mascots/seilbat/README.md.\n`);
  process.exitCode = 1;
}
