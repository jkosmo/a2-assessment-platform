import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.unit.config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Testgjennomgangen 2026-11 (avsnitt 4.4): alt enhetskjøringen tar, er utelukket her, lest fra vitest.unit.config.ts.
//
// ⚠️ Før sto bare de sju første rotfilene i lista under. De 24 kilde- og kontraktstestene i rota som senere ble lagt i
// enhetskonfigurasjonen (vaktene, oversettelsene, `admin-content-ui-contracts` …), kjørte dermed i BEGGE, og `test:native` kjørte
// dem to ganger (~22 s, `content-lock-write-guard` alene 16–18 s). En liste som må holdes lik en annen liste for hånd, driver
// fra hverandre; derfor leses den. `npm test` (vitest.config.ts, CI) kjører fortsatt alt én gang.
const unitInclude = unitConfig.test?.include ?? [];
if (unitInclude.length === 0) throw new Error("vitest.integration.config.ts: fant ingen include-liste i vitest.unit.config.ts");

export default defineConfig({
  // #975: se vitest.unit.config.ts — public/api-client.js importerer /static/dom-visibility.js.
  // Vite nekter modulimport fra publicDir, og nettleser-stien `/static/…` finnes ikke på disk.
  publicDir: false,
  resolve: {
    alias: [
      { find: /^\/static\/i18n\/(.*)$/, replacement: `${path.join(rootDir, "public", "i18n")}${path.sep}$1` },
      // Filer som ligger i public-rota, men serveres under /static (app.ts monterer begge): api-client.js.
      { find: /^\/static\/(api-client\.js)$/, replacement: `${path.join(rootDir, "public")}${path.sep}$1` },
      { find: /^\/static\/(.*)$/, replacement: `${path.join(rootDir, "public", "static")}${path.sep}$1` },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    exclude: [
      // Enhetskjøringen: test/unit/** og rotfilene uten database (se toppen av fila).
      ...unitInclude,
      // ⚠️ DOM-testene har sin egen kjøring med jsdom (`vitest.dom.config.ts`). Uten denne
      // utelukkelsen kjører de OGSÅ her, i Node uten `document`, og feiler med «document is not
      // defined» — en rød suite som ikke sier noe om produktet.
      //
      // `test/dom/api-client-formdata.dom.test.js` slapp unna fordi den aldri rører `document`.
      // Feilen dukket derfor først opp da en test som faktisk bygger noder ble lagt til.
      "test/dom/**/*.test.ts",
      "test/dom/**/*.test.js",
      // #804: these exercise the GLOBAL audit hash chain (whole-table verify/backfill + deleteMany), so
      // they require exclusive DB access — even with fileParallelism:false, since they mutate the whole
      // table other files have already written to. Run them with `npm run test:integration:audit`.
      "test/m2-audit-chain.test.ts",
      "test/m2-audit-pii-scrub.test.ts",
    ],
    globals: true,
    testTimeout: 20000,
    // #1021: filene kjørte i PARALLELL mot én delt Postgres, og racet fra #513 var aldri løst — bare
    // omgått for de to filene over.
    //
    // ⚠️ Symptomet var en suite som feilet TILFELDIG: seks kjøringer, seks ulike tester, hver av dem
    // grønn alene. Det er verre enn en suite som feiler alltid, fordi den lærer leseren å se bort fra
    // rødt. Én av de tilfeldige feilene gjaldt dessuten regelen om at et KI-signal skal rute til
    // gjennomgang i stedet for stryk — avfeier man den som støy, kan man avfeie en ekte regresjon.
    //
    // Målt 2026-08-27 på samme ferske, seedede database: parallelt feilet 6 av 6 kjøringer med 1–4
    // tester; serielt 576/576 grønt. `npm test` (vitest.config.ts) har kjørt serielt siden #513 —
    // dette gjør den lokale kommandoen lik CI.
    //
    // Prisen er 4 minutter mot 1. En suite man ikke kan stole på er verdt mindre enn de tre.
    fileParallelism: false,
  },
});
