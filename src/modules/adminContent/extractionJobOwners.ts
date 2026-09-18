// #1031: hvem startet en ekstraheringsjobb. Jobbene bor i parser-arbeideren (eller i minnet her),
// og status-endepunktet visste ikke hvem som spurte — enhver fagansvarlig med en jobId kunne lese
// en annens kildemateriale. Eierskapet huskes her, i web-appen, med samme levetid som jobbene har
// lokalt. Én instans i dag (B1); med flere instanser må dette flyttes til et delt lager — det er
// den kjente begrensningen, skrevet ned heller enn antatt bort.

const owners = new Map<string, { userId: string; createdAt: number }>();
const TTL_MS = 60 * 60 * 1000;

function purge(now = Date.now()): void {
  for (const [jobId, entry] of owners) {
    if (now - entry.createdAt > TTL_MS) owners.delete(jobId);
  }
}

export function rememberExtractionJobOwner(jobId: string, userId: string): void {
  purge();
  owners.set(jobId, { userId, createdAt: Date.now() });
}

/** Sann bare når jobben ble startet av denne brukeren i denne prosessen. Ukjent jobb = ikke eier. */
export function isExtractionJobOwner(jobId: string, userId: string): boolean {
  purge();
  return owners.get(jobId)?.userId === userId;
}

/** For tester: glem alt. */
export function resetExtractionJobOwners(): void {
  owners.clear();
}
