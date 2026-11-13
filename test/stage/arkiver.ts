// #1150 skive 2b: arkivering av et kurs fra stage-testene, slik dialogen i forfattersida gjør det.
//
// Fra 2.159.0 tar `POST …/courses/:id/archive` med seg modulene og seksjonene som bare brukes i kurset, og krever at klienten
// sender det forhåndsvisningen viste (`expected`). Uten det svarer tjeneren `409 course_archive_needs_confirmation` når noe ville
// fulgt med, eller `400 course_has_active_participants` når noen er midt i kurset, og ingenting arkiveres. Ryddingen i
// stage-testene sendte arkiveringen uten kropp, og testdataene ble liggende.
//
// Hjelperen henter `GET …/archive-preview`, sender `expected` fra den, og henter på nytt én gang hvis tjeneren svarer
// `409 course_archive_preview_changed` (noe endret seg imellom). Mot en tjener uten forhåndsvisningen (404, eldre enn 2.159.0)
// sendes arkiveringen uten kropp, som før. Svaret er tjenerens, uendret: testene måler det samme som før.
//
// `fulgte` er modulene og seksjonene tjeneren arkiverte sammen med kurset. En rydding som arkiverer dem for seg etterpå, får
// «allerede arkivert» for disse, og kan hoppe over dem.

export type StageSvar = { status: number; json: any; tekst: string };
/** Formen `api(metode, sti, body?)` har i stage-filene. Filer der `api` tar en konto først, sender en innpakning. */
export type StageApi = (metode: string, sti: string, body?: unknown) => Promise<StageSvar>;

export async function arkiverKurs(api: StageApi, kursId: string): Promise<StageSvar & { fulgte: Set<string> }> {
  const sti = `/api/admin/content/courses/${encodeURIComponent(kursId)}`;
  let svar: StageSvar = { status: 0, json: {}, tekst: "" };
  for (let forsøk = 0; forsøk < 2; forsøk += 1) {
    const forhånd = await api("GET", `${sti}/archive-preview`);
    if (forhånd.status === 404) return { ...(await api("POST", `${sti}/archive`)), fulgte: new Set() };
    if (forhånd.status !== 200) return { ...forhånd, fulgte: new Set() };
    const følger: Array<{ type: string; id: string }> = Array.isArray(forhånd.json?.follows) ? forhånd.json.follows : [];
    const expected = {
      follows: {
        moduleIds: følger.filter((element) => element.type === "MODULE").map((element) => element.id),
        sectionIds: følger.filter((element) => element.type === "SECTION").map((element) => element.id),
      },
      inProgressCount: Number(forhånd.json?.inProgressCount) || 0,
    };
    svar = await api("POST", `${sti}/archive`, { expected });
    if (svar.status !== 409 || svar.json?.error !== "course_archive_preview_changed") break;
  }
  const fulgte = new Set<string>([...(svar.json?.followed?.moduleIds ?? []), ...(svar.json?.followed?.sectionIds ?? [])]);
  return { ...svar, fulgte };
}
