import { test, expect, type Page, type Route } from "@playwright/test";

// Et kurs på telefon. Radene for leste og kommende steg hadde tittelen på ÉN linje, som skulle
// forkortes med «…» når den ikke fikk plass. To ting var galt:
//
// 1. Rutenettet rundt raden lot seg presse ut av den lange tittelen i stedet for å holde på
//    bredden, så hele kursinnholdet ble bredere enn skjermen (668 px på en skjerm på 390).
//    Tittelen, «Lest» og «Se igjen» gikk ut til høyre, og teksten i leseren ble kuttet.
// 2. Da det var rettet, viste det seg at tittelen ikke hadde noe sted å være: ved siden av typen,
//    statusen og «Se igjen» fikk den 20 px på en telefon på 360, og 0 på 320. På telefon står
//    tittelen nå på sin egen linje, hel.
//
// Funnet av produkteier på en ekte telefon 2026-10-05, i testkurset fra stage-testen.
//
// ⚠️ Hvorfor ingen test så det: de andre testene åpner et kurs med ETT steg som ikke er lest. Det
// steget vises som et kort, og der brekker tittelen. Feilen krever et steg som er lest (eller som
// kommer senere) med en tittel som er lengre enn raden — altså et helt vanlig kurs, etter første
// seksjon.
//
// ⚠️ Og første utgave av DENNE testen gjorde samme feil en gang til (QA-gjennomgangen av 2.82.2):
// den åpnet kurset uten diskusjon og bare på bokmål. Diskusjonslinja under stegene står på hvert
// kurs, har en tekst på én linje, og presset kursinnholdet ut på akkurat samme måte — 20 px på en
// telefon på 390 på engelsk, der tekstene er lengst. Kurset åpnes derfor her slik det er hos en
// deltaker: diskusjon på, og på både bokmål og engelsk.

const LANG = "Seksjon 3b: Fra kostnadsestimat til styrings- og kostnadsramme";

type Valg = { språk?: "nb" | "en-GB"; steg?: unknown[]; seksjonstekst?: string };
const STEG = [
  // Ett lest steg, ett som står for tur, ett som kommer — alle med en tittel som er lengre enn raden.
  { type: "SECTION", sectionId: "s1", title: LANG, read: true },
  { type: "SECTION", sectionId: "s2", title: "Seksjon 4: Usikkerhetsanalyse og avsetninger i store prosjekter", read: false },
  { type: "SECTION", sectionId: "s3", title: "Seksjon 5: Rapportering til styringsgruppa og endringshåndtering", read: false },
];
const TEKST = "<p>Et kostnadsestimat blir til en styringsramme når usikkerheten er regnet inn og fordelt mellom prosjektet og eieren.</p>";

async function åpneKurset(page: Page, bredde: number, { språk = "nb", steg = STEG, seksjonstekst = TEKST }: Valg = {}) {
  await page.setViewportSize({ width: bredde, height: 844 });
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Prosjektøkonomi for prosjektledere i offentlig sektor", description: null, moduleCount: 3, progress: { completed: 1, total: 3, courseStatus: "IN_PROGRESS" } }] })));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  // Diskusjon er PÅ, som den er som standard: linja under stegene er en del av kurset.
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Prosjektøkonomi for prosjektledere i offentlig sektor", discussionsEnabled: true, items: steg } })));
  await page.route("**/api/courses/c1/sections/*", (route: Route) => route.fulfill(json({ title: LANG, html: seksjonstekst })));
  await page.addInitScript((valgt) => { try { localStorage.setItem("participant.locale", valgt); } catch { /* ignore */ } }, språk);
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await expect(page.locator(".course-module-row")).toHaveCount(steg.length);
  // Kontroll: diskusjonslinja er der. Uten den måles et kurs ingen deltaker ser.
  await expect(page.locator(".course-discussion-toggle")).toBeVisible();
}

