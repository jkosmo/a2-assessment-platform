-- 2.102.0: tema i «Mine kurs». Et kurs kan ha flere tema, eller ingen.
--
-- Bare utvidelse: to nye tabeller. Gamle containere som kjører under et bytte, kjenner dem ikke og
-- leser eller skriver dem ikke.
CREATE TABLE "CourseTheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseTheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseThemeAssignment" (
    "courseId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseThemeAssignment_pkey" PRIMARY KEY ("courseId","themeId")
);

CREATE INDEX "CourseThemeAssignment_themeId_idx" ON "CourseThemeAssignment"("themeId");

ALTER TABLE "CourseThemeAssignment" ADD CONSTRAINT "CourseThemeAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseThemeAssignment" ADD CONSTRAINT "CourseThemeAssignment_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "CourseTheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
