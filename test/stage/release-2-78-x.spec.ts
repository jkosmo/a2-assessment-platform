import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

// Utgivelsene 2.78.1–2.78.3 mot UTRULLET stage, med EKTE innhold: #1080, #1081, #1083 og #1073.
//
// ⚠️ Hvorfor denne finnes: produkteier skal ikke klikke seg gjennom det en maskin kan måle. Alt her
// sto først i et manuelt testskript. Det som blir igjen til et menneske, er det ingen måling kan
// svare på — hvordan det SER UT, og hvordan det oppfører seg på en ekte telefon. Derfor tar testen
// skjermbilder underveis og legger dem i `test-results/stage-rapport/`, så det som skal ses på, er
// en side med bilder og ikke tjue minutter med klikking.
//
// Det testen skriver på stage: to testseksjoner (importert), som arkiveres og slettes til slutt.
// Lister med ekte innhold blir bare LEST: ingenting døpes om, og ingenting oversettes, utenom i
// testseksjonene. Figurene oversettes av den ekte språkmodellen på stage (to kall).
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.
//
// Lokal prøvekjøring uten innlogging (appen i mock-modus mot testdatabasen):
//   STAGE_LOKAL=http://127.0.0.1:3001 npx playwright test --config playwright.stage.config.ts test/stage/release-2-78-x.spec.ts

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);

const VENT_MS = 45000;
const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
// Funnene skrives til fil etter hvert, én linje per funn: et nytt forsøk starter en ny prosess, og
// det som bare lå i minnet, ville vært borte. Mappa tømmes av den som starter kjøringen
// (scripts/test/stage-release-report.mjs), ikke her — av samme grunn.
const noter = (testnavn: string, hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: testnavn, hva, verdi: String(verdi) })}
`, "utf8");
};

const bilde = (page: Page, navn: string) => { fs.mkdirSync(RAPPORT, { recursive: true }); return page.screenshot({ path: path.join(RAPPORT, `${navn}.png`), fullPage: false }); };

// ── API ────────────────────────────────────────────────────────────────────────────────────────

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; tekst: string }> {
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(tekst) as Record<string, unknown>; } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const hentFigur = async (assetId: string, spørring = "") => {
  const svar = await fetch(`${BASE}/api/content-assets/${assetId}${spørring}`, { headers: hoder() });
  return { status: svar.status, type: svar.headers.get("content-type") ?? "", svg: await svar.text() };
};

const b64 = (tekst: string) => Buffer.from(tekst, "utf8").toString("base64");
const NBSP = " ";
const three = (base: string) => ({ nb: base, nn: base, "en-GB": base });

const FIGUR_HARDT_MELLOMROM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 110" aria-label="Terskel: belop &lt; 500 kr"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <rect x="10" y="20" width="140" height="60" rx="6" fill="#eef" stroke="#333"/>
  <text x="80" y="55" text-anchor="middle" font-size="16">§${NBSP}12</text>
  <rect x="170" y="20" width="140" height="60" rx="6" fill="#efe" stroke="#333"/>
  <text x="240" y="55" text-anchor="middle" font-size="16">10${NBSP}%</text>
  <rect x="330" y="20" width="140" height="60" rx="6" fill="#fee" stroke="#333"/>
  <text x="400" y="55" text-anchor="middle" font-size="16">kr${NBSP}500</text>
  <text x="240" y="102" text-anchor="middle" font-size="12">Tre etiketter med hardt mellomrom</text>
</svg>
`;

