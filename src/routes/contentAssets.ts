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
    const { mimeType, buffer } = await getSectionAssetContent(request.params.assetId);
    response.setHeader("Content-Type", mimeType);
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.send(buffer);
  } catch (error) {
    next(error);
  }
});

export { contentAssetsRouter };
