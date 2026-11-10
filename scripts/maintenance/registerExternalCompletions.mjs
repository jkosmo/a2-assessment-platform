// #1145: registrer kursbevis for kurs tatt utenfor plattformen, fra en liste over navn per kurs (doc/design/PLAN_1145.md).
//
// To trinn, med produkteiers godkjenning imellom:
//
//   1. Prøvekjøring (standard): node scripts/maintenance/registerExternalCompletions.mjs \
//        --auth <innlogging.json> --input <inndata.json> --report <rapport.json>
//      Slår opp hvert kurs på tittelen (nøyaktig én publisert, ikke arkivert) og hvert navn med brukersøket. Bare EKSAKT likt navn
//      (store/små bokstaver og mellomrom normalisert, «Etternavn, Fornavn» snudd) godtas; søket er delstreng, så ett treff er ikke
//      nok. Alt annet havner under `unresolved`, med kandidatenes e-post. Så spør skriptet plattformen (dryRun) hva som ville skjedd.
//      Rapporten viser navn → e-post → utfall. Produkteier godkjenner e-postene.
//
//   2. Skriving: ... --write --approved <godkjent-rapport.json> --report <resultat.json>
//      Leser de godkjente userId-ene fra rapporten og søker IKKE på nytt (lista kan ha endret seg). Sender bare dem med utfallet
//      `would_create`. Plattformen sjekker alt på nytt under låsene og gir `exists` for det som alt finnes; kjøres to ganger, blir
//      ingenting dobbelt.
//
// Inndata (lages lokalt fra arket, aldri i repoet):
//   { "courses": [ { "courseTitle": "...", "reference": "Kurs og sertifisering.xlsx, Modul 2", "names": ["Kari Nordmann", ...] } ] }
// Innloggingen er en fil med { baseUrl, accessToken, expiresOn } for en ADMINISTRATOR (f.eks. fra en personlig innlogging mot prod).
// Tokenet skrives aldri ut. Alle filer må ligge UTENFOR repoet: de har navn og e-post.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAUSE_MS = 600; // under grensen på 120 kall i minuttet per bruker (rateLimiting.ts)
let partial = null; // skrivingens rapport så langt, så en feil midt i ikke skjuler hvem som fikk bevis
const CHUNK = 200; // endepunktets tak per kall

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);
const fail = (message) => {
  console.error(`[eksterne-bevis] ${message}`);
  process.exit(1);
};

function outsideRepo(file, label) {
  if (!file) fail(`mangler --${label}`);
  const resolved = path.resolve(file);
  const relative = path.relative(REPO, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) fail(`--${label} ligger inne i repoet (${relative}); legg fila utenfor, den har personopplysninger.`);
  return resolved;
}

