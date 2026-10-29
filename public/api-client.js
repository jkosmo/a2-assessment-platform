import { setHidden } from "/static/dom-visibility.js";

// ---------------------------------------------------------------------------
// MSAL (Entra auth)
// ---------------------------------------------------------------------------

// #355: validate that a sessionStorage-recovered URL targets our own origin + a sensible
// internal path before navigating to it. sessionStorage is same-origin already, but a
// defense-in-depth validation keeps a future code path that could write a poisoned value
// (or a bug that stores an absolute external URL) from turning into an open redirect.
// Pure function — exported for unit testing.
export function isSafeSameOriginRedirect(target, currentOrigin) {
  if (typeof target !== "string" || target.length === 0) return false;
  if (typeof currentOrigin !== "string" || currentOrigin.length === 0) return false;
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.origin !== currentOrigin) return false;
  // pathname must be an absolute internal path; URL parsing with a non-special scheme would
  // not surface here (URL() rejects javascript:/data: as opaque), but we double-check.
  if (!url.pathname.startsWith("/")) return false;
  return true;
}

let msalInstance = null;
let msalScopes = null;

async function loadMsalScript() {
  if (window.msal) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // #393: MSAL vendret lokalt (public/static/vendor/) i stedet for ekstern CDN, så en
    // kompromittert CDN ikke kan kjøre kode i vår origin. SRI-integrity beholdes som
    // defense-in-depth selv for egen origin. Versjon er pinnet i filnavnet; oppdaterings-
    // prosess er dokumentert i doc/MSAL_VENDORING.md. crossOrigin kreves for SRI.
    s.src = "/static/vendor/msal-browser-2.38.0.min.js";
    s.integrity = "sha384-mz+8Q3jA4XBFbnyAsyQegn/0LHvziH7qHLBa9GzcU3HzeWj9J16SXM5S+TsmPBy0";
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load MSAL script."));
    document.head.appendChild(s);
  });
}

// 2.104.0: «Logg ut» (produkteier 2026-10-25: «det er ikke noe konsistent måte å bytte» mellom to
// kontoer). Innloggingen ligger i fanens sessionStorage, men Microsoft husker kontoen i nettleseren og
// logget straks inn med den samme igjen. Å logge ut avslutter derfor også Microsoft-økten, og NESTE
// innlogging spør hvilken konto — bare den, så ingen må velge konto i hver ny fane.
const CHOOSE_ACCOUNT_KEY = "a2.auth.chooseAccount";

/**
 * Det innloggingen ber Microsoft om: kontovelgeren når brukeren nettopp logget ut, ellers ingenting
 * ekstra. Flagget brukes én gang. Lagringen kan mangle (privat vindu); da er det en vanlig innlogging.
 * @param {string[]} scopes
 * @param {Pick<Storage, "getItem" | "removeItem">} [storage]
 */
export function loginRequestFor(scopes, storage = globalThis.localStorage) {
  let choose = false;
  try {
    choose = storage?.getItem(CHOOSE_ACCOUNT_KEY) === "1";
    if (choose) storage.removeItem(CHOOSE_ACCOUNT_KEY);
  } catch {/* uten lagring: vanlig innlogging */}
  return choose ? { scopes, prompt: "select_account" } : { scopes };
}

/** Logger ut av plattformen og av Microsoft-kontoen i denne nettleseren. Uten Entra (lokalt): til forsiden. */
export async function signOut() {
  try { globalThis.localStorage?.setItem(CHOOSE_ACCOUNT_KEY, "1"); } catch {/* se loginRequestFor */}
  if (!msalInstance) {
    window.location.href = "/";
    return;
  }
  const account = msalInstance.getAllAccounts()[0];
  // Tilbake til samme adresse som innloggingen bruker — den er registrert i Entra.
  await msalInstance.logoutRedirect({ account, postLogoutRedirectUri: window.location.origin + "/admin-content" });
}

