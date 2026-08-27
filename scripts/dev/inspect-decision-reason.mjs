import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// #950: rendrer BEGRUNNELSE-raden på resultatskjermen med de ekte setningene og den ekte CSS-en, og
// MÅLER at ingenting flyter ut eller klippes.
//
// Produkteier 2026-08-26: «Når vi lager UI-elementer så bør de visuelt inspiseres som en del av
// kvalitetskontroll.»
//
// ⚠️ Det som faktisk kan gå galt her er lengden. De nye setningene er vesentlig lengre enn de gamle
// — KI-erklæringen med deltakerens egen beskrivelse er over 300 tegn — og de havner i en
// to-kolonners rutenettrad. En skjermdump alene ville ikke fanget en verdi som flyter ut av kortet;
// derfor måles bredden mot beholderen, og teksten mot det som faktisk er synlig.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".ai-qa");
fs.mkdirSync(OUT, { recursive: true });

// pathToFileURL, ikke en rå sti: Node nekter å importere "c:\..." som ESM-URL.
const { translations } = await import(pathToFileURL(path.join(ROOT, "public/i18n/participant-translations.js")).href);
const { localizeDecisionReason } = await import(pathToFileURL(path.join(ROOT, "public/static/decision-reason.js")).href);

const css = fs.readFileSync(path.join(ROOT, "public/static/shared.css"), "utf8");

// De tre lengste og de tre vanligste grunnene — hvis noe brekker, brekker det her.
const CASES = [
  {
    name: "ren flervalg, bestått",
    guidance: {
      decisionReason: "Automatic pass: MCQ score 100% meets the required minimum of 70%.",
      decisionReasonCode: "MCQ_ONLY_PASS",
      decisionReasonParams: { scorePercent: 100, minPercent: 70 },
    },
  },
  {
    name: "grenseområde",
    guidance: {
      decisionReason: "Routed to manual review: total score 64 is in the borderline window [60, 70].",
      decisionReasonCode: "MANUAL_REVIEW_BORDERLINE",
      decisionReasonParams: { totalScore: 64, min: 60, max: 70 },
    },
  },
  {
    name: "KI-erklæring med beskrivelse (LENGST)",
    guidance: {
      decisionReason: "…",
      decisionReasonCode: "MANUAL_REVIEW_AI_DECLARATION",
      decisionReasonParams: {
        description:
          "Jeg brukte en språkmodell til å skrive utkastet og redigerte det lett etterpå, fordi jeg hadde dårlig tid denne uka.",
      },
    },
  },
  {
    name: "innholdslikhet",
    guidance: {
      decisionReason: "…",
      decisionReasonCode: "MANUAL_REVIEW_CONTENT_SIMILARITY",
      decisionReasonParams: { similarityPercent: 87, thresholdPercent: 80 },
    },
  },
  {
    name: "sensors egne ord (ingen kode)",
    guidance: {
      decisionReason:
        "Vurdert på nytt etter klage: kandidaten dokumenterte praksisen godt nok, og besvarelsen dekker begge læringsmålene.",
      decisionReasonCode: null,
      decisionReasonParams: {},
    },
  },
];

const WIDTHS = [
  { label: "desktop", width: 1280, height: 1000 },
  { label: "mobil", width: 390, height: 1200 },
];

const browser = await chromium.launch();
let problems = 0;

for (const locale of ["nb", "nn", "en-GB"]) {
  const t = (key) => translations[locale][key] ?? translations["en-GB"][key] ?? key;
  const rows = CASES.map((c) => ({
    name: c.name,
    label: t("result.decisionReason"),
    value: localizeDecisionReason(c.guidance, t),
  }));

  for (const size of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    await page.setContent(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
      <style>${css}</style>
      <style>body{padding:24px;background:var(--color-bg,#fff)}
        .case{margin-bottom:20px}
        .case h4{font:600 12px/1.4 system-ui;color:#888;margin:0 0 6px}</style>
      </head><body>
      <div class="card" id="card">
        ${rows.map((r) => `
          <div class="case">
            <h4>${r.name}</h4>
            <div class="summary-grid">
              <div class="summary-row">
                <div class="summary-label">${r.label}</div>
                <div class="summary-value">${r.value.replace(/</g, "&lt;")}</div>
              </div>
            </div>
          </div>`).join("")}
      </div></body></html>`);

    const file = path.join(OUT, `decision-reason-${locale}-${size.label}.png`);
    await page.screenshot({ path: file, fullPage: true });

    // MÅLINGEN. En skjermdump viser at det finnes; tallene viser at det holder seg innenfor.
    const measured = await page.evaluate(() => {
      const card = document.getElementById("card");
      const cardRight = card.getBoundingClientRect().right;
      return [...document.querySelectorAll(".summary-value")].map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          i,
          overflowRight: Math.round(r.right - cardRight),
          clipped: el.scrollHeight - el.clientHeight > 1,
          empty: el.textContent.trim().length === 0,
          leftoverPlaceholder: /\{\w+\}/.test(el.textContent),
          text: el.textContent.trim().slice(0, 60),
        };
      });
    });

    for (const m of measured) {
      const bad = [];
      if (m.overflowRight > 0) bad.push(`flyter ${m.overflowRight}px ut av kortet`);
      if (m.clipped) bad.push("teksten er klippet");
      if (m.empty) bad.push("TOM");
      if (m.leftoverPlaceholder) bad.push("plassholder {…} står igjen");
      if (bad.length) {
        problems += 1;
        console.log(`  ✗ ${locale}/${size.label} «${CASES[m.i].name}»: ${bad.join(", ")}`);
      }
    }

    console.log(`${locale} / ${size.label} → ${path.relative(ROOT, file)}`);
    // Beviser at språket faktisk byttet — ellers måler vi bokmål tre ganger.
    console.log(`   ${measured[0].text}…`);
    await page.close();
  }
}

await browser.close();
console.log(problems === 0 ? "\nIngen avvik målt." : `\n${problems} avvik målt.`);
process.exit(problems === 0 ? 0 : 1);
