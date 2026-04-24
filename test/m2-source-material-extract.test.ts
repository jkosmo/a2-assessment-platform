import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-extract-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const smoHeaders = {
  "x-user-id": "smo-extract-1",
  "x-user-email": "smo@company.com",
  "x-user-name": "SMO User",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

function base64Encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

async function pollExtractJob(
  jobId: string,
  headers: Record<string, string>,
  maxAttempts = 20,
): Promise<{ status: string; extractedText?: string; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await request(app)
      .get(`/api/admin/content/source-material/extract/${jobId}`)
      .set(headers);
    expect(res.status).toBe(200);
    if (res.body.status !== "pending") return res.body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Extract job did not complete within poll limit.");
}

describe("API-341: Async source material extraction", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("POST /source-material/extract returns 202 with jobId for a plain-text file", async () => {
    const res = await request(app)
      .post("/api/admin/content/source-material/extract")
      .set(adminHeaders)
      .send({
        fileName: "sample.txt",
        mimeType: "text/plain",
        contentBase64: base64Encode("Hello, this is a test document."),
      });

    expect(res.status).toBe(202);
    expect(typeof res.body.jobId).toBe("string");
    expect(res.body.jobId.length).toBeGreaterThan(0);
  });

  it("GET /source-material/extract/:jobId returns done result after polling", async () => {
    const submitRes = await request(app)
      .post("/api/admin/content/source-material/extract")
      .set(adminHeaders)
      .send({
        fileName: "notes.txt",
        mimeType: "text/plain",
        contentBase64: base64Encode("Parser isolation test content for #341."),
      });

    expect(submitRes.status).toBe(202);
    const { jobId } = submitRes.body as { jobId: string };

    const result = await pollExtractJob(jobId, adminHeaders);
    expect(result.status).toBe("done");
    expect(result.extractedText).toContain("Parser isolation test content");
  });

  it("GET /source-material/extract/:jobId returns done for a markdown file", async () => {
    const submitRes = await request(app)
      .post("/api/admin/content/source-material/extract")
      .set(smoHeaders)
      .send({
        fileName: "readme.md",
        contentBase64: base64Encode("# Title\n\nMarkdown content for parsing test."),
      });

    expect(submitRes.status).toBe(202);
    const result = await pollExtractJob(submitRes.body.jobId as string, smoHeaders);
    expect(result.status).toBe("done");
    expect(result.extractedText).toContain("Title");
  });

  it("GET /source-material/extract/:jobId returns 404 for unknown jobId", async () => {
    const res = await request(app)
      .get("/api/admin/content/source-material/extract/nonexistent-job-id-00000")
      .set(adminHeaders);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("job_not_found");
  });

  it("POST with unsupported file type returns failed job status after polling", async () => {
    const submitRes = await request(app)
      .post("/api/admin/content/source-material/extract")
      .set(adminHeaders)
      .send({
        fileName: "image.png",
        mimeType: "image/png",
        contentBase64: base64Encode("not a real png"),
      });

    expect(submitRes.status).toBe(202);
    const result = await pollExtractJob(submitRes.body.jobId as string, adminHeaders);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("unsupported_file_type");
  });

  it("POST with missing body returns 400 validation error", async () => {
    const res = await request(app)
      .post("/api/admin/content/source-material/extract")
      .set(adminHeaders)
      .send({ fileName: "test.txt" }); // missing contentBase64

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
