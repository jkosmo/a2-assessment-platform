// #1151 (doc/design/CONTENT_LIFECYCLE.md, G5): ARKIVERT ER URØRLIG.
//
// Et arkivert kurs, en arkivert modul og en arkivert seksjon kan ikke endres eller brukes før de er gjenopprettet. Lov på et
// arkivert element: gjenopprette, slette (der slettereglene ellers tillater det), eksportere, lese og endre eiere (#1150 2b).
//
// ÉN vakt for alle tre typene. Den leser `archivedAt` på transaksjonen som holder innholdslåsen (typen `ContentWriteTx` krever
// det): arkiveringen tar samme lås, så svaret gjelder til skrivingen er ferdig. Den som kommer sist av en arkivering og en
// skriving, ser den andres resultat.
//
// Finnes ikke raden, sier vakta ingenting: hver kaller har alt sin egen sjekk av at elementet finnes, med sitt eget svar.
//
// `assertNotArchivedBeforeLock` er en FORHÅNDSSJEKK på den globale klienten, for veier som gjør noe dyrt før låsen (laster opp
// bilder, kaller språkmodellen). Den er et forslag; svaret som gjelder, gir `assertNotArchived` i transaksjonen.
//
// Hvem som kaller vakta, og hvilke skrivinger som er unntatt (med grunn): test/archived-is-readonly-guard.test.js.
import type { ContentWriteTx } from "../../db/contentLock.js";
import { prisma } from "../../db/prisma.js";
import { DomainRuleError } from "../../errors/AppError.js";

export type ArchivableType = "COURSE" | "MODULE" | "SECTION";
export type ArchivableRef = { type: ArchivableType; id: string };

type ArchivedAtReader = Pick<ContentWriteTx, "course" | "module" | "courseSection"> | typeof prisma;

const ERRORS: Record<ArchivableType, { code: string; message: string }> = {
  COURSE: { code: "course_archived", message: "The course is archived. Restore it first; nothing was changed." },
  MODULE: { code: "module_archived", message: "The module is archived. Restore it first; nothing was changed." },
  SECTION: { code: "section_archived", message: "The section is archived. Restore it first; nothing was changed." },
};

/** Feilen et arkivert element gir. Også for den som har lest raden selv. */
export function archivedError(ref: ArchivableRef): DomainRuleError {
  const { code, message } = ERRORS[ref.type];
  return new DomainRuleError(code, message, { id: ref.id });
}

async function readArchivedAt(reader: ArchivedAtReader, ref: ArchivableRef): Promise<Date | null | undefined> {
  const select = { archivedAt: true } as const;
  const row =
    ref.type === "COURSE"
      ? await reader.course.findUnique({ where: { id: ref.id }, select })
      : ref.type === "MODULE"
        ? await reader.module.findUnique({ where: { id: ref.id }, select })
        : await reader.courseSection.findUnique({ where: { id: ref.id }, select });
  return row ? row.archivedAt : undefined;
}

/** Vakta. Kaster `course_archived`, `module_archived` eller `section_archived` (400) når elementet er arkivert. */
export async function assertNotArchived(tx: ContentWriteTx, ref: ArchivableRef): Promise<void> {
  if (await readArchivedAt(tx, ref)) throw archivedError(ref);
}

/** Forhåndssjekken før noe dyrt (se toppen av fila). Ikke svaret som gjelder. */
export async function assertNotArchivedBeforeLock(ref: ArchivableRef): Promise<void> {
  if (await readArchivedAt(prisma, ref)) throw archivedError(ref);
}

/**
 * Forhåndssjekken for «slett krever arkivert», for en rute som svarer med noe annet før slettingen (modulruta sjekker «ligger i et
 * kurs» før låsen). Finnes ikke raden, sier den ingenting. Svaret som gjelder, gir slettefunksjonen etter låsen.
 */
export async function assertArchivedBeforeLock(ref: ArchivableRef): Promise<void> {
  const archivedAt = await readArchivedAt(prisma, ref);
  if (archivedAt === null) throw deleteRequiresArchivedError(ref);
}

/** «Slett krever arkivert» (G4, #1151). Klasser har sin egen (`class_not_archived`). */
export function deleteRequiresArchivedError(ref: ArchivableRef): DomainRuleError {
  return new DomainRuleError(
    "delete_requires_archived",
    "Only archived content can be deleted. Archive it first; nothing was deleted.",
    { itemType: ref.type, id: ref.id },
  );
}
