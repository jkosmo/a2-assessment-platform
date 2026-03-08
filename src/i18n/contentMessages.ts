import type { SupportedLocale } from "./locale.js";

type ContentLocaleMap = Record<Exclude<SupportedLocale, "en-GB">, Record<string, string>>;

export const contentMessages: ContentLocaleMap = {
  nb: {
    "Generative AI Foundations": "Grunnleggende generativ KI",
    "M0 seeded module for development and integration testing.":
      "M0 seedet modul for utvikling og integrasjonstesting.",
    "What is the recommended model ownership boundary?":
      "Hva er anbefalt ansvarsgrense for modellen?",
    "What should be configuration-first?": "Hva bør være konfigurasjonsstyrt først?",
    "Backend owns final decision": "Backend eier endelig beslutning",
    "LLM owns final decision": "LLM eier endelig beslutning",
    "Reviewer is optional for all cases": "Fagvurderer er valgfri i alle tilfeller",
    "No scoring needed": "Ingen poengsetting nødvendig",
    "Prompt versions and thresholds": "Prompt-versjoner og terskler",
    "Secrets in source code": "Hemmeligheter i kildekode",
    "Deployment keys in UI code": "Deploy-nøkler i UI-kode",
    "Hardcoded policy values": "Hardkodede policy-verdier",
  },
  nn: {
    "Generative AI Foundations": "Grunnleggjande generativ KI",
    "M0 seeded module for development and integration testing.":
      "M0-seeda modul for utvikling og integrasjonstesting.",
    "What is the recommended model ownership boundary?":
      "Kva er tilrådd ansvarsgrense for modellen?",
    "What should be configuration-first?": "Kva bør vere konfigurasjonsstyrt først?",
    "Backend owns final decision": "Backend eig endeleg avgjerd",
    "LLM owns final decision": "LLM eig endeleg avgjerd",
    "Reviewer is optional for all cases": "Fagvurderar er valfri i alle tilfelle",
    "No scoring needed": "Ingen poengsetjing nødvendig",
    "Prompt versions and thresholds": "Prompt-versjonar og tersklar",
    "Secrets in source code": "Hemmelegheiter i kjeldekode",
    "Deployment keys in UI code": "Deploy-nøklar i UI-kode",
    "Hardcoded policy values": "Hardkoda policy-verdiar",
  },
};
