import { describe, expect, it, vi } from "vitest";
// vi.mock under løftes over denne, så låsmodulen får den falske runInTransaction.
import { runContentRead, runContentWrite } from "../../src/db/contentLock.js";

// #934 skive 4a (QA-porten 2.131.0, runde 2): står så mange skrivere i kø bak innholdslåsen at poolen er tom, får den
// neste ikke startet transaksjonen (Prisma P2028). Det er samme situasjon som å vente for lenge på låsen, og skal gi
// 503 `content_busy`, ikke 500. Andre feil går videre som de er.

const runInTransaction = vi.fn();
vi.mock("../../src/db/transaction.js", () => ({ runInTransaction: (...args: unknown[]) => runInTransaction(...args) }));


function prismaError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

describe("innholdslåsens kø: en transaksjon som ikke får startet, er content_busy", () => {
  it("P2028 «Unable to start a transaction» gir 503 content_busy, for skrivere og lesere", async () => {
    runInTransaction.mockRejectedValue(prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time."));
    await expect(runContentWrite(async () => "x")).rejects.toMatchObject({ code: "content_busy", httpStatus: 503 });
    await expect(runContentRead(async () => "x")).rejects.toMatchObject({ code: "content_busy", httpStatus: 503 });
  });

  it("KONTROLL: en annen feil (også en annen P2028) går videre urørt", async () => {
    const other = prismaError("P2028", "Transaction already closed: the timeout for this transaction was 5000 ms.");
    runInTransaction.mockRejectedValue(other);
    await expect(runContentWrite(async () => "x")).rejects.toBe(other);
    const plain = new Error("boom");
    runInTransaction.mockRejectedValue(plain);
    await expect(runContentWrite(async () => "x")).rejects.toBe(plain);
  });

  it("ventetiden på en forbindelse er låsens, med mindre kalleren sier noe annet", async () => {
    runInTransaction.mockResolvedValue("ok");
    await runContentWrite(async () => "x");
    expect(runInTransaction.mock.calls.at(-1)?.[1]).toMatchObject({ maxWait: 15_000 });
    await runContentRead(async () => "x");
    expect(runInTransaction.mock.calls.at(-1)?.[1]).toMatchObject({ maxWait: 3_000 });
  });
});
