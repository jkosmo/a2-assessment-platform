import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

describe("MVP i18n baseline", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves locale from x-locale header and returns supported locales", async () => {
    const response = await request(app)
      .get("/api/me")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });

    expect(response.status).toBe(200);
    expect(response.body.user.locale).toBe("nb");
    expect(response.body.supportedLocales).toEqual(["en-GB", "nb", "nn"]);
  });

  it("uses fallback locale when unsupported locale is provided", async () => {
    const response = await request(app)
      .get("/api/reviews")
      .set({
        ...participantHeaders,
        "x-locale": "fr",
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("Requires one of roles:");
  });

  it("localizes role error to nb and not-found message to nn", async () => {
    const roleError = await request(app)
      .get("/api/reviews")
      .set({
        ...participantHeaders,
        "x-locale": "nb",
      });

    expect(roleError.status).toBe(403);
    expect(roleError.body.message).toContain("Krever en av rollene:");

    const notFound = await request(app)
      .get("/api/modules/not-a-real-module")
      .set({
        ...participantHeaders,
        "x-locale": "nn",
      });

    expect(notFound.status).toBe(404);
    expect(notFound.body.message).toBe("Fann ikkje modul.");
  });

  it("resolves locale from Accept-Language when x-locale is absent", async () => {
    const response = await request(app)
      .get("/api/me")
      .set({
        ...participantHeaders,
        "accept-language": "nn-NO,nb;q=0.9,en-GB;q=0.8",
      });

    expect(response.status).toBe(200);
    expect(response.body.user.locale).toBe("nn");
  });
});
