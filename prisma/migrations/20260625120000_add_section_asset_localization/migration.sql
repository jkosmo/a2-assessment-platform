-- #657: localized SVG variants for section assets.
-- sourceLocale: the language of the text baked into the original asset.
-- localizedBlobPaths: JSON map of locale -> blob path for translated SVG variants.
ALTER TABLE "SectionAsset" ADD COLUMN "sourceLocale" TEXT;
ALTER TABLE "SectionAsset" ADD COLUMN "localizedBlobPaths" JSONB;
