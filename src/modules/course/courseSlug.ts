import { localizeContentText } from "../../i18n/content.js";
import type { DbTransactionClient } from "../../db/transaction.js";

/**
 * 2.121.0: kursets navn i delingslenka, f.eks. «Kurs 7 – Hva er egentlig en KI-agent?» →
 * `kurs-7-hva-er-egentlig-en-ki-agent`. Bokmålstittelen brukes (organisasjonens språk); mangler den,
 * faller oppslaget tilbake som ellers.
 *
 * Migrasjonen `20261031090000_course_slug` gjør det samme i SQL for kurs som var publisert fra før.
 * De to trenger ikke gi likt svar — en slug settes bare én gang — men reglene er de samme.
 */
const MAX_LENGTH = 80;

export function slugifyCourseTitle(title: string): string {
  const text = (localizeContentText("nb", title) ?? title)
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  let slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > MAX_LENGTH) slug = slug.slice(0, MAX_LENGTH).replace(/-[^-]*$/, "") || slug.slice(0, MAX_LENGTH);
  return slug || "kurs";
}

/**
 * Setter kursets slug hvis den mangler, og returnerer den. Er navnet tatt, får det et nummer (`-2`, `-3` …).
 * Kalles ved publisering, i samme transaksjon.
 */
export async function assignCourseSlugIfMissing(client: DbTransactionClient, courseId: string): Promise<string | null> {
  const course = await client.course.findUnique({ where: { id: courseId }, select: { slug: true, title: true } });
  if (!course) return null;
  if (course.slug) return course.slug;

  const base = slugifyCourseTitle(course.title);
  const taken = new Set(
    (await client.course.findMany({
      where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
      select: { slug: true },
    })).map((row) => row.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  await client.course.update({ where: { id: courseId }, data: { slug } });
  return slug;
}
