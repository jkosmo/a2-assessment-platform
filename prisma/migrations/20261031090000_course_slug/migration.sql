-- 2.121.0: kursets navn i delingslenka (/kurs/<slug>). Settes ved første publisering og endres aldri.
--
-- Utvidelse: én kolonne (null tillatt) og en unik indeks. Kurs som allerede er publisert, får sin slug
-- her, fra bokmålstittelen — samme regler som src/modules/course/courseSlug.ts: små bokstaver, æ/ø/å
-- skrives ae/o/a, aksenter fjernes, alt annet blir bindestrek, høyst 80 tegn. Like navn får et nummer.
-- Upubliserte kurs får ingen: forfatteren kan bytte tittel fritt til kurset publiseres.
ALTER TABLE "Course" ADD COLUMN "slug" TEXT;

WITH titled AS (
  SELECT id, "publishedAt",
    lower(CASE WHEN title IS JSON OBJECT
      THEN coalesce(nullif(title::jsonb->>'nb', ''), nullif(title::jsonb->>'en-GB', ''), nullif(title::jsonb->>'nn', ''), title)
      ELSE title END) AS t
  FROM "Course"
  WHERE "publishedAt" IS NOT NULL
),
cleaned AS (
  SELECT id, "publishedAt",
    trim(BOTH '-' FROM regexp_replace(
      translate(replace(replace(replace(t, 'æ', 'ae'), 'ø', 'o'), 'å', 'a'),
        'áàâäãéèêëíìîïóòôöõúùûüýÿçñ', 'aaaaaeeeeiiiiooooouuuuyycn'),
      '[^a-z0-9]+', '-', 'g')) AS s
  FROM titled
),
based AS (
  SELECT id, "publishedAt",
    coalesce(nullif(trim(BOTH '-' FROM left(s, 80)), ''), 'kurs') AS base
  FROM cleaned
),
numbered AS (
  SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY "publishedAt", id) AS n
  FROM based
)
UPDATE "Course" c
SET slug = CASE WHEN numbered.n = 1 THEN numbered.base ELSE numbered.base || '-' || numbered.n END
FROM numbered
WHERE c.id = numbered.id;

CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");
