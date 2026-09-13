// #1046 steg B: ÉN tilstand for alt innhold i forfatterlistene.
//
// Før svarte API-et på «hvilken tilstand er dette i» på tre måter: moduler med et `status`-felt i
// fem verdier, kurs med `publishedAt` + `archivedAt`, seksjoner med `activeVersionId` + `archivedAt`.
// Klienten regnet ut status selv, tre ganger, med tre ulike betingelser — og «Nyere utkast»-merket
// fantes bare der informasjonen tilfeldigvis var med (moduler).
//
// Nå leverer alle listekallene `lifecycle`, regnet ut HER, og klienten leser bare ordet.

export type ContentLifecycle = "draft" | "published" | "published_with_draft" | "archived";

/** Klasser publiseres ikke; de er aktive eller arkiverte. Samme felt, to av verdiene. */
export type ClassLifecycle = "active" | "archived";

export type Lifecycle = ContentLifecycle | ClassLifecycle;

export interface LifecycleInput {
  archivedAt: Date | string | null | undefined;
  /** Versjonert innhold (modul, seksjon): id-en på versjonen som er live, eller null. */
  activeVersionId?: string | null;
  /** Versjonert innhold: id-en på den nyeste versjonen som finnes, eller null når ingen finnes. */
  latestVersionId?: string | null;
  /** Uversjonert innhold (kurs): når det ble publisert, eller null. */
  publishedAt?: Date | string | null;
}

/**
 * Regelen, én gang:
 * - arkivert slår alt;
 * - versjonert innhold er «published» når en versjon er live, «published_with_draft» når det i
 *   tillegg finnes en nyere versjon enn den som er live, ellers «draft» (også når ingen versjon
 *   finnes ennå — et tomt skall er et utkast);
 * - uversjonert innhold er «published» når det har `publishedAt`, ellers «draft».
 */
export function deriveContentLifecycle(input: LifecycleInput): ContentLifecycle {
  if (input.archivedAt) return "archived";
  if (input.activeVersionId !== undefined) {
    if (!input.activeVersionId) return "draft";
    if (input.latestVersionId && input.latestVersionId !== input.activeVersionId) return "published_with_draft";
    return "published";
  }
  return input.publishedAt ? "published" : "draft";
}

export function deriveClassLifecycle(input: { archivedAt: Date | string | null | undefined }): ClassLifecycle {
  return input.archivedAt ? "archived" : "active";
}