/** Det nettleseren har tegnet: hva i kurset stikker ut av skjermen, og kan noe rulles sidelengs? */
function mål(page: Page) {
  return page.evaluate(() => {
    const skjerm = document.documentElement.clientWidth;
    const ute = [...document.querySelectorAll<HTMLElement>("#courseSection *")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > skjerm + 0.5 || r.left < -0.5); })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} ${Math.round(el.getBoundingClientRect().left)}–${Math.round(el.getBoundingClientRect().right)}`);
    // En beholder som kan rulles sidelengs, skjuler det som stikker ut — og blir stående forskjøvet.
    // (En tekst som er forkortet med «…» med vilje, er ikke en slik beholder.)
    const rullbare = [...document.querySelectorAll<HTMLElement>("#courseSection, #courseSection *")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && getComputedStyle(el).textOverflow !== "ellipsis")
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${el.scrollWidth}>${el.clientWidth}`);
    // Kursrammen klipper det som går ut over kanten (overflow: hidden), så sida kan ikke rulles og
    // ingenting «stikker ut av skjermen» — innholdet er bare borte til høyre. Måles derfor for seg:
    // hvor langt går innholdet i kurset forbi innsiden av kursrammen?
    const ramme = document.querySelector<HTMLElement>(".course-accordion-item.is-focused");
    const innside = ramme ? ramme.getBoundingClientRect().right - 1 : skjerm;
    const lengstUt = Math.max(0, ...[...document.querySelectorAll<HTMLElement>(".course-accordion-item.is-focused *")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !el.closest(".sr-only"); })
      .map((el) => el.getBoundingClientRect().right));
    return { ute, rullbare, sidelengs: document.documentElement.scrollWidth - window.innerWidth, kuttet: Math.max(0, Math.round(lengstUt - innside)) };
  });
}

/** Sett KURS_BILDER til en mappe for å få skjermbilder å se på. */
const BILDER = process.env.KURS_BILDER ?? "";

