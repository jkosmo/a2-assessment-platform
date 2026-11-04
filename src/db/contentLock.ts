// #934 skive 4a: ÉN lås for alt innhold på plattformen (doc/DESIGN_934.md, «Låsene»).
//
// Produkteier 2026-11-04: det er få forfattere, og en innholdsendring tar millisekunder. Det er greit at alle
// innholdsendringer på hele plattformen står i kø bak hverandre.
//
// Låsen er én rådgivende lås i PostgreSQL med én fast nøkkel (`pg_advisory_xact_lock`). Den gjelder ut
// transaksjonen og slippes ved commit eller tilbakerulling.
//   - EKSKLUSIV for alt som skriver innhold, eller endrer hvilke elementer et kurs har. Den tas som FØRSTE
//     setning i transaksjonen, og alt som avgjør om handlingen er lov, sjekkes ETTER den — inne i samme
//     transaksjon. En forhåndsvisning regnet ut før er bare et forslag.
//   - DELT for dem som må lese en fast versjon (innlevering, registrering av lesing og utstedelse av kursbevis).
//     Delte låser venter ikke på hverandre, bare på en som skriver innhold.
//
// Typene er poenget: `runContentWrite` gir en MERKET klient (`ContentWriteTx`), og funksjonene som skriver
// innhold tar bare imot den. Glemmer en ny vei låsen, kompilerer den ikke. `test/content-lock-write-guard.test.js`
// nekter i tillegg enhver skriving til innholdstabellene på en klient uten merket, og at merket lages andre
// steder enn her.
//
// Fast rekkefølge: innholdslåsen først. Revisjonssporets lås (`auditService.ts`) tas etter, når en skriver
// registrerer en hendelse; ingen transaksjon tar innholdslåsen etter revisjonssporets.
//
// #934 skive 5a-1: DELTAKERLÅSEN står også her. Én rådgivende lås per deltaker (nøkkel fra `userId`), eksklusiv. Den
// tas av alt som endrer hva en deltaker har gjort: innlevering, vedtak, lesing og utstedelse av kursbevis.
//   - Innlevering, lesing og utstedelse må også se en fast versjon av innholdet: `runContentReadForLearner` tar
//     innholdslåsen delt og SÅ deltakerlåsen.
//   - Vedtakene trenger ikke innholdslåsen: `runLearnerWrite` tar bare deltakerlåsen. Kontrollen av kursbevis etter
//     et vedtak går på outboxen og kjører i en egen transaksjon.
// Fast rekkefølge: innholdslåsen, deltakerlåsen, revisjonssporets lås. En transaksjon som har tatt deltakerlåsen, tar
// aldri innholdslåsen etterpå; `assertNotNested` stopper det. Med én rekkefølge kan låsene ikke låse hverandre fast.
// Samme merke-tanke som over: funksjonene som skriver det deltakeren har gjort, tar bare imot `LearnerTx`.
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../errors/AppError.js";
import { runInTransaction, type DbTransactionClient, type RunInTransactionOptions } from "./transaction.js";

/** Én fast nøkkel for hele plattformen. Revisjonssporet bruker 8_040_804. */
export const CONTENT_LOCK_KEY = 9_340_401;

/** Hvor lenge en skriver venter på en annen før den gir opp med 503. Kommer i tillegg til arbeidstiden. */
export const CONTENT_WRITE_LOCK_WAIT_MS = 15_000;
/** Lesere (delt lås) venter kortere: en deltaker skal ikke stå og vente på en stor import. */
export const CONTENT_READ_LOCK_WAIT_MS = 3_000;
/**
 * Deltakerlåsen bruker PostgreSQLs nøkkel med to heltall: dette tallet og en hash av `userId`. Den nøkkelrommet er
 * adskilt fra nøkkelen med ett tall som innholdslåsen og revisjonssporet bruker. To deltakere med samme hash venter
 * bare litt på hverandre; ingenting blir galt.
 */
export const LEARNER_LOCK_NAMESPACE = 9_340_402;
/** Holdes i millisekunder av en deltakers egen handling. 3 sekunder er derfor rikelig. */
export const LEARNER_LOCK_WAIT_MS = 3_000;
/** Prismas standard for arbeidet i en transaksjon. */
const DEFAULT_WORK_MS = 5_000;

declare const contentWriteLock: unique symbol;
declare const contentReadLock: unique symbol;
declare const learnerLock: unique symbol;

/**
 * En transaksjon som har tatt innholdslåsen DELT. Kan lese en fast versjon av innholdet.
 * (Merket finnes bare i typene; klienten er den samme Prisma-klienten.)
 */
export type ContentReadTx = DbTransactionClient & { readonly __contentReadLock: typeof contentReadLock };