const FIGUR_ANIMERT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 80" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <style>
    .steg { fill: #eef; stroke: #333; }
    @keyframes lys { 0%, 70% { fill: #ffd166; } 100% { fill: #eef; } }
    .steg { animation: lys 1.4s ease-in-out 1; }
    .s2 { animation-delay: 1.2s; }
    .s3 { animation-delay: 2.4s; }
    @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
  </style>
  <rect class="steg s1" x="10" y="20" width="120" height="40" rx="6"/>
  <text x="70" y="45" text-anchor="middle" font-size="14">Motta sak</text>
  <line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>
  <rect class="steg s2" x="180" y="20" width="120" height="40" rx="6"/>
  <text x="240" y="45" text-anchor="middle" font-size="14">Vurder</text>
  <line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>
  <rect class="steg s3" x="350" y="20" width="120" height="40" rx="6"/>
  <text x="410" y="45" text-anchor="middle" font-size="14">Fatt vedtak</text>
</svg>
`;

const pakke = (tittel: string, figur: string, alt: string) => ({
  exportFormat: "a2-content-export/v1",
  exportedAt: new Date().toISOString(),
  scope: "section",
  section: {
    title: three(tittel),
    bodyMarkdown: three(`# ${tittel}\n\nLaget av den automatiske stage-testen. Kan slettes.\n\n![${alt}](asset:figur)\n`),
    audit: {},
    assets: [{ sourceId: "figur", filename: "figur.svg", mimeType: "image/svg+xml", sizeBytes: Buffer.byteLength(figur), contentBase64: b64(figur), sourceLocale: "nb" }],
  },
});

const opprettet: string[] = [];
async function importer(tittel: string, figur: string, alt: string): Promise<{ sectionId: string; assetId: string }> {
  const svar = await api("POST", "/api/admin/content/sections/import", { payload: pakke(tittel, figur, alt), mode: "createNew" });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(201);
  const sectionId = svar.json.sectionId as string;
  opprettet.push(sectionId);
  const liste = await api("GET", `/api/admin/content/sections/${sectionId}/assets`);
  const assets = liste.json.assets as Array<{ id: string }>;
  expect(assets).toHaveLength(1);
  return { sectionId, assetId: assets[0]!.id };
}

test.afterAll(async () => {
  // Rydd: arkiver og slett det testen laget. En opprydding som feiler, skal ikke skjule funnene —
  // men den skal sies fra om, så ingenting blir liggende uten at noen vet det.
  for (const sectionId of opprettet) {
    const arkivert = await api("POST", `/api/admin/content/sections/${sectionId}/archive`);
    const slettet = await api("DELETE", `/api/admin/content/sections/${sectionId}`);
    noter("opprydding", `testseksjon ${sectionId.slice(-6)}`, slettet.status === 204 ? "slettet" : `IKKE slettet (arkiver ${arkivert.status}, slett ${slettet.status})`);
  }
});

// ── Nettleseren ────────────────────────────────────────────────────────────────────────────────

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  // Samme grep som de andre stage-suitene: appen tror den kjører i mock-modus, og hver API-
  // forespørsel får den ekte innloggingen lagt på. Da kjører den EKTE klienten mot de EKTE dataene.
  await page.route("**/api/**", async (r: Route) => {
    await r.continue({ headers: { ...r.request().headers(), ...hoder() } });
  });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

