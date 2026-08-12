/**
 * #892 follow-up: fill in missing locale values for the TITLES of every section and module in one
 * course, translating from a source locale with the platform's own localisation service.
 *
 * Why this exists: renaming a module never had a translation step (fixed in v2.11.3), so courses
 * authored before it have module titles in one language only. The participant then sees a list that
 * mixes languages — English section titles above Norwegian test titles (observed on prod
 * 2026-08-12). Translating ~20 titles by hand through the authoring UI is hours of clicking.
 *
 * ## Safety
 *
 * - **Dry run by default.** `--apply` is required to write. The dry run prints every proposed
 *   translation so it can be read before anything changes.
 * - **Refuses to run in LLM stub mode.** With `LLM_MODE !== "azure_openai"` the localisation service
 *   returns tagged placeholders like `[nn] Tittel`. Writing those would be worse than the problem —
 *   so the script exits instead.
 * - **Never overwrites an existing value.** Only locales that are missing (or empty) are filled, so
 *   a real translation someone already made is left alone.
 * - **Titles only.** Section bodies and module task text are deliberately out of scope: they are
 *   long, participant-facing, and deserve review per item rather than a bulk pass.
 *
 * ## Usage
 *
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/translate-course-titles.ts --course "<title fragment>"
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/translate-course-titles.ts --course "<fragment>" --apply
 *
 * Optional: `--from nb` (source locale, default nb), `--to en-GB,nn` (targets, default both others).
 */
import { prisma } from "../../src/db/prisma.js";
import { env } from "../../src/config/env.js";
import { localizedTextCodec, type LocalizedTextObject } from "../../src/codecs/localizedTextCodec.js";
import { localizeSectionContent } from "../../src/modules/adminContent/llmContentGenerationService.js";

type Locale = "en-GB" | "nb" | "nn";
const ALL: Locale[] = ["en-GB", "nb", "nn"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function asMap(raw: string | null): LocalizedTextObject {
  const parsed = localizedTextCodec.parse(raw);
  if (!parsed) return {};
  if (typeof parsed === "string") return {};
  return { ...parsed };
}

/** The source text: the requested locale, else any non-empty value (a plain string counts). */
function sourceText(raw: string | null, from: Locale): string | null {
  const parsed = localizedTextCodec.parse(raw);
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed.trim() || null;
  return (parsed[from] ?? Object.values(parsed).find((v) => typeof v === "string" && v.trim()))?.trim() ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const redoDuplicates = process.argv.includes("--redo-duplicates");
  const courseNeedle = arg("course");
  const from = (arg("from") ?? "nb") as Locale;
  const targets = (arg("to")?.split(",") ?? ALL.filter((l) => l !== from)) as Locale[];

  if (!courseNeedle) {
    console.error("Mangler --course \"<del av kurstittelen>\".");
    process.exitCode = 1;
    return;
  }

  // Hard guard: the stub localiser returns "[nn] Tittel" and would poison the data.
  if (apply && env.LLM_MODE !== "azure_openai") {
    console.error(
      JSON.stringify({
        event: "translate_course_titles_refused",
        reason: "LLM_MODE er ikke azure_openai — oversettelsestjenesten ville returnert stubbede " +
          "plassholdere ([nn] Tittel). Kjør mot et miljø med ekte LLM-konfig.",
        llmMode: env.LLM_MODE,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const courses = await prisma.course.findMany({ select: { id: true, title: true } });
  const course = courses.find((c) => c.title.includes(courseNeedle));
  if (!course) {
    console.error(`Fant ingen kurs med «${courseNeedle}» i tittelen.`);
    process.exitCode = 1;
    return;
  }

  const items = await prisma.courseItem.findMany({
    where: { courseId: course.id },
    orderBy: { sortOrder: "asc" },
    select: {
      itemType: true,
      moduleId: true,
      sectionId: true,
      module: { select: { id: true, title: true } },
      section: { select: { id: true, title: true } },
    },
  });

  console.log(JSON.stringify({ event: "translate_course_titles_start", course: course.title, items: items.length, from, targets, dryRun: !apply }));

  let filled = 0;
  let skipped = 0;

  for (const item of items) {
    const isSection = item.itemType === "SECTION";
    const row = isSection ? item.section : item.module;
    if (!row) continue;

    const map = asMap(row.title);
    const src = sourceText(row.title, from);
    if (!src) { skipped += 1; continue; }

    // A locale needs filling when it is absent — or, with --redo-duplicates, when it merely repeats
    // the source text. #892 wrote the author's one title into every locale, so those rows LOOK
    // translated and would otherwise be skipped: they are exactly the rows that need fixing.
    // Off by default, because a title that is legitimately identical across languages (a proper
    // noun) is indistinguishable from a fabricated copy — see #892.
    const missing = targets.filter((l) => {
      const v = map[l];
      if (!v || !v.trim()) return true;
      return redoDuplicates && v.trim() === src.trim();
    });
    if (missing.length === 0) { skipped += 1; continue; }

    const additions: Record<string, string> = {};
    for (const target of missing) {
      // Reuses the same service the section editor's "Translate" action calls, so the output is
      // what a human would have got through the UI.
      const result = await localizeSectionContent({ title: src, sourceLocale: from, targetLocale: target } as never);
      const translated = (result as { title?: string }).title?.trim();
      if (!translated) continue;
      additions[target] = translated;
    }
    if (Object.keys(additions).length === 0) { skipped += 1; continue; }

    console.log(JSON.stringify({
      event: "translate_course_titles_item",
      type: item.itemType,
      id: row.id,
      source: src,
      additions,
    }));

    if (apply) {
      const next = localizedTextCodec.serialize({ ...map, ...additions } as LocalizedTextObject);
      if (isSection) {
        await prisma.courseSection.update({ where: { id: row.id }, data: { title: next } });
      } else {
        await prisma.module.update({ where: { id: row.id }, data: { title: next } });
      }
    }
    filled += 1;
  }

  console.log(JSON.stringify({ event: "translate_course_titles_complete", dryRun: !apply, filled, skipped }));
  if (!apply && filled > 0) console.log("Tørrkjøring — les forslagene over, kjør så på nytt med --apply.");
}

main()
  .catch((error) => {
    console.error("translate_course_titles_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
