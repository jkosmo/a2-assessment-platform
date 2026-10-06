import { randomUUID } from "node:crypto";
import type { AppRole as AppRoleType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { DomainRuleError, NotFoundError } from "../../errors/AppError.js";
import { putAsset, getAsset, deleteAsset } from "./assetStorage.js";
import { canParticipantReadSection } from "./enrollmentService.js";
import { sanitizeSvg, svgHasText, extractSvgTexts, applySvgTextTranslations, isSvgReadableAsImage } from "./svgSanitizer.js";
import { localizeSvgTexts, type GenerationLocale } from "../adminContent/llmContentGenerationService.js";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../../i18n/locale.js";
import { hasAnyRole, CONTENT_AUTHORS } from "../../auth/roleSets.js";

export const SVG_MIME_TYPE = "image/svg+xml";
// Raster images plus SVG. SVG is accepted ONLY after server-side sanitisation strips its
// active content (scripts, handlers, foreignObject) — see svgSanitizer.ts (#657). It was
// previously excluded outright (#483/F4) because raw SVG is an XSS vector.
export const ALLOWED_ASSET_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", SVG_MIME_TYPE];
export const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB
// #749 (Layer A): total decoded-asset budget for one export envelope. Inlined blobs make the
// file large; this caps the whole course export (sum of every section's base + localized-variant
// bytes) so an export can never balloon unbounded. Export throws if exceeded — never silently drops.
export const MAX_EXPORT_ASSET_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * #999: vedleggsavslagene som koder, med TALLENE som felt.
 *
 * ⚠️ NI KAST, FEM REGLER. Tre av de ni var ordrette duplikater av hverandre — «unsupported type»
 * sto identisk tre steder, «too large» to. Å gi ni kast hver sin kode ville låst duplikatene fast;
 * de deler nå én kilde, så en endring i ordlyd eller grense treffer alle.
 *
 * ⚠️ OG TALLENE FØLGER SOM DATA, IKKE SOM INTERPOLERT PROSA. Meldingen sa
 * «too large (1234567 bytes, max 5242880)». Klienten måtte i så fall lese tallene UT AV en setning
 * for å kunne si «bildet er 1,2 MB, grensen er 5 MB» på brukerens språk. Nå ligger de i `details`,
 * og setningen bygges der den skal bygges.
 *
 * `message` er fortsatt engelsk med vilje: den logges, og den er det en API-konsument uten
 * oversettelsestabell får (se AppError.ts). Brukeren ser den kodebaserte teksten.
 */
function avvisType(label: string | null, mimeType: string): never {
  throw new DomainRuleError(
    "asset_unsupported_type",
    `Unsupported image type (${mimeType || "unknown"}). Allowed: PNG, JPEG, GIF, WebP, SVG.`,
    { label, mimeType: mimeType || null, allowed: ALLOWED_ASSET_MIME_TYPES },
  );
}

function avvisStorrelse(label: string | null, bytes: number): never {
  throw new DomainRuleError(
    "asset_too_large",
    `Image too large (${bytes} bytes, max ${MAX_ASSET_BYTES}).`,
    { label, bytes, maxBytes: MAX_ASSET_BYTES },
  );
}

function avvisSvg(label: string | null): never {
  throw new DomainRuleError(
    "asset_svg_invalid",
    "SVG could not be processed (empty or invalid after sanitisation).",
    { label },
  );
}

export async function createSectionAsset(input: {
  sectionId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const section = await prisma.courseSection.findUnique({
    where: { id: input.sectionId },
    select: { id: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (!ALLOWED_ASSET_MIME_TYPES.includes(input.mimeType)) {
    avvisType(null, input.mimeType);
  }
  if (input.buffer.byteLength > MAX_ASSET_BYTES) {
    avvisStorrelse(null, input.buffer.byteLength);
  }

  // #657: SVG is sanitised before storage — active content (scripts, handlers, foreignObject)
  // is stripped so the stored bytes are inert. A payload that contains no usable <svg> after
  // sanitisation is rejected rather than stored.
  let storedBuffer = input.buffer;
  if (input.mimeType === SVG_MIME_TYPE) {
    const sanitized = sanitizeSvg(input.buffer.toString("utf8"));
    if (!sanitized) {
      avvisSvg(null);
    }
    storedBuffer = Buffer.from(sanitized, "utf8");
  }

  const safeName = (input.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
  const blobPath = `sections/${input.sectionId}/${randomUUID()}-${safeName}`;

  // Upload binary first; only persist metadata once the blob is stored. A failed upload
  // leaves no row; a failed row-insert leaves an orphan blob (rare, tolerable for v1).
  await putAsset(blobPath, storedBuffer, input.mimeType);

  return prisma.sectionAsset.create({
    data: {
      sectionId: input.sectionId,
      filename: safeName,
      mimeType: input.mimeType,
      blobPath,
      sizeBytes: storedBuffer.byteLength,
    },
    select: { id: true, sectionId: true, filename: true, mimeType: true, sizeBytes: true },
  });
}

export async function listSectionAssets(sectionId: string) {
  return prisma.sectionAsset.findMany({
    where: { sectionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true },
  });
}

function readLocalizedBlobPaths(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return {};
}

// =========================================================================
// #1079 — a figure in more than one layout
// =========================================================================
//
// An SVG shown as an image has a fixed shape: it cannot re-break itself when the column gets narrow.
// A flow is therefore drawn twice from one description — wide (every step on one row) and narrow
// (two per row). The WIDE layout is the asset as it has always been stored: `blobPath` and
// `localizedBlobPaths`. A NARROW layout, when the figure has one, sits beside it in
// `layoutVariants`, with its own translated variants:
//
//   { "narrow": { "blobPath": "…", "localizedBlobPaths": { "nn": "…", "en-GB": "…" } } }
//
// ⚠️ ONE READER. The column is JSON, so nothing stops a second place from reading it its own way —
// and a file that is deleted by one reading and kept by another is an orphan blob or a missing
// figure. Everything that needs the files of an asset goes through `assetFiles`; everything that
// needs the shape goes through `readLayoutVariants`. Do not read `layoutVariants` anywhere else.

/** The layouts a figure can have BESIDE the wide one. The wide layout is the asset itself. */
export const ASSET_LAYOUTS = ["narrow"] as const;
export type AssetLayout = (typeof ASSET_LAYOUTS)[number];

type StoredLayoutVariant = { blobPath: string; localizedBlobPaths: Record<string, string> };

function readLayoutVariants(value: unknown): Partial<Record<AssetLayout, StoredLayoutVariant>> {
  const out: Partial<Record<AssetLayout, StoredLayoutVariant>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const layout of ASSET_LAYOUTS) {
    const entry = (value as Record<string, unknown>)[layout];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const blobPath = (entry as { blobPath?: unknown }).blobPath;
    if (typeof blobPath !== "string" || blobPath.length === 0) continue;
    out[layout] = { blobPath, localizedBlobPaths: readLocalizedBlobPaths((entry as { localizedBlobPaths?: unknown }).localizedBlobPaths) };
  }
  return out;
}

/** One stored file of an asset: which layout it is (`null` = wide) and which language (`null` = the original). */
export type AssetFile = { layout: AssetLayout | null; locale: string | null; blobPath: string };

/**
 * EVERY file one asset row occupies: the wide original, its translated variants, and each other
 * layout with its translated variants. The one list deletion, repair and export are built on — a
 * file missing from it is a file nobody cleans up, repairs or carries along.
 */
function assetFiles(asset: { blobPath: string; localizedBlobPaths: unknown; layoutVariants: unknown }): AssetFile[] {
  const files: AssetFile[] = [{ layout: null, locale: null, blobPath: asset.blobPath }];
  for (const [locale, blobPath] of Object.entries(readLocalizedBlobPaths(asset.localizedBlobPaths))) {
    if (blobPath) files.push({ layout: null, locale, blobPath });
  }
  for (const [layout, variant] of Object.entries(readLayoutVariants(asset.layoutVariants)) as Array<[AssetLayout, StoredLayoutVariant]>) {
    files.push({ layout, locale: null, blobPath: variant.blobPath });
    for (const [locale, blobPath] of Object.entries(variant.localizedBlobPaths)) {
      if (blobPath) files.push({ layout, locale, blobPath });
    }
  }
  return files;
}

// #758: every stored blob path the given sections' assets occupy — each asset's base blob, every
// localized SVG variant, and (#1079) every other layout with its variants. Query this BEFORE the
// sections are deleted: `SectionAsset` cascades away with the section (`onDelete: Cascade`), so
// afterwards there is nothing left to look the paths up from. Returns a flat, de-duplicated list.
export async function collectSectionAssetBlobPaths(sectionIds: string[]): Promise<string[]> {
  if (sectionIds.length === 0) return [];
  const assets = await prisma.sectionAsset.findMany({
    where: { sectionId: { in: sectionIds } },
    select: { blobPath: true, localizedBlobPaths: true, layoutVariants: true },
  });
  const paths = new Set<string>();
  for (const asset of assets) {
    for (const file of assetFiles(asset)) paths.add(file.blobPath);
  }
  return [...paths];
}

// #1083: figurer lagret FØR rensingen skrev XML. `sanitizeSvg` skrev resultatet ut som HTML, og en
// figur med hardt mellomrom i en etikett (eller `<` i en attributtverdi) ble da lagret som noe
// nettleseren ikke kan lese som bilde. Rettingen i rensingen gjelder bare det som lagres fra nå av;
// det som alt ligger i lageret, er like uleselig som før.
//
// Dette går gjennom hver lagret SVG — grunnfila og hver språkvariant — og finner dem som ikke lar
// seg lese. En uleselig fil renses på nytt: den ble skrevet som HTML, og rensingen leser HTML, så
// innholdet kommer tilbake slik det var ment. Fila skrives til SAMME sti, så verken raden,
// markdown-referansene eller språkvariantene trenger å røres.
//
// ⚠️ Tørrkjøring er standard i skriptet som kaller denne. Uten `dryRun: false` endres ingenting.
export type UnreadableSvgAsset = {
  assetId: string;
  sectionId: string;
  /** `null` for det brede oppsettet (figuren selv), ellers oppsettet fila tilhører (#1079). */
  layout: AssetLayout | null;
  /** `null` for grunnfila, ellers språket varianten gjelder. */
  locale: string | null;
  blobPath: string;
  /** `false` når fila mangler i lageret, eller ikke lar seg redde av en ny rensing. */
  repairable: boolean;
  repaired: boolean;
};

export async function repairUnreadableSvgAssets(options: { dryRun: boolean }): Promise<{
  dryRun: boolean;
  scanned: number;
  unreadable: UnreadableSvgAsset[];
}> {
  const assets = await prisma.sectionAsset.findMany({
    where: { mimeType: SVG_MIME_TYPE },
    orderBy: { createdAt: "asc" },
    select: { id: true, sectionId: true, blobPath: true, localizedBlobPaths: true, layoutVariants: true },
  });

  let scanned = 0;
  const unreadable: UnreadableSvgAsset[] = [];
  for (const asset of assets) {
    for (const { layout, locale, blobPath } of assetFiles(asset)) {
      scanned += 1;
      const funn = { assetId: asset.id, sectionId: asset.sectionId, layout, locale, blobPath };
      let stored: string;
      try {
        stored = (await getAsset(blobPath)).toString("utf8");
      } catch {
        // Raden peker på en fil som ikke finnes. Det er et annet problem enn dette, men det er
        // også en figur deltakeren ikke ser — og bedre meldt her enn tiet om.
        unreadable.push({ ...funn, repairable: false, repaired: false });
        continue;
      }
      if (isSvgReadableAsImage(stored)) continue;

      const fixed = sanitizeSvg(stored);
      const repairable = fixed !== "";
      if (repairable && !options.dryRun) {
        await putAsset(blobPath, Buffer.from(fixed, "utf8"), SVG_MIME_TYPE);
        // `sizeBytes` is the size of the asset itself: the wide original.
        if (locale === null && layout === null) {
          await prisma.sectionAsset.update({ where: { id: asset.id }, data: { sizeBytes: Buffer.byteLength(fixed, "utf8") } });
        }
      }
      unreadable.push({ ...funn, repairable, repaired: repairable && !options.dryRun });
    }
  }
  return { dryRun: options.dryRun, scanned, unreadable };
}

// #758: best-effort blob reclamation. Call AFTER the DB delete has COMMITTED — never before, or a
// rolled-back transaction would strand a live section whose blobs were already gone. A failed delete
// is logged and skipped (the row is already deleted; a rare leftover blob is cheaper than a failed
// user-facing delete), so this never throws.
export async function reclaimAssetBlobs(blobPaths: string[]): Promise<void> {
  for (const blobPath of blobPaths) {
    try {
      await deleteAsset(blobPath);
    } catch (error) {
      console.warn(
        `[asset-reclaim] failed to delete blob "${blobPath}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/**
 * Which stored file answers a request for this language and this layout (#657, #1079).
 *
 * ⚠️ LANGUAGE BEFORE LAYOUT. Asked for the narrow layout in English, a figure that has the narrow
 * layout only in Norwegian and the wide one in English is served WIDE, in English: a figure that
 * is small can be read; one in the wrong language cannot. (doc/DECISIONS.md.) In order:
 *   1. the asked layout in the asked language
 *   2. the wide layout in the asked language
 *   3. the asked layout as drawn (its original language)
 *   4. the wide layout as drawn
 * Pure, so the rule can be tested without a database or a blob store.
 */
export function chooseAssetFile(
  asset: { blobPath: string; localizedBlobPaths: unknown; layoutVariants: unknown },
  wanted: { locale?: string; layout?: string },
): { blobPath: string; layout: AssetLayout | "wide" } {
  const wide = { blobPath: asset.blobPath, localizedBlobPaths: readLocalizedBlobPaths(asset.localizedBlobPaths) };
  const layouts = readLayoutVariants(asset.layoutVariants);
  const layout = ASSET_LAYOUTS.find((name) => name === wanted.layout && layouts[name] !== undefined);
  const other = layout ? layouts[layout] : undefined;

  // #1088: a language counts only when what stands under it is a path. A plain lookup
  // (`paths[locale]`) also finds what every object inherits: `?locale=constructor` gave a function
  // instead of a path, and the read from storage threw — a 500 where the answer is the original
  // figure, as for any unknown language. Nothing an object inherits is a string, so this one check
  // covers both that and a column holding something other than a path.
  const inLanguage = (paths: Record<string, string>) => {
    const path: unknown = wanted.locale ? paths[wanted.locale] : undefined;
    return typeof path === "string" && path.length > 0 ? path : undefined;
  };
  if (layout && other) {
    const translated = inLanguage(other.localizedBlobPaths);
    if (translated) return { blobPath: translated, layout };
  }
  const wideTranslated = inLanguage(wide.localizedBlobPaths);
  if (wideTranslated) return { blobPath: wideTranslated, layout: "wide" };
  if (layout && other) return { blobPath: other.blobPath, layout };
  return { blobPath: wide.blobPath, layout: "wide" };
}

export async function getSectionAssetContent(
  assetId: string,
  locale: string | undefined,
  viewer: { userId: string; roles: AppRoleType[]; groupIds?: string[] },
  layout?: string,
): Promise<{ mimeType: string; filename: string; buffer: Buffer; layout: AssetLayout | "wide"; layouts: Array<AssetLayout | "wide"> }> {
  const asset = await prisma.sectionAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new NotFoundError("SectionAsset", "asset_not_found", "Asset not found.");
  }
  // #778/#786: object-level authz. Assets are referenced from section markdown; a participant may
  // fetch one only if its section belongs to a published course they can access. Authors (SMO/ADMIN)
  // bypass so they can preview assets in unpublished/draft sections in the editor. 404 (not 403) so we
  // never confirm the asset's existence to an unauthorized caller.
  const isAuthor =
    hasAnyRole(viewer.roles, CONTENT_AUTHORS);
  if (!isAuthor) {
    const accessible = await canParticipantReadSection({
      sectionId: asset.sectionId,
      userId: viewer.userId,
      roles: viewer.roles,
      groupIds: viewer.groupIds,
    });
    if (!accessible) {
      throw new NotFoundError("SectionAsset", "asset_not_found", "Asset not found.");
    }
  }
  // #657: serve the localized SVG variant for the viewer's locale when one exists; otherwise the
  // original. Raster assets and untranslated SVGs always serve the original blob.
  // #1079: and the narrow layout when it is asked for and the figure has one. The answer says
  // which layout was served and which the figure has, so the client need not ask again to find out.
  const chosen = chooseAssetFile(asset, { locale, layout });
  const buffer = await getAsset(chosen.blobPath);
  const layouts: Array<AssetLayout | "wide"> = ["wide", ...ASSET_LAYOUTS.filter((name) => readLayoutVariants(asset.layoutVariants)[name] !== undefined)];
  return { mimeType: asset.mimeType, filename: asset.filename, buffer, layout: chosen.layout, layouts };
}

export interface LocalizeSectionAssetsResult {
  localizedAssetCount: number;
  skippedAssetCount: number;
  targetLocales: SupportedLocale[];
}

/**
 * #657: generates translated SVG variants for every SVG asset in a section that carries text.
 * The text runs are extracted from the original, translated into each OTHER supported locale, and
 * written back into a positional copy (geometry preserved). Each variant is sanitised again and
 * stored as a sibling blob; the asset row records the source locale and the per-locale blob map.
 *
 * Idempotent (#663): an asset's base SVG is immutable (a re-upload makes a new asset), so an asset
 * that already has variants for every target locale FROM THE SAME source locale is left untouched —
 * re-translating unchanged drawings wastes LLM calls and risks introducing drift. Only newly
 * uploaded SVGs, or assets being translated from a different source locale, are (re)generated.
 */
export async function localizeSectionAssets(
  sectionId: string,
  sourceLocale: SupportedLocale,
): Promise<LocalizeSectionAssetsResult> {
  const section = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { id: true } });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }

  const assets = await prisma.sectionAsset.findMany({
    where: { sectionId, mimeType: SVG_MIME_TYPE },
    select: { id: true, blobPath: true, filename: true, sourceLocale: true, localizedBlobPaths: true, layoutVariants: true },
  });

  const targetLocales = SUPPORTED_LOCALES.filter((l) => l !== sourceLocale);
  let localizedAssetCount = 0;
  let skippedAssetCount = 0;

  for (const asset of assets) {
    // Already up to date for this source locale → skip (immutable base, nothing to re-translate).
    // #1079: «up to date» includes every other layout — a figure whose wide layout is translated
    // and whose narrow one is not, would be in two languages depending on the width of the screen.
    const existingVariants = readLocalizedBlobPaths(asset.localizedBlobPaths);
    const otherLayouts = Object.entries(readLayoutVariants(asset.layoutVariants)) as Array<[AssetLayout, StoredLayoutVariant]>;
    if (
      asset.sourceLocale === sourceLocale &&
      targetLocales.every((t) => existingVariants[t]) &&
      otherLayouts.every(([, variant]) => targetLocales.every((t) => variant.localizedBlobPaths[t]))
    ) {
      skippedAssetCount += 1;
      continue;
    }

    const baseSvg = (await getAsset(asset.blobPath)).toString("utf8");
    if (!svgHasText(baseSvg)) continue;

    const originals = extractSvgTexts(baseSvg);
    if (originals.length === 0) continue;

    // The other layouts are translated with the SAME translations as the wide one — one call to the
    // language model per language, not one per layout. That is why a layout must carry the same
    // texts as the wide figure (checked where the figure is stored): a label found only in the
    // narrow layout would have no translation and be left in the source language.
    const otherSvgs = new Map<AssetLayout, string>();
    for (const [layout, variant] of otherLayouts) otherSvgs.set(layout, (await getAsset(variant.blobPath)).toString("utf8"));
    const otherLocalized = new Map<AssetLayout, Record<string, string>>(otherLayouts.map(([layout]) => [layout, {}]));

    const localizedBlobPaths: Record<string, string> = {};
    for (const target of targetLocales) {
      const translated = await localizeSvgTexts({
        texts: originals,
        sourceLocale: sourceLocale as GenerationLocale,
        targetLocale: target as GenerationLocale,
      });
      const translationMap: Record<string, string> = {};
      originals.forEach((original, index) => {
        const value = translated[index];
        if (typeof value === "string" && value.length > 0) translationMap[original] = value;
      });

      const localizedSvg = applySvgTextTranslations(baseSvg, translationMap);
      if (!localizedSvg) continue;
      const variantPath = `sections/${sectionId}/${randomUUID()}-${target}-${asset.filename}`;
      await putAsset(variantPath, Buffer.from(localizedSvg, "utf8"), SVG_MIME_TYPE);
      localizedBlobPaths[target] = variantPath;

      for (const [layout, svg] of otherSvgs) {
        const localizedLayoutSvg = applySvgTextTranslations(svg, translationMap);
        if (!localizedLayoutSvg) continue;
        const layoutVariantPath = `sections/${sectionId}/${randomUUID()}-${layout}-${target}-${asset.filename}`;
        await putAsset(layoutVariantPath, Buffer.from(localizedLayoutSvg, "utf8"), SVG_MIME_TYPE);
        otherLocalized.get(layout)![target] = layoutVariantPath;
      }
    }

    const layoutVariants = Object.fromEntries(
      otherLayouts.map(([layout, variant]) => [layout, { blobPath: variant.blobPath, localizedBlobPaths: otherLocalized.get(layout) ?? {} }]),
    );
    await prisma.sectionAsset.update({
      where: { id: asset.id },
      data: { sourceLocale, localizedBlobPaths, ...(otherLayouts.length > 0 ? { layoutVariants } : {}) },
    });
    // #1090: nothing points at the translated files the row pointed at BEFORE. They used to stay in
    // storage for good — two per figure for every new translation, four when the figure has a narrow
    // layout. Every file written above has a new name, so none of the old ones is still in use.
    // Removed after the row is written, never before: an update that failed would otherwise be
    // left with paths to files that were gone.
    const replaced = [...Object.values(existingVariants), ...otherLayouts.flatMap(([, variant]) => Object.values(variant.localizedBlobPaths))]
      .filter((path) => typeof path === "string" && path.length > 0);
    await reclaimAssetBlobs(replaced);
    localizedAssetCount += 1;
  }

  return { localizedAssetCount, skippedAssetCount, targetLocales };
}

// =========================================================================
// #749 (Layer A) — asset transport through export / import
// =========================================================================

// One inlined section asset ready to be serialised into an a2-content-export/v1 envelope.
export interface ExportedSectionAsset {
  sourceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  sourceLocale?: string | null;
  localizedVariants?: Array<{ locale: string; contentBase64: string }>;
  /** #1079: the figure's other layouts, each with its own translated variants. */
  layoutVariants?: Array<{ layout: AssetLayout; contentBase64: string; localizedVariants?: Array<{ locale: string; contentBase64: string }> }>;
}

/**
 * #749: load every SectionAsset of a section with its blob binary (base64) plus each localized
 * SVG variant (#657) and each other layout (#1079), ready to inline into an export envelope.
 * Returns the assets and the total decoded byte count (EVERY file) so the export builder can
 * enforce the envelope-wide cap.
 * The `sizeBytes` reported per asset is the ACTUAL base-blob byte length (not the stored metadata),
 * so the importer can trust it.
 */
export async function loadSectionAssetsForExport(
  sectionId: string,
): Promise<{ assets: ExportedSectionAsset[]; totalBytes: number }> {
  const rows = await prisma.sectionAsset.findMany({
    where: { sectionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      blobPath: true,
      sourceLocale: true,
      localizedBlobPaths: true,
      layoutVariants: true,
    },
  });

  const assets: ExportedSectionAsset[] = [];
  let totalBytes = 0;

  for (const row of rows) {
    // Every file of the asset, read once and counted once. Built on `assetFiles`, so a file the
    // asset has is a file the export carries — there is no second list to forget a layout in.
    const content = new Map<AssetFile, Buffer>();
    for (const file of assetFiles(row)) {
      const fileBuffer = await getAsset(file.blobPath);
      totalBytes += fileBuffer.byteLength;
      content.set(file, fileBuffer);
    }
    const files = [...content.keys()];
    const base64 = (file: AssetFile) => content.get(file)!.toString("base64");
    const translationsOf = (layout: AssetLayout | null) =>
      files.filter((f) => f.layout === layout && f.locale !== null).map((f) => ({ locale: f.locale!, contentBase64: base64(f) }));

    const original = files.find((f) => f.layout === null && f.locale === null)!;
    const localizedVariants = translationsOf(null);
    const layoutVariants = files
      .filter((f) => f.layout !== null && f.locale === null)
      .map((f) => {
        const translated = translationsOf(f.layout);
        return { layout: f.layout!, contentBase64: base64(f), ...(translated.length > 0 ? { localizedVariants: translated } : {}) };
      });

    assets.push({
      sourceId: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: content.get(original)!.byteLength,
      contentBase64: base64(original),
      ...(row.sourceLocale ? { sourceLocale: row.sourceLocale } : {}),
      ...(localizedVariants.length > 0 ? { localizedVariants } : {}),
      ...(layoutVariants.length > 0 ? { layoutVariants } : {}),
    });
  }

  return { assets, totalBytes };
}

// Decode + validate a single inlined blob: enforce the per-asset size cap and (for SVG) run the
// sanitiser (defence in depth — the source may be a hand-crafted or tampered file). Returns the
// bytes to store. Throws a clear ValidationError (naming the asset) on any failure.
function decodeAndValidateAssetBytes(input: {
  label: string;
  mimeType: string;
  contentBase64: string;
}): Buffer {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new DomainRuleError(
      "asset_invalid_base64",
      `Asset "${input.label}" has invalid base64 content.`,
      { label: input.label },
    );
  }
  if (buffer.byteLength === 0) {
    throw new DomainRuleError(
      "asset_empty",
      `Asset "${input.label}" decoded to zero bytes.`,
      { label: input.label },
    );
  }
  if (buffer.byteLength > MAX_ASSET_BYTES) {
    avvisStorrelse(input.label, buffer.byteLength);
  }
  if (input.mimeType === SVG_MIME_TYPE) {
    const sanitized = sanitizeSvg(buffer.toString("utf8"));
    if (!sanitized) {
      avvisSvg(input.label);
    }
    return Buffer.from(sanitized, "utf8");
  }
  return buffer;
}

// One figure as it arrives in an export envelope or an authoring package (#749, #763, #1079).
export type IncomingSectionAsset = {
  sourceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  sourceLocale?: string | null;
  localizedVariants?: ReadonlyArray<{ locale: string; contentBase64: string }>;
  layoutVariants?: ReadonlyArray<{
    layout: string;
    contentBase64: string;
    localizedVariants?: ReadonlyArray<{ locale: string; contentBase64: string }>;
  }>;
};

/**
 * #1079: the other layouts of one incoming figure, decoded and checked — nothing is written here.
 *
 * Three rules, and each is one the platform itself depends on:
 *  · only an SVG has layouts. A raster image is one picture.
 *  · a layout is one of ASSET_LAYOUTS, and appears once.
 *  · a layout carries the SAME TEXTS as the wide figure, language by language. Translation asks
 *    the language model once, from the wide figure, and writes the answers into every layout by
 *    matching the original text. A label found only in the narrow layout would have no answer, and
 *    stay in the source language — a figure in two languages on a phone, and whole on a desktop.
 */
function prepareLayoutVariants(input: {
  label: string;
  mimeType: string;
  wide: Buffer;
  wideVariants: ReadonlyArray<{ locale: string; buffer: Buffer }>;
  layoutVariants: IncomingSectionAsset["layoutVariants"];
}): Array<{ layout: AssetLayout; buffer: Buffer; variants: Array<{ locale: string; buffer: Buffer }> }> {
  const incoming = input.layoutVariants ?? [];
  if (incoming.length === 0) return [];
  if (input.mimeType !== SVG_MIME_TYPE) {
    throw new DomainRuleError(
      "asset_layout_not_svg",
      `Asset "${input.label}" has layout variants, but only an SVG figure can have more than one layout.`,
      { label: input.label, mimeType: input.mimeType },
    );
  }

  const sameTexts = (layout: string, locale: string | null, wide: Buffer, other: Buffer) => {
    const wideTexts = new Set(extractSvgTexts(wide.toString("utf8")));
    const otherTexts = new Set(extractSvgTexts(other.toString("utf8")));
    const onlyInWide = [...wideTexts].filter((text) => !otherTexts.has(text));
    const onlyInLayout = [...otherTexts].filter((text) => !wideTexts.has(text));
    if (onlyInWide.length > 0 || onlyInLayout.length > 0) {
      throw new DomainRuleError(
        "asset_layout_text_mismatch",
        `Asset "${input.label}": the ${layout} layout${locale ? ` (${locale})` : ""} does not carry the same texts as the wide figure.`,
        { label: input.label, layout, locale, onlyInWide, onlyInLayout },
      );
    }
  };

  const seen = new Set<string>();
  return incoming.map((variant) => {
    const layout = ASSET_LAYOUTS.find((name) => name === variant.layout);
    if (!layout || seen.has(layout)) {
      throw new DomainRuleError(
        "asset_layout_unknown",
        `Asset "${input.label}" has ${layout ? "the same layout twice" : "an unknown layout"} ("${variant.layout}"). Allowed: ${ASSET_LAYOUTS.join(", ")}, once each.`,
        { label: input.label, layout: variant.layout, allowed: [...ASSET_LAYOUTS] },
      );
    }
    seen.add(layout);

    const buffer = decodeAndValidateAssetBytes({ label: `${input.label} (${layout})`, mimeType: input.mimeType, contentBase64: variant.contentBase64 });
    sameTexts(layout, null, input.wide, buffer);

    const variants = (variant.localizedVariants ?? []).map((translated) => {
      const translatedBuffer = decodeAndValidateAssetBytes({
        label: `${input.label} (${layout}, ${translated.locale})`,
        mimeType: input.mimeType,
        contentBase64: translated.contentBase64,
      });
      // Compared with the wide figure IN THE SAME LANGUAGE, when the figure has one. A layout
      // translated into a language the wide figure is not, has nothing to be compared with.
      const wideTranslated = input.wideVariants.find((w) => w.locale === translated.locale);
      if (wideTranslated) sameTexts(layout, translated.locale, wideTranslated.buffer, translatedBuffer);
      return { locale: translated.locale, buffer: translatedBuffer };
    });
    return { layout, buffer, variants };
  });
}

/**
 * What storing this figure's layouts would refuse, without storing anything — for the dry-run
 * validation of an authoring package. It RUNS the rule above rather than restating it, so the
 * report and the later import cannot come to disagree about what a layout must be.
 * `null` when the figure has no other layouts, or when they are accepted.
 */
export function findLayoutVariantProblem(asset: IncomingSectionAsset): { code: string; message: string } | null {
  if ((asset.layoutVariants ?? []).length === 0) return null;
  const label = asset.filename || asset.sourceId;
  try {
    const wide = decodeAndValidateAssetBytes({ label, mimeType: asset.mimeType, contentBase64: asset.contentBase64 });
    const wideVariants = (asset.localizedVariants ?? []).map((variant) => ({
      locale: variant.locale,
      buffer: decodeAndValidateAssetBytes({ label: `${label} (${variant.locale})`, mimeType: asset.mimeType, contentBase64: variant.contentBase64 }),
    }));
    prepareLayoutVariants({ label, mimeType: asset.mimeType, wide, wideVariants, layoutVariants: asset.layoutVariants });
    return null;
  } catch (error) {
    if (error instanceof DomainRuleError) return { code: error.code, message: error.message };
    throw error;
  }
}

// #796: a section asset prepared for a transactional import — its blob(s) are already written to storage
// (staged), and `rowData` is everything needed to create the SectionAsset row inside the import's single
// transaction. `blobPaths` lists every blob written for this asset so a rolled-back import can reclaim them.
export type StagedSectionAsset = {
  sourceId: string;
  rowData: {
    filename: string;
    mimeType: string;
    blobPath: string;
    sizeBytes: number;
    sourceLocale: string | null;
    localizedBlobPaths?: Record<string, string>;
    layoutVariants?: Record<string, { blobPath: string; localizedBlobPaths: Record<string, string> }>;
  };
  blobPaths: string[];
};

// #796: the I/O half of an asset import — validate + write blobs to storage, WITHOUT touching the DB. The
// caller persists the SectionAsset rows (from `rowData`) inside its own transaction, keeping blob uploads
// out of the DB transaction (a B1 pool must not hold a connection open across uploads). `sectionId` is the
// pre-generated id the caller will create the section with, so blob paths are already final. On a failed
// import the caller reclaims every returned `blobPaths` entry.
//
// ⚠️ EVERYTHING IS CHECKED BEFORE ANYTHING IS WRITTEN. Each asset is decoded, sanitised and compared
// first; only when every one of them is accepted does the first blob go to storage. A figure refused
// as number three used to leave the blobs of the first two behind, with no row to find them by.
export async function stageSectionAssets(
  sectionId: string,
  assets: ReadonlyArray<IncomingSectionAsset>,
): Promise<StagedSectionAsset[]> {
  const prepared = assets.map((asset) => {
    const label = asset.filename || asset.sourceId;
    if (!ALLOWED_ASSET_MIME_TYPES.includes(asset.mimeType)) {
      avvisType(label, asset.mimeType);
    }
    const buffer = decodeAndValidateAssetBytes({ label, mimeType: asset.mimeType, contentBase64: asset.contentBase64 });
    // Localized SVG variants (#657): each becomes a sibling blob, re-sanitised for defence in depth.
    const variants = (asset.localizedVariants ?? []).map((variant) => ({
      locale: variant.locale,
      buffer: decodeAndValidateAssetBytes({ label: `${label} (${variant.locale})`, mimeType: asset.mimeType, contentBase64: variant.contentBase64 }),
    }));
    const layouts = prepareLayoutVariants({ label, mimeType: asset.mimeType, wide: buffer, wideVariants: variants, layoutVariants: asset.layoutVariants });
    const safeName = (asset.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
    return { asset, safeName, buffer, variants, layouts };
  });

  const staged: StagedSectionAsset[] = [];
  for (const { asset, safeName, buffer, variants, layouts } of prepared) {
    const blobPaths: string[] = [];
    const store = async (tag: string, content: Buffer) => {
      const path = `sections/${sectionId}/${randomUUID()}-${tag}${safeName}`;
      await putAsset(path, content, asset.mimeType);
      blobPaths.push(path);
      return path;
    };

    const blobPath = await store("", buffer);
    const localizedBlobPaths: Record<string, string> = {};
    for (const variant of variants) localizedBlobPaths[variant.locale] = await store(`${variant.locale}-`, variant.buffer);

    const layoutVariants: Record<string, { blobPath: string; localizedBlobPaths: Record<string, string> }> = {};
    for (const layout of layouts) {
      const layoutBlobPath = await store(`${layout.layout}-`, layout.buffer);
      const layoutLocalized: Record<string, string> = {};
      for (const variant of layout.variants) layoutLocalized[variant.locale] = await store(`${layout.layout}-${variant.locale}-`, variant.buffer);
      layoutVariants[layout.layout] = { blobPath: layoutBlobPath, localizedBlobPaths: layoutLocalized };
    }

    staged.push({
      sourceId: asset.sourceId,
      rowData: {
        filename: safeName,
        mimeType: asset.mimeType,
        blobPath,
        sizeBytes: buffer.byteLength,
        sourceLocale: asset.sourceLocale ?? null,
        localizedBlobPaths: Object.keys(localizedBlobPaths).length > 0 ? localizedBlobPaths : undefined,
        layoutVariants: Object.keys(layoutVariants).length > 0 ? layoutVariants : undefined,
      },
      blobPaths,
    });
  }

  return staged;
}
