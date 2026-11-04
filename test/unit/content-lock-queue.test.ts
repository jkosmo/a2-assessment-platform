import { describe, expect, it, vi } from "vitest";
// vi.mock under løftes over denne, så låsmodulen får den falske runInTransaction.
import { runContentRead, runContentReadForLearner, runContentWrite, runLearnerWrite } from "../../src/db/contentLock.js";

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

  // #934 skive 5a-1: deltakerlåsen. Samme kø, samme svar. Arbeidstiden utvides med begge ventegrensene, så en som står i
  // kø bak en lås, ikke rulles tilbake av Prisma (500).
  it("P2028 gir 503 content_busy også for deltakerlåsen", async () => {
    runInTransaction.mockRejectedValue(prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time."));
    await expect(runLearnerWrite("u", async () => "x")).rejects.toMatchObject({ code: "content_busy", httpStatus: 503 });
    await expect(runContentReadForLearner("u", async () => "x")).rejects.toMatchObject({ code: "content_busy", httpStatus: 503 });
  });

  it("arbeidstiden dekker ventetiden på låsene", async () => {
    runInTransaction.mockResolvedValue("ok");
    await runLearnerWrite("u", async () => "x");
    expect(runInTransaction.mock.calls.at(-1)?.[1]).toMatchObject({ maxWait: 3_000, timeout: 5_000 + 3_000 });
    await runContentReadForLearner("u", async () => "x");
    expect(runInTransaction.mock.calls.at(-1)?.[1]).toMatchObject({ maxWait: 3_000, timeout: 5_000 + 3_000 + 3_000 });
  });
});

describe("låserekkefølgen: en transaksjon som holder deltakerlåsen, tar ikke innholdslåsen etterpå", () => {
  // Klienten låsene tas på; SQL-en finnes ikke her. Selve låsene måler test/m2-learner-lock-934-5a1.test.ts.
  const fakeTx = { $executeRaw: async () => 0, $executeRawUnsafe: async () => 0 };

  it("alt som åpner en ny transaksjon inne i runLearnerWrite, stoppes med én gang", async () => {
    runInTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(fakeTx));
    for (const nested of [
      () => runContentRead(async () => "x"),
      () => runContentWrite(async () => "x"),
      () => runContentReadForLearner("u", async () => "x"),
      () => runLearnerWrite("u", async () => "x"),
    ]) {
      await expect(runLearnerWrite("u", async () => nested())).rejects.toMatchObject({ code: "internal_error" });
    }
  });

  it("det samme inne i runContentReadForLearner", async () => {
    runInTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(fakeTx));
    await expect(runContentReadForLearner("u", async () => runLearnerWrite("u", async () => "x"))).rejects.toMatchObject({ code: "internal_error" });
    await expect(runContentReadForLearner("u", async () => runContentRead(async () => "x"))).rejects.toMatchObject({ code: "internal_error" });
  });

  it("KONTROLL: hver for seg, etter hverandre, går det", async () => {
    runInTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(fakeTx));
    await expect(runLearnerWrite("u", async () => "a")).resolves.toBe("a");
    await expect(runContentReadForLearner("u", async () => "b")).resolves.toBe("b");
    await expect(runContentRead(async () => "c")).resolves.toBe("c");
  });
});