export function normalizeName(value) {
  let name = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  // «Nordmann, Kari» → «Kari Nordmann»
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  return name.toLocaleLowerCase("nb");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kurstittelen som den står, med mellomrom normalisert (ikke store/små bokstaver: titlene skal være like). */
export function normalizeTitle(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Utløpet som millisekunder: et tall i ms eller sekunder, eller en datotekst. `null` når det ikke kan leses. */
export function expiresAtMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/** `Retry-After` i millisekunder: sekunder eller en HTTP-dato; 10 s når det ikke kan leses. */
function retryAfterMs(header) {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(String(header ?? ""));
  return Number.isNaN(at) ? 10_000 : Math.max(1000, at - Date.now());
}

function client(auth) {
  const base = String(auth.baseUrl).replace(/\/+$/, "");
  return async function call(method, route, body) {
    for (let attempt = 1; ; attempt += 1) {
      await sleep(PAUSE_MS);
      const response = await fetch(`${base}${route}`, {
        method,
        headers: { authorization: `Bearer ${auth.accessToken}`, "x-locale": "nb", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 429 && attempt < 5) {
        const wait = retryAfterMs(response.headers.get("retry-after"));
        console.log(`[eksterne-bevis] 429, venter ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        continue;
      }
      const json = await response.json().catch(() => ({}));
      // Kaster (ikke `fail`), så hovedløkka kan skrive det som er gjort før den avslutter.
      if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
      return json;
    }
  };
}

async function resolveCourses(call, inputCourses) {
  const all = (await call("GET", "/api/admin/content/courses")).courses ?? [];
  return inputCourses.map((input) => {
    // Mellomrom normaliseres: den arkiverte kopien av Modul 5 har to mellomrom etter kolon (prøvekjøringen på stage 2026-11-10).
    const sameTitle = all.filter((c) => normalizeTitle(c.displayTitle) === normalizeTitle(input.courseTitle));
    const live = sameTitle.filter((c) => c.publishedAt && !c.archivedAt);
    if (live.length !== 1) fail(`kurset «${input.courseTitle}»: ${live.length} publiserte, ikke arkiverte kurs med den tittelen (ventet 1)`);
    // Andre kurs med samme tittel (f.eks. en arkivert kopi): et bevis der betyr også at personen har tatt kurset. Endepunktet tar
    // høyst fem; flere avbryter i stedet for å kutte i stillhet. Rapporten viser hvor mange som ble funnet, så en kopi med litt
    // annen tittel kan oppdages ved godkjenningen.
    const related = sameTitle.filter((c) => c.id !== live[0].id).map((c) => c.id);
    if (related.length > 5) fail(`kurset «${input.courseTitle}»: ${related.length} andre kurs med samme tittel (høyst 5)`);
    return { ...input, courseId: live[0].id, relatedCourseIds: related };
  });
}

export async function resolvePeople(call, names) {
  const matched = new Map(); // normalisert navn → { name, userId, email }
  const unresolved = [];
  for (const raw of names) {
    const wanted = normalizeName(raw);
    if (matched.has(wanted) || unresolved.some((u) => normalizeName(u.name) === wanted)) continue;
    const found = (await call("GET", `/api/admin/content/users/search?q=${encodeURIComponent(String(raw).trim())}`)).users ?? [];
    // En e-postadresse i stedet for navnet (satt av produkteier ved godkjenningen, når navnet er tvetydig) matches eksakt på e-post.
    const byEmail = String(raw).includes("@");
    const exact = found.filter((u) => (byEmail ? String(u.email ?? "").toLowerCase() === String(raw).trim().toLowerCase() : normalizeName(u.name) === wanted));
    if (exact.length === 1) {
      matched.set(wanted, { name: String(raw).trim(), userId: exact[0].id, email: exact[0].email });
      continue;
    }
    // Ingen eller flere eksakte: vis kandidater fra søk på etternavnet, så produkteier kan avgjøre.
    let candidates = exact;
    if (exact.length === 0) {
      const last = String(raw).trim().split(/\s+/).pop();
      if (last && last.length >= 2) candidates = (await call("GET", `/api/admin/content/users/search?q=${encodeURIComponent(last)}`)).users ?? [];
    }
    unresolved.push({
      name: String(raw).trim(),
      reason: exact.length > 1 ? "flere_med_samme_navn" : "ingen_med_eksakt_navn",
      candidates: candidates.slice(0, 10).map((u) => ({ name: u.name, email: u.email })),
    });
  }
  return { matched: [...matched.values()], unresolved };
}

async function dryRun(call, input) {
  const courses = await resolveCourses(call, input.courses ?? []);
  const report = { mode: "dry-run", createdAt: new Date().toISOString(), baseUrl: null, courses: [] };
  for (const course of courses) {
    const { matched, unresolved } = await resolvePeople(call, course.names ?? []);
    const outcomes = new Map();
    for (let i = 0; i < matched.length; i += CHUNK) {
      const chunk = matched.slice(i, i + CHUNK);
      const result = await call("POST", "/api/admin/platform/course-completions/external", {
        courseId: course.courseId,
        userIds: chunk.map((m) => m.userId),
        relatedCourseIds: course.relatedCourseIds,
        reference: course.reference,
        dryRun: true,
      });
      for (const r of result.results ?? []) outcomes.set(r.userId, r.outcome);
    }
    report.courses.push({
      courseTitle: course.courseTitle,
      courseId: course.courseId,
      relatedCourseIds: course.relatedCourseIds,
      reference: course.reference,
      people: matched.map((m) => ({ ...m, outcome: outcomes.get(m.userId) ?? "ukjent" })),
      unresolved,
    });
  }
  return report;
}

const sameBase = (a, b) => Boolean(a) && String(a).replace(/\/+$/, "") === String(b ?? "").replace(/\/+$/, "");

export async function write(call, approved, auth) {
  if (approved.mode !== "dry-run") throw new Error("--approved må være rapporten fra en prøvekjøring");
  // ⚠️ Stage er en kopi av prod med de samme id-ene og andre navn. En prøvekjøring godkjent mot stage og skrevet mot prod ville gitt
  // bevis til de virkelige personene bak stage-navnene. Rapporten og innloggingen må gjelde samme miljø.
  if (!sameBase(approved.baseUrl, auth.baseUrl)) {
    throw new Error(`den godkjente rapporten gjelder ${approved.baseUrl}, innloggingen ${auth.baseUrl}. Kjør prøvekjøringen mot samme miljø.`);
  }
  console.log(`[eksterne-bevis] skriver mot ${auth.baseUrl}, fra prøvekjøringen ${approved.createdAt}`);
  const result = { mode: "write", createdAt: new Date().toISOString(), basedOn: approved.createdAt, courses: [] };
  partial = result;
  for (const course of approved.courses ?? []) {
    const toCreate = (course.people ?? []).filter((p) => p.outcome === "would_create");
    const outcomes = new Map();
    // Kurset står i rapporten før kallet, så en feil midt i viser hvilket kurs som ikke ble ferdig.
    const entry = { courseTitle: course.courseTitle, courseId: course.courseId, people: [] };
    result.courses.push(entry);
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const chunk = toCreate.slice(i, i + CHUNK);
      const response = await call("POST", "/api/admin/platform/course-completions/external", {
        courseId: course.courseId,
        userIds: chunk.map((p) => p.userId),
        relatedCourseIds: course.relatedCourseIds,
        reference: course.reference,
        dryRun: false,
      });
      for (const r of response.results ?? []) outcomes.set(r.userId, r.outcome);
      entry.people = toCreate.map((p) => ({ name: p.name, email: p.email, userId: p.userId, outcome: outcomes.get(p.userId) ?? "ikke_sendt" }));
    }
    entry.people = toCreate.map((p) => ({ name: p.name, email: p.email, userId: p.userId, outcome: outcomes.get(p.userId) ?? "ikke_sendt" }));
  }
  return result;
}

function summarize(report) {
  for (const course of report.courses) {
    const counts = {};
    for (const p of course.people) counts[p.outcome] = (counts[p.outcome] ?? 0) + 1;
    const extra = course.unresolved
      ? `, uavklart ${course.unresolved.length}, andre kurs med samme tittel ${(course.relatedCourseIds ?? []).length}`
      : "";
    console.log(`[eksterne-bevis] ${course.courseTitle}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") || "ingen"}${extra}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const authFile = outsideRepo(arg("auth"), "auth");
  const reportFile = outsideRepo(arg("report"), "report");
  const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
  if (!auth.accessToken || !auth.baseUrl) fail("innloggingsfila mangler accessToken eller baseUrl");
  if (expiresAtMs(auth.expiresOn) !== null && expiresAtMs(auth.expiresOn) < Date.now()) fail("innloggingen er utløpt; logg inn på nytt");
  const call = client(auth);
  let report;
  try {
    if (flag("write")) {
      const approved = JSON.parse(fs.readFileSync(outsideRepo(arg("approved"), "approved"), "utf8"));
      report = await write(call, approved, auth);
    } else {
      const input = JSON.parse(fs.readFileSync(outsideRepo(arg("input"), "input"), "utf8"));
      report = await dryRun(call, input);
    }
  } catch (error) {
    // Det som alt er skrevet, står i databasen. Rapporten over det skrives før skriptet avslutter; ny kjøring gir `exists`.
    if (partial) {
      partial.baseUrl = auth.baseUrl;
      partial.incomplete = String(error?.message ?? error).slice(0, 500);
      fs.writeFileSync(reportFile, `${JSON.stringify(partial, null, 2)}\n`);
      console.error(`[eksterne-bevis] avbrutt; det som ble gjort, står i ${reportFile}`);
    }
    fail(String(error?.message ?? error));
  }
  report.baseUrl = auth.baseUrl;
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  summarize(report);
  console.log(`[eksterne-bevis] rapporten: ${reportFile}`);
}
