import { prisma } from "../db/prisma.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";

/**
 * #892 clean-up: collapse localized-text values whose locales all hold the SAME string back into a
 * plain string.
 *
 * Renaming a module used to fan one title out into `en-GB`, `nb` and `nn`. The rename path is fixed
 * (v2.11.3), but the rows it already wrote still look translated — which is exactly the signal a
 * translation-status view needs (#894). This restores the signal on existing content.
 *
 * ## Why this is safe
 *
 * The transformation is **display-neutral**. `localizeContentText` resolves a locale map as
 * `map[locale] ?? map["en-GB"] ?? first-value`, and a plain string is returned verbatim for every
 * locale. When every entry holds the same string S, both encodings render S in every locale — so no
 * participant, author or export can observe a difference. Only the *claim* «this has a per-locale
 * translation» goes away, and that claim was false.
 *
 * ## What is deliberately left alone
 *
 * - **Single-locale maps** (`{"nb":"X"}`). These carry MORE information than a plain string — they
 *   record which language the text is in. Collapsing them would discard that.
 * - **Maps with any differing value.** Two locales equal and a third different means someone
 *   genuinely translated part of it.
 * - **Values that are already plain strings.** Nothing to do.
 *
 * Idempotent: a second run finds nothing to collapse.
 */

export type EntityKey = "module.title" | "courseSection.title" | "course.title" | "course.description";

export type CleanupEntityResult = {
  scanned: number;
  collapsed: number;
  /** Ids touched (or that WOULD be touched in a dry run), for the operator log. */
  ids: string[];
};

export type CleanupResult = {
  dryRun: boolean;
  byEntity: Record<EntityKey, CleanupEntityResult>;
  totalCollapsed: number;
};

/**
 * Returns the single shared string when `raw` is a locale map of 2+ entries that all hold the same
 * value; otherwise null (leave the row untouched).
 */
export function collapsibleTitle(raw: string | null | undefined): string | null {
  const parsed = localizedTextCodec.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const values = Object.values(parsed).filter((v): v is string => typeof v === "string");
  if (values.length < 2) {
    return null;
  }

  const [first, ...rest] = values;
  const trimmed = first.trim();
  if (!trimmed) {
    return null;
  }
  return rest.every((v) => v.trim() === trimmed) ? trimmed : null;
}

type Row = { id: string; value: string | null };

async function collapseRows(
  rows: Row[],
  apply: (id: string, value: string) => Promise<unknown>,
  dryRun: boolean,
): Promise<CleanupEntityResult> {
  const ids: string[] = [];
  for (const row of rows) {
    const collapsed = collapsibleTitle(row.value);
    if (collapsed === null) continue;
    ids.push(row.id);
    if (!dryRun) {
      await apply(row.id, collapsed);
    }
  }
  return { scanned: rows.length, collapsed: ids.length, ids };
}

/**
 * Scans every localized title/description that the rename paths write to. Dry run by default —
 * pass `{ dryRun: false }` to write.
 */
export async function collapseDuplicatedLocalizedTitles(
  options: { dryRun?: boolean } = {},
): Promise<CleanupResult> {
  const dryRun = options.dryRun !== false;

  const [modules, sections, courses] = await Promise.all([
    prisma.module.findMany({ select: { id: true, title: true } }),
    prisma.courseSection.findMany({ select: { id: true, title: true } }),
    prisma.course.findMany({ select: { id: true, title: true, description: true } }),
  ]);

  const byEntity: Record<EntityKey, CleanupEntityResult> = {
    "module.title": await collapseRows(
      modules.map((m) => ({ id: m.id, value: m.title })),
      (id, title) => prisma.module.update({ where: { id }, data: { title } }),
      dryRun,
    ),
    "courseSection.title": await collapseRows(
      sections.map((s) => ({ id: s.id, value: s.title })),
      (id, title) => prisma.courseSection.update({ where: { id }, data: { title } }),
      dryRun,
    ),
    "course.title": await collapseRows(
      courses.map((c) => ({ id: c.id, value: c.title })),
      (id, title) => prisma.course.update({ where: { id }, data: { title } }),
      dryRun,
    ),
    "course.description": await collapseRows(
      courses.map((c) => ({ id: c.id, value: c.description })),
      (id, description) => prisma.course.update({ where: { id }, data: { description } }),
      dryRun,
    ),
  };

  const totalCollapsed = Object.values(byEntity).reduce((sum, e) => sum + e.collapsed, 0);
  return { dryRun, byEntity, totalCollapsed };
}
