import { beforeAll } from "vitest";

/**
 * #994 — flytt modullastingen ut av testenes tidsbudsjett.
 *
 * ⚠️ HVA SOM FAKTISK VAR GALT. Seks unit-filer feilet tilfeldig med «Test timed out in 20000ms»,
 * og feilen traff alltid den FØRSTE testen i fila. Saken gjettet på databasekontanse. Målingen
 * viste noe annet:
 *
 *     kald graf   →  51 903 ms  på første test, de sju andre momentane
 *     varm graf   →   1 395 ms  på første test, alt grønt
 *
 * Samme fil, samme maskin, ingen last, to minutter mellom kjøringene. Prisma er mocket i alle
 * seks, så databasen var aldri inne i bildet.
 *
 * Kostnaden er å LESE modulgrafen. `appealService` trekker inn `modules/course/index.js`, en
 * barrel på flere hundre filer, og repoet ligger i OneDrive. Kald gjennomlesing tar titalls
 * sekunder; andre gang ligger alt i OS-ens filcache. Derfor «passerer når den kjøres alene» —
 * det er egentlig «passerer andre gang».
 *
 * ⚠️ POENGET: dette er en BYGGEKOSTNAD, ikke en egenskap ved koden som testes. Fordi filene
 * gjør `await import(...)` inne i testkroppen, blir den belastet den testen som tilfeldigvis
 * står først. `testTimeout: 20000` måler da lesehastigheten på disk, ikke om logikken henger.
 *
 * KUREN har samme form som #958: gi kostnaden ett navngitt sted, så ingen test KAN belastes
 * for den. Etter oppvarmingen treffer hver `await import(...)` i testkroppene et varmt register
 * og koster ingenting — testkroppene trenger derfor ingen endring.
 *
 * ⚠️ Hvorfor ikke bare statisk import øverst? Mock-fabrikkene i disse filene lukker over
 * `const x = vi.fn()` på modulnivå. `vi.mock` heises over importene, mens `const`-ene ikke
 * heises — en statisk import ville kjørt fabrikken før variabelen fantes (TDZ). Den dynamiske
 * importen er altså ikke en vane, den er nødvendig. `beforeAll` kjører etter modulinitialisering
 * og er derfor det tidligste trygge stedet.
 *
 * ⚠️ Hvorfor ikke heve `testTimeout`? Da ville en ekte hengning tatt to minutter å oppdage, og
 * grensen ville fortsatt målt to ting samtidig. Her er de to budsjettene skilt: oppvarmingen får
 * et eksplisitt romslig budsjett fordi den er I/O, og `testTimeout: 20000` fortsetter å bety
 * «denne logikken henger».
 *
 * `test/module-graph-warmup-guard.test.js` nekter en ny unit-fil som importerer `src/` inne i en
 * testkropp uten å varme opp først.
 */
const WARMUP_TIMEOUT_MS = 120_000;

export function warmModuleGraph(loader: () => Promise<unknown>): void {
  beforeAll(async () => {
    await loader();
  }, WARMUP_TIMEOUT_MS);
}