/** Bredden nettleseren gir figuren når den vises som bilde: over 0 når fila lar seg lese. */
async function bildebredde(page: Page, svg: string): Promise<number> {
  await page.setContent(`<img id="f" alt="">`);
  return page.evaluate((kilde) => new Promise<number>((ferdig) => {
    const el = document.getElementById("f") as HTMLImageElement;
    el.onload = () => ferdig(el.naturalWidth);
    el.onerror = () => ferdig(0);
    el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kilde)}`;
  }), svg);
}

const etiketter = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);

// ── #1083: figur med hardt mellomrom ───────────────────────────────────────────────────────────

test.describe("#1083 — en figur med hardt mellomrom vises", () => {
  // Testene her bygger på samme importerte seksjon, så de går i rekkefølge og stopper ved første feil.
  test.describe.configure({ mode: "serial" });
  let seksjon: { sectionId: string; assetId: string };

  test("importert figur leveres som en fil nettleseren kan lese, med etikettene i behold", async ({ page }) => {
    seksjon = await importer(`Stage-test hardt mellomrom ${Date.now()}`, FIGUR_HARDT_MELLOMROM, "Tre bokser");
    const figur = await hentFigur(seksjon.assetId);
    expect(figur.status).toBe(200);
    expect(figur.type).toContain("image/svg+xml");
    // Det som gjorde figuren uleselig før: `&nbsp;` finnes ikke i XML.
    expect(figur.svg).not.toContain("&nbsp;");
    expect(figur.svg).toContain(`aria-label="Terskel: belop &lt; 500 kr"`);
    expect(etiketter(figur.svg).slice(0, 3)).toEqual([`§${NBSP}12`, `10${NBSP}%`, `kr${NBSP}500`]);
    expect(await bildebredde(page, figur.svg), "figuren skal la seg vise som bilde").toBeGreaterThan(0);
    noter("#1083", "importert figur vises som bilde", "ja");
  });

  test("åpnet direkte i en fane vises figuren som SVG, ikke som en XML-feilside", async ({ page }) => {
    await page.route("**/api/**", async (r: Route) => r.continue({ headers: { ...r.request().headers(), ...hoder() } }));
    await page.goto(`${BASE}/api/content-assets/${seksjon.assetId}`);
    const rot = await page.evaluate(() => ({ navn: document.documentElement.localName, feil: document.querySelector("parsererror") !== null, tekster: [...document.querySelectorAll("text")].length }));
    expect(rot).toEqual({ navn: "svg", feil: false, tekster: 4 });
    await bilde(page, "1083-figur-i-egen-fane");
  });

  test("oversatt til engelsk og nynorsk: begge variantene lar seg lese, og etikettene er oversatt", async ({ page }) => {
    test.setTimeout(180000);
    const oversatt = await api("POST", `/api/admin/content/sections/${seksjon.sectionId}/assets/localize`, { sourceLocale: "nb" });
    expect(oversatt.status, oversatt.tekst.slice(0, 300)).toBe(200);
    expect(oversatt.json.localizedAssetCount).toBe(1);

    const norsk = await hentFigur(seksjon.assetId, "?locale=nb");
    for (const språk of ["en-GB", "nn"]) {
      const variant = await hentFigur(seksjon.assetId, `?locale=${språk}`);
      expect(variant.status).toBe(200);
      expect(variant.svg, `${språk}: varianten skal være en annen fil enn den norske`).not.toBe(norsk.svg);
      expect(variant.svg).not.toContain("&nbsp;");
      expect(await bildebredde(page, variant.svg), `${språk}: varianten skal la seg vise som bilde`).toBeGreaterThan(0);
      expect(etiketter(variant.svg)).toHaveLength(4);
      noter("#1083", `etiketter på ${språk}`, etiketter(variant.svg).join(" · "));
    }
  });

  test("forhåndsvisningen i editoren viser figuren", async ({ page }) => {
    await forberedSide(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/admin-content/sections?id=${seksjon.sectionId}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-form-tab-btn="forhandsvisning"]').click({ timeout: VENT_MS });
    const figur = page.locator("#previewPane img").first();
    await expect.poll(async () => (await figur.getAttribute("src")) ?? "", { timeout: VENT_MS }).toMatch(/^blob:/);
    const bredde = await figur.evaluate((el) => new Promise<number>((ferdig) => {
      const img = el as HTMLImageElement;
      if (img.complete) ferdig(img.naturalWidth); else { img.onload = () => ferdig(img.naturalWidth); img.onerror = () => ferdig(0); }
    }));
    expect(bredde, "figuren i forhåndsvisningen").toBeGreaterThan(0);
    await figur.scrollIntoViewIfNeeded();
    await bilde(page, "1083-forhaandsvisning");
  });

  test("opplasting for hånd: samme figur lastet opp som fil vises også", async ({ page }) => {
    const skjema = new FormData();
    skjema.append("file", new Blob([FIGUR_HARDT_MELLOMROM], { type: "image/svg+xml" }), "hardt-mellomrom.svg");
    const svar = await fetch(`${BASE}/api/admin/content/sections/${seksjon.sectionId}/assets`, { method: "POST", headers: hoder(), body: skjema });
    expect(svar.status).toBe(201);
    const { asset } = (await svar.json()) as { asset: { id: string } };
    const figur = await hentFigur(asset.id);
    expect(figur.svg).not.toContain("&nbsp;");
    expect(await bildebredde(page, figur.svg)).toBeGreaterThan(0);
    noter("#1083", "opplastet figur vises som bilde", "ja");
  });
});

// ── #1073: animert figur ───────────────────────────────────────────────────────────────────────

test.describe("#1073 — en animert figur beveger seg slik den skal", () => {
  test("den lagrede figuren har tre animasjoner som går én gang, etter tur, og hviler med alt synlig", async ({ page }) => {
    const { assetId } = await importer(`Stage-test animert figur ${Date.now()}`, FIGUR_ANIMERT, "Saksgang i tre steg");
    const figur = await hentFigur(assetId);
    expect(figur.status).toBe(200);
    expect(await bildebredde(page, figur.svg)).toBeGreaterThan(0);

    // Figuren åpnet for seg selv, slik at nettleseren kan spørres om animasjonene i den.
    await page.goto(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(figur.svg)}`);
    const animasjoner = await page.evaluate(() => document.getAnimations().map((a) => {
      const t = a.effect!.getComputedTiming();
      return { steg: ((a.effect as KeyframeEffect).target as Element).getAttribute("class"), runder: t.iterations, slutt: Number(t.endTime) };
    }));
    expect(animasjoner.map((a) => a.steg).sort()).toEqual(["steg s1", "steg s2", "steg s3"]);
    for (const a of animasjoner) { expect(a.runder).toBe(1); expect(a.slutt).toBeLessThanOrEqual(5000); }
    expect(new Set(animasjoner.map((a) => a.slutt)).size, "stegene skal lyse opp etter tur").toBe(3);

    await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
    const synlige = await page.locator("rect, text").evaluateAll((els) => els.filter((el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0; }).length);
    expect(synlige).toBe(6);
    noter("#1073", "animasjoner i den lagrede figuren", animasjoner.map((a) => `${a.steg}: ferdig etter ${a.slutt / 1000} s`).join(" · "));
  });
});

