import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.124.0 mot UTRULLET stage: #1123 «Finn feilene». Forhåndsvisningen tegner `:::feil`-rammen som
// setninger å markere, med fasiten i markupen; mot den ekte modellen beholder oversettelsen til en-GB
// og nn rammen, setningene og hvilke av dem som er feil, og den oversatte teksten tegnes som samme blokk.
//
// Testen skriver ingenting på stage: den bruker bare forhåndsvisningen og oversettelsen.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`)
// og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.124.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const TEKST = [
  "Notatene fra styremøtet sier: *Til stede: Kari, Ola, Siri. Vedtak: budsjettet godkjent.",
  "Ola sender budsjettet til revisor innen 1. november. Ikke avklart hvem som bestiller lokale.*",
  "",
  ":::feil Finn feilene i KI-utkastet før det sendes.",
  "- [ ] Vedtak: Budsjettet ble godkjent.",
  "- [x] Ola sender budsjettet til revisor innen 15. november.",
  "  Notatene sier 1. november. Du finner det når du sjekker hver frist mot notatene.",
  "- [x] Kari bestiller lokale.",
  "  Notatene sier at det ikke er avklart. Utkastet skulle sagt «uklart».",
  "- [ ] Til stede: Kari, Ola og Siri.",
  ":::",
].join("\n");

// Hva blokken består av, lest av markupen tjeneren tegner: setningene i rekkefølge, true = feil.
function fasit(html: string): boolean[] {
  expect(html, "blokken tegnes").toContain("data-content-errors");
  return [...html.matchAll(/data-errors-item[^>]*data-error="(true|false)"/g)].map((m) => m[1] === "true");
}

async function forhåndsvis(markdown: string, locale: string): Promise<string> {
  const svar = await api("POST", "/api/admin/content/sections/preview", { markdown, locale });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  return svar.json.html as string;
}

test("versjonen er 2.124.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.124.0");
});

test("forhåndsvisningen tegner setningene med fasiten", async () => {
  const html = await forhåndsvis(TEKST, "nb");
  const rekke = fasit(html);
  noter("nb: setninger (true = feil)", rekke);
  expect(rekke).toEqual([false, true, true, false]);
  expect(html).toContain("data-errors-check");
});

for (const mål of ["en-GB", "nn"] as const) {
  test(`KI-oversettelse til ${mål} beholder rammen og hvilke setninger som er feil`, async () => {
    test.setTimeout(240_000);
    const svar = await api("POST", "/api/admin/content/sections/localize", {
      sourceLocale: "nb",
      targetLocale: mål,
      title: "Sjekk referatet",
      bodyMarkdown: TEKST,
    });
    expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
    const oversatt = String(svar.json.bodyMarkdown);
    noter(`${mål}: oversatt tekst`, oversatt);
    expect(oversatt).toMatch(/^:::[ \t]*(feil|errors)\b/m);
    const html = await forhåndsvis(oversatt, mål);
    const rekke = fasit(html);
    noter(`${mål}: setninger (true = feil)`, rekke);
    expect(rekke).toEqual([false, true, true, false]);
    expect((html.match(/content-errors-explain/g) ?? []).length, "forklaringen under hver feil").toBe(2);
  });
}
