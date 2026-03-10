import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/errors/AppError.js";
import { errorHandlingMiddleware } from "../src/middleware/errorHandling.js";

describe("errorHandlingMiddleware", () => {
  function buildTestApp(error: AppError | Error) {
    const app = express();
    app.get("/test", (_request, _response, next) => {
      next(error);
    });
    app.use(errorHandlingMiddleware);
    return app;
  }

  it("maps NotFoundError to 404", async () => {
    const response = await request(buildTestApp(new NotFoundError("Submission"))).get("/test");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "not_found",
      message: "Submission not found.",
    });
  });

  it("maps ConflictError to 409", async () => {
    const response = await request(
      buildTestApp(new ConflictError("appeal_already_open", "Submission already has an open or in-review appeal.")),
    ).get("/test");
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "appeal_already_open",
      message: "Submission already has an open or in-review appeal.",
    });
  });

  it("maps ValidationError to 400", async () => {
    const response = await request(buildTestApp(new ValidationError("Module active version is not available."))).get(
      "/test",
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation_error",
      message: "Module active version is not available.",
    });
  });

  it("maps ForbiddenError to 403", async () => {
    const response = await request(
      buildTestApp(new ForbiddenError("You do not have access to this submission audit trail.")),
    ).get("/test");
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "forbidden",
      message: "You do not have access to this submission audit trail.",
    });
  });

  it("falls back to 500 for non-AppError values", async () => {
    const response = await request(buildTestApp(new Error("Unexpected failure."))).get("/test");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "internal_error",
      message: "Unexpected failure.",
    });
  });
});
