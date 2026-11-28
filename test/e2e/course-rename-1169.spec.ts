import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1169 skive 4c (doc/design/PLAN_1169_4B_DUPLISER_KURS.md, § 6; produkteier 28.11.2026): «Døp om» i kurslista, i raden, på språket
// lista viser. Klienten sender HELE språkkartet og den lagrede teksten raden viste (`expectedTitle`); for et kurs med utkast starter
// redigeringen fra utkastets tittel (`draftTitle`). Tjeneren avgjør om navnet går i utkastet, og meldingen sier det.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const nb = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });
const map = (text: string) => ({ "en-GB": `${text} EN`, nb: text, nn: `${text} NN` });

const row = (page: Page, id: string) => page.locator(`tr[data-row-id="${id}"]`);
const more = (page: Page, id: string) => row(page, id).locator(".row-actions > details.row-more");

function course(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id, title: JSON.stringify(map(title)), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 2, sortOrder: null,
    updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: null, inProgressCount: 0, canManage: true, themes: [], versionMajor: 2, versionMinor: 1,
    publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published", ...extra,
  };
}

async function openList(page: Page, courses: unknown[], answer: Record<string, unknown> = { renamedIn: "draft" }) {
  await mockCommonApis(page, {});
  await nb(page);
  const sent: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/admin\/content\/courses(\?.*)?$/, (r: Route) => r.fulfill(json({ courses })));
  await page.route("**/api/admin/content/courses/*/title", (r: Route) => {
    sent.push(r.request().postDataJSON());
    return r.fulfill(json(answer));
  });
  await page.goto("/admin-content/courses");
  return sent;
}

async function startRename(page: Page, id: string) {
  await more(page, id).locator("summary").click();
  await more(page, id).locator('[data-action="rename"]').click();
  return row(page, id).locator(".row-rename input");
}

test("publisert kurs: «Døp om» først i «Mer»; Enter sender hele språkkartet og navnet raden viste; meldingen sier utkastet", async ({ page }) => {
  const k = course("k-pub", "Informasjonssikkerhet");
  const sent = await openList(page, [k]);
  await more(page, "k-pub").locator("summary").click();
  await expect(more(page, "k-pub").locator(".row-more-menu > .row-action-btn").first()).toHaveText("Døp om");
  await more(page, "k-pub").locator('[data-action="rename"]').click();
  const field = row(page, "k-pub").locator(".row-rename input");
  await expect(field).toHaveValue("Informasjonssikkerhet");
  await field.fill("Informasjonssikkerhet 2027");
  await field.press("Enter");
  await expect(page.locator(".toast__message")).toHaveText("Navnet er lagret i utkastet. Deltakerne ser det når du publiserer utkastet.");
  expect(sent).toEqual([{ title: { ...map("Informasjonssikkerhet"), nb: "Informasjonssikkerhet 2027" }, expectedTitle: k.title }]);
});

test("kurs med utkast: redigeringen starter fra utkastets tittel, og den sendes som forventet", async ({ page }) => {
  const draftTitle = JSON.stringify(map("Navnet i utkastet"));
  const sent = await openList(page, [course("k-utk", "Publisert navn", { lifecycle: "published_with_draft", draftTitle })]);
  const field = await startRename(page, "k-utk");
  await expect(field).toHaveValue("Navnet i utkastet");
  await field.fill("Enda et navn");
  await field.press("Enter");
  await expect(page.locator(".toast__message")).toBeVisible();
  expect(sent).toEqual([{ title: { ...map("Navnet i utkastet"), nb: "Enda et navn" }, expectedTitle: draftTitle }]);
});

test("upublisert kurs: navnet er lagret (vanlig melding)", async ({ page }) => {
  await openList(page, [course("k-ny", "Nytt kurs", { publishedAt: null, lifecycle: "draft", versionMajor: 1, versionMinor: 0 })], { renamedIn: "course" });
  const field = await startRename(page, "k-ny");
  await field.fill("Nytt kurs, nytt navn");
  await field.press("Enter");
  await expect(page.locator(".toast__message")).toHaveText("Navnet er lagret.");
});

test("Escape avbryter uten å sende noe; et arkivert kurs og en annens kurs har ikke «Døp om»", async ({ page }) => {
  const sent = await openList(page, [
    course("k-pub", "Publisert kurs"),
    course("k-annen", "Andres kurs", { canManage: false }),
    course("k-ark", "Arkivert kurs", { publishedAt: null, archivedAt: "2026-10-05T08:00:00.000Z", lifecycle: "archived" }),
  ]);
  const field = await startRename(page, "k-pub");
  await field.press("Escape");
  await expect(row(page, "k-pub").locator(".row-rename")).toHaveCount(0);
  expect(sent).toEqual([]);
  await expect(row(page, "k-annen").locator('[data-action="rename"]')).toHaveCount(0);
  await expect(row(page, "k-ark").locator('[data-action="rename"]')).toHaveCount(0);
});
