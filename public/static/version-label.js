// #934 skive 5b: modulens versjon slik forfatter og deltaker ser den, «v2.1». `versionNo` er rekkefølgen av lagringer og står i
// API-et som før. En versjon som aldri er publisert, har ikke noe nummer.

/** «2.1», eller null når versjonen ikke har nummer. */
export function moduleVersionNumber(version) {
  if (!Number.isInteger(version?.versionMajor)) return null;
  return `${version.versionMajor}.${Number.isInteger(version.versionMinor) ? version.versionMinor : 0}`;
}

/** «v2.1». Eldre svar uten nummer viser det de alltid har vist: «v5». Tom streng når det ikke finnes noe å vise. */
export function moduleVersionLabel(version) {
  const number = moduleVersionNumber(version);
  if (number) return `v${number}`;
  return Number.isInteger(version?.versionNo) ? `v${version.versionNo}` : "";
}
