import { expect, type Page, type Route } from "@playwright/test";
import { sha256 } from "./mascotFasit.js";

// Felles for e2e-testene av maskoten på profilen og i «Mine kurs»: fasiten (mascot-fasit-*.spec.ts, seilbåten) og
// testen av et bytte (mascot-swap.spec.ts, testpakken). De tegner det samme og måler det på samme måte.

export const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

// ── Profilen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fem humør og ett klienten ikke kjenner (faller tilbake til «mett»). */
export const PROFILE_MOODS = ["mett", "sulten", "sur", "dramatisk", "ny", "anker"] as const;
export const PROFILE_LOCALES = ["nb", "nn", "en-GB"] as const;

function stats(mood: string) {
  return { generatedAt: "2026-11-11T10:30:00.000Z", mood, lastActivityAt: null, weeks: [], recent: {}, totals: {}, passedModules: [] };
}

/** Statistikken svarer med humøret først; med `failAfterFirst` feiler hver henting etter den første. */
export async function mockProfile(page: Page, mood: string, locale: string, { failAfterFirst = false } = {}) {
  await page.addInitScript((value) => {
    try { localStorage.setItem("participant.locale", value); } catch { /* ignore */ }
  }, locale);
  await page.route("**/participant/config", (route: Route) => route.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "p-1", email: "kari@example.com", name: "Kari", department: "Rådgivning", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({
    user: { id: "p-1", name: "Kari Nordmann", email: "kari@example.com", department: "Rådgivning", roles: ["PARTICIPANT"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  let calls = 0;
  await page.route("**/api/me/stats", (route: Route) => {
    calls += 1;
    return route.fulfill(failAfterFirst && calls > 1 ? json({ error: "boom" }, 500) : json(stats(mood)));
  });
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  return { statsCalls: () => calls };
}

/** Båten på profilen: linja, bildets attributter og mål, og bildets bytes slik nettleseren får dem. */
export async function boatView(page: Page) {
  const line = page.locator("#statsMoodLine");
  await expect(line).toBeVisible();
  const boat = page.locator(".stats-boat");
  await expect.poll(() => boat.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const view = await boat.evaluate((img: HTMLImageElement) => ({
    alt: img.getAttribute("alt"),
    width: img.getAttribute("width"),
    height: img.getAttribute("height"),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    src: img.currentSrc,
  }));
  // Hentes i siden, så en rute satt med page.route (testen av et bytte) gjelder også her.
  const fetched = await page.evaluate(async (src) => {
    const response = await fetch(src);
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    return { status: response.status, contentType: response.headers.get("content-type"), bytes };
  }, view.src);
  expect(fetched.status, view.src).toBe(200);
  const bytes = Buffer.from(fetched.bytes);
  const { src: _src, ...rest } = view;
  return { line: await line.textContent(), ...rest, image: { contentType: fetched.contentType, bytes: bytes.length, sha256: sha256(bytes) } };
}

// ── «Mine kurs» ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const COURSES = [
  { id: "cNot", state: "ikke påbegynt", done: 0, total: 8, status: "NOT_STARTED" },
  { id: "c1of300", state: "1 av 300", done: 1, total: 300, status: "IN_PROGRESS" },
  { id: "c29", state: "29 %", done: 29, total: 100, status: "IN_PROGRESS" },
  { id: "c30", state: "30 %", done: 30, total: 100, status: "IN_PROGRESS" },
  { id: "cDone", state: "fullført", done: 8, total: 8, status: "COMPLETED" },
];

export async function mockCourses(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (r: Route) => r.fulfill(json({
    courses: COURSES.map((c) => ({
      id: c.id,
      title: c.state,
      description: null,
      moduleCount: 0,
      progress: { completed: c.done, total: c.total, sectionCompleted: c.done, sectionTotal: c.total, courseStatus: c.status },
      themes: [],
    })),
    themes: [],
  })));
  await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({
    completions: [{ courseId: "cDone", certificateId: "cert-1", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "fullført" }],
  })));
}

export const progress = (page: Page, id: string) => page.locator(`.course-accordion-item[data-course-id="${id}"] .course-progress`).first();

export type NormalizedNode = { ns: string | null; tag: string; attrs: Array<[string, string]>; children: Array<NormalizedNode | string> };

/** Elementtreet som data: navnerom, navn, sorterte attributter (uten xmlns), tekst uten rene mellomrom. */
export function normalizedDom(page: Page, id: string): Promise<NormalizedNode> {
  return progress(page, id).evaluate(normalizeInPage);
}

/** Samme normalisering av en bit markup, satt inn i siden slik figuren settes inn (innerHTML i et HTML-element). */
export function normalizedMarkup(page: Page, markup: string): Promise<NormalizedNode> {
  return page.evaluate(
    ([html, walkSource]) => {
      const span = document.createElement("span");
      span.innerHTML = html;
      // eslint-disable-next-line no-new-func
      const walk = new Function(`return (${walkSource})`)() as (el: Element) => unknown;
      return walk(span.firstElementChild!) as NormalizedNode;
    },
    [markup, normalizeInPage.toString()] as const,
  );
}

function normalizeInPage(root: Element): NormalizedNode {
  type Node_ = { ns: string | null; tag: string; attrs: Array<[string, string]>; children: Array<Node_ | string> };
  const walk = (el: Element): Node_ => ({
    ns: el.namespaceURI,
    tag: el.localName,
    attrs: Array.from(el.attributes)
      .filter((a) => a.name !== "xmlns" && !a.name.startsWith("xmlns:"))
      .map((a) => [a.name, a.value] as [string, string])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    children: Array.from(el.childNodes).flatMap((child): Array<Node_ | string> => {
      if (child.nodeType === Node.ELEMENT_NODE) return [walk(child as Element)];
      if (child.nodeType === Node.TEXT_NODE && child.textContent!.trim()) return [child.textContent!.trim()];
      return [];
    }),
  });
  return walk(root);
}

/** Feiringen, slik den startes når et kurs fullføres i økta, fryst 600 ms inn (figuren er inne, konfettien i lufta). */
export async function startFrozenCelebration(page: Page) {
  await page.evaluate(async () => {
    const { launchCourseBoatCelebration } = await import("/static/course-progress-boat.js" as string);
    const el = document.querySelector('.course-accordion-item[data-course-id="cDone"] .course-progress');
    // Sikkerhetsnettet (setTimeout) ville fjernet figuren mens skjermbildet tas; animasjonen står stille her.
    const realSetTimeout = window.setTimeout;
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
    try {
      launchCourseBoatCelebration(el, { reducedMotion: false });
    } finally {
      window.setTimeout = realSetTimeout;
    }
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 600;
    }
  });
  await expect(progress(page, "cDone").locator(".course-boat")).toHaveAttribute("data-boat-mood", "feirer");
}
