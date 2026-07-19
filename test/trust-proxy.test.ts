import { app } from "../src/app.js";

// Guards the fix for the architecture-review finding "no `trust proxy` set → IP-keyed rate limiting
// collapses all anonymous clients into one bucket behind Azure's front end". The rate limiters
// (src/middleware/rateLimiting.ts) key anonymous callers by req.ip; behind Azure App Service that
// only resolves to the real client when Express is told to trust exactly one proxy hop. If a future
// refactor drops this, anonymous rate limiting silently becomes a single shared bucket again.
describe("trust proxy", () => {
  it("trusts exactly one proxy hop so req.ip resolves from X-Forwarded-For (not the front-end IP)", () => {
    expect(app.get("trust proxy")).toBe(1);
  });
});
