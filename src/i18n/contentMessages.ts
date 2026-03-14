import type { SupportedLocale } from "./locale.js";

type ContentLocaleMap = Record<Exclude<SupportedLocale, "en-GB">, Record<string, string>>;

export const contentMessages: ContentLocaleMap = {
  nb: {
    "Generative AI Foundations": "Grunnleggende generativ KI",
    "M0 seeded module for development and integration testing.":
      "M0 seedet modul for utvikling og integrasjonstesting.",
    "Submit a practical reflection and complete the MCQ.":
      "Lever en praktisk refleksjon og fullfør flervalgsoppgavene.",
    "Include iteration and quality assurance notes.":
      "Ta med notater om iterasjon og kvalitetssikring.",
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
    "AI Governance and Risk Essentials": "Grunnleggende KI-styring og risiko",
    "Second seeded module for multi-module flow testing and UX verification.":
      "Andre seedede modul for testing av fler-modulflyt og UX-verifisering.",
    "Assess governance risks and document a practical mitigation approach.":
      "Vurder styringsrisiko og dokumenter en praktisk tilnærming til risikoreduserende tiltak.",
    "Describe concrete controls, owners, and follow-up actions.":
      "Beskriv konkrete kontroller, ansvarlige og oppfølgingsaktiviteter.",
    "Which control best supports traceability in AI assessments?":
      "Hvilken kontroll støtter best sporbarhet i KI-vurderinger?",
    "Versioned decisions and audit trail": "Versjonerte beslutninger og revisjonsspor",
    "Ad hoc reviewer notes without timestamps": "Ad hoc-vurderernotater uten tidsstempler",
    "Manual score updates without logs": "Manuelle poengoppdateringer uten logger",
    "Deleting historical submissions after scoring": "Sletting av historiske innleveringer etter vurdering",
    "What is the preferred response when model confidence is low?":
      "Hva er foretrukket respons når modellkonfidensen er lav?",
    "Route to manual review by policy": "Send til manuell vurdering etter policy",
    "Auto-pass to avoid queue growth": "Automatisk bestått for å unngå køvekst",
    "Ignore confidence and use total score only": "Ignorer konfidens og bruk bare totalscore",
    "Hide confidence signal from administrators": "Skjul konfidenssignal fra administratorer",
  },
  nn: {
    "Generative AI Foundations": "Grunnleggjande generativ KI",
    "M0 seeded module for development and integration testing.":
      "M0-seeda modul for utvikling og integrasjonstesting.",
    "Submit a practical reflection and complete the MCQ.":
      "Lever ei praktisk refleksjon og fullfør fleirvalsoppgåvene.",
    "Include iteration and quality assurance notes.":
      "Ta med notat om iterasjon og kvalitetssikring.",
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
    "AI Governance and Risk Essentials": "Grunnleggjande KI-styring og risiko",
    "Second seeded module for multi-module flow testing and UX verification.":
      "Andre seeda modul for testing av fleir-modulflyt og UX-verifisering.",
    "Assess governance risks and document a practical mitigation approach.":
      "Vurder styringsrisiko og dokumenter ei praktisk tilnærming til risikoreduserande tiltak.",
    "Describe concrete controls, owners, and follow-up actions.":
      "Skildra konkrete kontrollar, ansvarlege og oppfølgingsaktivitetar.",
    "Which control best supports traceability in AI assessments?":
      "Kva for kontroll støttar best sporbarheit i KI-vurderingar?",
    "Versioned decisions and audit trail": "Versjonerte avgjerder og revisjonsspor",
    "Ad hoc reviewer notes without timestamps": "Ad hoc-vurderarnotat utan tidsstempel",
    "Manual score updates without logs": "Manuelle poengoppdateringar utan loggar",
    "Deleting historical submissions after scoring": "Sletting av historiske innleveringar etter vurdering",
    "What is the preferred response when model confidence is low?":
      "Kva er føretrekt respons når modellkonfidensen er låg?",
    "Route to manual review by policy": "Send til manuell vurdering etter policy",
    "Auto-pass to avoid queue growth": "Automatisk bestått for å unngå køvekst",
    "Ignore confidence and use total score only": "Ignorer konfidens og bruk berre totalscore",
    "Hide confidence signal from administrators": "Skjul konfidenssignal frå administratorar",
  },
};

