// #1150 skive 2a-1: skjemaene for et kurs' felt og elementliste, flyttet hit fra routes/adminCourses.ts uendret.
//
// Hvorfor de ikke står i ruta lenger: utkastet til et kurs (#1140) lagrer kroppen fra kursskjemaet som tekst, og «brukes dette
// elementet andre steder?» (contentLifecycle.ts) må lese elementlista i den teksten. Den lesingen bor i courseDraft.ts, som eier
// tabellen. For at ruta og regelen skal lese teksten på ÉN måte, bygger courseDraft.ts skjemaet for utkastet av disse to, og ruta
// bruker de samme. Ingen andre regler er endret.
import { z } from "zod";
import { localizedTextPatchSchema } from "../adminContent/adminContentSchemas.js";

/** Kursets felt, som kursskjemaet sender dem. */
export const courseBodySchema = z.object({
  title: localizedTextPatchSchema,
  description: localizedTextPatchSchema.optional(),
  certificationLevel: localizedTextPatchSchema.optional(),
  // #645/#496: course visibility — OPEN (everyone) or RESTRICTED (only enrolled / class-assigned).
  enrollmentPolicy: z.enum(["OPEN", "RESTRICTED"]).optional(),
  // #495/T-QA-4: kurs-master av/på for diskusjon (default true i datamodellen).
  discussionsEnabled: z.boolean().optional(),
  // 2.119.0: e-post til kursets eiere om nye spørsmål i diskusjonen (default true i datamodellen).
  discussionOwnerNotifications: z.boolean().optional(),
  // #1093: plassering i «Mine kurs». null = alfabetisk (det vanlige).
  sortOrder: z.number().int().min(0).max(9999).nullable().optional(),
  // 2.102.0: kursets tema i «Mine kurs». Satt = nøyaktig disse; utelatt = urørt.
  themeIds: z.array(z.string().min(1)).max(100).optional(),
});

/** Kursets elementliste: moduler og seksjoner om hverandre, i rekkefølge (#486/B2). */
export const courseItemListSchema = z.array(
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("MODULE"), moduleId: z.string().min(1), discussionsEnabled: z.boolean().optional() }),
    z.object({ type: z.literal("SECTION"), sectionId: z.string().min(1), discussionsEnabled: z.boolean().optional() }),
  ]),
);
