import { chromium } from "playwright";
import fs from "node:fs";

// #1012: rendrer seksjonsredigeringen og tar skjermbilde av verktøylinja, så knappen «Erstatt
// innhold fra fil» kan INSPISERES før den sendes videre.
//
// Produkteier 2026-08-26: «Når vi lager UI-elementer så bør de visuelt inspiseres som en del av
// kvalitetskontroll.»

const OUT = ".ai-qa";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:4173";

const SECTION = {
  id: "sec-1",
  title: JSON.stringify({ "en-GB": "Quality assurance in KS2", nb: "Kvalitetssikring i KS2", nn: "Kvalitetssikring i KS2" }),
  bodyMarkdown: JSON.stringify({ "en-GB": "# KS2\n\nContent.", nb: "# KS2\n\nInnhold.", nn: "# KS2\n\nInnhald." }),
  activeVersionId: "ver-1",
  versionNo: 3,
  hasUnpublishedChanges: false,
  updatedAt: "2026-08-27T08:00:00.000Z",
  archivedAt: null,
};

const browser = await chromium.launch();
for (const [locale, label] of [["nb", "nb"], ["en-GB", "en"]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.route("**/participant/config", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    }),
  }));
  await page.route("**/version", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"version":"dev"}' }));
  await page.route("**/api/me", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
  }));
  await page.route("**/api/admin/content/sections/sec-1", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ section: SECTION }),
  }));
  await page.route("**/api/admin/content/sections*", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ sections: [SECTION] }),
  }));
  await page.route("**/api/admin/content-owners**", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }),
  }));

  await page.addInitScript((loc) => {
    try { localStorage.setItem("participant.locale", loc); } catch { /* ignorer */ }
  }, locale);

  // Ruteren bruker query-parameter, ikke hash: /admin-content/sections?id=<id>
  await page.goto(`${BASE}/admin-content/sections?id=sec-1`);
  await page.waitForSelector("#replaceFromFileBtn", { timeout: 10000 }).catch(() => {});

  const btn = page.locator("#replaceFromFileBtn");
  const found = await btn.count();
  if (found === 0) {
    console.log(`[${label}] FANT IKKE KNAPPEN — sjekk at redigeringen faktisk ble rendret`);
    await page.screenshot({ path: `${OUT}/seksjon-${label}-feil.png`, fullPage: true });
    await page.close();
    continue;
  }

  const toolbar = page.locator("#saveBtn").locator("..");
  await toolbar.screenshot({ path: `${OUT}/seksjon-verktoylinje-${label}.png` });

  const m = await toolbar.evaluate((el) => {
    const buttons = [...el.querySelectorAll("button")].map((b) => ({
      id: b.id,
      text: b.textContent.trim(),
      right: Math.round(b.getBoundingClientRect().right),
      left: Math.round(b.getBoundingClientRect().left),
    }));
    return { buttons, wraps: el.scrollWidth > el.clientWidth };
  });
  console.log(`\n[${label}] knapper i verktøylinja:`);
  m.buttons.forEach((b) => console.log(`   ${b.id || "(uten id)"} — «${b.text}»`));
  const gaps = m.buttons.slice(1).map((b, i) => b.left - m.buttons[i].right);
  console.log(`   avstand mellom knapper: ${gaps.join(", ")} px`);
  console.log(`   verktøylinja flyter over: ${m.wraps ? "JA — for trang" : "nei"}`);
  await page.close();
}
await browser.close();
console.log(`\nskjermbilder i ${OUT}/`);
