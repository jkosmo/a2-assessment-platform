// `npm run mascot:preview -- <navn> [fil]`: tegner alt maskotpakken `mascots/<navn>/` bidrar med, til én HTML-fil, så
// den som lager en pakke kan se resultatet før noen bytter valget (doc/design/MASKOTPAKKE.md, mascots/seilbat/README.md):
//   - alle e-poster: ni situasjoner × tre språk, med bildet øverst;
//   - alle humør på Profil, på tre språk;
//   - figuren i «Mine kurs» i hver tilstand, og feiringen.
// Uten navn: pakken som er valgt i mascot.config.json. Uten fil: dist/mascot-preview-<navn>.html.
//
// Alt tegnes av de ekte funksjonene: e-postene av malen og tekstene appen sender med (participantNotificationService.ts,
// notificationMessages.ts), Profil av `renderStats` (profile-stats.js) og figuren av `renderCourseProgress` og
// `launchCourseBoatCelebration` (course-progress-boat.js). Nettlesermodulene importerer `/static/...`; en liten
// oppslagskrok sender dem til public/static/, og figurmodulen til den serveren ville laget av pakken.
//
// Sjekken (`npm run mascot:check`) kjøres ikke her; kjør den også.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BOAT_MOODS } from "../modules/gamification/moods.js";
import {
  loadMascotPack,
  MASCOT_EMAIL_SITUATIONS,
  mascotFigureModule,
  mascotMoodsJson,
  resolveMascotRequest,
  selectedMascotId,
  useMascotPack,
  type MascotEmailSituation,
  type MascotPack,
} from "../modules/mascot/mascotPack.js";
import type { SupportedLocale } from "../i18n/locale.js";

const root = process.cwd();
const id = process.argv[2] || selectedMascotId(root);
const outFile = path.resolve(process.argv[3] || path.join("dist", `mascot-preview-${id}.html`));

// Pakken velges FØR noe som leser den, lastes (e-postmalen tar den med seg når den lastes).
const pack = loadMascotPack(root, id);
useMascotPack(pack);

// E-postmalen ligger bak env.ts, som krever en database-adresse. Forhåndsvisningen bruker ingen database; lenkene i
// e-postene får en eksempeladresse.
process.env.DATABASE_URL ??= "postgresql://forhandsvisning@127.0.0.1:1/brukes-ikke";
process.env.PUBLIC_APP_BASE_URL ??= "https://plattform.example.test";

registerStaticImports(pack);

const LOCALES: SupportedLocale[] = ["nb", "nn", "en-GB"];
const COURSE = "Brannvern for alle";
const MODULE = "Rømningsveier";

const html = await renderPreview(pack);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, html, "utf8");
process.stdout.write(`Forhåndsvisningen av «${pack.id}» er skrevet til ${outFile}\n`);
// Feiringen har et sikkerhetsnett med setTimeout; ikke vent på det.
process.exit(0);

/** Nettlesermodulenes `/static/...`: figurmodulen fra pakken, resten fra public/static/. */
function registerStaticImports(selected: MascotPack) {
  const hook = [
    "let map;",
    "export function initialize(data) { map = data; }",
    "export async function resolve(specifier, context, next) {",
    "  if (Object.hasOwn(map.exact, specifier)) return { url: map.exact[specifier], shortCircuit: true };",
    "  if (specifier.startsWith('/static/')) return { url: map.publicStatic + specifier.slice('/static/'.length), shortCircuit: true };",
    "  return next(specifier, context);",
    "}",
  ].join("\n");
  const figureModule = `data:text/javascript;base64,${Buffer.from(mascotFigureModule(selected)).toString("base64")}`;
  register(`data:text/javascript;base64,${Buffer.from(hook).toString("base64")}`, {
    data: {
      exact: { "/static/mascot/figure.js": figureModule },
      publicStatic: pathToFileURL(path.join(root, "public", "static") + path.sep).href,
    },
  });
}