/**
 * En transaksjon som har tatt innholdslåsen EKSKLUSIVT. Den eneste klienten som kan skrive innhold. Den
 * kan også alt en delt kan.
 */
export type ContentWriteTx = ContentReadTx & { readonly __contentWriteLock: typeof contentWriteLock };

/**
 * En transaksjon som holder deltakerlåsen. Den eneste klienten som kan skrive det en deltaker har gjort: innlevering,
 * vedtak, status for modulen, lesing og kursbevis. (Unntaket er den eksklusive innholdslåsen, som stenger ute alle
 * lesinger og utstedelser: importen flytter lesinger, og #997 setter `SUPERSEDED`, under den.)
 */
export type LearnerTx = DbTransactionClient & { readonly __learnerLock: typeof learnerLock };

/** Innholdslåsen delt og deltakerlåsen, i den rekkefølgen: innlevering, lesing og utstedelse av kursbevis. */
export type LearnerContentTx = ContentReadTx & LearnerTx;

export type ContentLockMode = "exclusive" | "shared";

// En innholdstransaksjon inne i en annen ville ventet på sin egen lås (en ny forbindelse står i kø bak den
// som holder den) til Prisma gir opp. Det er en programmeringsfeil; den skal stoppe med én gang, ikke henge.
const insideContentTransaction = new AsyncLocalStorage<ContentLockMode>();
// Samme for deltakerlåsen: en ny transaksjon inne i en som holder den, ville enten ventet på sin egen lås, eller tatt
// innholdslåsen etter deltakerlåsen, og da er den faste rekkefølgen brutt.
const insideLearnerTransaction = new AsyncLocalStorage<string>();

function isLockTimeout(error: unknown): boolean {
  const meta = (error as { meta?: { code?: unknown } } | null)?.meta;
  if (meta && meta.code === "55P03") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /55P03|lock timeout|canceling statement due to lock timeout/i.test(message);
}

/**
 * Tar innholdslåsen i en transaksjon som er åpnet med `runInTransaction`. Brukes bare av `runContentWrite` og
 * `runContentRead` under, så låsen alltid er det første transaksjonen gjør (vakttesten nekter andre kall).
 */
async function withContentLock(tx: DbTransactionClient, mode: "exclusive", waitMs: number): Promise<ContentWriteTx>;
async function withContentLock(tx: DbTransactionClient, mode: "shared", waitMs: number): Promise<ContentReadTx>;
async function withContentLock(tx: DbTransactionClient, mode: ContentLockMode, waitMs: number): Promise<ContentReadTx> {
  // `SET LOCAL` gjelder ut transaksjonen; ventegrensen settes tilbake rett etter, så den ikke gjelder
  // radlåsene arbeidet tar senere. Tallet er vårt eget heltall, ikke inndata.
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${Math.max(1, Math.floor(waitMs))}ms'`);
  try {
    if (mode === "exclusive") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CONTENT_LOCK_KEY}::bigint)`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${CONTENT_LOCK_KEY}::bigint)`;
    }
  } catch (error) {
    if (isLockTimeout(error)) throw busy();
    throw error;
  }
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout TO DEFAULT");
  return tx as ContentReadTx;
}

function busy() {
  return new AppError(
    "content_busy",
    503,
    "Someone else is changing content on the platform right now. Try again in a moment.",
  );
}

/**
 * Tar deltakerlåsen i en åpen transaksjon. Brukes bare av `runLearnerWrite` og `runContentReadForLearner` under, så
 * låsen alltid kommer før alt annet (bortsett fra innholdslåsen). Samme ventegrense og samme svar som en delt
 * innholdslås: `503 content_busy`, og siden prøver igjen. Ingenting er skrevet.
 */
async function withLearnerLock<T extends DbTransactionClient>(tx: T, userId: string): Promise<T & LearnerTx> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${Math.max(1, Math.floor(LEARNER_LOCK_WAIT_MS))}ms'`);
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEARNER_LOCK_NAMESPACE}::int, hashtext(${userId}))`;
  } catch (error) {
    if (isLockTimeout(error)) throw busy();
    throw error;
  }
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout TO DEFAULT");
  return tx as T & LearnerTx;
}

// QA-porten 2.131.0, runde 2: hver skriver som står i kø bak låsen, holder en forbindelse. Er poolen full, får den
// neste ikke engang startet transaksjonen (Prisma P2028 «Unable to start a transaction»). Det er samme situasjon —
// noen andre arbeider med innhold — og skal gi 503, ikke 500. Transaksjonen er ikke startet; ingenting er skrevet.
function isTransactionStartTimeout(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === "P2028" && /unable to start a transaction/i.test(message);
}

async function mapQueueErrors<T>(run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (error) {
    if (isTransactionStartTimeout(error)) throw busy();
    throw error;
  }
}

function assertNotNested(mode: ContentLockMode | "learner") {
  const outer = insideContentTransaction.getStore() ?? (insideLearnerTransaction.getStore() ? "learner" : undefined);
  if (outer) {
    throw new AppError(
      "internal_error",
      500,
      `A content transaction (${mode}) was opened inside another (${outer}). Pass the outer transaction's client instead.`,
    );
  }
}