// ── #1080 og #1081: listene, med det ekte innholdet ────────────────────────────────────────────

const LISTER = [
  { navn: "moduler", rute: "/admin-content", harMer: true },
  { navn: "kurs", rute: "/admin-content/courses", harMer: true },
  { navn: "seksjoner", rute: "/admin-content/sections", harMer: true },
  { navn: "klasser", rute: "/deltakere/klasser", harMer: false },
];

async function åpneListe(page: Page, rute: string, bredde: number) {
  await forberedSide(page);
  await page.setViewportSize({ width: bredde, height: 844 });
  await page.goto(`${BASE}${rute}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible({ timeout: VENT_MS });
}

test.describe("#1080 — listene på telefon (390 px), med ekte innhold", () => {
  for (const liste of LISTER) {
    test(`${liste.navn}: hver verdi har kolonnenavnet sitt, ingenting er klippet, og sida ruller ikke sidelengs`, async ({ page }) => {
      await åpneListe(page, liste.rute, 390);
      const måling = await page.locator(".list-table tbody tr").evaluateAll((rader) => {
        const funn = { rader: rader.length, utenEtikett: [] as string[], utenforKortet: [] as string[], klippet: [] as string[], lengsteNavn: "" };
        for (const rad of rader) {
          // Første linje i navnecellen: merker som «System» står i samme celle, på egen linje.
          const navn = ((rad.querySelector(".col-name, .col-title") as HTMLElement | null)?.innerText ?? "").trim().split(/\r?\n/)[0] ?? "";
          if (navn.length > funn.lengsteNavn.length) funn.lengsteNavn = navn;
          for (const td of rad.querySelectorAll("td")) {
            const etikett = getComputedStyle(td, "::before").content;
            const erHandlinger = td.classList.contains("col-actions");
            if (!erHandlinger && !/^"[^"]+"$/.test(etikett)) funn.utenEtikett.push(`${navn}: ${td.className}`);
            const kort = td.closest(".list-table-wrap")!.getBoundingClientRect();
            if (td.getBoundingClientRect().right - kort.right > 0.5) funn.utenforKortet.push(`${navn}: ${td.className}`);
            if (td.scrollWidth > td.clientWidth) funn.klippet.push(`${navn}: ${td.className}`);
          }
        }
        return funn;
      });
      expect(måling.rader).toBeGreaterThan(0);
      expect(måling.utenEtikett, "celler uten synlig kolonnenavn").toEqual([]);
      expect(måling.utenforKortet, "celler som går ut av kortet").toEqual([]);
      expect(måling.klippet, "celler der innholdet er bredere enn cellen").toEqual([]);
      const sidelengs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // Myk påstand: et funn her skal meldes, men ikke hindre at resten av lista måles og avbildes.
      if (sidelengs > 0) {
        const årsak = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 0.5; }).map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} «${(el.textContent ?? "").trim().slice(0, 30)}»`).slice(-3).join(", "));
        noter("#1080", `${liste.navn}: sida kan rulles ${sidelengs} px sidelengs`, `stikker ut: ${årsak}`);
      }
      expect.soft(sidelengs, "piksler sida kan rulles sidelengs").toBeLessThanOrEqual(0);
      noter("#1080", `${liste.navn}: rader målt`, måling.rader);
      noter("#1080", `${liste.navn}: lengste navn`, `${måling.lengsteNavn.length} tegn — «${måling.lengsteNavn.slice(0, 70)}»`);
      await bilde(page, `1080-${liste.navn}-390`);
    });
  }

  test("moduler: «Døp om» åpner et skrivefelt inne i kortet, og Escape lukker det uten å endre noe", async ({ page }) => {
    await åpneListe(page, "/admin-content", 390);
    const knapp = page.getByRole("button", { name: "Døp om" }).first();
    test.skip((await knapp.count()) === 0, "ingen modul i lista kan døpes om av denne brukeren");
    const rad = knapp.locator("xpath=ancestor::tr");
    const navnFør = (await rad.locator("td.col-name").innerText()).trim();
    await knapp.click();
    const felt = rad.locator(".row-rename input");
    await expect(felt).toBeFocused();
    const innenfor = await felt.evaluate((el) => { const f = el.getBoundingClientRect(); const c = el.closest("td")!.getBoundingClientRect(); return f.left >= c.left - 0.5 && f.right <= c.right + 0.5; });
    expect(innenfor, "skrivefeltet skal ligge innenfor navnecellen").toBe(true);
    await bilde(page, "1080-doep-om-390");
    await page.keyboard.press("Escape");
    await expect(felt).toHaveCount(0);
    expect((await rad.locator("td.col-name").innerText()).trim()).toBe(navnFør);
  });
});