async function initMsal(entraConfig) {
  await loadMsalScript();

  msalScopes = entraConfig.scopes;

  msalInstance = new msal.PublicClientApplication({
    auth: {
      clientId: entraConfig.clientId,
      authority: entraConfig.authority,
      redirectUri: window.location.origin + "/admin-content",
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
  });

  await msalInstance.initialize();

  // Handle the token response after a redirect login
  const result = await msalInstance.handleRedirectPromise();
  if (result) {
    // Restore the page the user was on before being sent to login.
    // #355: only navigate if the stored URL is same-origin + an internal path. Reject and
    // drop the value silently otherwise so a poisoned sessionStorage entry can't redirect us.
    const intended = sessionStorage.getItem("auth_intended_url");
    sessionStorage.removeItem("auth_intended_url");
    if (intended && isSafeSameOriginRedirect(intended, window.location.origin) && intended !== window.location.href) {
      window.location.replace(intended);
      return;
    }
    return;
  }

  // If no account is present, save destination and trigger login
  if (msalInstance.getAllAccounts().length === 0) {
    rememberIntendedUrl();
    await msalInstance.loginRedirect(loginRequestFor(msalScopes));
    // Page will redirect — execution stops here
  }
}

// Innloggingen kommer alltid tilbake til /admin-content (adressen som er registrert i Entra), og siden
// sender brukeren videre hit. 2.120.0: bare den første innloggingen lagret adressen — en fornyet
// innlogging midt i økta (`getAccessToken`) gjorde det ikke, og en deltaker ble stående på forfattersiden.
function rememberIntendedUrl() {
  try { sessionStorage.setItem("auth_intended_url", window.location.href); } catch {/* uten lagring: forsiden */}
}

export async function getAccessToken() {
  if (!msalInstance) return null;

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    rememberIntendedUrl();
    await msalInstance.loginRedirect(loginRequestFor(msalScopes));
    return null;
  }

  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: msalScopes,
      account: accounts[0],
    });
    return result.accessToken;
  } catch {
    rememberIntendedUrl();
    await msalInstance.acquireTokenRedirect({ scopes: msalScopes, account: accounts[0] });
    return null;
  }
}

/**
 * 2.120.0: forfattersidene (/admin-content…) er ikke for deltakere. En deltaker kom dit fra deltakerlenka
 * (innloggingen lander på /admin-content, og adressen hun kom fra var borte i Teams-nettleseren) og fikk
 * «Du har ikke tilgang» uten vei videre. Veiene inn er flere — innlogging, utlogging, fornyet innlogging,
 * en tilsendt lenke — så sperren står på siden, ikke på hver vei.
 *
 * Bare den som ikke har noen annen rolle enn PARTICIPANT sendes til «Mine kurs». En ansattrolle beholder
 * siden, så sperren kan aldri låse noen ute fra noe de har tilgang til. Feiler oppslaget, skjer ingenting.
 */
