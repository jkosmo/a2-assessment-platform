import { describe, expect, it } from "vitest";
import { app } from "../../src/app.js";

// #788: an unauthenticated client could POST an honest up-to-~35MB body to a large-limit route and have
// Express buffer + parse it (event-loop-blocking) before the 401 further down. The fix mounts the IP
// pre-body limiter + authenticate BEFORE the JSON body parsers. The behavioural 401-before-parse only
// manifests in real (entra) auth — mock auth resolves a default user, so a request is never truly
// "unauthenticated" in tests — so we assert the ordering invariant directly on the Express stack.
describe("pre-body auth ordering (#788)", () => {
  it("mounts authenticate before every JSON body parser", () => {
    const stack = (app as unknown as { _router: { stack: Array<{ name: string }> } })._router.stack;
    const names = stack.map((layer) => layer.name);

    const authIdx = names.indexOf("authenticate");
    const firstParserIdx = names.indexOf("jsonParser");

    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(firstParserIdx).toBeGreaterThanOrEqual(0);
    // Every body parser must come after authenticate — no large body is buffered before the auth check.
    stack.forEach((layer, index) => {
      if (layer.name === "jsonParser") expect(index).toBeGreaterThan(authIdx);
    });
  });
});
