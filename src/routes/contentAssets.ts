import { Router } from "express";
import { getSectionAssetContent } from "../modules/course/index.js";

const contentAssetsRouter = Router();

// Serve a learning-section media asset (#483/F4). The web app streams the blob from private
// storage via its managed identity — assets are never publicly accessible. Referenced from
// section markdown as `asset:<id>`, resolved to `/api/content-assets/<id>` at render time.
contentAssetsRouter.get("/:assetId", async (request, response, next) => {
  if (!request.context?.userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    // #657: `?locale=` selects a translated SVG variant when one exists (set by the section
    // markdown renderer, which knows which locale pane it is rendering). Falls back to original.
    const localeParam = typeof request.query.locale === "string" ? request.query.locale : undefined;
    const { mimeType, buffer } = await getSectionAssetContent(request.params.assetId, localeParam);
    response.setHeader("Content-Type", mimeType);
    response.setHeader("Cache-Control", "private, max-age=3600");
    // #657: defence-in-depth for SVG. The stored bytes are already sanitised, but if a victim
    // navigates DIRECTLY to this URL the browser would render the SVG as a same-origin document.
    // `sandbox` + `default-src 'none'` neutralise any script that slipped through, and `nosniff`
    // stops content-type confusion. These headers are ignored when the SVG is loaded via `<img>`,
    // so normal section rendering is unaffected.
    if (mimeType === "image/svg+xml") {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      response.setHeader("X-Content-Type-Options", "nosniff");
    }
    response.send(buffer);
  } catch (error) {
    next(error);
  }
});

export { contentAssetsRouter };
