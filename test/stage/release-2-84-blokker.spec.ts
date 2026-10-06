import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.84.x mot UTRULLET stage: innholdsblokkene (#1079) — uthevet boks, prompt-boks med «Kopier»,
// kort med ikon, og en tabell med kolonnenavn på telefon — hele kjeden med den ekte tjeneren:
// importert, vist i forhåndsvisningen i seksjonsredigeringen, og vist til en deltaker i et publisert
// kurs, på PC- og telefonbredde.
//
// Det testen skriver på stage: én testseksjon og ett testkurs med navn som begynner på
// «Stage-test innholdsblokker». Kurset publiseres for at deltakervisningen skal kunne måles, og begge
// slettes til slutt (STAGE_BEHOLD=1 lar kurset stå, så det kan ses på en ekte telefon).
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.
// Lokal prøvekjøring: STAGE_LOKAL=http://127.0.0.1:3001 (appen i mock-modus mot testdatabasen).

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const VENT_MS = 45000;
const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.84 blokker", hva, verdi: String(verdi) })}\n`, "utf8");
};
const bilde = (page: Page, navn: string) => { fs.mkdirSync(RAPPORT, { recursive: true }); return page.screenshot({ path: path.join(RAPPORT, `${navn}.png`), fullPage: false }); };

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; tekst: string }> {
  await vent();
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

const stempel = Date.now();
const TITTEL_START = "Stage-test innholdsblokker ";
const TITTEL = `${TITTEL_START}${stempel}`;
const three = (tekst: string) => ({ nb: tekst, nn: tekst, "en-GB": tekst });
const F = "```";
const PROMPT = "Du skal skrive kapittel [nummer] i en rapport.\nLesere: [hvem som skal lese den]\nBruk bare kildene i prosjektet. Skriv «uklart» der kildene ikke sier noe.";
const IKON = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 96 96" fill="none" stroke="#33312b" stroke-width="6" stroke-linecap="round"><path d="M24 28h48M24 48h48M24 68h30"/></svg>';
const MARKDOWN = [
  `# ${TITTEL}`,
  "",
  "Laget av den automatiske stage-testen. Kan slettes. Fire arbeidsformer står til valg.",
  "",
  ":::kort",
  "### ![](asset:ikon) Chat (samtale)",
  "",
  "**Når bruke**",
  "",
  "Rask hjelp, idémyldring, utkast.",
  "",
  "- Raskt og fleksibelt",
  "- Lett å prøve ut ideer",
  "",
  "### ![](asset:ikon) Lerret (Canvas)",
  "",
  "Når du skal utvikle tekst stegvis over tid.",
  "",
  "> **Tips:** Bruk lerretet til selve rapportteksten.",
  "",
  "### Prosjekt",
  "",
  "Komplekse oppgaver med mange kilder.",
  "",
  "### Grundig tenkemodus",
  "",
  "Krevende analyser der kvalitet går foran fart.",
  ":::",
  "",
  "> **Husk:** Jo mer du legger i kontekstvinduet, desto viktigere er det å rydde.",
  "",
  "> **Viktig:** Du eier vurderingene og står ansvarlig for innholdet.",
  "",
  "## Slik ber du om et kapittelutkast",
  "",
  `${F}prompt`,
  PROMPT,
  F,
  "",
  "| Kapittel | Innhold | Eksempel på en god formulering i teksten |",
  "|---|---|---|",
  "| Sammendrag | Hovedfunn og **anbefalinger** til ledelsen | Førsteutkast fra ferdig rapport |",
  "| Metode | Hvordan dataene er samlet inn | Struktur og språk |",
].join("\n");

let sectionId = "";
let courseId = "";
const behold = process.env.STAGE_BEHOLD === "1";

async function slettKurs(id: string) {
  await api("POST", `/api/admin/content/courses/${id}/unpublish`);
  await api("POST", `/api/admin/content/courses/${id}/archive`);
  return api("DELETE", `/api/admin/content/courses/${id}`);
}
async function slettSeksjon(id: string) {
  await api("POST", `/api/admin/content/sections/${id}/archive`);
  return api("DELETE", `/api/admin/content/sections/${id}`);
}
const erTestens = (tittel: unknown): boolean => JSON.stringify(tittel ?? "").includes(TITTEL_START);

test.beforeAll(async () => {
  if (!lokal && !auth) return;
  const kurs = ((await api("GET", "/api/admin/content/courses")).json.courses ?? []) as Array<{ id: string; title: unknown }>;
  const seksjoner = ((await api("GET", "/api/admin/content/sections")).json.sections ?? []) as Array<{ id: string; title: unknown }>;
  let slettet = 0;
  let igjen = 0;
  for (const k of kurs.filter((k) => erTestens(k.title))) ((await slettKurs(k.id)).status < 300 ? slettet++ : igjen++);
  for (const s of seksjoner.filter((s) => erTestens(s.title))) ((await slettSeksjon(s.id)).status < 300 ? slettet++ : igjen++);
  if (slettet > 0) noter("opprydding før start", `${slettet} testkurs/-seksjoner fra en tidligere kjøring er slettet`);
  if (igjen > 0) noter("opprydding før start: STÅR IGJEN, arkivert", `${igjen} testkurs/-seksjoner kan ikke slettes (fullført kurs med kursbevis)`);
});

test.afterAll(async () => {
  if (behold) {
    if (courseId) noter("STÅR IGJEN PÅ STAGE (for å se på en ekte telefon)", `kurset «${TITTEL}» — slettes av neste kjøring. Ikke trykk «Avslutt kurset»`);
    return;
  }
  if (courseId) {
    const slettet = await slettKurs(courseId);
    noter("opprydding: testkurset", slettet.status < 300 ? "slettet" : `IKKE slettet (${slettet.status}: ${slettet.tekst.slice(0, 120)})`);
  }
  if (sectionId) {
    const slettet = await slettSeksjon(sectionId);
    noter("opprydding: testseksjon", slettet.status === 204 ? "slettet" : `IKKE slettet (${slettet.status}: ${slettet.tekst.slice(0, 120)})`);
  }
});

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => { await vent(); await r.continue({ headers: { ...r.request().headers(), ...hoder() } }); });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

