import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.js";

export const rulesSchema = z.object({
  thresholds: z.object({
    totalMin: z.number().min(0).max(100),
    // Produkteierbeslutning 2026-08-28: et resultat like UNDER terskelen gaar til sensor i stedet
    // for aa strykes av maskinen. Tallet er hvor mange poeng baandet strekker seg — 10 gir 60-70
    // med dagens terskel paa 70.
    //
    // ⚠️ Funksjonen fantes fra #464, men bare per modulversjon og uten standard. Maalt paa stage:
    // 3 av 101 modulversjoner hadde et vindu satt — og de tre sto paa 0-90, altsaa «vurder alt
    // manuelt». Vakta som skulle fange grensetilfeller hadde dermed aldri vaert i drift noe sted.
    //
    // ⚠️ RELATIVT, ikke absolutt. Foerste forsoek satte «60-70» rett inn, og fem eksisterende
    // tester ble roede med en gang: en modul kan ha sin EGEN terskel (`passRules.totalMin`), og da
    // er 60-70 meningsloest — for en modul med krav 50 ligger hele vinduet over bestaatt-grensa.
    //
    // Baandet er dessuten AApent oppad: et resultat paa noeyaktig terskelen er bestaatt, ikke et
    // grensetilfelle. Uten det ble hver eneste akkurat-bestaatt sendt til sensor.
    //
    // 10 poeng er bevisst vidt: en kandidat som blir feilaktig stroeket er en dyrere feil enn en
    // som blir feilaktig bestaatt. Strammes inn hvis sensorlasten blir for hoey.
    borderlineBelowMin: z.number().min(0).max(100).optional(),
  }),
  weights: z.object({
    practicalMaxScore: z.number().min(1),
    mcqMaxScore: z.number().min(1),
  }),
  manualReview: z.object({
    redFlagSeverities: z.array(z.string().min(1)),
    redFlagCodes: z.array(z.string().min(1)).default([]),
  }),
  llmDecisionReliability: z
    .object({
      unknownRedFlagHandling: z.enum(["downgrade_to_unclassified", "keep_as_is"]).default("downgrade_to_unclassified"),
      unknownRedFlagCanonicalCode: z.string().min(1).default("unclassified_model_warning"),
      redFlagDescriptions: z
        .record(z.string().min(1), z.string().min(1))
        .optional()
        .default({}),
      // #1023: samme mekanisme, for de to feltene som bærer USIKKERHET.
      //
      // ⚠️ Målt 2026-09-05: `manual_review_reason_code = low_confidence` forekom 0 av 48 ekte
      // vurderinger, og `evidence_sufficiency = uncertain` 0 av 48. Begge sto i kontrakten som en
      // ren liste over tillatte verdier, uten ett ord om NÅR de gjelder — mens `red_flags` rett over
      // fikk kriterier per kode. Modellen fikk aldri vite hva den skulle se etter.
      manualReviewReasonDescriptions: z
        .record(z.string().min(1), z.string().min(1))
        .optional()
        .default({}),
      evidenceSufficiencyDescriptions: z
        .record(z.string().min(1), z.string().min(1))
        .optional()
        .default({}),
      canonicalRedFlags: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
    })
    .default({
      unknownRedFlagHandling: "downgrade_to_unclassified",
      unknownRedFlagCanonicalCode: "unclassified_model_warning",
      redFlagDescriptions: {},
      manualReviewReasonDescriptions: {},
      evidenceSufficiencyDescriptions: {},
      canonicalRedFlags: {},
    }),
  mcqQuality: z
    .object({
      minAttemptCount: z.number().int().positive().default(5),
      difficultyMin: z.number().min(0).max(1).default(0.2),
      difficultyMax: z.number().min(0).max(1).default(0.9),
      difficultyMaxByLevel: z.record(z.string(), z.number().min(0).max(1)).default({}),
      discriminationMin: z.number().min(-1).max(1).default(0.1),
      distractorPickRateMin: z.number().min(0).max(1).default(0.05),
    })
    .default({
      minAttemptCount: 5,
      difficultyMin: 0.2,
      difficultyMax: 0.9,
      difficultyMaxByLevel: {},
      discriminationMin: 0.1,
      distractorPickRateMin: 0.05,
    }),
  sensitiveData: z
    .object({
      enabledByDefault: z.boolean().default(false),
      moduleOverrides: z.record(z.string(), z.boolean()).default({}),
      rules: z
        .array(
          z.object({
            id: z.string().min(1),
            pattern: z.string().min(1),
            flags: z.string().optional(),
            replacement: z.string().min(1),
          }),
        )
        .default([]),
    })
    .default({
      enabledByDefault: false,
      moduleOverrides: {},
      rules: [],
    }),
  secondaryAssessment: z
    .object({
      enabledByDefault: z.boolean().default(true),
      moduleOverrides: z.record(z.string(), z.boolean()).default({}),
      triggerRules: z
        .object({
          manualReviewRecommended: z.boolean().default(true),
          confidenceNotePatterns: z.array(z.string().min(1)).default(["medium confidence", "low confidence"]),
          redFlagCodes: z.array(z.string().min(1)).default([]),
          redFlagSeverities: z.array(z.string().min(1)).default(["medium", "high"]),
        })
        .default({
          manualReviewRecommended: true,
          confidenceNotePatterns: ["medium confidence", "low confidence"],
          redFlagCodes: [],
          redFlagSeverities: ["medium", "high"],
        }),
      disagreementRules: z
        .object({
          practicalScoreDeltaMin: z.number().min(0).default(8),
          rubricTotalDeltaMin: z.number().min(0).default(3),
          manualReviewRecommendationMismatch: z.boolean().default(true),
        })
        .default({
          practicalScoreDeltaMin: 8,
          rubricTotalDeltaMin: 3,
          manualReviewRecommendationMismatch: true,
        }),
    })
    .default({
      enabledByDefault: true,
      moduleOverrides: {},
      triggerRules: {
        manualReviewRecommended: true,
        confidenceNotePatterns: ["medium confidence", "low confidence"],
        redFlagCodes: [],
        redFlagSeverities: ["medium", "high"],
      },
      disagreementRules: {
        practicalScoreDeltaMin: 8,
        rubricTotalDeltaMin: 3,
        manualReviewRecommendationMismatch: true,
      },
    }),
  // #989: `recertification` (validityDays/dueOffsetDays/dueSoonDays/reminderDaysBefore) er fjernet —
  // moduler utløper ikke lenger. Skjemaet stripper ukjente nøkler, så en gammel `recertification`-
  // blokk i en utrullet config-fil er harmløs.
  // #497: kurs-frist-påminnelser. `reminderDaysBefore` = offsets (dager før dueAt) for
  // "frist nærmer seg"-påminnelser; standard 7 og 1 dag før forfall.
  courseReminders: z
    .object({
      reminderDaysBefore: z.array(z.number().int().min(0)).default([7, 1]),
    })
    .default({
      reminderDaysBefore: [7, 1],
    }),
  // #475: AI-influence flagging. A REVIEW TRIGGER, never a verdict/penalty — a strong AI-use
  // declaration routes to UNDER_REVIEW, never to FAIL. `enabled` gates the whole feature (client
  // declaration UI + server routing); default OFF so it ships dormant. `shadowMode` collects the
  // declaration without routing anyone (Phase 1a) — default true so even when enabled it measures
  // first. Per-module override lives in ModuleAssessmentPolicy.aiInfluence.
  aiInfluence: z
    .object({
      enabled: z.boolean().default(false),
      shadowMode: z.boolean().default(true),
      // #475 Phase 2: content-similarity signal — post-submission, generate a model answer to the task
      // and measure similarity to the student's answer. ONE additional review signal, never a verdict.
      // Coarse (lexical) by design; ships OFF + shadow so it collects pilot data before it can route.
      contentSimilarity: z
        .object({
          enabled: z.boolean().default(false),
          shadowMode: z.boolean().default(true),
          similarityThreshold: z.number().min(0).max(1).default(0.82),
        })
        .default({
          enabled: false,
          shadowMode: true,
          similarityThreshold: 0.82,
        }),
    })
    .default({
      enabled: false,
      shadowMode: true,
      contentSimilarity: {
        enabled: false,
        shadowMode: true,
        similarityThreshold: 0.82,
      },
    }),
});

export type AssessmentRules = z.infer<typeof rulesSchema>;

let cached: AssessmentRules | null = null;

export function getAssessmentRules(): AssessmentRules {
  if (cached) {
    return cached;
  }

  const rulesPath = path.resolve(process.cwd(), env.ASSESSMENT_RULES_FILE);
  const raw = fs.readFileSync(rulesPath, "utf8");
  const parsedJson = JSON.parse(raw);
  const rules = rulesSchema.parse(parsedJson);

  // #475 Phase 2: per-environment override of the content-similarity signal (enable on staging only
  // without touching the shared file). Unset env vars leave the file value untouched.
  if (env.AI_CONTENT_SIMILARITY_ENABLED !== undefined) {
    rules.aiInfluence.contentSimilarity.enabled = env.AI_CONTENT_SIMILARITY_ENABLED === "true";
  }
  if (env.AI_CONTENT_SIMILARITY_SHADOW !== undefined) {
    rules.aiInfluence.contentSimilarity.shadowMode = env.AI_CONTENT_SIMILARITY_SHADOW === "true";
  }

  cached = rules;
  return cached;
}
