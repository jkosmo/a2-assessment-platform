import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { localizedTextCodec } from "../src/codecs/localizedTextCodec.js";

// #896 S3b: module-level fields (description, certification level, validity) became editable
// after creation. The rule that matters is the one this repository keeps re-learning: a patch
// naming ONE locale must merge onto the stored value, not replace it. #892 lost titles that way,
// #902 lost criteria, #905 lost body text — this pins the same rule for the module fields.

const adminHeaders = {
  "x-user-id": "admin-s3b",
  "x-user-email": "admin-s3b@company.com",
  "x-user-name": "Details Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const rubric = {
  criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } },
  scalingRule: { max_total: 5 },
};
const promptTemplate = { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" };
const mcqSet = {
  title: "Set",
  questions: [{ stem: "Q?", options: ["A", "B"], correctAnswer: "A", rationale: "Because." }],
};

async function createModule(description?: Record<string, string>) {
  const res = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({
      title: { "en-GB": "Details module", nb: "Detaljmodul", nn: "Detaljmodul" },
      ...(description ? { description } : {}),
      certificationLevel: { "en-GB": "advanced", nb: "avansert", nn: "avansert" },
    });
  expect(res.status).toBe(201);
  return res.body.module.id as string;
}

describe("#896 S3b module-level field updates", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("merges a single-locale description patch instead of replacing the other languages", async () => {
    const moduleId = await createModule({ "en-GB": "Safety", nb: "Sikkerhet", nn: "Tryggleik" });

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ description: { nb: "Oppdatert sikkerhet" }, taskText: "Oppgave", rubric, promptTemplate, mcqSet });
    expect(res.status).toBe(201);

    const stored = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { description: true, certificationLevel: true },
    });
    expect(localizedTextCodec.parse(stored?.description ?? null)).toEqual({
      "en-GB": "Safety",
      nb: "Oppdatert sikkerhet",
      nn: "Tryggleik",
    });
    // Untouched field stays exactly as it was.
    expect(localizedTextCodec.parse(stored?.certificationLevel ?? null)).toEqual({
      "en-GB": "advanced",
      nb: "avansert",
      nn: "avansert",
    });

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("rejects a validity window that crosses the STORED boundary, not just the one in the request", async () => {
    const moduleId = await createModule();

    const first = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ validFrom: "2026-09-01", validTo: "2026-12-01", taskText: "Oppgave", rubric, promptTemplate, mcqSet });
    expect(first.status).toBe(201);

    // Only validFrom is sent, and it lands after the stored validTo. Validating just the fields
    // present in the request would wave this through and leave a window that never opens.
    const second = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ validFrom: "2027-01-01", taskText: "Oppgave", rubric, promptTemplate, mcqSet });
    expect(second.status).toBe(400);

    const stored = await prisma.module.findUnique({ where: { id: moduleId }, select: { validFrom: true } });
    expect(stored?.validFrom?.toISOString().slice(0, 10)).toBe("2026-09-01");

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("refuses an unparseable date instead of treating it as a request to clear the field", async () => {
    const moduleId = await createModule();

    const seeded = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ validTo: "2026-12-01", taskText: "Oppgave", rubric, promptTemplate, mcqSet });
    expect(seeded.status).toBe(201);

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ validTo: "not-a-date", taskText: "Oppgave", rubric, promptTemplate, mcqSet });
    expect(res.status).toBe(400);

    // The existing bound survived — a typo must not silently erase a date.
    const stored = await prisma.module.findUnique({ where: { id: moduleId }, select: { validTo: true } });
    expect(stored?.validTo?.toISOString().slice(0, 10)).toBe("2026-12-01");

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
