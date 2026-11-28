import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1171 (2.193.0): meldingene (toast) står nederst til høyre, ikke øverst. Øverst la de seg over handlingsknappene i sidehodet på
// 1280 px. Målt i kursets hode (Lagre, Publiser, «Mer») og i kurslista, på 1280 og 390 px: meldingen og knappene overlapper ikke,
// og på smal skjerm går meldingen fra kant til kant (popoveren nullstiller `inset`, så `left` må stå også for den åpne).

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const nb = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function toastBox(page: Page, type: "success" | "error") {
  await page.evaluate(async (kind) => {
    // Nettleserens modul; stien står i en variabel så typesjekken av testene ikke prøver å løse den opp.
    const toastModule = "/static/toast.js";
    const mod = await import(toastModule);
    mod.showToast(kind === "error" ? "Noe gikk galt, og meldingen er lang nok til å gå over to linjer i boksen." : "Lagret.", kind);
  }, type);
  const toast = page.locator(".toast").last();
  await expect(toast).toBeVisible();
  return (await toast.boundingBox())!;
}

for (const width of [1280, 390]) {
  test(`kursets hode, ${width} px: meldingen ligger ikke over handlingsknappene`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockCommonApis(page, { courses: [{ id: "course-1", title: "Informasjonssikkerhet", modules: [], publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published" } as never] });
    await nb(page);
    await page.goto("/admin-content/courses/course-1");
    await page.locator("#title-nb").waitFor();
    const actions = (await page.locator(".form-page-actions").first().boundingBox())!;
    for (const kind of ["success", "error"] as const) {
      const box = await toastBox(page, kind);
      expect(overlaps(box, actions), `${kind}: ${JSON.stringify({ box, actions })}`).toBe(false);
      // Nederst: bunnen av meldingen nær bunnen av vinduet.
      expect(box.y + box.height).toBeGreaterThan(800 - 60);
      if (width === 390) expect(box.width).toBeGreaterThan(390 - 60);
    }
  });
}

test("kurslista, 1280 px: meldingen ligger ikke over knappene øverst", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCommonApis(page, {});
  await nb(page);
  await page.route(/\/api\/admin\/content\/courses(\?.*)?$/, (r: Route) => r.fulfill(json({ courses: [] })));
  await page.goto("/admin-content/courses");
  const buttons = page.locator("#importCoursePackageBtn, a[href='/admin-content/courses/new']");
  await expect(buttons.first()).toBeVisible();
  const box = await toastBox(page, "error");
  for (const b of await buttons.all()) {
    if (!(await b.isVisible())) continue;
    expect(overlaps(box, (await b.boundingBox())!)).toBe(false);
  }
});

for (const width of [1280, 390]) {
  test(`en åpen dialog, ${width} px: meldingen ligger ikke over knappene i dialogen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockCommonApis(page, { courses: [{ id: "course-1", title: "Informasjonssikkerhet", modules: [], publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published" } as never] });
    await nb(page);
    await page.goto("/admin-content/courses/course-1");
    await page.locator("#title-nb").waitFor();
    const head = page.locator(".form-page-actions").first();
    await head.locator("details.row-more > summary").click();
    await head.locator('.row-more-menu [data-action="duplicate"]').click();
    const buttons = page.locator("dialog[open] #moduleLifecycleDialogConfirmBtn, dialog[open] #moduleLifecycleDialogCancelBtn");
    await expect(buttons.first()).toBeVisible();
    const box = await toastBox(page, "error");
    for (const b of await buttons.all()) expect(overlaps(box, (await b.boundingBox())!)).toBe(false);
    // Kjent, fra før (stage 14.09): meldingen VISES over en modal dialog, men kan ikke klikkes mens den er åpen — dialogen gjør
    // alt utenfor seg inert, også toppsjiktets popover. En feilmelding lukkes derfor først når dialogen er lukket.
  });
}

test("krysset har sin egen bredde: en kort melding står på én linje, og krysset ved høyre kant", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCommonApis(page, { courses: [{ id: "course-1", title: "Informasjonssikkerhet", modules: [], publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published" } as never] });
  await nb(page);
  await page.goto("/admin-content/courses/course-1");
  await page.locator("#title-nb").waitFor();
  const box = await toastBox(page, "success");
  const close = (await page.locator(".toast").last().locator(".toast__close").boundingBox())!;
  const message = (await page.locator(".toast").last().locator(".toast__message").boundingBox())!;
  expect(close.width).toBeLessThan(40);
  expect(box.x + box.width - (close.x + close.width)).toBeLessThan(30);
  expect(message.height).toBeLessThan(26);
});
