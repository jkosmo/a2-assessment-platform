import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

// Storage backend for course learning-section assets (#483/F4).
// - In Azure (COURSE_ASSETS_BLOB_ENDPOINT set): private blob storage, authenticated via the
//   web app's managed identity (DefaultAzureCredential) — no account key/SAS exists.
// - Locally / in CI (no endpoint): filesystem fallback, so dev + tests work without Azure.

const blobEndpoint = process.env.COURSE_ASSETS_BLOB_ENDPOINT;
const containerName = process.env.COURSE_ASSETS_CONTAINER ?? "course-assets";
const localDir = process.env.COURSE_ASSETS_LOCAL_DIR ?? path.resolve(process.cwd(), ".course-assets-local");

export const assetStorageMode: "blob" | "local" = blobEndpoint ? "blob" : "local";

let containerClient: ContainerClient | null = null;
function getContainerClient(): ContainerClient {
  if (!containerClient) {
    const service = new BlobServiceClient(blobEndpoint as string, new DefaultAzureCredential());
    containerClient = service.getContainerClient(containerName);
  }
  return containerClient;
}

export async function putAsset(blobPath: string, buffer: Buffer, contentType: string): Promise<void> {
  if (assetStorageMode === "blob") {
    const block = getContainerClient().getBlockBlobClient(blobPath);
    await block.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
    return;
  }
  const full = path.join(localDir, blobPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
}

export async function getAsset(blobPath: string): Promise<Buffer> {
  if (assetStorageMode === "blob") {
    return getContainerClient().getBlockBlobClient(blobPath).downloadToBuffer();
  }
  return fs.readFile(path.join(localDir, blobPath));
}
