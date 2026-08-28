import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Sveiper overskriftsskalaen over ALLE flatene.
//
// Overskriftene var ikke stilsatt: `h1/h2/h3` arvet nettleserens standard (32/24/18px med
// em-baserte marger) mens resten av designet toppet seg på 17px. Fem steder i markupen var det
// allerede håndrettet inline — bevis på at avviket var merket, men bare lappet lokalt.
//
// ⚠️ En overskriftsregel treffer hver eneste side. Denne sveipen finnes for at «jeg fikset
// arbeidsflaten» ikke skal bety «jeg brakk fire andre skjermer uten å se det».

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".ai-qa");
fs.mkdirSync(OUT, { recursive: true });

const PORT = 4195;
const BASE = `http://127.0.0.1:${PORT}`;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

// Forventet skala. En overskrift utenfor denne er enten en bevisst unntaksklasse (som listes) eller
// et avvik som skal ses på.
const EXPECTED = { h1: 22, h2: 16, h3: 15 };
// Bevisste unntak, hver med sin grunn. Listen er kort med vilje: vokser den, er det skalaen som er
// feil, ikke unntakene.
const DELIBERATE = new Set([
  "dialog-title",            // 18px — paneler som legger seg oppaa siden
  "workspace-help-title",    // 18px — samme flatetype som dialogene
  "profile-section-title",   // 11px — en etikett, ikke en overskrift
]);
// `.ai-declaration-head h3` er 13px: en kompakt komponent med sin egen skala (11-13px).
const DELIBERATE_ANCESTORS = ["ai-declaration-head"];

const PAGES = [
  "/participant",
  "/deltakere/klasser",
  "/deltakere/status",
  "/admin-content",
  "/admin-content/courses",
  "/admin-content/sections",
  "/admin-content/calibration",
  "/profile",
];

const server = spawn(process.execPath, [path.join(ROOT, "scripts/test/admin-content-static-server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
process.on("exit", () => server.kill());

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try { up = (await fetch(`${BASE}/static/participant.js`)).ok; } catch { /* */ }
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) { console.log("Fikk ikke opp den statiske serveren."); server.kill(); process.exit(1); }

const browser = await chromium.launch();
let problems = 0;

for (const route of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("**/participant/config", (r) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { contentAdmin: { userId: "a-1", email: "a@x.no", name: "A", roles: ["ADMINISTRATOR"] },
                        participant: { userId: "p-1", email: "p@x.no", name: "P", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: ["ADMINISTRATOR"] },
    flow: {}, output: {},
  })));
  await page.route("**/version", (r) => r.fulfill(json({ version: "inspeksjon" })));
  await page.route("**/api/me", (r) => r.fulfill(json({ user: { roles: ["ADMINISTRATOR"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/**", (r) => r.fulfill(json({})));

  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(400);

  const headings = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3")].map((el) => {
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      px: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      vekt: cs.fontWeight,
      tekst: (el.textContent ?? "").trim().slice(0, 30),
      klasser: String(el.className || ""),
      inline: el.getAttribute("style") || "",
      forelderKlasser: String(el.parentElement?.className || ""),
    };
  }));

  const off = headings.filter((h) => {
    if ([...DELIBERATE].some((c) => h.klasser.includes(c))) return false;
    if (h.forelderKlasser && DELIBERATE_ANCESTORS.some((c) => h.forelderKlasser.includes(c))) return false;
    return h.px !== EXPECTED[h.tag];
  });

  const summary = ["h1", "h2", "h3"]
    .map((tag) => {
      const sizes = [...new Set(headings.filter((h) => h.tag === tag).map((h) => h.px))];
      return sizes.length ? `${tag}: ${sizes.join("/")}px` : null;
    })
    .filter(Boolean)
    .join("   ");

  console.log(`${route.padEnd(30)} ${summary || "(ingen overskrifter)"}`);
  for (const h of off) {
    console.log(`   ⚠️ ${h.tag} ${h.px}px «${h.tekst}»${h.inline ? ` inline:${h.inline}` : ""}${h.klasser ? ` class:${h.klasser}` : ""}`);
    problems += 1;
  }
  await page.close();
}

await browser.close();
server.kill();
console.log(problems === 0 ? "\nAlle overskrifter følger skalaen." : `\n${problems} overskrifter utenfor skalaen — se over.`);
process.exit(problems === 0 ? 0 : 1);
