// For enhetstester med en falsk Prisma-klient: låsene er SQL, og den finnes ikke her. Bruk:
//
//   vi.mock("../../src/db/contentLock.js", () => import("../support/contentLockThroughTransaction.js"));
//
// Hver funksjon åpner en transaksjon på den falske klienten og gir testens egen klient videre, så påstander om hvilken
// transaksjon noe skjedde i, måler det samme som før. At låsene faktisk tas, måler integrasjonstestene
// (test/m2-learner-lock-934-5a1.test.ts) og vakta (test/content-lock-write-guard.test.js).
import { runInTransaction } from "../../src/db/transaction.js";

type Callback<T> = (tx: never) => Promise<T>;

export const runContentWrite = <T>(callback: Callback<T>) => runInTransaction((tx) => callback(tx as never));
export const runContentRead = <T>(callback: Callback<T>) => runInTransaction((tx) => callback(tx as never));
export const runContentReadForLearner = <T>(_userId: string, callback: Callback<T>) => runInTransaction((tx) => callback(tx as never));
export const runLearnerWrite = <T>(_userId: string, callback: Callback<T>) => runInTransaction((tx) => callback(tx as never));