/** Hva blokkene ser ut som der de står: ett tall per ting som avgjør om de er tegnet. */
async function målBlokker(page: Page, rot: string) {
  const r = page.locator(rot);
  await expect(r.locator(".content-cards")).toBeVisible({ timeout: VENT_MS });
  return r.evaluate((el) => {
    const kort = [...el.querySelectorAll<HTMLElement>(".content-card")].map((k) => k.getBoundingClientRect());
    const bokser = [...el.querySelectorAll<HTMLElement>(".content-callout")].map((b) => getComputedStyle(b).backgroundColor);
    const varsel = el.querySelector<HTMLElement>(".content-callout--warning");
    const knapp = el.querySelector<HTMLElement>(".content-prompt-copy");
    const celler = [...el.querySelectorAll<HTMLElement>(".content-table td")];
    const ikon = el.querySelector<HTMLImageElement>(".content-card-title img.content-icon");
    const kant = el.getBoundingClientRect().right + 0.5;
    const utenfor = [...el.querySelectorAll<HTMLElement>("*")].filter((x) => { const b = x.getBoundingClientRect(); return b.width > 1 && b.height > 1 && b.right > kant; }).length;
    return {
      kort: kort.length,
      kortPåÉnRad: new Set(kort.map((k) => Math.round(k.top))).size === 1,
      kortUnderHverandre: kort.every((k, i) => i === 0 || k.top >= kort[i - 1]!.bottom),
      bokser: bokser.length,
      bokserMedFarge: bokser.filter((f) => f !== "rgba(0, 0, 0, 0)").length,
      varselStrek: varsel ? getComputedStyle(varsel).borderLeftWidth : null,
      knapp: knapp?.textContent?.trim() ?? null,
      celler: celler.length,
      kolonnenavnPåTelefon: celler.map((c) => getComputedStyle(c, "::before").content).filter((c) => c && c !== "none" && c !== '""').length,
      overskriftsradSkjult: el.querySelector(".content-table thead") ? getComputedStyle(el.querySelector(".content-table thead")!).display === "none" : null,
      ikonBredde: ikon ? Math.round(ikon.getBoundingClientRect().width) : null,
      utenfor,
    };
  });
}

