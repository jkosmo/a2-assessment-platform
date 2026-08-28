import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Måler typografi- og boksskalaen i modul-arbeidsflaten mot resten av deltakerflaten.
//
// Produkteier 2026-08-28, med skjermbilde: «Det er noe feil med størrelsen av font og skala på
// boksene her i forhold til hva som blir brukt for selve listen.»
//
// ⚠️ Måler i stedet for å gjette. Skriptet leser BEREGNEDE verdier fra den ekte siden — ikke fra
// CSS-kilden, som ikke sier hva som faktisk vinner i kaskaden.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".ai-qa");
fs.mkdirSync(OUT, { recursive: true });

const PORT = 4193;
const BASE = `http://127.0.0.1:${PORT}`;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockParticipant(page) {
  await page.route("**/participant/config", (r) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "p-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: { autoStartAfterMcq: false },
    output: {},
  })));
  await page.route("**/version", (r) => r.fulfill(json({ version: "inspeksjon" })));
  await page.route("**/api/me", (r) => r.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (r) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/modules**", (r) => r.fulfill(json({
    modules: [{
      id: "m-mcq",
      title: JSON.stringify({ nn: "Endringsleiing i verksemda", nb: "Endringsledelse i virksomheten", "en-GB": "Change management" }),
      description: JSON.stringify({ nn: "Tre kontrollspørsmål om rolla til endringsleiing og forholdet til prosjektstyring." }),
      assessmentMode: "MCQ_ONLY",
      submissionSchema: null, assessmentPolicy: null, taskText: null,
      activeVersion: { versionNo: 1 }, participantStatus: null,
    }],
  })));
  await page.route("**/api/submissions", (r) => r.fulfill({ ...json({ submission: { id: "s1" } }), status: 201 }));
}

const server = spawn(process.execPath, [path.join(ROOT, "scripts/test/admin-content-static-server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
process.on("exit", () => server.kill());

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try { up = (await fetch(`${BASE}/static/participant.js`)).ok; } catch { /* ikke oppe */ }
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) { console.log("Fikk ikke opp den statiske serveren."); server.kill(); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nn"); } catch { /* */ } });
await mockParticipant(page);

await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
await page.locator("#loadModules").click();
await page.locator(".module-card").first().click();
await page.locator("#submissionSection h2").waitFor({ timeout: 15000 });

const measured = await page.evaluate(() => {
  const read = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      tekst: (el.textContent ?? "").trim().slice(0, 34),
      fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      marginTop: cs.marginTop,
      marginBottom: cs.marginBottom,
      padding: cs.padding,
      bredde: Math.round(box.width),
    };
  };
  const pick = (sel) => read(document.querySelector(sel));

  return {
    // Referansen: typografien lista og resten av flaten faktisk bruker.
    rot: Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 10) / 10,
    body: Math.round(parseFloat(getComputedStyle(document.body).fontSize) * 10) / 10,
    listeKortTittel: pick(".module-card .module-card-title") ?? pick(".module-card strong") ?? pick(".module-card"),
    // Arbeidsflatens overskrifter — de som ser for store ut.
    arbeidsflateH2: [...document.querySelectorAll("#moduleWorkspace section.card > h2")].map(read),
    arbeidsflateKort: [...document.querySelectorAll("#moduleWorkspace section.card")].map((el) => {
      const cs = getComputedStyle(el);
      return { padding: cs.padding, marginBottom: cs.marginBottom, borderRadius: cs.borderRadius };
    }),
    // Sammenlign med en h2 ANDRE steder på flaten, om den finnes.
    andreH2: [...document.querySelectorAll("h2")]
      .filter((el) => !el.closest("#moduleWorkspace"))
      .map((el) => ({
        ...read(el),
        // ⚠️ Uten opphavet blir et avvikende maal umulig aa forfoelge — jeg brukte fem minutter
        // paa aa gjette hvor «Deltakar» kom fra foer denne linja fantes.
        id: el.id || null,
        klasser: el.className || null,
        inline: el.getAttribute("style") || null,
        forelder: el.parentElement ? `${el.parentElement.tagName.toLowerCase()}${el.parentElement.id ? "#" + el.parentElement.id : ""}${el.parentElement.className ? "." + String(el.parentElement.className).split(" ")[0] : ""}` : null,
      }))
      .slice(0, 8),
  };
});

console.log(`rot-fontstørrelse: ${measured.rot}px    body: ${measured.body}px`);
console.log(`\nlistekortets tittel: ${measured.listeKortTittel?.fontSize}px vekt ${measured.listeKortTittel?.fontWeight}  «${measured.listeKortTittel?.tekst}»`);

console.log("\narbeidsflatens overskrifter (h2 i section.card):");
for (const h of measured.arbeidsflateH2) {
  console.log(`   ${String(h.fontSize).padStart(5)}px  vekt ${h.fontWeight}  linje ${h.lineHeight}  marg ${h.marginTop}/${h.marginBottom}  «${h.tekst}»`);
}

console.log("\nh2 andre steder på flaten:");
for (const h of measured.andreH2) {
  console.log(`   ${String(h.fontSize).padStart(5)}px  vekt ${h.fontWeight}  «${h.tekst}»   [${h.forelder ?? "?"}]${h.inline ? " inline:" + h.inline : ""}${h.klasser ? " class:" + h.klasser : ""}`);
}

console.log("\narbeidsflatens kort:");
for (const c of measured.arbeidsflateKort) {
  console.log(`   padding ${c.padding}  bunnmarg ${c.marginBottom}  radius ${c.borderRadius}`);
}

const wsSizes = measured.arbeidsflateH2.map((h) => h.fontSize);
const listSize = measured.listeKortTittel?.fontSize ?? 0;
const ratio = listSize ? Math.max(...wsSizes) / listSize : 0;
console.log(`\nstørste arbeidsflate-overskrift ÷ listetittel = ${ratio.toFixed(2)}x`);

await page.locator("#moduleWorkspace").screenshot({ path: path.join(OUT, "arbeidsflate-skala.png") });
await page.close();
await browser.close();
server.kill();
console.log(`\nskjermbilde i ${OUT}/arbeidsflate-skala.png`);
