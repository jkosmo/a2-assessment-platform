-- #970: «sist sett»-språk per bruker. Additiv og nullbar; eldre containere ignorerer kolonnen.
-- Null betyr «aldri logget inn siden kolonnen kom» → e-post bruker env.DEFAULT_LOCALE.
ALTER TABLE "User" ADD COLUMN "preferredLocale" TEXT;
