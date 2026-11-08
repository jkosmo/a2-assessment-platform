import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

// Playwright-oppsettet for admin-content-e2e (playwright.admin-content.config.ts): ADMIN_CONTENT_E2E_PORT skal styre
// både hvor Playwright venter og hvor testtjeneren (scripts/test/admin-content-static-server.mjs) lytter. Tjeneren
// leser PORT. Før rettingen fikk den aldri porten, lyttet på standardporten, og Playwright ventet på en annen port til
// tidsavbrudd.
//
// Testen starter tjeneren slik Playwright gjør: kommandoen fra oppsettet, med prosessens miljø og oppsettets `env` oppå.

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("admin-content-e2e: én variabel styrer porten", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("testtjeneren lytter på porten Playwright venter på", async () => {
    const port = await freePort();
    vi.stubEnv("ADMIN_CONTENT_E2E_PORT", String(port));
    vi.resetModules();
    const { default: config } = await import("../../playwright.admin-content.config.js");
    const webServer = config.webServer as { command: string; port: number; env?: Record<string, string> };
    expect(webServer.port).toBe(port);
    expect(config.use?.baseURL).toBe(`http://127.0.0.1:${port}`);

    const [bin, ...args] = webServer.command.split(" ");
    const child = spawn(bin === "node" ? process.execPath : bin!, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...webServer.env },
      stdio: "ignore",
    });
    try {
      let listening = false;
      const deadline = Date.now() + 20_000;
      while (!listening && Date.now() < deadline && child.exitCode === null) {
        listening = await canConnect(port);
        if (!listening) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(listening, `tjeneren lytter ikke på ${port}`).toBe(true);
    } finally {
      child.kill();
    }
  }, 30_000);
});
