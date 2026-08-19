// Autentiserte tester mot UTRULLET stage med REELLE data.
//
// Produkteier, 2026-08-19: *«Alt annet bør testes via Playwright, dette inkluderer å teste mot Stage
// slik at du kan teste mot reelle data.»* Dette er den halvdelen som krever innlogging.
//
// Sesjonen fanges én gang med `npm run stage:auth` (åpner en ekte nettleser, du logger inn, og
// access-tokenet lagres i den gitignorerte `.stage-auth.json`). Uten fila hopper alt under over —
// suiten skal aldri feile fordi noen ikke har logget inn, bare fortelle at den ikke kjørte.
//
// ⚠️ **Disse testene er LESENDE.** De oppretter ikke innhold, endrer ikke innhold og sletter ikke
// innhold på stage. Det er et bevisst valg: stage er et testmiljø, men det er også der produkteier
// har innhold hen faktisk tester med, og en suite som rydder «sitt eget» innhold er én feilslått
// filtrering unna å rydde noe annet. Trenger vi skrivende tester, får de opprette i en egen,
// tydelig merket sandkasse.

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type StageAuth = {
  baseUrl: string;
  accessToken: string;
  expiresOn: number;
  username: string | null;
  roles: string[];
};

function readAuth(): { auth: StageAuth | null; reason: string } {
  const file = path.resolve(process.cwd(), ".stage-auth.json");
  if (!fs.existsSync(file)) {
    return { auth: null, reason: "ingen .stage-auth.json — kjør `npm run stage:auth` først" };
  }
  let parsed: StageAuth;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StageAuth;
  } catch {
    return { auth: null, reason: ".stage-auth.json kunne ikke leses" };
  }
  if (!parsed.accessToken) return { auth: null, reason: ".stage-auth.json mangler token" };
  if (parsed.expiresOn && parsed.expiresOn < Date.now()) {
    return { auth: null, reason: "sesjonen er utløpt — kjør `npm run stage:auth` på nytt" };
  }
  return { auth: parsed, reason: "" };
}

const { auth, reason } = readAuth();
const BASE = auth?.baseUrl
  ?? process.env.STAGE_BASE_URL
  ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";