export async function sendParticipantsHome({ pathname, getToken, fetchImpl = fetch, replace = (url) => window.location.replace(url) }) {
  if (!pathname.startsWith("/admin-content")) return false;
  let roles;
  try {
    const token = await getToken();
    if (!token) return false;
    const response = await fetchImpl("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const body = await response.json();
    roles = Array.isArray(body?.user?.roles) ? body.user.roles : null;
  } catch {
    return false;
  }
  if (!roles || roles.some((role) => role !== "PARTICIPANT")) return false;
  replace("/participant");
  return true;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export function buildConsoleHeaders({ userId, email, name, department, roles, locale }) {
  return {
    "Content-Type": "application/json",
    "x-user-id": userId,
    "x-user-email": email,
    "x-user-name": name,
    "x-user-department": department,
    "x-user-roles": roles,
    "x-locale": locale,
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch(url, getHeadersOrOptions = {}, maybeOptions = {}) {
  const getHeaders = typeof getHeadersOrOptions === "function" ? getHeadersOrOptions : null;
  const options = getHeaders ? maybeOptions : (getHeadersOrOptions ?? {});
  const baseHeaders = getHeaders ? getHeaders() : {};

  const token = await getAccessToken();
  if (token) {
    baseHeaders["Authorization"] = `Bearer ${token}`;
  }

  const headers = { ...baseHeaders, ...(options.headers ?? {}) };
  // For multipart/FormData uploads the browser must set Content-Type (with the
  // boundary) itself. buildConsoleHeaders injects "application/json", which would
  // otherwise make the server parse the multipart body as JSON and 500 (#483/F4).
  if (typeof FormData !== "undefined" && options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    // The message keeps its exact old shape — several call sites and tests match on it. The
    // parsed body rides along as properties so a caller that wants to act on structured error
    // data (e.g. the publish translation gate's `issues[]`) does not have to re-parse the text.
    const error = new Error(`${response.status}: ${JSON.stringify(body)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

// Loads private course-asset images (#483/F4). A plain <img src="/api/content-assets/<id>">
// can't carry the Bearer/console auth headers, so the server returns 401 and the image breaks.
// This fetches each such image WITH the authenticated headers and swaps in an object URL.
// Call after injecting rendered section HTML (editor preview + participant reader).
//
// #1079: a figure can have a NARROW layout beside the wide one. An SVG shown as an image has a fixed
// shape and cannot re-break itself, so it is the client that picks: this is the one place every
// figure is fetched, and it knows how wide the column is. Under ASSET_NARROW_BELOW the narrow layout
// is asked for; a figure without one answers with the wide layout, and says so.
export async function hydrateContentAssetImages(root, getHeadersOrFn) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const images = Array.from(root.querySelectorAll('img[src^="/api/content-assets/"]'));
  if (images.length === 0) return;

  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src) return;
      // The address the page was rendered with. `src` becomes an object URL below, so this is
      // what a later fetch — the other layout, when the column changes width — starts from.
      img.dataset.assetSrc = src;
      await loadAssetLayout(img, wantedAssetLayout(img), getHeadersOrFn);
      if ((img.dataset.assetLayouts ?? "").split(",").includes("narrow")) {
        // The first answer told how wide this figure's wide layout is; with that, the other layout
        // may fit better (a short flow in a 500 px column). Asked again only then.
        const better = wantedAssetLayout(img);
        if (better !== img.dataset.assetWanted) await loadAssetLayout(img, better, getHeadersOrFn);
        watchAssetColumn(img, getHeadersOrFn);
      }
    }),
  );
}

/**
 * The column width under which a figure's narrow layout is shown. ONE fixed number for every figure
 * (product owner, 2026-10-04): the widest figure the skill draws is 848 wide with 12 px labels, and
 * under 640 px those labels are smaller than 9 px on screen. Measured on a real phone and a tablet
 * before it is called final.
 */
export const ASSET_NARROW_BELOW = 640;

/**
 * The column a figure stands in: the nearest ancestor that has a width. An image inside an inline
 * element (a link, emphasis) has a parent without one, and the answer would be «not laid out».
 */
function assetColumn(img) {
  let element = img.parentElement;
  while (element && element.clientWidth === 0) element = element.parentElement;
  return element;
}

/**
 * How much larger than it is drawn a figure is shown, at most: its 12 px labels read as 15 px, about
 * the size of the text around them (product owner, 2026-10-22). A drawing that only stated a viewBox
 * filled its column, and a three-step flow in a 1000 px column had labels 37 px high.
 */
export const ASSET_SHOWN_AT = 1.25;
/** The narrow layout takes over where the wide one's 12 px labels would be under 9 px on screen. */
const ASSET_SMALLEST_SCALE = 9 / 12;

/**
 * Which layout fits the column the figure stands in. A page not laid out at all is wide.
 *
 * Per figure (2026-10-22), once the server has said how wide the wide layout is drawn: an eight-step
 * flow (848) switches under 636 px, a three-step one (328) only under 246. Before that is known —
 * the first request — the fixed ASSET_NARROW_BELOW, which is the widest figure's.
 */
function wantedAssetLayout(img) {
  const width = assetColumn(img)?.clientWidth ?? 0;
  if (width <= 0) return "wide";
  const wide = Number(img.dataset.assetWideWidth);
  return width < (wide > 0 ? wide * ASSET_SMALLEST_SCALE : ASSET_NARROW_BELOW) ? "narrow" : "wide";
}

/**
 * The largest a drawing is shown: what it states itself (`width`), or its viewBox × ASSET_SHOWN_AT.
 * A ceiling, `max-width: min(100%, …)`, not a width: a stylesheet that makes it smaller (an icon in a
 * table is 24 px) still decides — a width set here overrode it, and the icons became 40 px. A width
 * that is not a number of pixels (a percentage) is the author's choice and left alone.
 */
function sizeSvgFigure(img, svg) {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const stated = /\swidth\s*=\s*["']\s*([^"']*?)\s*["']/i.exec(root)?.[1];
  const viewBox = /\sviewBox\s*=\s*["']([^"']*)["']/i.exec(root)?.[1];
  const drawn = viewBox ? Number(viewBox.trim().split(/[\s,]+/)[2]) : NaN;
  let shown = null;
  if (stated !== undefined) shown = /^\d+(\.\d+)?(px)?$/.test(stated) ? parseFloat(stated) : null;
  else if (drawn > 0) shown = drawn * ASSET_SHOWN_AT;
  img.style.maxWidth = shown ? `min(100%, ${Math.round(shown)}px)` : "";
}

/** Fetches the figure in the given layout, with the viewer's credentials, and shows it. */
async function loadAssetLayout(img, layout, getHeadersOrFn) {
  const headers = typeof getHeadersOrFn === "function" ? { ...getHeadersOrFn() } : { ...(getHeadersOrFn ?? {}) };
  delete headers["Content-Type"];
  delete headers["content-type"];

  // What was ASKED for, not what came back: a figure that has the narrow layout only in another
  // language answers with the wide one, and asking again at every resize would get the same answer.
  img.dataset.assetWanted = layout;
  try {
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const url = new URL(img.dataset.assetSrc, window.location.origin);
    if (layout === "narrow") url.searchParams.set("layout", "narrow");
    const response = await fetch(url.pathname + url.search, { headers });
    if (!response.ok) return;
    const blob = await response.blob();
    const svg = /svg/i.test(blob.type || response.headers.get("Content-Type") || "") ? await blob.text() : null;
    // The column changed width again while this was on its way: a later request owns the image now.
    if (img.dataset.assetWanted !== layout) return;
    const previous = img.src;
    if (svg !== null) sizeSvgFigure(img, svg);
    img.src = URL.createObjectURL(svg !== null && isAnimatedSvg(svg) ? animatedFigureBlob(img, svg, blob) : blob);
    if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
    img.dataset.assetLayout = response.headers.get("X-Asset-Layout") ?? "wide";
    img.dataset.assetLayouts = response.headers.get("X-Asset-Layouts") ?? "wide";
    const wideWidth = Number(response.headers.get("X-Asset-Wide-Width"));
    if (wideWidth > 0) img.dataset.assetWideWidth = String(wideWidth);
  } catch {
    /* leave the broken image; non-fatal */
  }
}

// ---------------------------------------------------------------------------
// #1073: animated figures. A figure is shown as an <img>, and a browser does NOT apply the reader's
// «reduce motion» setting inside an SVG shown as an image (measured in Chromium, 2026-10-03). So the
// platform applies it: with the setting on, the figure is shown as its still picture — the same one
// the figure rests in when its animation is over, which the check guarantees is complete.
//
// Without the setting, a short animation (at most five seconds) could be over before the reader has
// scrolled down to it. So it plays again the first time it comes into view, and once more each time
// the reader clicks it. Playing again is loading the same picture anew: a new image starts its
// animation from the beginning.
// ---------------------------------------------------------------------------

/** An SVG that moves: the templates' keyframes, or any other — the platform refuses all but those. */
export function isAnimatedSvg(svg) {
  return /@keyframes/i.test(String(svg ?? ""));
}

/** The figure's still picture: every animation and transition switched off. */
export function stillSvg(svg) {
  return String(svg).replace(/<svg\b(?:"[^"]*"|'[^']*'|[^>"'])*>/i, (open) => (open.endsWith("/>")
    ? open
    : `${open}<style>*{animation:none !important;transition:none !important}</style>`));
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/** image → the animated picture it plays again. */
const animatedFigures = new WeakMap();
let animatedFigureObserver = null;

/** The picture to show for an animated figure, and — when it may move — what to play it again with. */
function animatedFigureBlob(img, svg, blob) {
  img.dataset.assetAnimated = prefersReducedMotion() ? "still" : "moving";
  if (img.dataset.assetAnimated === "still") {
    animatedFigures.delete(img);
    return new Blob([stillSvg(svg)], { type: "image/svg+xml" });
  }
  const known = animatedFigures.has(img);
  animatedFigures.set(img, blob);
  if (!known) watchAnimatedFigure(img);
  return blob;
}

/** Plays an animated figure again from the start. */
export function replayAnimatedFigure(img) {
  const blob = animatedFigures.get(img);
  if (!blob || !img.isConnected) return false;
  const previous = img.src;
  img.src = URL.createObjectURL(blob);
  if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
  return true;
}

function watchAnimatedFigure(img) {
  img.style.cursor = "pointer";
  img.addEventListener("click", () => replayAnimatedFigure(img));
  if (typeof IntersectionObserver !== "function") return;
  // A figure already in view when it loads is restarted a few milliseconds after it began — nobody
  // sees that, so it is not told apart from one the reader scrolls down to.
  animatedFigureObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      animatedFigureObserver.unobserve(entry.target);
      replayAnimatedFigure(entry.target);
    }
  }, { threshold: 0.5 });
  animatedFigureObserver.observe(img);
}

// A figure with both layouts follows its column: a phone turned on its side, a window dragged
// narrower. Only such figures are watched — for the rest there is nothing to change to.
let assetColumnObserver = null;
/** column element → (image → how to get its headers). */
const watchedAssetColumns = new Map();

// The editor preview replaces its whole content at every keystroke pause, so images come and go all
// the time. An image that has left the page is forgotten here — at every hydration, and whenever
// its column changes width — or the observer would hold on to every figure ever previewed.
function forgetRemovedAssetImages() {
  for (const [column, images] of watchedAssetColumns) {
    for (const image of images.keys()) {
      if (!image.isConnected) images.delete(image);
    }
    if (images.size === 0 || !column.isConnected) {
      assetColumnObserver?.unobserve(column);
      watchedAssetColumns.delete(column);
    }
  }
}

function watchAssetColumn(img, getHeadersOrFn) {
  const column = assetColumn(img);
  if (!column || typeof ResizeObserver !== "function") return;
  if (!assetColumnObserver) {
    assetColumnObserver = new ResizeObserver((entries) => {
      forgetRemovedAssetImages();
      for (const entry of entries) {
        for (const [image, headersOrFn] of watchedAssetColumns.get(entry.target) ?? []) {
          const layout = wantedAssetLayout(image);
          if (layout !== image.dataset.assetWanted) void loadAssetLayout(image, layout, headersOrFn);
        }
      }
    });
  }
  forgetRemovedAssetImages();
  if (!watchedAssetColumns.has(column)) {
    watchedAssetColumns.set(column, new Map());
    assetColumnObserver.observe(column);
  }
  watchedAssetColumns.get(column).set(img, getHeadersOrFn);
}

/** For tests: how many figures are being followed for a change of column width. */
export function watchedAssetImageCount() {
  let count = 0;
  for (const images of watchedAssetColumns.values()) count += images.size;
  return count;
}

// ---------------------------------------------------------------------------
// Queue counts — nav badge helper
// ---------------------------------------------------------------------------

export async function fetchQueueCounts(headers) {
  try {
    return await apiFetch("/api/queue-counts", headers);
  } catch {
    return { reviews: 0, appeals: 0 };
  }
}

export function applyNavReviewBadge(navEl, counts) {
  if (!navEl) return;
  applyNavBadge(navEl, 'a[href="/review"]', (counts?.reviews ?? 0) + (counts?.appeals ?? 0));
  // #953: vurderinger som ga opp er ADMINISTRATORENS kø, ikke vurdererens — derfor et eget merke
  // på plattformlenka og ikke lagt til i summen over. En administrator skal se at det finnes noe
  // uten å måtte gå innom siden; produkteier 2026-08-26: «vis dette kun hvis det er noe å vise».
  //
  // ⚠️ Serveren gir 0 til alle som ikke er administrator, så merket kan ikke lekke tallet.
  applyNavBadge(navEl, 'a[href="/admin-platform"]', counts?.failedAssessments ?? 0);
}

function applyNavBadge(navEl, selector, total) {
  const link = navEl.querySelector(selector);
  if (!link) return;

  let badge = link.querySelector(".nav-queue-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "nav-queue-badge";
    badge.setAttribute("aria-label", `${total} ubehandlet`);
    link.appendChild(badge);
  }

  // #975: `.nav-queue-badge{display:inline-flex}` (shared.css) er en forfatter-regel, og origin slår
  // spesifisitet — så den vinner over UA-arkets `[hidden]`. Uten setHidden sto det en «0»-plakett på
  // Vurdering-lenka i toppmenyen for alle med tom kø.
  setHidden(badge, total <= 0);
  badge.textContent = String(total);
  badge.setAttribute("aria-label", `${total} ubehandlet`);
}

let consoleConfigPromise = null;

let defaultLocale = "en-GB";
/** Organisasjonens standardspråk (fra /participant/config). «en-GB» til konfigurasjonen er lest. */
export function getDefaultLocale() {
  return defaultLocale;
}

export async function getConsoleConfig() {
  if (!consoleConfigPromise) {
    consoleConfigPromise = (async () => {
      const response = await fetch("/participant/config");
      if (!response.ok) {
        throw new Error("participant_config_unavailable");
      }

      const config = await parseResponseBody(response);
      // #1046: organisasjonens standardspråk — leses av pickLocalizedText (i18n-locale.js).
      if (config && typeof config.defaultLocale === "string") defaultLocale = config.defaultLocale;

      if (config.authMode === "entra" && config.entra) {
        await initMsal(config.entra);
        if (await sendParticipantsHome({ pathname: window.location.pathname, getToken: getAccessToken })) {
          // Siden byttes ut; resten av forfattersiden skal ikke starte og vise «ingen tilgang» imens.
          return new Promise(() => {});
        }
      }

      return config;
    })();
  }

  return consoleConfigPromise;
}
