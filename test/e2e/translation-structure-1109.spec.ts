import { expect, test, type Page, type Route } from "@playwright/test";
import { buildMockModuleExport, localizedText, mockCommonApis } from "./admin-content-helpers.js";

// #1109: tjeneren forkaster oversettelsen til et språk som endret rammene (422
// `translation_structure_changed`). Her: at klienten sier fra til forfatteren og ikke lagrer språket —
// i seksjonseditoren («Oversett fra dette språket») og i modulens lagring fra Rediger.

const NL = String.fromCharCode(10);
const SECTION_BODY = [":::sjekk Hvilken kilde er viktigst?", "- [ ] Innkallingen", "- [x] Notatene", ":::"].join(NL);

function structureRejection(locale: string) {
  return {
    status: 422,
    contentType: "application/json",
    body: JSON.stringify({
      error: "translation_structure_changed",
      message: `The translation to ${locale} changed the frames in the text and was not used.`,
      details: { locale, fields: [{ field: "bodyMarkdown", problems: [{ kind: "sjekk", problem: "shape", position: 1, expected: "01", actual: "10" }] }] },
    }),
  };
}

async function mockSectionApis(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  const created: Array<Record<string, any>> = [];
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ section: { id: "sec1", versionNo: 1 } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
  });
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>x</p>" }) }),
  );
  return created;
}