// Funnet første gang denne testen kjørte mot stage (2026-10-04): med de ekte dataene er modullista
// 67 px bredere enn ramma si, og «Mer» ligger utenfor til man ruller tabellen sidelengs. De mockede
// e2e-testene har korte navn og verdier og kunne ikke se det. Måles for alle tre listene.
test.describe("PC-bredde — handlingene er synlige uten å rulle tabellen sidelengs", () => {
  for (const liste of LISTER.filter((l) => l.harMer)) {
    test(`${liste.navn}, 1280 px: tabellen er ikke bredere enn ramma, og «Mer» ligger innenfor`, async ({ page }) => {
      await åpneListe(page, liste.rute, 1280);
      const måling = await page.locator(".list-table-wrap").evaluate((wrap) => {
        const ramme = wrap.getBoundingClientRect();
        const mer = wrap.querySelector("tbody tr .row-more > summary");
        return {
          forBred: wrap.scrollWidth - wrap.clientWidth,
          merUtenfor: mer ? Math.max(0, Math.round(mer.getBoundingClientRect().right - ramme.right)) : null,
          kolonner: [...wrap.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim()).filter(Boolean).join(" · "),
        };
      });
      noter("PC-bredde", `${liste.navn}: tabellen er bredere enn ramma med`, `${måling.forBred} px`);
      if (måling.merUtenfor) noter("PC-bredde", `${liste.navn}: «Mer» stikker ut av ramma med`, `${måling.merUtenfor} px (kolonner: ${måling.kolonner})`);
      await bilde(page, `pc-${liste.navn}-1280`);
      expect.soft(måling.forBred, "piksler tabellen er bredere enn ramma").toBeLessThanOrEqual(0);
      expect.soft(måling.merUtenfor ?? 0, "piksler «Mer» stikker ut av ramma").toBe(0);
    });
  }
});

