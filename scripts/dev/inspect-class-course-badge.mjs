import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #967: merket «Arkivert - deltakerne ser det ikke» på klasseskjermens kurstildelinger.
//
// Produkteier 2026-08-26: «Når vi lager UI-elementer så bør de visuelt inspiseres som en del av
// kvalitetskontroll.»
//
// ⚠️ Siden lastes som den er — ekte admin-content-classes.js, ekte CSS, mockede API-svar. En
// replika ville kunne divergere fra produktet og gi en falsk kvittering (jf. #940).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".ai-qa");
fs.mkdirSync(OUT, { recursive: true });

const PORT = 4191;
const BASE = `http://127.0.0.1:${PORT}`;
const L = (nb) => JSON.stringify({ "en-GB": nb, nb, nn: nb });

const COURSES = [
  { courseId: "c-ok", title: L("Grunnleggende generativ KI"), dueAt: "2026-09-30T00:00:00.000Z", coursePublished: true, courseArchived: false },
  { courseId: "c-unpub", title: L("Personvern for ledere"), dueAt: "2026-09-15T00:00:00.000Z", coursePublished: false, courseArchived: false },
  { courseId: "c-arch", title: L("Avvikshåndtering (gammel)"), dueAt: null, coursePublished: true, courseArchived: true },
];

const server = spawn(process.execPath, [path.join(ROOT, "scripts/test/admin-content-static-server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
process.on("exit", () => server.kill());

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try {
    up = (await fetch(`${BASE}/static/admin-content-classes.js`)).ok;
  } catch { /* ikke oppe ennå */ }
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) {
  console.log("Fikk ikke opp den statiske serveren — avbryter.");
  server.kill();
  process.exit(1);
}

const browser = await chromium.launch();
let problems = 0;

for (const width of [1280, 480]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });

  await page.route("**/participant/config", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["ADMINISTRATOR"] } },
      calibrationWorkspace: { accessRoles: [] },
    }),
  }));
  await page.route("**/version", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"version":"dev"}' }));
  await page.route("**/api/me", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { roles: ["ADMINISTRATOR"] }, consent: { accepted: true, currentVersion: "1.0" } }),
  }));
  await page.route("**/api/admin/content/classes/*/members", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }),
  }));
  await page.route("**/api/admin/content/classes/*/courses", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ courses: COURSES }),
  }));
  await page.route("**/api/admin/content/classes", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ classes: [{ id: "cls-1", name: "Kull 2026 vår", kind: "MANUAL", isSystem: false, archivedAt: null, canManage: true, _count: { members: 12, courseAssignments: 3 } }] }),
  }));
  await page.route("**/api/admin/content/courses", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }),
  }));

  await page.goto(`${BASE}/deltakere/klasser`);
  await page.waitForSelector('[data-action="open"]', { timeout: 10000 }).catch(() => {});
  await page.locator('[data-action="open"]').first().click();
  await page.waitForSelector(".assign-row", { timeout: 10000 }).catch(() => {});

  const rows = await page.locator(".assign-row").evaluateAll((els) =>
    els.map((el) => {
      const warn = el.querySelector(".assign-meta--warn");
      const name = el.querySelector(".assign-name");
      const box = el.getBoundingClientRect();
      return {
        navn: name?.textContent.trim() ?? "",
        merke: warn?.textContent.trim() ?? null,
        merkeFarge: warn ? getComputedStyle(warn).color : null,
        // ⚠️ MÅ ekskludere varselelementet: det bærer BEGGE klassene og kommer først i DOM-en, så
        // en naiv `.assign-meta` sammenligner merket med seg selv og melder alltid «samme farge».
        metaFarge: (() => {
          const plain = el.querySelector(".assign-meta:not(.assign-meta--warn)");
          return plain ? getComputedStyle(plain).color : null;
        })(),
        flyterOver: el.scrollWidth > el.clientWidth + 1,
        hoyde: Math.round(box.height),
      };
    }),
  );

  console.log(`\n=== bredde ${width}px ===`);
  for (const r of rows) {
    console.log(`  ${r.navn}`);
    console.log(`     merke: ${r.merke ?? "(ingen)"}${r.merke ? `  farge ${r.merkeFarge}` : ""}`);
    if (r.flyterOver) { console.log("     ⚠️ RADEN FLYTER OVER"); problems += 1; }
  }

  const withBadge = rows.filter((r) => r.merke);
  if (withBadge.length !== 2) {
    console.log(`  ⚠️ FORVENTET 2 merkede rader, fant ${withBadge.length}`);
    problems += 1;
  }
  // Merket skal skille seg fra den nøytrale metateksten — ellers er det ingen advarsel.
  if (withBadge.some((r) => r.merkeFarge === r.metaFarge)) {
    console.log("  ⚠️ MERKET HAR SAMME FARGE SOM VANLIG METATEKST — usynlig som advarsel");
    problems += 1;
  }

  await page.locator(".assign-row").first().locator("..").screenshot({
    path: path.join(OUT, `967-klasse-kurs-${width}.png`),
  });
  await page.close();
}

await browser.close();
server.kill();
console.log(problems === 0 ? "\nIngen avvik målt." : `\n${problems} avvik — se over.`);
process.exit(problems === 0 ? 0 : 1);
