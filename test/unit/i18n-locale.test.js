// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveInitialLocale } from "../../public/static/i18n-locale.js";

// #596 slice 3: pins the consolidated initial-locale resolution (stored > browser-prefix > en-GB).
const SUPPORTED = ["en-GB", "nb", "nn"];

function setLanguage(value) {
  Object.defineProperty(navigator, "language", { value, configurable: true });
}

describe("resolveInitialLocale (shared, #596)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns a valid stored locale, ignoring the browser", () => {
    localStorage.setItem("participant.locale", "nn");
    setLanguage("en-US");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nn");
  });

  it("ignores an unsupported stored locale and falls back to the browser", () => {
    localStorage.setItem("participant.locale", "de");
    setLanguage("nb-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nb");
  });

  it("maps the browser language prefix nb/nn/en", () => {
    setLanguage("nb-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nb");
    setLanguage("nn-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nn");
    setLanguage("en-US");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
  });

  it("defaults to en-GB for unknown or empty browser languages when no organisation default is known yet", () => {
    setLanguage("de-DE");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
    setLanguage("");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
  });

  // #1191: «no» er norsk uten målform; før ga det engelsk, og engelsk ble mottakerens språk i e-postene.
  it("maps the browser language no / no-NO to nb", () => {
    setLanguage("no");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nb");
    setLanguage("no-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nb");
    // Kontroll: et språk som bare begynner på «no» er ikke norsk.
    setLanguage("nog");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
  });
});

// #1191: et ukjent nettleserspråk gir organisasjonens standardspråk (husket fra forrige lesing av konfigurasjonen), som tjeneren.
// Standardspråket leses når api-client lastes, så hvert tilfelle laster modulene på nytt.
describe("resolveInitialLocale: organisation default for unknown browser languages (#1191)", () => {
  async function freshResolve(cached, browser) {
    localStorage.clear();
    if (cached !== null) localStorage.setItem("org.defaultLocale", cached);
    setLanguage(browser);
    vi.resetModules();
    const mod = await import("../../public/static/i18n-locale.js");
    return mod.resolveInitialLocale(SUPPORTED);
  }

  it("uses the remembered organisation default for da, sv and other unknown languages", async () => {
    expect(await freshResolve("nb", "da-DK")).toBe("nb");
    expect(await freshResolve("nb", "sv")).toBe("nb");
    expect(await freshResolve("nn", "de-DE")).toBe("nn");
  });

  it("a known browser language still wins over the organisation default", async () => {
    expect(await freshResolve("nb", "en-US")).toBe("en-GB");
    expect(await freshResolve("en-GB", "nn-NO")).toBe("nn");
  });

  it("falls back to en-GB when the remembered default is not a supported locale", async () => {
    expect(await freshResolve("de", "da-DK")).toBe("en-GB");
  });

  // QA 2026-11-23: sidene lagrer språket ved oppstart, også et gjettet et. Et lagret en-GB fra den gamle reserven vant for alltid.
  async function resolveWithStored({ stored, chosen = null, browser, cached = "nb" }) {
    localStorage.clear();
    localStorage.setItem("org.defaultLocale", cached);
    localStorage.setItem("participant.locale", stored);
    if (chosen !== null) localStorage.setItem("participant.localeChosen", chosen);
    setLanguage(browser);
    vi.resetModules();
    const mod = await import("../../public/static/i18n-locale.js");
    return mod.resolveInitialLocale(SUPPORTED);
  }

  it("a stored en-GB the user did not choose, in a non-English browser, is the old fallback and is guessed again", async () => {
    expect(await resolveWithStored({ stored: "en-GB", browser: "da-DK" })).toBe("nb");
    expect(await resolveWithStored({ stored: "en-GB", browser: "no" })).toBe("nb");
    expect(await resolveWithStored({ stored: "en-GB", browser: "nb-NO" })).toBe("nb");
  });

  it("a stored en-GB the user chose in the language picker stands", async () => {
    expect(await resolveWithStored({ stored: "en-GB", chosen: "en-GB", browser: "da-DK" })).toBe("en-GB");
  });

  it("kontroll: other stored values stand, also without the chosen mark (choices made before it existed)", async () => {
    expect(await resolveWithStored({ stored: "nn", browser: "nb-NO" })).toBe("nn");
    expect(await resolveWithStored({ stored: "en-GB", browser: "en-US" })).toBe("en-GB");
    expect(await resolveWithStored({ stored: "nb", browser: "en-US" })).toBe("nb");
  });

  it("a change in #localeSelect marks the language as chosen", async () => {
    localStorage.clear();
    vi.resetModules();
    await import("../../public/static/i18n-locale.js");
    const select = document.createElement("select");
    select.id = "localeSelect";
    for (const v of ["nb", "en-GB"]) {
      const o = document.createElement("option");
      o.value = v;
      select.append(o);
    }
    document.body.append(select);
    select.value = "en-GB";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(localStorage.getItem("participant.localeChosen")).toBe("en-GB");
    select.remove();
  });
});
