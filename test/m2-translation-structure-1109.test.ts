import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";

// #1109: oversettelsen til et språk som endrer rammene (fasiten i «sjekk deg selv», et steg, et kort,
// et sjekkpunkt), forkastes på tjeneren — 422 `translation_structure_changed` — på hver rute plattformens
// oversetter svarer på. Klientene lagrer oversettelsen de får herfra; et språk som ikke kom, slippes
// (#905/#982). Kontrollen: en riktig oversettelse svarer som før.

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const NL = String.fromCharCode(10);
const lines = (...rows: string[]) => rows.join(NL);
const SOURCE = lines("Innledning.", "", ":::sjekk Hvilken kilde?", "- [ ] Innkallingen", "- [x] Notatene", ":::", "", ":::steg Slik", "### Les", "Finn.", "### Skriv", "Med frist.", ":::");
const RIGHT = lines("Introduction.", "", ":::check Which source?", "- [ ] The invitation", "- [x] The notes", ":::", "", ":::steps How", "### Read", "Find.", "### Write", "With a deadline.", ":::");
const MOVED = RIGHT.replace("- [ ] The invitation" + NL + "- [x] The notes", "- [x] The invitation" + NL + "- [ ] The notes");
const LOST_STEP = RIGHT.replace("### Write" + NL, "");

const original = {
  fetch: global.fetch,
  mode: env.LLM_MODE,
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  key: env.AZURE_OPENAI_API_KEY,
  deployment: env.AZURE_OPENAI_DEPLOYMENT,
};

/** Modellen svarer med `answer` (som JSON), slik Azure OpenAI gjør. */
function modelAnswers(answer: Record<string, unknown>) {
  env.LLM_MODE = "azure_openai";
  env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  env.AZURE_OPENAI_API_KEY = "test-key";
  env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
  global.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

describe("#1109 — oversetterens ruter forkaster et språk som endrer rammene", () => {
  afterEach(() => {
    global.fetch = original.fetch;
    env.LLM_MODE = original.mode;
    env.AZURE_OPENAI_ENDPOINT = original.endpoint;
    env.AZURE_OPENAI_API_KEY = original.key;
    env.AZURE_OPENAI_DEPLOYMENT = original.deployment;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seksjon («Oversett fra dette språket»): flyttet fasit gir 422 med språk og felt", async () => {
    modelAnswers({ title: "Sources", bodyMarkdown: MOVED });
    const response = await request(app)
      .post("/api/admin/content/sections/localize")
      .set(adminHeaders)
      .send({ title: "Kilder", bodyMarkdown: SOURCE, sourceLocale: "nb", targetLocale: "en-GB" });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("translation_structure_changed");
    expect(response.body.details.locale).toBe("en-GB");
    expect(response.body.details.fields).toEqual([
      { field: "bodyMarkdown", problems: [{ kind: "sjekk", problem: "shape", position: 1, expected: "01", actual: "10" }] },
    ]);
    // Oversettelsen er ikke i svaret: det finnes ingenting å lagre for språket.
    expect(response.body.bodyMarkdown).toBeUndefined();
  });

  it("seksjon, kontroll: en riktig oversettelse svarer 200 med teksten, som før", async () => {
    modelAnswers({ title: "Sources", bodyMarkdown: RIGHT });
    const response = await request(app)
      .post("/api/admin/content/sections/localize")
      .set(adminHeaders)
      .send({ title: "Kilder", bodyMarkdown: SOURCE, sourceLocale: "nb", targetLocale: "en-GB" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ title: "Sources", bodyMarkdown: RIGHT });
  });

  it("seksjon, stubben (lokalt uten KI): en tekst som begynner med en ramme, oversettes uten 422", async () => {
    env.LLM_MODE = "stub";
    const body = lines(":::sjekk Hvilken?", "- [ ] A", "- [x] B", ":::");
    const response = await request(app)
      .post("/api/admin/content/sections/localize")
      .set(adminHeaders)
      .send({ title: "Tittel", bodyMarkdown: body, sourceLocale: "nb", targetLocale: "nn" });
    expect(response.status).toBe(200);
    expect(response.body.bodyMarkdown).toContain("[nn]");
    expect(response.body.bodyMarkdown).toContain(body);
  });

  it("modul (lagring fra Rediger, «Generer innhold», «Be om endring», publiseringsporten): et steg som forsvant, gir 422", async () => {
    modelAnswers({ title: "Module", taskText: LOST_STEP, assessorExpectedContent: "Expected.", candidateTaskConstraints: "", includesScenario: false });
    const response = await request(app)
      .post("/api/admin/content/generate/module-draft/localize")
      .set(adminHeaders)
      .send({ title: "Modul", taskText: SOURCE, assessorExpectedContent: "Forventet.", candidateTaskConstraints: "", sourceLocale: "nb", targetLocale: "en-GB" });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("translation_structure_changed");
    expect(response.body.details.fields.map((f: { field: string }) => f.field)).toEqual(["taskText"]);
    expect(response.body.draft).toBeUndefined();
  });

  it("modul, kontroll: en riktig oversettelse svarer 200 med utkastet, som før", async () => {
    modelAnswers({ title: "Module", taskText: RIGHT, assessorExpectedContent: "Expected.", candidateTaskConstraints: "", includesScenario: false });
    const response = await request(app)
      .post("/api/admin/content/generate/module-draft/localize")
      .set(adminHeaders)
      .send({ title: "Modul", taskText: SOURCE, assessorExpectedContent: "Forventet.", candidateTaskConstraints: "", sourceLocale: "nb", targetLocale: "en-GB" });
    expect(response.status).toBe(200);
    expect(response.body.draft.taskText).toBe(RIGHT);
  });

  it("modul: andre feil fra modellen er fortsatt 500 generation_failed (bare rammeavviket er 422)", async () => {
    modelAnswers({ nothing: "useful" });
    const response = await request(app)
      .post("/api/admin/content/generate/module-draft/localize")
      .set(adminHeaders)
      .send({ title: "Modul", taskText: SOURCE, assessorExpectedContent: "Forventet.", candidateTaskConstraints: "", sourceLocale: "nb", targetLocale: "en-GB" });
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("generation_failed");
  });

  it("kurs: en ramme som dukker opp i beskrivelsen, gir 422; vanlig tekst svarer 200", async () => {
    modelAnswers({ title: "Course", description: lines(":::think Why?", "Because.", ":::") });
    const rejected = await request(app)
      .post("/api/admin/content/courses/localize-copy")
      .set(adminHeaders)
      .send({ title: "Kurs", description: "Hvorfor.", sourceLocale: "nb", targetLocale: "en-GB" });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toBe("translation_structure_changed");

    modelAnswers({ title: "Course", description: "Why." });
    const accepted = await request(app)
      .post("/api/admin/content/courses/localize-copy")
      .set(adminHeaders)
      .send({ title: "Kurs", description: "Hvorfor.", sourceLocale: "nb", targetLocale: "en-GB" });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ title: "Course", description: "Why." });
  });
});