/**
 * Åpner en transaksjon der det FØRSTE som skjer, er at innholdslåsen tas eksklusivt. Alle som skriver innhold
 * eller endrer et kurs' elementer, går gjennom denne (eller får klienten den gir, fra kalleren).
 *
 * `timeout` er arbeidstiden; ventetiden på låsen legges til, så en skriver som står i kø bak en import ikke
 * rulles tilbake av Prisma (500) — den venter, og gir opp med 503 `content_busy` etter
 * `CONTENT_WRITE_LOCK_WAIT_MS`.
 */
export function runContentWrite<T>(
  callback: (tx: ContentWriteTx) => Promise<T>,
  options?: RunInTransactionOptions,
): Promise<T> {
  assertNotNested("exclusive");
  const work = options?.timeout ?? DEFAULT_WORK_MS;
  // `maxWait`: en forbindelse kan også være noe å stå i kø for; samme grense som for låsen.
  return insideContentTransaction.run("exclusive", () =>
    mapQueueErrors(
      runInTransaction(
        async (tx) => callback(await withContentLock(tx, "exclusive", CONTENT_WRITE_LOCK_WAIT_MS)),
        { maxWait: CONTENT_WRITE_LOCK_WAIT_MS, ...options, timeout: work + CONTENT_WRITE_LOCK_WAIT_MS },
      ),
    ),
  );
}

/**
 * Som `runContentWrite`, men låsen tas DELT: for den som må lese en fast versjon av innholdet. Venter på en
 * skriver i høyst `CONTENT_READ_LOCK_WAIT_MS`, og svarer så 503 `content_busy` (doc/DESIGN_934.md, «Ventetid»).
 */
export function runContentRead<T>(
  callback: (tx: ContentReadTx) => Promise<T>,
  options?: RunInTransactionOptions,
): Promise<T> {
  assertNotNested("shared");
  const work = options?.timeout ?? DEFAULT_WORK_MS;
  return insideContentTransaction.run("shared", () =>
    mapQueueErrors(
      runInTransaction(
        async (tx) => callback(await withContentLock(tx, "shared", CONTENT_READ_LOCK_WAIT_MS)),
        { maxWait: CONTENT_READ_LOCK_WAIT_MS, ...options, timeout: work + CONTENT_READ_LOCK_WAIT_MS },
      ),
    ),
  );
}

/**
 * Innholdslåsen delt, så deltakerlåsen, som de to første setningene i transaksjonen. For den som endrer hva en deltaker
 * har gjort, og må se en fast versjon av innholdet mens det skjer: innlevering, lesing og utstedelse av kursbevis.
 */
export function runContentReadForLearner<T>(
  userId: string,
  callback: (tx: LearnerContentTx) => Promise<T>,
  options?: RunInTransactionOptions,
): Promise<T> {
  const work = options?.timeout ?? DEFAULT_WORK_MS;
  return runContentRead(
    (tx) => insideLearnerTransaction.run(userId, async () => callback(await withLearnerLock(tx, userId))),
    { ...options, timeout: work + LEARNER_LOCK_WAIT_MS },
  );
}

/**
 * Bare deltakerlåsen, som første setning i transaksjonen. For vedtakene (automatisk, flervalg, manuell vurdering og
 * anke): de leser ingen fast versjon av innholdet, og skal ikke vente på en som skriver innhold.
 */
export function runLearnerWrite<T>(
  userId: string,
  callback: (tx: LearnerTx) => Promise<T>,
  options?: RunInTransactionOptions,
): Promise<T> {
  assertNotNested("learner");
  const work = options?.timeout ?? DEFAULT_WORK_MS;
  return insideLearnerTransaction.run(userId, () =>
    mapQueueErrors(
      runInTransaction(
        async (tx) => callback(await withLearnerLock(tx, userId)),
        { maxWait: LEARNER_LOCK_WAIT_MS, ...options, timeout: work + LEARNER_LOCK_WAIT_MS },
      ),
    ),
  );
}

/** Bare for vakttesten og integrasjonstestene: står koden nå inne i en innholdstransaksjon? */
export function currentContentLockMode(): ContentLockMode | undefined {
  return insideContentTransaction.getStore();
}
