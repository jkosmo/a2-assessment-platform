import { describe, it, expect, vi, beforeEach } from "vitest";

// #580: unit-test the platform certificate-background service in isolation — blob storage and the
// platform key-value config are mocked, so no Azure/DB is needed.
const blobStore = new Map<string, Buffer>();
const kv: Record<string, string> = {};

vi.mock("../../src/modules/course/assetStorage.js", () => ({
  putAsset: vi.fn(async (blobPath: string, buffer: Buffer) => {
    blobStore.set(blobPath, buffer);
  }),
  getAsset: vi.fn(async (blobPath: string) => {
    const b = blobStore.get(blobPath);
    if (!b) throw new Error("blob not found");
    return b;
  }),
}));

vi.mock("../../src/modules/platformConfig/platformConfigRepository.js", () => ({
  platformConfigRepository: {
    getMany: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, kv[k] ?? ""]))),
    setMany: vi.fn(async (entries: Record<string, string>) => {
      Object.assign(kv, entries);
    }),
  },
}));

const svc = await import("../../src/modules/platformConfig/certificateBackgroundService.js");

describe("certificateBackgroundService (#580)", () => {
  beforeEach(() => {
    blobStore.clear();
    for (const k of Object.keys(kv)) delete kv[k];
  });

  it("reports no background initially", async () => {
    expect(await svc.hasCertificateBackground()).toBe(false);
    expect(await svc.getCertificateBackgroundContent()).toBeNull();
  });

  it("stores a valid image to blob + config and serves it back", async () => {
    const buffer = Buffer.from("fake-png-bytes");
    await svc.setCertificateBackground({ filename: "diploma bg.png", mimeType: "image/png", buffer }, "admin-1");

    expect(await svc.hasCertificateBackground()).toBe(true);
    const content = await svc.getCertificateBackgroundContent();
    expect(content?.mimeType).toBe("image/png");
    expect(content?.buffer.toString()).toBe("fake-png-bytes");

    const ref = await svc.getCertificateBackgroundRef();
    // Sanitised filename + the platform prefix.
    expect(ref?.blobPath).toMatch(/^platform\/certificate-background\/.*diploma_bg\.png$/);
  });

  it("rejects an unsupported mime type", async () => {
    await expect(
      svc.setCertificateBackground({ filename: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("x") }, "admin-1"),
    ).rejects.toThrow(/Unsupported image type/);
    expect(await svc.hasCertificateBackground()).toBe(false);
  });

  it("rejects an oversized image", async () => {
    const tooBig = Buffer.alloc(svc.CERTIFICATE_BACKGROUND_MAX_BYTES + 1, 0x41);
    await expect(
      svc.setCertificateBackground({ filename: "big.png", mimeType: "image/png", buffer: tooBig }, "admin-1"),
    ).rejects.toThrow(/too large/i);
  });

  it("clears the background", async () => {
    await svc.setCertificateBackground({ filename: "bg.png", mimeType: "image/png", buffer: Buffer.from("x") }, "admin-1");
    expect(await svc.hasCertificateBackground()).toBe(true);
    await svc.clearCertificateBackground("admin-1");
    expect(await svc.hasCertificateBackground()).toBe(false);
    expect(await svc.getCertificateBackgroundContent()).toBeNull();
  });
});