test.describe("et kurs med lange stegtitler får plass på telefon", () => {
  // Engelsk har de lengste tekstene i menyer og hjelpelinjer, og er der det først blir trangt.
  for (const [bredde, språk] of [[390, "nb"], [360, "nb"], [320, "nb"], [390, "en-GB"], [360, "en-GB"]] as const) {
    test(`${bredde} px, ${språk}: ingenting i kurset er bredere enn skjermen eller kuttet, og «Se igjen» er synlig`, async ({ page }) => {
      await åpneKurset(page, bredde, { språk });
      // Kontroll: kurset har alle tre slags rader — lest, for tur og kommende.
      await expect(page.locator(".course-step--done")).toHaveCount(1);
      await expect(page.locator(".course-step--now")).toHaveCount(1);
      await expect(page.locator(".course-step--ahead")).toHaveCount(1);

      if (BILDER) await page.screenshot({ path: `${BILDER}/kurs-${bredde}-${språk}.png` });
      const m = await mål(page);
      expect(m.ute, "det som stikker ut av skjermen").toEqual([]);
      expect(m.kuttet, "piksler av kursinnholdet som er kuttet av kursrammen til høyre").toBe(0);
      expect(m.rullbare, "beholdere som er bredere inni enn utenpå").toEqual([]);
      expect(m.sidelengs).toBeLessThanOrEqual(0);
      await expect(page.locator(".course-step--done .course-step-review")).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".course-step--done .module-status-badge")).toBeInViewport({ ratio: 1 });

      // Tittelen kan leses i sin helhet, på både det leste og det kommende steget: ingenting av
      // den er skjult, og den står over typen og statusen, ikke klemt inn ved siden av dem.
      for (const rad of [".course-step--done", ".course-step--ahead"]) {
        const tittel = page.locator(`${rad} .course-step-title`);
        expect(await tittel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), `${rad}: hele tittelen er synlig`).toBe(true);
        const t = (await tittel.boundingBox())!;
        const type = (await page.locator(`${rad} .course-step-kind`).boundingBox())!;
        expect(t.width, `${rad}: tittelen har hele radens bredde`).toBeGreaterThan(bredde * 0.5);
        expect(t.y + t.height, `${rad}: tittelen står over typen`).toBeLessThanOrEqual(type.y + 1);
      }
    });

    test(`${bredde} px, ${språk}: et lest steg åpnet igjen — leseren og teksten er innenfor skjermen`, async ({ page }) => {
      await åpneKurset(page, bredde, { språk });
      await page.locator(".course-step--done").click();
      const leser = page.locator("#sectionReaderBody");
      await expect(leser).toContainText("kostnadsestimat");
      if (BILDER) await page.screenshot({ path: `${BILDER}/kurs-leser-${bredde}-${språk}.png` });
      const m = await mål(page);
      expect(m.ute, "det som stikker ut av skjermen").toEqual([]);
      expect(m.kuttet, "piksler av kursinnholdet som er kuttet av kursrammen til høyre").toBe(0);
      expect(m.rullbare, "beholdere som er bredere inni enn utenpå").toEqual([]);
      const r = (await leser.boundingBox())!;
      expect(r.x + r.width, "leserens høyre kant").toBeLessThanOrEqual(bredde);
      await expect(page.locator(".course-inline-panel-close")).toBeInViewport({ ratio: 1 });
    });
  }

  // Diskusjonen åpnet, med et spørsmål som har en lang adresse i tittelen: tråden skal holde seg i
  // sin egen boks, ikke gjøre hele kurset bredere.
  test("360 px: en diskusjonstråd med en lang adresse i tittelen gjør ikke kurset bredere", async ({ page }) => {
    const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    const tråd = { id: "t1", title: "Se https://www.regjeringen.no/no/dokumenter/veileder-i-samfunnsokonomiske-analyser/id2000000/", kind: "QUESTION", status: "OPEN", pinned: false, deleted: false, author: { name: "Kari" }, replyCount: 0 };
    await åpneKurset(page, 360);
    // Registrert etter åpneKurset, og vinner derfor over ruta for selve kurset.
    await page.route("**/api/courses/c1/discussions**", (route: Route) => route.fulfill(json({ threads: [tråd] })));
    await page.locator(".course-discussion-toggle").click();
    // Kontroll: tråden med adressen er tegnet. Uten den måles en tom diskusjon.
    await expect(page.locator("[data-disc-thread]")).toContainText("regjeringen.no");
    const m = await mål(page);
    expect(m.kuttet, "piksler av kursinnholdet som er kuttet av kursrammen til høyre").toBe(0);
    expect(m.ute, "det som stikker ut av skjermen").toEqual([]);
  });

  // En test rett etter en seksjon med samme tittel viser ikke tittelen en gang til. Da skal
  // statusmerket stå i samme kolonne som i radene over og under — ikke hoppe ut til høyre kant.
  test("390 px: statusmerkene står i samme kolonne, også i raden som ikke gjentar tittelen", async ({ page }) => {
    await åpneKurset(page, 390, { steg: [
      { type: "SECTION", sectionId: "s1", title: LANG, read: true },
      { type: "MODULE", moduleId: "m1", title: LANG, moduleStatus: "PASSED" },
      { type: "SECTION", sectionId: "s2", title: "Seksjon 4: Usikkerhetsanalyse og avsetninger i store prosjekter", read: true },
      { type: "SECTION", sectionId: "s3", title: "Seksjon 5: Rapportering til styringsgruppa og endringshåndtering", read: false },
    ] });
    await expect(page.locator(".course-step--title-repeat")).toHaveCount(1);
    const venstrekanter = await page.locator(".course-step--done .module-status-badge").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    expect(venstrekanter).toHaveLength(3);
    expect(new Set(venstrekanter).size, `venstrekanten på statusmerkene: ${venstrekanter.join(", ")}`).toBe(1);
    expect((await mål(page)).kuttet).toBe(0);
  });

  // Et ord som er lengre enn raden (et sammensatt ord, et filnavn, en adresse) skal brekke, ikke
  // gå ut over kanten og bli kuttet midt i en bokstav.
  test("360 px: et ord som er lengre enn raden, brekker — i stegtittelen og i teksten i leseren", async ({ page }) => {
    const ord = "Prosjektøkonomistyringsdokumentasjonsrutinebeskrivelsen";
    const adresse = "https://www.regjeringen.no/no/dokumenter/veileder-i-samfunnsokonomiske-analyser-og-gevinstrealisering-i-statlige-investeringsprosjekter/id2000000/";
    await åpneKurset(page, 360, {
      steg: [{ type: "SECTION", sectionId: "s1", title: ord, read: true }, { type: "SECTION", sectionId: "s2", title: "Neste", read: false }],
      seksjonstekst: `<p>Les veilederen: <a href="${adresse}">${adresse}</a></p>`,
    });
    const tittel = page.locator(".course-step--done .course-step-title");
    expect(await tittel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "hele ordet er innenfor raden").toBe(true);
    expect((await mål(page)).kuttet).toBe(0);

    await page.locator(".course-step--done").click();
    const leser = page.locator("#sectionReaderBody");
    await expect(leser).toContainText("Les veilederen");
    const lenke = leser.locator("a");
    const [l, r] = [(await lenke.boundingBox())!, (await leser.boundingBox())!];
    expect(l.x + l.width, "adressen slutter innenfor leseren").toBeLessThanOrEqual(r.x + r.width + 0.5);
    expect((await mål(page)).kuttet).toBe(0);
  });

  test("kontroll: på PC står tittelen på samme linje som typen og statusen, uforkortet — som før", async ({ page }) => {
    await åpneKurset(page, 1280);
    const tittel = page.locator(".course-step--done .course-step-title");
    expect(await tittel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const t = (await tittel.boundingBox())!;
    const type = (await page.locator(".course-step--done .course-step-kind").boundingBox())!;
    expect(Math.abs((t.y + t.height / 2) - (type.y + type.height / 2)), "tittelen og typen står på samme linje").toBeLessThan(4);
    expect((await mål(page)).ute).toEqual([]);
  });

  // Rett over telefongrensa (600 px) står tittelen fortsatt på én linje ved siden av typen og
  // statusen, og får ikke alltid plass. Der skal den forkortes med «…» — ikke presse kursinnholdet
  // ut av skjermen, som den gjorde før rutenettene rundt fikk holde på bredden.
  for (const bredde of [640]) {
    test(`${bredde} px (rett over telefongrensa): tittelen står på én linje og forkortes, og ingenting stikker ut`, async ({ page }) => {
      await åpneKurset(page, bredde);
      const m = await mål(page);
      expect(m.ute, "det som stikker ut av skjermen").toEqual([]);
      expect(m.rullbare, "beholdere som er bredere inni enn utenpå").toEqual([]);
      for (const rad of [".course-step--done", ".course-step--ahead"]) {
        const tittel = page.locator(`${rad} .course-step-title`);
        const t = (await tittel.boundingBox())!;
        const type = (await page.locator(`${rad} .course-step-kind`).boundingBox())!;
        expect(Math.abs((t.y + t.height / 2) - (type.y + type.height / 2)), `${rad}: tittelen og typen står på samme linje`).toBeLessThan(4);
        // Kontroll: tittelen ER for lang for raden her — ellers måler testen ingenting.
        expect(await tittel.evaluate((el) => el.scrollWidth > el.clientWidth), `${rad}: tittelen er forkortet`).toBe(true);
        expect(t.width, `${rad}: tittelen har fått plassen som er igjen`).toBeGreaterThan(100);
      }
      await expect(page.locator(".course-step--done .course-step-review")).toBeInViewport({ ratio: 1 });
    });
  }

  // En modul rett etter en seksjon med samme tittel har tittelen skjult for øyet (den står der for
  // skjermlesere). Telefonregelen gjelder den også, og den skal fortsatt være skjult.
  test("en gjentatt tittel er fortsatt skjult på telefon", async ({ page }) => {
    await åpneKurset(page, 390);
    await expect(page.locator(".course-step-title.sr-only")).toHaveCount(0);
    const skjult = await page.evaluate(() => {
      const tittel = document.querySelector(".course-step--ahead .course-step-title")!;
      tittel.classList.add("sr-only");
      const r = tittel.getBoundingClientRect();
      return { bredde: r.width, høyde: r.height };
    });
    expect(skjult.bredde).toBeLessThanOrEqual(1);
    expect(skjult.høyde).toBeLessThanOrEqual(1);
  });
});
