import { describe, expect, it } from "vitest";
import { createValidatingLookup } from "../../src/modules/adminContent/urlFetchService.js";

// #520: the connect-time lookup must re-validate the resolved IP so a DNS-rebinding attacker
// (public IP at the up-front check, private IP at connect time) cannot reach internal addresses.

type Addr = { address: string; family: number };

// Build a fake dns.lookup-style resolver that returns a fixed address list.
function resolverReturning(addresses: Addr[] | Error) {
  return (
    _hostname: string,
    _options: unknown,
    cb: (err: NodeJS.ErrnoException | null, addresses: Addr[]) => void,
  ) => {
    if (addresses instanceof Error) cb(addresses as NodeJS.ErrnoException, []);
    else cb(null, addresses);
  };
}

function runLookup(addresses: Addr[] | Error, options: Record<string, unknown> = {}) {
  const lookup = createValidatingLookup(resolverReturning(addresses) as never);
  return new Promise<{ err: unknown; address: unknown; family?: number }>((resolve) => {
    lookup("example.test", options as never, (err, address, family) => resolve({ err, address, family }));
  });
}

describe("createValidatingLookup (SSRF connect-time pinning, #520)", () => {
  it("rejects when the resolved address is private (rebinding to internal)", async () => {
    const { err } = await runLookup([{ address: "10.0.0.5", family: 4 }]);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe("private_address");
  });

  it("rejects the cloud metadata endpoint", async () => {
    const { err } = await runLookup([{ address: "169.254.169.254", family: 4 }]);
    expect((err as { code?: string }).code).toBe("private_address");
  });

  it("rejects when ANY resolved address is private (mixed public+private)", async () => {
    const { err } = await runLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect((err as { code?: string }).code).toBe("private_address");
  });

  it("passes a public address through (single)", async () => {
    const { err, address, family } = await runLookup([{ address: "93.184.216.34", family: 4 }]);
    expect(err).toBeNull();
    expect(address).toBe("93.184.216.34");
    expect(family).toBe(4);
  });

  it("returns the full validated list when options.all is set", async () => {
    const { err, address } = await runLookup([{ address: "93.184.216.34", family: 4 }], { all: true });
    expect(err).toBeNull();
    expect(Array.isArray(address)).toBe(true);
    expect((address as Addr[])[0].address).toBe("93.184.216.34");
  });

  it("rejects a private IPv6 (unique-local)", async () => {
    const { err } = await runLookup([{ address: "fc00::1", family: 6 }]);
    expect((err as { code?: string }).code).toBe("private_address");
  });

  it("propagates resolver errors", async () => {
    const { err } = await runLookup(new Error("dns boom"));
    expect(err).toBeInstanceOf(Error);
  });

  it("fails closed when nothing resolves", async () => {
    const { err } = await runLookup([]);
    expect((err as { code?: string }).code).toBe("dns_failed");
  });
});
