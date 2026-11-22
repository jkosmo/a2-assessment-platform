// #1158: hvor deltakeren står, slik adressen sier det.
//
// Kursnivået hadde det alt: `?courseId=<id>` er kurset alene, og tilbake fører til «Mine kurs». En åpnet seksjon eller modul
// sto ikke i adressen, så nettleserens tilbake forlot kurset, og en oppfriskning lukket det deltakeren leste. Nå står elementet
// ved siden av kurset:
//
//   /participant?courseId=<kurs>&sectionId=<seksjon>   seksjonen er åpen i kurset
//   /participant?courseId=<kurs>&moduleId=<modul>      modulen er åpen i kurset
//
// `?moduleId=` ALENE er fortsatt e-postlenka, som ikke vet hvilket kurs modulen ligger i (`resolveModuleLink`). Med kurset ved
// siden av er kurset kjent, og modulen åpnes i det.
//
// Rene funksjoner, så regelen kan testes uten nettleser. Historikken selv (pushState, popstate) eier participant.js.

export const ITEM_PARAM_BY_TYPE = Object.freeze({ SECTION: "sectionId", MODULE: "moduleId" });

const nonEmpty = (value) => (typeof value === "string" && value.trim().length > 0 ? value : null);

/**
 * Leser adressen.
 * @param {string} search  `window.location.search`
 * @returns {{ courseId: string|null, slug: string|null, threadId: string|null, item: { type: "SECTION"|"MODULE", id: string } | null }}
 */
export function readParticipantLocation(search) {
  const params = new URLSearchParams(search ?? "");
  const courseId = nonEmpty(params.get("courseId"));
  const sectionId = nonEmpty(params.get("sectionId"));
  const moduleId = nonEmpty(params.get("moduleId"));
  // Et element står bare i et kurs. Uten kurset er `moduleId` e-postlenka, ikke et åpent element.
  let item = null;
  if (courseId && sectionId) item = { type: "SECTION", id: sectionId };
  else if (courseId && moduleId) item = { type: "MODULE", id: moduleId };
  return {
    courseId,
    slug: nonEmpty(params.get("kurs")),
    threadId: nonEmpty(params.get("threadId")),
    item,
  };
}

/**
 * Adressen for kurset, med eller uten et åpent element. Andre parametere (språk, `debug`, `preview`) står urørt.
 * @param {string} href  `window.location.href`
 * @param {{ courseId?: string|null, item?: { type: string, id: string } | null }} target
 * @returns {string} sti + søk + fragment, klar for pushState/replaceState
 */
export function buildParticipantUrl(href, { courseId = null, item = null } = {}) {
  const url = new URL(href);
  for (const param of Object.values(ITEM_PARAM_BY_TYPE)) url.searchParams.delete(param);
  if (courseId) {
    url.searchParams.set("courseId", courseId);
    const param = item ? ITEM_PARAM_BY_TYPE[item.type] : null;
    if (param && item.id) url.searchParams.set(param, item.id);
  } else {
    url.searchParams.delete("courseId");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Er to elementer det samme? `null` er lik `null`. */
export function sameParticipantItem(left, right) {
  if (!left || !right) return !left && !right;
  return left.type === right.type && left.id === right.id;
}

/** Elementet i kursets rekke som adressen peker på, eller null. */
export function findSequenceEntry(sequence, item) {
  if (!Array.isArray(sequence) || !item) return null;
  return sequence.find((entry) => (item.type === "SECTION"
    ? entry?.type === "SECTION" && entry.sectionId === item.id
    : entry?.type === "MODULE" && entry.moduleId === item.id)) ?? null;
}

/** Elementet et åpent panel viser, i samme form som adressen. */
export function itemOfOpenEntry(open) {
  if (!open) return null;
  if (open.type === "SECTION") return open.sectionId ? { type: "SECTION", id: open.sectionId } : null;
  if (open.type === "MODULE") return open.moduleId ? { type: "MODULE", id: open.moduleId } : null;
  return null;
}
