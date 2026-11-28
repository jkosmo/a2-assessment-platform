/**
 * content-duplicate.js — «Dupliser» for en modul og en seksjon, ett sted (#1169 skive 4).
 *
 * Kopien lages som før i lista: eksportpakken (`/export-package`, ikke `/export` — den gir ikke konvolutten importen tar) med
 * « (kopi)» på navnet i hvert språk, importert som et nytt element. En modul importeres uten å publiseres (#456). Lista og hodet
 * (modulsida, seksjonsredigereren) bruker de samme to funksjonene. Kjent forskjell: modulens hode kopierer versjonen sida viser
 * (`moduleVersionId`), modullista den publiserte (lista vet ikke id-en til et nyere utkast); seksjonen tar alltid den nyeste.
 * Hva som skjer etterpå, er sidens: lista tegnes på nytt, hodet åpner kopien.
 */
import { runWithWorkDialog } from "./work-dialog.js";

function withCopySuffix(title) {
  if (title && typeof title === "object") {
    return Object.fromEntries(Object.entries(title).map(([locale, value]) => [locale, value ? `${value} (kopi)` : value]));
  }
  if (typeof title === "string" && title) return `${title} (kopi)`;
  return title;
}

/**
 * `moduleVersionId`: versjonen kopien lages av. Modulsida sender den som vises (et nyere lagret utkast, ikke den publiserte), som
 * eksporten der (QA-porten 2.190.0); uten den pakker tjeneren den publiserte, som lista alltid har gjort.
 * @returns {Promise<string>} id-en til kopien
 */
export async function duplicateModuleCopy({ moduleId, moduleVersionId = null, apiFetch, getHeaders, t }) {
  const query = moduleVersionId ? `?moduleVersionId=${encodeURIComponent(moduleVersionId)}` : "";
  const exportResult = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export-package${query}`, getHeaders);
  const envelope = exportResult?.envelope ?? exportResult;
  if (!envelope || envelope.exportFormat !== "a2-content-export/v1" || !envelope.module) {
    throw new Error(t("library.exportUnexpected"));
  }
  if (envelope.module?.module) envelope.module.module.title = withCopySuffix(envelope.module.module.title);
  // #456: autoPublish=false så kopien lander som et upublisert utkast uansett om kilden var publisert.
  const importResult = await runWithWorkDialog(t("adminContent.work.copying"), () => apiFetch("/api/admin/content/modules/import", getHeaders, {
    method: "POST",
    body: JSON.stringify({ payload: envelope, mode: "createNew", autoPublish: false }),
  }));
  if (!importResult?.moduleId) throw new Error(t("library.importNoId"));
  return importResult.moduleId;
}

/** @returns {Promise<string>} id-en til kopien */
export async function duplicateSectionCopy({ sectionId, apiFetch, getHeaders, t }) {
  const body = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}/export-package`, getHeaders);
  const envelope = body?.envelope ?? null;
  if (!envelope?.section) throw new Error("Eksport returnerte tom envelope.");
  envelope.section.title = withCopySuffix(envelope.section.title);
  const result = await runWithWorkDialog(t("adminContent.work.copying"), () => apiFetch("/api/admin/content/sections/import", getHeaders, {
    method: "POST",
    body: JSON.stringify({ payload: envelope, mode: "createNew" }),
  }));
  if (!result?.sectionId) throw new Error("Import-respons mangler sectionId.");
  return result.sectionId;
}
