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
        const wait = Number(response.headers.get("retry-after") ?? "10") * 1000;
        console.log(`[eksterne-bevis] 429, venter ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        continue;
      }
      const json = await response.json().catch(() => ({}));
      if (!response.ok) fail(`${method} ${route}: ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
      return json;
    }
  };
}

async function resolveCourses(call, inputCourses) {
  const all = (await call("GET", "/api/admin/content/courses")).courses ?? [];
  return inputCourses.map((input) => {
    const sameTitle = all.filter((c) => (c.displayTitle ?? "").trim() === input.courseTitle.trim());
    const live = sameTitle.filter((c) => c.publishedAt && !c.archivedAt);
    if (live.length !== 1) fail(`kurset «${input.courseTitle}»: ${live.length} publiserte, ikke arkiverte kurs med den tittelen (ventet 1)`);
    // Andre kurs med samme tittel (f.eks. en arkivert kopi): et bevis der betyr også at personen har tatt kurset.
    const related = sameTitle.filter((c) => c.id !== live[0].id).map((c) => c.id);
    return { ...input, courseId: live[0].id, relatedCourseIds: related.slice(0, 5) };
  });
}

async function resolvePeople(call, names) {
  const matched = new Map(); // normalisert navn → { name, userId, email }
  const unresolved = [];
  for (const raw of names) {
    const wanted = normalizeName(raw);
    if (matched.has(wanted) || unresolved.some((u) => normalizeName(u.name) === wanted)) continue;
    const found = (await call("GET", `/api/admin/content/users/search?q=${encodeURIComponent(String(raw).trim())}`)).users ?? [];
    const exact = found.filter((u) => normalizeName(u.name) === wanted);
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

async function write(call, approved) {
  if (approved.mode !== "dry-run") fail("--approved må være rapporten fra en prøvekjøring");
  const result = { mode: "write", createdAt: new Date().toISOString(), basedOn: approved.createdAt, courses: [] };
  for (const course of approved.courses ?? []) {
    const toCreate = (course.people ?? []).filter((p) => p.outcome === "would_create");
    const outcomes = new Map();
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
    }
    result.courses.push({
      courseTitle: course.courseTitle,
      courseId: course.courseId,
      people: toCreate.map((p) => ({ name: p.name, email: p.email, userId: p.userId, outcome: outcomes.get(p.userId) ?? "ukjent" })),
    });
  }
  return result;
}

function summarize(report) {
  for (const course of report.courses) {
    const counts = {};
    for (const p of course.people) counts[p.outcome] = (counts[p.outcome] ?? 0) + 1;
    const extra = course.unresolved ? `, uavklart ${course.unresolved.length}` : "";
    console.log(`[eksterne-bevis] ${course.courseTitle}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") || "ingen"}${extra}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const authFile = outsideRepo(arg("auth"), "auth");
  const reportFile = outsideRepo(arg("report"), "report");
  const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
  if (!auth.accessToken || !auth.baseUrl) fail("innloggingsfila mangler accessToken eller baseUrl");
  if (auth.expiresOn && auth.expiresOn < Date.now()) fail("innloggingen er utløpt; logg inn på nytt");
  const call = client(auth);
  let report;
  if (flag("write")) {
    const approved = JSON.parse(fs.readFileSync(outsideRepo(arg("approved"), "approved"), "utf8"));
    report = await write(call, approved);
  } else {
    const input = JSON.parse(fs.readFileSync(outsideRepo(arg("input"), "input"), "utf8"));
    report = await dryRun(call, input);
  }
  report.baseUrl = auth.baseUrl;
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  summarize(report);
  console.log(`[eksterne-bevis] rapporten: ${reportFile}`);
}