test.describe("#1109 — en oversettelse som endret rammene, lagres ikke", () => {
  test("#1112: er det kilden som har en ramme som ikke tegnes, sier meldingen at kilden må rettes", async ({ page }) => {
    await mockSectionApis(page);
    await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
      const body = route.request().postDataJSON() as { targetLocale: string };
      if (body.targetLocale === "nn") {
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "translation_structure_changed",
            message: "The translation to nn changed the frames in the text and was not used.",
            details: { locale: "nn", fields: [{ field: "bodyMarkdown", problems: [{ kind: "sjekk", problem: "sourceNotDrawn", expected: 0, actual: 1 }] }] },
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Sources", bodyMarkdown: "Text." }) });
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/sections");
    await page.getByRole("button", { name: /Ny seksjon/ }).click();
    await page.locator("#titleInput").fill("Kilder");
    await page.locator("#markdownInput").fill(["- et punkt", SECTION_BODY].join(NL));
    await page.locator("#translateBtn").click();

    await expect(page.getByText(/Ikke oversatt til Norsk nynorsk: kilden har en blokk som ikke vises \(:::sjekk\)/)).toBeVisible();
    // Ikke den generelle meldingen om at oversettelsen endret blokkene — den ber forfatteren prøve igjen.
    await expect(page.getByText(/oversettelsen endret blokkene/)).toHaveCount(0);
  });

  test("seksjonseditoren: språket som ble avvist står urørt, forfatteren får beskjed, de andre oversettes", async ({ page }) => {
    const created = await mockSectionApis(page);
    const requested: string[] = [];
    await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
      const body = route.request().postDataJSON() as { targetLocale: string };
      requested.push(body.targetLocale);
      if (body.targetLocale === "nn") return route.fulfill(structureRejection("nn"));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: "Sources", bodyMarkdown: [":::check Which source matters most?", "- [ ] The invitation", "- [x] The notes", ":::"].join(NL) }),
      });
    });

    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/sections");
    await page.getByRole("button", { name: /Ny seksjon/ }).click();
    await page.locator("#titleInput").fill("Kilder");
    await page.locator("#markdownInput").fill(SECTION_BODY);
    await page.locator("#translateBtn").click();

    // Beskjeden sier hvilket språk og hvorfor — ikke «Oversatt», og ikke en rå feilkode.
    const toast = page.getByText(/Ikke oversatt til Norsk nynorsk: oversettelsen endret blokkene/);
    await expect(toast).toBeVisible();
    await expect(page.getByText("translation_structure_changed")).toHaveCount(0);
    await expect(page.getByText(/Oversatt — se over/)).toHaveCount(0);
    await expect.poll(() => [...requested].sort()).toEqual(["en-GB", "nn"]);

    // Engelsk er oversatt; nynorsk står som før (tom, i en ny seksjon) — ingen kildekopi.
    await page.locator('[data-form-locale="en-GB"]').click();
    await expect(page.locator("#titleInput")).toHaveValue("Sources");
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#titleInput")).toHaveValue("");
    await expect(page.locator("#markdownInput")).toHaveValue("");

    // Lagringen sender ikke nynorsk. (Feilvarselet blir stående til det lukkes, som alle feilvarsler.)
    await page.getByRole("button", { name: "Lukk varsel" }).click();
    await page.locator('[data-form-locale="nb"]').click();
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => created.length).toBeGreaterThan(0);
    const saved = created[created.length - 1]!;
    expect(Object.keys(saved.bodyMarkdown).sort()).toEqual(["en-GB", "nb"]);
    expect(saved.bodyMarkdown.nn).toBeUndefined();
    expect(saved.title.nn).toBeUndefined();
  });

  test("seksjonseditoren, kontroll: når alle språk kommer gjennom, står det «Oversatt» som før", async ({ page }) => {
    await mockSectionApis(page);
    await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
      const body = route.request().postDataJSON() as { targetLocale: string };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: `T-${body.targetLocale}`, bodyMarkdown: SECTION_BODY }) });
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/sections");
    await page.getByRole("button", { name: /Ny seksjon/ }).click();
    await page.locator("#titleInput").fill("Kilder");
    await page.locator("#markdownInput").fill(SECTION_BODY);
    await page.locator("#translateBtn").click();
    await expect(page.getByText(/Oversatt — se over/)).toBeVisible();
    await expect(page.getByText(/Ikke oversatt til/)).toHaveCount(0);
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#titleInput")).toHaveValue("T-nn");
  });

  // En lagret seksjon åpnes «ulagret: nei». Kom minst ett språk gjennom, er det noe nytt å lagre; ble alle
  // avvist, er ingenting endret, og skjemaet skal ikke påstå det.
  for (const [name, rejected, dirty] of [
    ["ett språk kom gjennom: skjemaet har ulagrede endringer", ["nn"], true],
    ["alle språk ble avvist: ingenting er endret, og skjemaet sier det", ["nn", "en-GB"], false],
  ] as const) {
    test(`seksjonseditoren, lagret seksjon — ${name}`, async ({ page }) => {
      await mockSectionApis(page);
      const row = {
        id: "sec-x", title: JSON.stringify({ nb: "Kilder", nn: "Kjelder", "en-GB": "Old sources" }),
        bodyMarkdown: JSON.stringify({ nb: SECTION_BODY, nn: "Gammal tekst.", "en-GB": "Old text." }),
        activeVersionId: "v1", versionNo: 1, updatedAt: "2026-10-01T00:00:00.000Z", archivedAt: null, courseCount: 0, courses: [], canManage: true,
      };
      await page.route("**/api/admin/content/sections/sec-x", (route: Route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: row }) }));
      await page.route("**/api/admin/content-owners/SECTION/sec-x", (route: Route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }));
      await page.route("**/api/admin/content/sections/sec-x/assets/localize", (route: Route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ localizedAssetCount: 0 }) }));
      await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
        const body = route.request().postDataJSON() as { targetLocale: string };
        if ((rejected as readonly string[]).includes(body.targetLocale)) return route.fulfill(structureRejection(body.targetLocale));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "New sources", bodyMarkdown: SECTION_BODY.replace(":::sjekk", ":::check") }) });
      });

      await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
      await page.goto("/admin-content/sections?id=sec-x");
      await expect(page.locator("#titleInput")).toHaveValue("Kilder");
      await expect(page.locator("#formPageDirty")).not.toHaveClass(/is-dirty/);

      await page.locator("#translateBtn").click();
      await expect(page.getByText(/Ikke oversatt til/)).toBeVisible();
      if (dirty) await expect(page.locator("#formPageDirty")).toHaveClass(/is-dirty/);
      else await expect(page.locator("#formPageDirty")).not.toHaveClass(/is-dirty/);

      // Det avviste nynorske står som før.
      await page.getByRole("button", { name: "Lukk varsel" }).click();
      await page.locator('[data-form-locale="nn"]').click();
      await expect(page.locator("#titleInput")).toHaveValue("Kjelder");
      await expect(page.locator("#markdownInput")).toHaveValue("Gammal tekst.");
    });
  }

  test("modulen: språket som ble avvist, lagres ikke, og forfatteren får beskjed", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    // Registrert etter mockCommonApis, så denne vinner: bokmål kommer gjennom, nynorsk avvises.
    await page.route("**/generate/module-draft/localize", async (route: Route) => {
      const body = route.request().postDataJSON() as { title?: string; taskText?: string; assessorExpectedContent?: string; targetLocale: string };
      if (body.targetLocale === "nn") return route.fulfill(structureRejection("nn"));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: `${body.title} [nb]`, taskText: `${body.taskText ?? ""} [nb]`, assessorExpectedContent: `${body.assessorExpectedContent ?? ""} [nb]` }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#formSaveBtn").click();

    // Lagringen går gjennom med kilden og bokmål — nynorsk står tomt, ikke kildefylt.
    await expect.poll(() => state.lastTitlePatchBody?.title).toBeTruthy();
    expect(state.lastTitlePatchBody.title).toEqual({ "en-GB": "Fagforeninger", nb: "Fagforeninger [nb]" });
    expect(state.lastTitlePatchBody.title.nn).toBeUndefined();
    // Og forfatteren får vite det (samme beskjed som for en oversettelse som feilet).
    // (Teksten står både i loggen og i skjermleserens kunngjøring — derfor den første.)
    await expect(page.getByText(/Not translated to: nn\./).first()).toBeVisible();
  });
});
