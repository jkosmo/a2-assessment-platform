/**
 * #1163 skive 1: tittelen er en del av seksjonsversjonen (prinsipp 2, doc/DECISIONS.md «felles prinsipper»).
 *
 * - Det deltakerne ser, er tittelen på den PUBLISERTE versjonen (`activeVersion.title`). Leseren, kursdetaljen og
 *   aktivitetsrapporten spør her. `CourseSection.title` er forfatterens arbeidstittel (lister, redigereren) og når aldri en
 *   deltaker før den er publisert.
 * - Publiseringsporten måler tittelen på versjonen som publiseres (`sectionVersionTitle`).
 *
 * Reserven: en versjon uten tittel (`null`) finnes bare når gammel kode laget den under utrullingen (migreringen fylte alle som
 * fantes). Da gjelder seksjonens tittel, slik den gjorde for gammel kode. Valget står i doc/DECISIONS.md, «Valgt under byggingen
 * av #1163, skive 1».
 */
export function sectionVersionTitle(
  version: { title?: string | null } | null | undefined,
  sectionTitle: string,
): string {
  return version?.title ?? sectionTitle;
}

/**
 * Tittelen deltakerne ser: den publiserte versjonens. Uten publisert versjon (et utkast) er det ingen deltakertittel, men
 * kallerne her har alt filtrert bort det deltakeren ikke kan lese; arbeidstittelen er da reserven, som før.
 */
export function publishedSectionTitle(section: { title: string; activeVersion?: { title?: string | null } | null }): string {
  return sectionVersionTitle(section.activeVersion, section.title);
}

/** Det Prisma-utvalget en deltakerleser trenger for `publishedSectionTitle`. */
export const publishedSectionTitleSelect = { title: true, activeVersion: { select: { title: true } } } as const;