function publicModule(rel: string): string {
  return pathToFileURL(path.join(root, "public", rel)).href;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** En hel side i en iframe, så stilene til e-posten, Profil og «Mine kurs» ikke blander seg. */
function frame(document: string, height: number, title: string): string {
  return `<iframe title="${escapeHtml(title)}" style="width:100%;height:${height}px;border:1px solid #ccc;background:#fff" srcdoc="${escapeHtml(document)}"></iframe>`;
}

/** En tekstfil uten BOM: et BOM først i en `<style>` gjør den første regelen (`:root` med fargene) ugyldig. */
function readText(file: string): string {
  const text = readFileSync(file, "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Fellesstilen alle sidene har (fargene, avstandene). */
function sharedCss(): string {
  return readText(path.join(root, "public", "static", "shared.css"));
}

/** `<style>`-blokkene i en side i public/, så forhåndsvisningen bruker sidens egne regler. */
function pageStyles(page: string): string {
  const source = readText(path.join(root, "public", page));
  return [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
}

/** En fil i pakken som data-adresse, for adressene nettleseren ellers ville hentet fra serveren. */
function packFileAsDataUrl(selected: MascotPack, url: string): string {
  const hit = resolveMascotRequest(selected, url);
  if (!hit || hit.kind !== "file") throw new Error(`${url} finnes ikke i pakken`);
  const type = hit.file.endsWith(".svg") ? "image/svg+xml" : hit.file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${type};base64,${readFileSync(hit.file).toString("base64")}`;
}

// ── E-postene ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function renderEmails(): Promise<string> {
  const { buildCourseMajorVersionEmail, buildNotificationEmail } = await import("../modules/certification/participantNotificationService.js");
  const messages = await import("../i18n/notificationMessages.js");
  const { buildEmailLink } = await import("../modules/certification/emailLinks.js");
  const { EMAIL_ILLUSTRATIONS } = await import("../modules/certification/illustratedEmail.js");
  const submittedAt = new Date("2026-11-10T10:00:00.000Z");
  const dueAt = new Date("2026-11-20T00:00:00.000Z");

  // Samme tekst, grunn og lenke som avsenderen av hver e-post bruker (se kallene i participantNotificationService.ts
  // og courseReminderService.ts).
  const build = (situation: MascotEmailSituation, locale: SupportedLocale) => {
    const moduleLink = buildEmailLink(locale, "module", { moduleId: "m1" });
    const courseLink = buildEmailLink(locale, "course", { courseId: "c1" });
    const common = { locale, illustration: EMAIL_ILLUSTRATIONS[situation] };
    switch (situation) {
      case "courseNewVersion":
        return buildCourseMajorVersionEmail({ locale, courseTitle: COURSE, versionMajor: 4, changedItemCount: 3, courseId: "c1" });
      case "courseAssigned":
        return buildNotificationEmail({ ...common, message: messages.getCourseAssignmentNotificationMessage(locale, { courseTitle: COURSE, className: "Avdeling Vest", dueAt }), reason: "assignment", link: courseLink });
      case "dueSoon":
        return buildNotificationEmail({ ...common, message: messages.getCourseReminderNotificationMessage(locale, "due_soon", { courseTitle: COURSE, dueAt, daysBefore: 3 }), reason: "reminder", link: courseLink });
      case "overdue":
        return buildNotificationEmail({ ...common, message: messages.getCourseReminderNotificationMessage(locale, "overdue", { courseTitle: COURSE, dueAt }), reason: "reminder", link: courseLink });
      case "passed":
        return buildNotificationEmail({ ...common, message: messages.getAssessmentResultNotificationMessage(locale, "pass", { moduleTitle: MODULE, submittedAt }), reason: "submission", link: moduleLink });
      case "notPassed":
        return buildNotificationEmail({ ...common, message: messages.getAssessmentResultNotificationMessage(locale, "fail", { moduleTitle: MODULE, submittedAt }), reason: "submission", link: moduleLink });
      case "underReview":
        return buildNotificationEmail({ ...common, message: messages.getAssessmentResultNotificationMessage(locale, "under_review", { moduleTitle: MODULE, submittedAt }), reason: "submission", link: moduleLink });
      case "appeal":
        return buildNotificationEmail({ ...common, message: messages.getAppealNotificationMessage(locale, "OPEN", { moduleTitle: MODULE }), reason: "appeal", link: moduleLink });
      case "discussion":
        return buildNotificationEmail({
          ...common,
          message: messages.getDiscussionQuestionNotificationMessage(locale, { courseTitle: COURSE, threadTitle: "Hvor står slukkeapparatet?" }),
          reason: "discussionQuestion",
          link: buildEmailLink(locale, "discussion", { courseId: "c1", threadId: "t1" }),
        });
    }
  };

  const rows = MASCOT_EMAIL_SITUATIONS.map((situation) => {
    const cells = LOCALES.map((locale) => {
      const email = build(situation, locale);
      // Bildet er et innebygd vedlegg (cid:); her settes det rett inn, så det vises i en vanlig nettleser.
      let body = email.html;
      for (const attachment of email.attachments) {
        body = body.split(`cid:${attachment.contentId}`).join(`data:${attachment.contentType};base64,${attachment.contentInBase64}`);
      }
      return `<div class="cell"><p class="meta">${escapeHtml(locale)} · emne: <b>${escapeHtml(email.subject)}</b></p>${frame(body, 560, `${situation} ${locale}`)}</div>`;
    }).join("");
    return `<h3>${escapeHtml(situation)}</h3><div class="grid">${cells}</div>`;
  });
  return rows.join("\n");
}

// ── Profil ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function renderMoods(selected: MascotPack): Promise<string> {
  const { renderStats } = await import(publicModule("static/profile-stats.js"));
  const { translations } = await import(publicModule("i18n/profile-translations.js"));
  // Det profilen får fra /static/mascot/moods.json, med bildene som data-adresser.
  const mascot = JSON.parse(mascotMoodsJson(selected));
  for (const mood of Object.values(mascot.moods) as Array<{ image: string }>) mood.image = packFileAsDataUrl(selected, mood.image);

  const heroes = [...BOAT_MOODS, "ukjent"].flatMap((mood) =>
    LOCALES.map((locale) => {
      const container = { innerHTML: "" };
      const t = (key: string) => translations[locale]?.[key] ?? key;
      renderStats(container, { mood, weeks: [], recent: {}, totals: {} }, { t, locale, mascot });
      // Bare toppen med båten og linja; ukene og totalene kommer ikke fra pakken.
      const hero = container.innerHTML.slice(0, container.innerHTML.indexOf('<div class="stats-weeks">'));
      const label = mood === "ukjent" ? "et humør klienten ikke kjenner (faller tilbake til «mett»)" : mood;
      return `<p class="meta">${escapeHtml(label)} · ${escapeHtml(locale)}</p>${hero}`;
    }),
  );
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${sharedCss()}\n${pageStyles("profile.html")}\nbody{padding:16px}.meta{font:12px sans-serif;color:#666;margin:16px 0 4px}</style></head><body>${heroes.join("\n")}</body></html>`;
  return frame(page, 1800, "Profil");
}

// ── «Mine kurs» ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function renderFigure(selected: MascotPack): Promise<string> {
  const { renderCourseProgress, launchCourseBoatCelebration } = await import(publicModule("static/course-progress-boat.js"));
  const { JSDOM } = await import("jsdom");
  const states = [
    { label: "ikke påbegynt", completed: false, stepsDone: 0, pct: 0 },
    { label: "1 av 300 steg (flatt seil)", completed: false, stepsDone: 1, pct: 0 },
    { label: "29 % (flatt seil)", completed: false, stepsDone: 29, pct: 29 },
    { label: "30 % (fullt seil)", completed: false, stepsDone: 30, pct: 30 },
    { label: "70 %", completed: false, stepsDone: 70, pct: 70 },
    { label: "fullført", completed: true, stepsDone: 8, pct: 100 },
  ];
  const barAttrs = 'role="progressbar" aria-valuemin="0" aria-valuemax="100"';
  const rows = states.map((state) => `<p class="meta">${escapeHtml(state.label)}</p><div class="row">${renderCourseProgress({ ...state, barAttrs })}</div>`);

  // Feiringen lages i en DOM, som i nettleseren; knappen setter den inn på nytt, så animasjonen spilles igjen.
  const dom = new JSDOM("<!DOCTYPE html><div id=c></div>");
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = dom.window.document;
  let celebration: string;
  try {
    const host = dom.window.document.getElementById("c")!;
    host.innerHTML = renderCourseProgress({ completed: true, stepsDone: 8, pct: 100, barAttrs });
    launchCourseBoatCelebration(host.firstElementChild, { reducedMotion: false });
    celebration = host.innerHTML;
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
  const figureCss = readText(path.join(selected.dir, selected.figure.css));
  const page = [
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${sharedCss()}\n${pageStyles("participant.html")}\n${figureCss}`,
    "body{padding:16px}.meta{font:12px sans-serif;color:#666;margin:16px 0 4px}.row{width:min(600px,100%)}#again{width:auto;display:inline-block}</style></head><body>",
    rows.join("\n"),
    `<p class="meta">feiring når kurset fullføres (${selected.figure.celebrationMs} ms) <button id="again" type="button">Spill av igjen</button></p>`,
    `<div class="row" id="celebration">${celebration}</div>`,
    `<script>const markup = ${JSON.stringify(celebration).replace(/</g, "\\u003c")}; document.getElementById("again").onclick = () => { document.getElementById("celebration").innerHTML = markup; };</script>`,
    "</body></html>",
  ].join("\n");
  return frame(page, 640, "Mine kurs");
}

// ── Siden ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function renderPreview(selected: MascotPack): Promise<string> {
  const favicon = packFileAsDataUrl(selected, "/static/favicon.svg");
  const icons = Object.entries(selected.favicon)
    .map(([key, rel]) => `<figure><img src="${packFileAsDataUrl(selected, `/static/mascot/${selected.id}/${rel}`)}" alt="" style="max-width:64px"><figcaption>${escapeHtml(key)}</figcaption></figure>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maskotpakken «${escapeHtml(selected.id)}»</title>
<link rel="icon" href="${favicon}">
<style>
body { font-family: Arial, Helvetica, sans-serif; margin: 0 auto; max-width: 1500px; padding: 16px; color: #1f2933; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.meta { font-size: 12px; color: #5f6b7a; margin: 4px 0; }
.icons { display: flex; gap: 24px; align-items: end; flex-wrap: wrap; }
figure { margin: 0; text-align: center; font-size: 12px; }
</style>
</head>
<body>
<h1>Maskotpakken «${escapeHtml(selected.id)}» (${escapeHtml(selected.name.nb)})</h1>
<p>Laget av <code>npm run mascot:preview</code> fra <code>mascots/${escapeHtml(selected.id)}/</code>. Kravene og nøklene står i <code>mascots/seilbat/README.md</code>; kjør også <code>npm run mascot:check</code>.</p>
<h2>Favicon</h2>
<div class="icons">${icons}</div>
<h2>«Mine kurs»: figuren på fremdriftslinja</h2>
${await renderFigure(selected)}
<h2>Profil: humørene</h2>
${await renderMoods(selected)}
<h2>E-postene: ni situasjoner × tre språk</h2>
${await renderEmails()}
</body>
</html>
`;
}
