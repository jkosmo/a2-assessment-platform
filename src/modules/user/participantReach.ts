/**
 * #968: ÉN regel for «kan denne deltakeren nås / telles».
 *
 * En deltaker som er deaktivert (sluttet, org-synk) eller anonymisert (pseudonymisert) skal verken
 * telles i et kulls publikum, få påminnelser, eller få tildelings-e-post. Regelen sto på fire steder
 * og ble håndhevet på tre — og innad i `resolveCourseAudience` bare for KLASSE-medlemmer, ikke for
 * individuelle innmeldinger. Samme person talte eller ikke, avhengig av hvilken vei hen kom inn.
 *
 * Scenario som fantes: to ansatte har sluttet. Kull-dashbordet viste 10 av 12 fullført og lot SMO
 * purre på de to; påminnelsesjobben hoppet over dem, så purringen kom aldri, og tallet sto fast.
 * Ved ny kurstildeling fikk de to derimot tildelings-e-post på en avviklet adresse.
 *
 * ⚠️ Dette er regelen for PUBLIKUM og VARSLER. Administrative lister (kursets innmeldinger, klassens
 * medlemmer) skal fortsatt vise raden — en administrator må kunne se og fjerne den.
 */
export function isReachableParticipant(user: { activeStatus: boolean; isAnonymized: boolean }): boolean {
  return user.activeStatus && !user.isAnonymized;
}