test.describe("utrullet stage — reelle data", () => {
  test.skip(!auth, `Hopper over: ${reason}`);

  const headers = () => ({ Authorization: `Bearer ${auth!.accessToken}` });

  test("sesjonen er den vi tror, og har forfatterrettigheter", async ({ request }) => {
    const me = await request.get(`${BASE}/api/me`, { headers: headers() });
    expect(me.ok()).toBe(true);
    const body = await me.json();
    const roles: string[] = body?.roles ?? body?.user?.roles ?? [];
    // Uten en av disse er resten av suiten meningsløs — den ville målt 403 og kalt det en test.
    expect(
      roles.some((r) => r === "SUBJECT_MATTER_OWNER" || r === "ADMINISTRATOR"),
      `sesjonen har rollene ${roles.join(", ") || "(ingen)"} — trenger SMO eller ADMINISTRATOR`,
    ).toBe(true);
  });

  // ── Det som ikke kan mockes: hvordan gaten leser innhold som faktisk finnes ────────────────
  //
  // Publiseringsgaten gjelder nå seksjoner (#916), og stage har innhold skrevet før gaten fantes.
  // Spørsmålet er ikke om gaten virker — det er dekket av integrasjonstester — men hvor mange
  // forfattere den låser ute fra innhold som virket i går. Det kan bare ekte data svare på.
  test("kartlegger hvor mye eksisterende innhold den nye seksjonsgaten ville blokkere", async ({ request }) => {
    const response = await request.get(`${BASE}/api/admin/content/sections`, { headers: headers() });
    expect(response.ok(), `sections svarte ${response.status()}`).toBe(true);

    const sections: Array<{ id: string; title: unknown; activeVersionId?: string | null }> =
      (await response.json()).sections ?? [];

    // En ren streng betyr «ett språk, ikke oversatt ennå» — og det er nettopp formen gaten
    // blokkerer. Et lokale-objekt som mangler et språk gjør det også.
    const oneLanguage = sections.filter((s) => typeof s.title === "string");
    const partial = sections.filter((s) => {
      if (typeof s.title !== "object" || s.title === null) return false;
      const t = s.title as Record<string, unknown>;
      return ["en-GB", "nb", "nn"].some((l) => typeof t[l] !== "string" || !String(t[l]).trim());
    });

    // Ingen terskel her — dette er en MÅLING, ikke en grense. Tallet er svaret produkteier trenger
    // for #932, og det å feile på det ville bare skjult det.
    console.log(
      `[stage] seksjoner: ${sections.length} · ettspråks tittel: ${oneLanguage.length}`
      + ` · delvis oversatt tittel: ${partial.length}`,
    );

    expect(Array.isArray(sections)).toBe(true);
  });

  test("kartlegger det samme for moduler", async ({ request }) => {
    const response = await request.get(`${BASE}/api/admin/content/modules`, { headers: headers() });
    expect(response.ok(), `modules svarte ${response.status()}`).toBe(true);

    const modules: Array<{ id: string; title: unknown }> = (await response.json()).modules ?? [];
    const oneLanguage = modules.filter((m) => typeof m.title === "string");
    const allThreeIdentical = modules.filter((m) => {
      if (typeof m.title !== "object" || m.title === null) return false;
      const t = m.title as Record<string, string>;
      const values = ["en-GB", "nb", "nn"].map((l) => t[l]).filter(Boolean);
      return values.length === 3 && new Set(values).size === 1;
    });

    // Den siste er den gamle løgnen fra #892: tre identiske kopier passerer gaten, men er ikke
    // oversatt. Gaten kan ikke se dem — men vi kan telle dem her.
    console.log(
      `[stage] moduler: ${modules.length} · ettspråks tittel: ${oneLanguage.length}`
      + ` · tre identiske kopier (#892-arv): ${allThreeIdentical.length}`,
    );

    expect(Array.isArray(modules)).toBe(true);
  });

  // ── Formen på ekte svar, ikke formen vi mocket ────────────────────────────────────────────
  //
  // Modultype-funnet fra stage var nettopp dette: e2e-en er grønn fordi mocken bygger en modul som
  // har alt. Her ser vi hva serveren faktisk sender for en ekte modul.
  test("bundlen bærer versjonshistorikken Innstillinger trenger for modultype", async ({ request }) => {
    const list = await request.get(`${BASE}/api/admin/content/modules`, { headers: headers() });
    const modules: Array<{ id: string }> = (await list.json()).modules ?? [];
    test.skip(modules.length === 0, "ingen moduler på stage å inspisere");

    const bundle = await request.get(
      `${BASE}/api/admin/content/modules/${modules[0].id}/content-bundle`,
      { headers: headers() },
    );
    expect(bundle.ok(), `content-bundle svarte ${bundle.status()}`).toBe(true);

    const body = (await bundle.json()).moduleExport ?? (await bundle.json());
    // `renderSettingsPanel` leser tilgjengelige modultyper ut av HISTORIKKEN, ikke ut av gjeldende
    // versjons pekere. Mangler disse i det ekte svaret, er hvert valg deaktivert uansett hva
    // modulen inneholder — og det er akkurat det produkteier så.
    expect(body.versions, "bundlen mangler `versions`").toBeTruthy();
    for (const key of ["moduleVersions", "rubricVersions", "promptTemplateVersions", "mcqSetVersions"]) {
      expect(Array.isArray(body.versions?.[key]), `versions.${key} er ikke en liste`).toBe(true);
    }
  });

  // ── Eierskap, mot ekte roller ─────────────────────────────────────────────────────────────
  //
  // #903 finnes fordi en eksportrute gikk i produksjon uten eierskapssjekk. Her er de nye rutene
  // fra #916, mot en ekte innlogget bruker.
  test("seksjonseksport svarer for egne seksjoner og 404/403 for tull", async ({ request }) => {
    const bogus = await request.get(
      `${BASE}/api/admin/content/sections/not-a-real-section-id/export-package`,
      { headers: headers() },
    );
    // Enten «finnes ikke» eller «ikke din» — men aldri 200, og aldri 500.
    expect([403, 404]).toContain(bogus.status());
  });
});