test.describe("#1081 — «Mer» i nederste rad, med ekte innhold", () => {
  for (const bredde of [1280, 390]) {
    for (const liste of LISTER.filter((l) => l.harMer)) {
      test(`${liste.navn}, ${bredde} px: hele menyen ligger innenfor ramma, og Escape rydder opp`, async ({ page }) => {
        await åpneListe(page, liste.rute, bredde);
        const sisteMedMer = page.locator(".list-table tbody tr").filter({ has: page.locator(".row-more > summary") }).last();
        test.skip((await sisteMedMer.count()) === 0, "ingen rad i lista har «Mer» for denne brukeren");
        // Er raden med «Mer» også den nederste? Bare da tester dette det #1081 handlet om.
        const erNederst = await sisteMedMer.evaluate((rad) => rad === rad.parentElement!.lastElementChild);
        noter("#1081", `${liste.navn}, ${bredde} px: raden med «Mer» er nederste rad`, erNederst ? "ja" : "nei");

        const høydeFør = await page.locator(".list-table-wrap").evaluate((w) => Math.round(w.getBoundingClientRect().height));
        await sisteMedMer.scrollIntoViewIfNeeded();
        await sisteMedMer.locator(".row-more > summary").click();
        const valg = sisteMedMer.locator(".row-more-menu .row-action-btn");
        await expect(valg.first()).toBeVisible();

        await expect.poll(() => valg.evaluateAll((knapper) => {
          const ramme = knapper[0]!.closest(".list-table-wrap")!.getBoundingClientRect();
          return knapper.filter((k) => k.getBoundingClientRect().bottom > ramme.bottom + 0.5).map((k) => (k.textContent ?? "").trim());
        }), { message: "valg som ligger under rammekanten" }).toEqual([]);
        const rullerInni = await page.locator(".list-table-wrap").evaluate((w) => w.scrollHeight > w.clientHeight);
        expect(rullerInni, "tabellen skal ikke få et eget rullefelt").toBe(false);
        noter("#1081", `${liste.navn}, ${bredde} px: valg i menyen`, (await valg.allInnerTexts()).map((t) => t.trim()).join(" · "));
        await sisteMedMer.locator(".row-more-menu").scrollIntoViewIfNeeded();
        await bilde(page, `1081-${liste.navn}-${bredde}`);

        await page.keyboard.press("Escape");
        await expect(valg.first()).toBeHidden();
        await expect.poll(() => page.locator(".list-table-wrap").evaluate((w) => Math.round(w.getBoundingClientRect().height)), { message: "lufta under lista skal forsvinne" }).toBe(høydeFør);
      });
    }
  }
});

// ── #894: omdøping i lista virker som før — på en seksjon testen selv har laget ────────────────

test.describe("#894 — omdøping i lista virker som før", () => {
  test("en testseksjon døpes om fra lista: navnet lagres, og de andre språkene står urørt", async ({ page }) => {
    const tittel = `Stage-test omdoeping ${Date.now()}`;
    const { sectionId } = await importer(tittel, FIGUR_HARDT_MELLOMROM, "Tre bokser");
    await åpneListe(page, "/admin-content/sections", 1280);
    const rad = page.locator(`tr[data-row-id="${sectionId}"]`);
    await expect(rad).toBeVisible({ timeout: VENT_MS });
    await rad.getByRole("button", { name: "Døp om" }).click();
    const felt = rad.locator(".row-rename input");
    await felt.fill(`${tittel} — nytt navn`);
    await page.keyboard.press("Enter");
    await expect(rad.locator("td.col-title, td.col-name").first()).toContainText("nytt navn", { timeout: VENT_MS });

    const lagret = await api("GET", `/api/admin/content/sections/${sectionId}`);
    const tittelfelt = JSON.stringify(lagret.json);
    expect(tittelfelt).toContain(`${tittel} — nytt navn`);
    // De to andre språkene hadde samme tittel, og skal ikke være berørt av omdøpingen på bokmål.
    expect(tittelfelt.split(tittel).length - 1, "tittelen skal fortsatt stå på alle tre språk").toBeGreaterThanOrEqual(3);
    await bilde(page, "894-omdoept-i-lista");
  });
});
