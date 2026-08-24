import { test, expect, type Page } from "@playwright/test";

// Modulstien er en NETTLESER-sti, ikke en fil på disk, så tsc kan ikke slå den opp. En variabel
// gjør spesifikatoren ikke-litterær, og da lar tsc den stå — importen skjer uansett i Chromium.
const DOM_VISIBILITY = "/static/dom-visibility.js";
type DomVisibility = { setHidden: (el: HTMLElement, hidden: boolean) => void };

// #975: dette er ren CSS-cascade, og cascade kan ikke måles med filsøk. Enhetsvakta
// (test/hidden-cascade-guard.test.js) modellerer cascaden; her måler vi den i en ekte Chromium.
//
// ⚠️ Vi sjekker `getComputedStyle().display`, ikke `toBeHidden()`. Playwright regner et element som
// skjult også når det bare har tom boks — og nettopp DET var grunnen til at fella overlevde: et tomt
// `.status-grid` har høyde 0, så `toBeHidden()` sa «i orden» om et rutenett som sto og tok plass i
// layouten. `toBeHidden()` ville også sagt «skjult» om et `.sr-only`-element, som er 1×1 med clip og
// slett ikke display:none. Mekanismen man tester må måles på sin egen måte.

type Trap = {
  name: string;
  path: string;
  /** Finn eller lag elementet i siden. Returnerer en velger vi kan bruke etterpå. */
  build: string;
};

// Elementer der en display-settende regel slår skjulingen. Alle sju ble bekreftet i nettleseren før
// fiksen: `el.hidden = true` etterlot dem synlige.
const TRAPS: Trap[] = [
  {
    name: "review: fanestripa",
    path: "/review",
    build: "#reviewWorkspaceTabs",
  },
  {
    name: "review: faneknapp",
    path: "/review",
    build: "#reviewTabManual",
  },
  {
    name: "review: telleplakett på fanen",
    path: "/review",
    build: "#reviewTabManualCount",
  },
  {
    name: "kohort-status: rutenettet med statuskort",
    path: "/deltakere/status",
    build: "#statusCards",
  },
  {
    name: "arbeidsflate: tilstandslinja (CSS-lappen .state-rail[hidden] er fjernet)",
    path: "/admin-content/module/x/conversation",
    build: "#stateRail",
  },
  {
    name: "toppmeny: køplaketten på Vurdering",
    path: "/participant",
    build: "new:span.nav-queue-badge",
  },
  {
    name: "arbeidsflate: kildechip-lista",
    path: "/admin-content/module/x/conversation",
    build: "new:ul.source-chip-list",
  },
];

/** Henter elementet, eventuelt ved å lage det, og setter det inn i siden under en kjent id. */
async function resolve(page: Page, build: string): Promise<string> {
  if (!build.startsWith("new:")) return build;
  const [tag, cls] = build.slice(4).split(".");
  await page.evaluate(
    ([t, c]) => {
      const el = document.createElement(t);
      el.className = c;
      el.id = "e2eTrapProbe";
      document.body.appendChild(el);
    },
    [tag, cls] as const,
  );
  return "#e2eTrapProbe";
}

async function displayAfter(
  page: Page,
  selector: string,
  action: "setHidden-true" | "setHidden-false" | "attribute-only",
): Promise<string> {
  return page.evaluate(
    async ([sel, act, modulePath]) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (act === "attribute-only") {
        el.style.display = "";
        el.hidden = true;
      } else {
        // Den EKTE kuren importeres fra siden — ikke en kopi av logikken her. En e2e som speiler
        // implementasjonen sin ville bestått selv om setHidden ble tømt.
        const { setHidden } = (await import(modulePath)) as DomVisibility;
        setHidden(el, act === "setHidden-true");
      }
      return getComputedStyle(el).display;
    },
    [selector, action, DOM_VISIBILITY] as const,
  );
}

for (const trap of TRAPS) {
  test(`${trap.name}: setHidden skjuler, og elementet kommer tilbake`, async ({ page }) => {
    await page.goto(trap.path);
    const selector = await resolve(page, trap.build);
    await expect(page.locator(selector)).toHaveCount(1);

    // KONTROLLASSERTION — dette er selve fella. Med bare `hidden`-attributtet står elementet
    // synlig. Skulle denne en dag begynne å gi «none», er elementet ikke lenger et felletilfelle,
    // og oppføringa over kan fjernes. Da måler testen ellers ingenting.
    expect(
      await displayAfter(page, selector, "attribute-only"),
      `${trap.name}: forventet at hidden-attributtet ALENE taper cascaden her — ellers er dette ikke lenger et felletilfelle`,
    ).not.toBe("none");

    expect(await displayAfter(page, selector, "setHidden-true"), `${trap.name}: setHidden(el, true) må skjule`).toBe("none");

    // MAKKEREN: uten denne vet vi ikke om vi målte regelen eller bare knakk elementet.
    expect(await displayAfter(page, selector, "setHidden-false"), `${trap.name}: setHidden(el, false) må vise den igjen`).not.toBe("none");
  });
}

test("review: telleplakettene er skjult ved første maling, før JS har talt noe", async ({ page }) => {
  // Selve symptomet: en «0»-plakett på begge fanene fra siden males til køen er hentet.
  await page.goto("/review");
  for (const id of ["#reviewTabManualCount", "#reviewTabAppealCount"]) {
    const display = await page.locator(id).evaluate((el) => getComputedStyle(el).display);
    expect(display, `${id} skal være skjult ved første maling`).toBe("none");
  }
});

test("arbeidsflate: tilstandslinja er skjult ved første maling uten CSS-lappen", async ({ page }) => {
  // `.state-rail[hidden]` i shared.css er fjernet. Markupen må klare skjulingen på egen hånd, ellers
  // står en tom statuslinje over arbeidsflata til en modul er valgt.
  await page.goto("/admin-content/module/x/conversation");
  const display = await page.locator("#stateRail").evaluate((el) => getComputedStyle(el).display);
  expect(display, "#stateRail skal være skjult før en modul er valgt").toBe("none");
});

test("deltaker: kurspanel og diskusjonsboard skjules uten CSS-lappene sine", async ({ page }) => {
  // `.course-inline-panel[hidden]` og `.course-discussion-body[hidden]` i participant.html er
  // fjernet. Begge klassene setter ingen display, så UA-arkets [hidden] holder — men det er en
  // påstand, ikke en selvfølge, og den skal måles.
  await page.goto("/participant");
  for (const cls of ["course-inline-panel", "course-discussion-body"]) {
    const result = await page.evaluate(async ([c, modulePath]) => {
      const { setHidden } = (await import(modulePath)) as DomVisibility;
      const el = document.createElement("div");
      el.className = c;
      document.body.appendChild(el);
      setHidden(el, true);
      const hidden = getComputedStyle(el).display;
      setHidden(el, false);
      const shown = getComputedStyle(el).display;
      el.remove();
      return { hidden, shown };
    }, [cls, DOM_VISIBILITY] as const);
    expect(result.hidden, `.${cls} skal skjules av setHidden`).toBe("none");
    expect(result.shown, `.${cls} skal komme tilbake av setHidden(el, false)`).not.toBe("none");
  }
});