test.describe("2.84 — innholdsblokkene på stage", () => {
  test("seksjonen importeres med kort, bokser, prompt og tabell", async () => {
    const pakke = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "section",
      section: {
        title: three(TITTEL),
        bodyMarkdown: three(MARKDOWN),
        audit: {},
        assets: [{ sourceId: "ikon", filename: "image7.svg", mimeType: "image/svg+xml", sizeBytes: Buffer.byteLength(IKON), contentBase64: Buffer.from(IKON, "utf8").toString("base64") }],
      },
    };
    const importert = await api("POST", "/api/admin/content/sections/import", { payload: pakke, mode: "createNew" });
    expect(importert.status, importert.tekst.slice(0, 400)).toBe(201);
    sectionId = importert.json.sectionId as string;

    // Tjenerens egen gjengivelse, slik forhåndsvisningen og leseren får den.
    const html = (await api("POST", "/api/admin/content/sections/preview", { markdown: MARKDOWN, locale: "nb" })).json.html as string;
    expect(html).toContain('<div class="content-cards">');
    expect((html.match(/content-card"/g) ?? []).length).toBe(4);
    expect(html).toContain("content-callout--warning");
    expect(html).toContain('class="content-prompt-copy"');
    expect(html).toContain('data-label="Eksempel på en god formulering i teksten"');
    noter("gjengivelsen på tjeneren", "4 kort, 3 bokser (1 varsel), 1 prompt-boks, tabell med kolonnenavn per celle");
  });

  for (const skjerm of [{ navn: "PC", w: 1280, h: 900 }, { navn: "telefon", w: 390, h: 844 }]) {
    test(`forhåndsvisningen i editoren, ${skjerm.navn} (${skjerm.w} px): blokkene er tegnet`, async ({ page }) => {
      await forberedSide(page);
      await page.setViewportSize({ width: skjerm.w, height: skjerm.h });
      await page.goto(`${BASE}/admin-content/sections?id=${sectionId}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-form-tab-btn="forhandsvisning"]').click({ timeout: VENT_MS });
      const m = await målBlokker(page, "#previewPane");
      expect(m.kort).toBe(4);
      expect(m.bokserMedFarge).toBe(3);
      expect(m.knapp).toBe("Kopier");
      expect(m.utenfor, "ingenting går ut av forhåndsvisningen").toBe(0);
      noter(`forhåndsvisning, ${skjerm.navn}`, `${m.kort} kort ${skjerm.w === 390 ? (m.kortUnderHverandre ? "under hverandre" : "IKKE under hverandre") : (m.kortPåÉnRad ? "på én rad" : "på flere rader")}, ${m.bokserMedFarge} bokser med farge, knapp «${m.knapp}»`);
      await page.locator("#previewPane .content-cards").scrollIntoViewIfNeeded();
      await bilde(page, `2-84-forhaandsvisning-${skjerm.w}`);
    });
  }

  test("seksjonen publiseres og legges i et publisert testkurs", async () => {
    const publisert = await api("POST", `/api/admin/content/sections/${sectionId}/publish`);
    expect(publisert.status, publisert.tekst.slice(0, 300)).toBe(200);
    const kurs = await api("POST", "/api/admin/content/courses", { title: three(TITTEL) });
    expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
    courseId = (kurs.json.course as { id: string }).id;
    const innhold = await api("PUT", `/api/admin/content/courses/${courseId}/items`, { items: [{ type: "SECTION", sectionId }] });
    expect(innhold.status, innhold.tekst.slice(0, 300)).toBe(204);
    const kursPublisert = await api("POST", `/api/admin/content/courses/${courseId}/publish`);
    expect(kursPublisert.status, kursPublisert.tekst.slice(0, 300)).toBe(200);
  });

  for (const skjerm of [{ navn: "PC", w: 1280, h: 900 }, { navn: "telefon", w: 390, h: 844 }]) {
    test(`deltakeren, ${skjerm.navn} (${skjerm.w} px): kort, bokser, prompt og tabell slik de skal`, async ({ page, context }) => {
      if (skjerm.w === 1280) await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
      await forberedSide(page);
      await page.setViewportSize({ width: skjerm.w, height: skjerm.h });
      await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
      const kurs = page.locator(".course-accordion-header").filter({ hasText: TITTEL }).first();
      await expect(kurs).toBeVisible({ timeout: VENT_MS });
      await kurs.click();
      const rad = page.locator(".course-item").filter({ hasText: TITTEL }).locator(".course-module-row").first();
      await expect(rad).toBeVisible({ timeout: VENT_MS });
      await rad.click();
      const m = await målBlokker(page, "#sectionReaderBody");
      expect(m.kort).toBe(4);
      expect(m.bokserMedFarge).toBe(3);
      expect(m.varselStrek).toBe("3px");
      expect(m.knapp).toBe("Kopier");
      expect(m.celler).toBe(6);
      expect(m.utenfor, "ingenting går ut av leseren").toBe(0);
      if (skjerm.w === 390) {
        expect(m.kortUnderHverandre, "kortene står under hverandre på telefon").toBe(true);
        expect(m.kolonnenavnPåTelefon, "hver celle viser kolonnenavnet sitt").toBe(6);
        expect(m.overskriftsradSkjult).toBe(true);
      } else {
        expect(m.kortPåÉnRad, "kortene står på én rad på PC").toBe(true);
        expect(m.kolonnenavnPåTelefon).toBe(0);
        // «Kopier» legger prompten på utklippstavla (Windows gir linjeskift tilbake som CRLF).
        await page.locator("#sectionReaderBody .content-prompt-copy").click();
        await expect(page.locator("#sectionReaderBody .content-prompt-copy")).toHaveText("Kopiert");
        const lest = await page.evaluate(() => navigator.clipboard.readText());
        expect(lest.split(String.fromCharCode(13)).join("")).toBe(PROMPT);
      }
      // Ikonet er hentet fra den ekte tjeneren (autentisert bilde) og står i overskriftens størrelse.
      await expect.poll(async () => (await målBlokker(page, "#sectionReaderBody")).ikonBredde, { timeout: VENT_MS }).toBeLessThanOrEqual(26);
      noter(`deltaker, ${skjerm.navn}`, `${m.kort} kort ${skjerm.w === 390 ? "under hverandre" : "på én rad"}, ${m.bokserMedFarge} bokser med farge, ${m.celler} celler${skjerm.w === 390 ? ` med ${m.kolonnenavnPåTelefon} kolonnenavn` : ""}, knapp «${m.knapp}»`);
      await page.locator("#sectionReaderBody .content-cards").scrollIntoViewIfNeeded();
      await bilde(page, `2-84-deltaker-${skjerm.w}`);
    });
  }
});
