import {
  localeLabels as baseLocaleLabels,
  supportedLocales as baseSupportedLocales,
  translations as participantTranslations,
} from "./participant-translations.js";

export const supportedLocales = baseSupportedLocales;
export const localeLabels = baseLocaleLabels;

const extraTranslations = {
  "en-GB": {
    "adminContentPage.title": "Content Setup Workspace",
    "adminContentPage.subtitle": "Define module content and scoring rules in a guided sequence.",
    "adminContentPage.versionLabel": "Version:",
    "adminContent.module.title": "1) Create module shell",
    "adminContent.module.name": "Module name shown to participants",
    "adminContent.module.description": "Short module description",
    "adminContent.module.certificationLevel": "Level (for example foundation)",
    "adminContent.module.validFrom": "Available from date",
    "adminContent.module.validTo": "Available until date",
    "adminContent.module.create": "Create module",
    "adminContent.select.title": "Select module to configure",
    "adminContent.select.moduleId": "Module ID",
    "adminContent.select.loadModules": "Load modules",
    "adminContent.select.loadContent": "Load selected content",
    "adminContent.select.exportModule": "Export selected module",
    "adminContent.select.deleteModule": "Delete selected module",
    "adminContent.select.moduleDropdown": "Available modules",
    "adminContent.rubric.title": "2) Submission scoring rules",
    "adminContent.rubric.criteria": "Criteria JSON",
    "adminContent.rubric.scalingRule": "Score scaling JSON",
    "adminContent.rubric.passRule": "Pass/fail threshold JSON",
    "adminContent.rubric.create": "Save scoring rules",
    "adminContent.prompt.title": "3) LLM evaluation instruction",
    "adminContent.prompt.systemPrompt": "System instruction to evaluator",
    "adminContent.prompt.userPromptTemplate": "Evaluation task instruction",
    "adminContent.prompt.examplesJson": "Optional examples JSON array",
    "adminContent.prompt.create": "Save evaluation instruction",
    "adminContent.mcq.title": "4) Multiple-choice test",
    "adminContent.mcq.setTitle": "Test title",
    "adminContent.mcq.questionsJson": "Questions JSON array",
    "adminContent.mcq.create": "Save test",
    "adminContent.moduleVersion.title": "5) Participant-facing module version",
    "adminContent.moduleVersion.taskText": "Assignment shown to participant (submission task)",
    "adminContent.moduleVersion.guidanceText": "What we expect in the submission",
    "adminContent.moduleVersion.rubricVersionId": "Scoring rules version ID",
    "adminContent.moduleVersion.promptTemplateVersionId": "Evaluation instruction version ID",
    "adminContent.moduleVersion.mcqSetVersionId": "Test version ID",
    "adminContent.moduleVersion.create": "Create module version",
    "adminContent.moduleVersion.saveBundle": "Save setup (steps 2-5)",
    "adminContent.publish.title": "6) Publish module version",
    "adminContent.publish.moduleVersionId": "Module version ID to publish",
    "adminContent.publish.publish": "Publish version",
    "adminContent.meta.selectedModulePrefix": "Selected module",
    "adminContent.meta.noneSelected": "none",
    "adminContent.meta.loadedCountPrefix": "Loaded modules",
    "adminContent.message.moduleCreated": "Module created.",
    "adminContent.message.moduleContentLoaded": "Selected module content loaded.",
    "adminContent.message.moduleExported": "Selected module exported.",
    "adminContent.message.moduleDeleted": "Module deleted.",
    "adminContent.message.rubricCreated": "Scoring rules saved.",
    "adminContent.message.promptCreated": "Evaluation instruction saved.",
    "adminContent.message.mcqCreated": "Test saved.",
    "adminContent.message.moduleVersionCreated": "Module version created.",
    "adminContent.message.moduleVersionPublished": "Module version published.",
    "adminContent.message.bundleSaved": "Setup for steps 2-5 saved.",
    "adminContent.errors.titleRequired": "Module name is required.",
    "adminContent.errors.valueRequiredPrefix": "Value is required for",
    "adminContent.errors.moduleIdRequired": "Module ID is required.",
    "adminContent.errors.moduleVersionIdRequired": "Module version ID is required.",
    "adminContent.errors.invalidJsonPrefix": "Invalid JSON in",
    "adminContent.confirm.deleteModule": "Delete module \"{module}\"? This only works for empty modules without dependencies.",
    "adminContent.help.moduleOverview":
      "Start here. This creates the base module container before adding scoring, evaluation instruction, and test.",
    "adminContent.help.moduleName":
      "Use plain text or locale JSON: {\"en-GB\":\"...\",\"nb\":\"...\",\"nn\":\"...\"}.",
    "adminContent.help.moduleDescription":
      "Shown in module lists. Supports the same locale JSON format.",
    "adminContent.help.loadContent":
      "Loads the saved rubric, prompt, MCQ, and module version into steps 2-6.",
    "adminContent.help.deleteModule":
      "Deletes only empty modules without submissions, versions, or published content.",
    "adminContent.help.moduleValidity":
      "Leave empty for always available. Dates are interpreted as UTC midnight.",
    "adminContent.help.rubricOverview":
      "Defines how the participant submission quality is scored.",
    "adminContent.help.rubricCriteria":
      "Criterion keys should match the current evaluator contract unless code is changed.",
    "adminContent.help.rubricScalingRule":
      "Controls score scaling (for example submission weight and maximum score).",
    "adminContent.help.rubricPassRule":
      "Controls pass/fail thresholds and hard-stop rules.",
    "adminContent.help.promptOverview":
      "Instruction used by the LLM during evaluation.",
    "adminContent.help.promptSystemPrompt":
      "Global evaluator behavior and output constraints.",
    "adminContent.help.promptUserTemplate":
      "Task-specific evaluation instruction. This is often called the module evaluation prompt.",
    "adminContent.help.promptExamples":
      "Optional few-shot examples. Keep these short and stable.",
    "adminContent.help.mcqOverview":
      "Defines the participant multiple-choice test.",
    "adminContent.help.mcqTitle":
      "Shown in admin context and can be localized using locale JSON.",
    "adminContent.help.mcqQuestions":
      "Supports plain strings or locale objects per field: stem/options/correctAnswer/rationale.",
    "adminContent.help.moduleVersionOverview":
      "Binds assignment text + scoring rules + evaluation instruction + test.",
    "adminContent.help.moduleTaskText":
      "This is the assignment shown to participants before they submit.",
    "adminContent.help.moduleGuidanceText":
      "Describe what a good submission should contain. This is also sent to LLM as evaluation context.",
    "adminContent.help.moduleVersionIds":
      "IDs are auto-filled when you save steps 2-5.",
    "adminContent.help.publishOverview":
      "Publishing makes this version active for participant submissions.",
    "adminContent.defaults.criteriaJson":
      "{\"relevance_for_case\":{\"weight\":0.2},\"quality_and_utility\":{\"weight\":0.2},\"iteration_and_improvement\":{\"weight\":0.2},\"human_quality_assurance\":{\"weight\":0.2},\"responsible_use\":{\"weight\":0.2}}",
    "adminContent.defaults.scalingRuleJson": "{\"practical_weight\":70,\"max_total\":20}",
    "adminContent.defaults.passRuleJson":
      "{\"total_min\":70,\"practical_min_percent\":50,\"mcq_min_percent\":60,\"no_open_red_flags\":true}",
    "adminContent.defaults.examplesJson":
      "[{\"example\":\"Strong answer with clear QA checks and risk handling.\"}]",
    "adminContent.defaults.questionsJson":
      "[{\"stem\":{\"en-GB\":\"Who owns the final decision logic?\",\"nb\":\"Hvem eier endelig beslutningslogikk?\",\"nn\":\"Kven eig endeleg avgjerdslogikk?\"},\"options\":[{\"en-GB\":\"Backend service\",\"nb\":\"Backend-tjeneste\",\"nn\":\"Backend-teneste\"},{\"en-GB\":\"LLM service\",\"nb\":\"LLM-tjeneste\",\"nn\":\"LLM-teneste\"}],\"correctAnswer\":{\"en-GB\":\"Backend service\",\"nb\":\"Backend-tjeneste\",\"nn\":\"Backend-teneste\"},\"rationale\":{\"en-GB\":\"Backend must own final business decisions.\",\"nb\":\"Backend må eie endelige forretningsbeslutninger.\",\"nn\":\"Backend må eige endelege forretningsavgjerder.\"}}]",
    "adminContent.defaults.systemPrompt":
      "You are an assessment assistant. Return strict JSON only.",
    "adminContent.defaults.userPromptTemplate":
      "Evaluate the submission against rubric criteria and explain each criterion score.",
    "adminContent.defaults.taskText":
      "Submit a practical reflection with risk handling, QA process, and improvement loop.",
    "adminContent.defaults.guidanceText":
      "Include concrete examples, measurable checks, and responsible AI safeguards.",
  },
  nb: {
    "adminContentPage.title": "Arbeidsflate for innholdsoppsett",
    "adminContentPage.subtitle": "Definer modulinnhold og vurderingsregler i en tydelig rekkefølge.",
    "adminContentPage.versionLabel": "Versjon:",
    "adminContent.module.title": "1) Opprett modulgrunnlag",
    "adminContent.module.name": "Modulnavn vist for deltaker",
    "adminContent.module.description": "Kort modulbeskrivelse",
    "adminContent.module.certificationLevel": "Nivå (for eksempel foundation)",
    "adminContent.module.validFrom": "Tilgjengelig fra dato",
    "adminContent.module.validTo": "Tilgjengelig til dato",
    "adminContent.module.create": "Opprett modul",
    "adminContent.select.title": "Velg modul som skal konfigureres",
    "adminContent.select.moduleId": "Modul-ID",
    "adminContent.select.loadModules": "Last moduler",
    "adminContent.select.loadContent": "Last valgt innhold",
    "adminContent.select.exportModule": "Eksporter valgt modul",
    "adminContent.select.deleteModule": "Slett valgt modul",
    "adminContent.select.moduleDropdown": "Tilgjengelige moduler",
    "adminContent.rubric.title": "2) Vurderingsregler for innlevering",
    "adminContent.rubric.criteria": "Kriterier JSON",
    "adminContent.rubric.scalingRule": "Poengskalering JSON",
    "adminContent.rubric.passRule": "Bestått/ikke bestått terskler JSON",
    "adminContent.rubric.create": "Lagre vurderingsregler",
    "adminContent.prompt.title": "3) Vurderingsinstruks til LLM",
    "adminContent.prompt.systemPrompt": "Systeminstruks til vurderingsmotor",
    "adminContent.prompt.userPromptTemplate": "Vurderingsinstruks for oppgaven",
    "adminContent.prompt.examplesJson": "Valgfri eksempel-liste JSON",
    "adminContent.prompt.create": "Lagre vurderingsinstruks",
    "adminContent.mcq.title": "4) Flervalgstest",
    "adminContent.mcq.setTitle": "Testtittel",
    "adminContent.mcq.questionsJson": "Spørsmål JSON-liste",
    "adminContent.mcq.create": "Lagre test",
    "adminContent.moduleVersion.title": "5) Modulversjon vist for deltaker",
    "adminContent.moduleVersion.taskText": "Oppgave vist til deltaker (innlevering)",
    "adminContent.moduleVersion.guidanceText": "Hva vi forventer i innleveringen",
    "adminContent.moduleVersion.rubricVersionId": "ID for vurderingsregel-versjon",
    "adminContent.moduleVersion.promptTemplateVersionId": "ID for vurderingsinstruks-versjon",
    "adminContent.moduleVersion.mcqSetVersionId": "ID for testversjon",
    "adminContent.moduleVersion.create": "Opprett modulversjon",
    "adminContent.moduleVersion.saveBundle": "Lagre oppsett (steg 2-5)",
    "adminContent.publish.title": "6) Publiser modulversjon",
    "adminContent.publish.moduleVersionId": "Modulversjon-ID som skal publiseres",
    "adminContent.publish.publish": "Publiser versjon",
    "adminContent.meta.selectedModulePrefix": "Valgt modul",
    "adminContent.meta.noneSelected": "ingen",
    "adminContent.meta.loadedCountPrefix": "Lastede moduler",
    "adminContent.message.moduleCreated": "Modul opprettet.",
    "adminContent.message.moduleContentLoaded": "Valgt modulinnhold er lastet inn.",
    "adminContent.message.moduleExported": "Valgt modul er eksportert.",
    "adminContent.message.moduleDeleted": "Modul slettet.",
    "adminContent.message.rubricCreated": "Vurderingsregler lagret.",
    "adminContent.message.promptCreated": "Vurderingsinstruks lagret.",
    "adminContent.message.mcqCreated": "Test lagret.",
    "adminContent.message.moduleVersionCreated": "Modulversjon opprettet.",
    "adminContent.message.moduleVersionPublished": "Modulversjon publisert.",
    "adminContent.message.bundleSaved": "Oppsett for steg 2-5 er lagret.",
    "adminContent.errors.titleRequired": "Modulnavn er påkrevd.",
    "adminContent.errors.valueRequiredPrefix": "Verdi mangler for",
    "adminContent.errors.moduleIdRequired": "Modul-ID er påkrevd.",
    "adminContent.errors.moduleVersionIdRequired": "Modulversjon-ID er påkrevd.",
    "adminContent.errors.invalidJsonPrefix": "Ugyldig JSON i",
    "adminContent.confirm.deleteModule":
      "Slette modulen \"{module}\"? Dette virker bare for tomme moduler uten avhengigheter.",
    "adminContent.help.moduleOverview":
      "Start her. Dette oppretter modulbeholderen før du legger til regler, vurderingsinstruks og test.",
    "adminContent.help.moduleName":
      "Bruk vanlig tekst eller locale-JSON: {\"en-GB\":\"...\",\"nb\":\"...\",\"nn\":\"...\"}.",
    "adminContent.help.moduleDescription":
      "Vises i modullister. Støtter samme locale-JSON-format.",
    "adminContent.help.loadContent":
      "Laster lagret vurderingsregel, prompt, MCQ og modulversjon inn i steg 2-6.",
    "adminContent.help.deleteModule":
      "Sletter bare tomme moduler uten innleveringer, versjoner eller publisert innhold.",
    "adminContent.help.moduleValidity":
      "Tomme felter betyr alltid tilgjengelig. Dato tolkes som UTC midnatt.",
    "adminContent.help.rubricOverview":
      "Definerer hvordan kvaliteten på deltakerens innlevering poengsettes.",
    "adminContent.help.rubricCriteria":
      "Kriterienøkler bør matche dagens evaluator-kontrakt hvis kode ikke endres.",
    "adminContent.help.rubricScalingRule":
      "Styrer poengskalering (for eksempel vekt på innlevering og maks poeng).",
    "adminContent.help.rubricPassRule":
      "Styrer terskler for bestått/ikke bestått og hard-stop-regler.",
    "adminContent.help.promptOverview":
      "Instruksen som LLM bruker under vurdering.",
    "adminContent.help.promptSystemPrompt":
      "Global oppførsel for evaluator og krav til svarformat.",
    "adminContent.help.promptUserTemplate":
      "Modulspesifikk vurderingsinstruks. Dette kalles ofte modulens vurderingsprompt.",
    "adminContent.help.promptExamples":
      "Valgfrie eksempler (few-shot). Hold dem korte og stabile.",
    "adminContent.help.mcqOverview":
      "Definerer deltakerens flervalgstest.",
    "adminContent.help.mcqTitle":
      "Vises i admin-kontekst og kan lokaliseres med locale-JSON.",
    "adminContent.help.mcqQuestions":
      "Støtter vanlig tekst eller locale-objekter i stem/options/correctAnswer/rationale.",
    "adminContent.help.moduleVersionOverview":
      "Binder oppgavetekst + regelversjon + vurderingsinstruks + testversjon.",
    "adminContent.help.moduleTaskText":
      "Dette er oppgaven deltakeren ser før innlevering.",
    "adminContent.help.moduleGuidanceText":
      "Beskriv hva en god innlevering skal inneholde. Sendes også til LLM som vurderingskontekst.",
    "adminContent.help.moduleVersionIds":
      "ID-er fylles automatisk når du lagrer steg 2-5.",
    "adminContent.help.publishOverview":
      "Publisering gjør versjonen aktiv for deltakerinnleveringer.",
    "adminContent.defaults.criteriaJson":
      "{\"relevance_for_case\":{\"weight\":0.2},\"quality_and_utility\":{\"weight\":0.2},\"iteration_and_improvement\":{\"weight\":0.2},\"human_quality_assurance\":{\"weight\":0.2},\"responsible_use\":{\"weight\":0.2}}",
    "adminContent.defaults.scalingRuleJson": "{\"practical_weight\":70,\"max_total\":20}",
    "adminContent.defaults.passRuleJson":
      "{\"total_min\":70,\"practical_min_percent\":50,\"mcq_min_percent\":60,\"no_open_red_flags\":true}",
    "adminContent.defaults.examplesJson":
      "[{\"example\":\"Sterkt svar med tydelige QA-kontroller og risikohåndtering.\"}]",
    "adminContent.defaults.questionsJson":
      "[{\"stem\":{\"en-GB\":\"Who owns the final decision logic?\",\"nb\":\"Hvem eier endelig beslutningslogikk?\",\"nn\":\"Kven eig endeleg avgjerdslogikk?\"},\"options\":[{\"en-GB\":\"Backend service\",\"nb\":\"Backend-tjeneste\",\"nn\":\"Backend-teneste\"},{\"en-GB\":\"LLM service\",\"nb\":\"LLM-tjeneste\",\"nn\":\"LLM-teneste\"}],\"correctAnswer\":{\"en-GB\":\"Backend service\",\"nb\":\"Backend-tjeneste\",\"nn\":\"Backend-teneste\"},\"rationale\":{\"en-GB\":\"Backend must own final business decisions.\",\"nb\":\"Backend må eie endelige forretningsbeslutninger.\",\"nn\":\"Backend må eige endelege forretningsavgjerder.\"}}]",
    "adminContent.defaults.systemPrompt":
      "You are an assessment assistant. Return strict JSON only.",
    "adminContent.defaults.userPromptTemplate":
      "Evaluate the submission against rubric criteria and explain each criterion score.",
    "adminContent.defaults.taskText":
      "Lever en praktisk refleksjon med risikohåndtering, QA-prosess og forbedringsloop.",
    "adminContent.defaults.guidanceText":
      "Inkluder konkrete eksempler, målbare kontroller og ansvarlig AI-sikring.",
  },
  nn: {
    "adminContentPage.title": "Arbeidsflate for innhaldsoppsett",
    "adminContentPage.subtitle": "Definer modulinnhald og vurderingsreglar i ei tydeleg rekkjefølgje.",
    "adminContentPage.versionLabel": "Versjon:",
    "adminContent.module.title": "1) Opprett modulgrunnlag",
    "adminContent.module.name": "Modulnamn vist for deltakar",
    "adminContent.module.description": "Kort modulskildring",
    "adminContent.module.certificationLevel": "Nivå (til dømes foundation)",
    "adminContent.module.validFrom": "Tilgjengeleg frå dato",
    "adminContent.module.validTo": "Tilgjengeleg til dato",
    "adminContent.module.create": "Opprett modul",
    "adminContent.select.title": "Vel modul som skal konfigurerast",
    "adminContent.select.moduleId": "Modul-ID",
    "adminContent.select.loadModules": "Last modular",
    "adminContent.select.loadContent": "Last valt innhald",
    "adminContent.select.exportModule": "Eksporter vald modul",
    "adminContent.select.deleteModule": "Slett vald modul",
    "adminContent.select.moduleDropdown": "Tilgjengelege modular",
    "adminContent.rubric.title": "2) Vurderingsreglar for innlevering",
    "adminContent.rubric.criteria": "Kriterium JSON",
    "adminContent.rubric.scalingRule": "Poengskalering JSON",
    "adminContent.rubric.passRule": "Bestått/ikkje bestått tersklar JSON",
    "adminContent.rubric.create": "Lagre vurderingsreglar",
    "adminContent.prompt.title": "3) Vurderingsinstruks til LLM",
    "adminContent.prompt.systemPrompt": "Systeminstruks til vurderingsmotor",
    "adminContent.prompt.userPromptTemplate": "Vurderingsinstruks for oppgåva",
    "adminContent.prompt.examplesJson": "Valfri eksempel-liste JSON",
    "adminContent.prompt.create": "Lagre vurderingsinstruks",
    "adminContent.mcq.title": "4) Fleirvalstest",
    "adminContent.mcq.setTitle": "Testtittel",
    "adminContent.mcq.questionsJson": "Spørsmål JSON-liste",
    "adminContent.mcq.create": "Lagre test",
    "adminContent.moduleVersion.title": "5) Modulversjon vist for deltakar",
    "adminContent.moduleVersion.taskText": "Oppgåve vist til deltakar (innlevering)",
    "adminContent.moduleVersion.guidanceText": "Kva vi forventar i innleveringa",
    "adminContent.moduleVersion.rubricVersionId": "ID for vurderingsregel-versjon",
    "adminContent.moduleVersion.promptTemplateVersionId": "ID for vurderingsinstruks-versjon",
    "adminContent.moduleVersion.mcqSetVersionId": "ID for testversjon",
    "adminContent.moduleVersion.create": "Opprett modulversjon",
    "adminContent.moduleVersion.saveBundle": "Lagre oppsett (steg 2-5)",
    "adminContent.publish.title": "6) Publiser modulversjon",
    "adminContent.publish.moduleVersionId": "Modulversjon-ID som skal publiserast",
    "adminContent.publish.publish": "Publiser versjon",
    "adminContent.meta.selectedModulePrefix": "Vald modul",
    "adminContent.meta.noneSelected": "ingen",
    "adminContent.meta.loadedCountPrefix": "Lasta modular",
    "adminContent.message.moduleCreated": "Modul oppretta.",
    "adminContent.message.moduleContentLoaded": "Valt modulinnhald er lasta inn.",
    "adminContent.message.moduleExported": "Vald modul er eksportert.",
    "adminContent.message.moduleDeleted": "Modul sletta.",
    "adminContent.message.rubricCreated": "Vurderingsreglar lagra.",
    "adminContent.message.promptCreated": "Vurderingsinstruks lagra.",
    "adminContent.message.mcqCreated": "Test lagra.",
    "adminContent.message.moduleVersionCreated": "Modulversjon oppretta.",
    "adminContent.message.moduleVersionPublished": "Modulversjon publisert.",
    "adminContent.message.bundleSaved": "Oppsett for steg 2-5 er lagra.",
    "adminContent.errors.titleRequired": "Modulnamn er påkravd.",
    "adminContent.errors.valueRequiredPrefix": "Verdi manglar for",
    "adminContent.errors.moduleIdRequired": "Modul-ID er påkravd.",
    "adminContent.errors.moduleVersionIdRequired": "Modulversjon-ID er påkravd.",
    "adminContent.errors.invalidJsonPrefix": "Ugyldig JSON i",
    "adminContent.confirm.deleteModule":
      "Slette modulen \"{module}\"? Dette verkar berre for tomme modular utan avhengigheiter.",
    "adminContent.help.moduleOverview":
      "Start her. Dette opprettar modulbehaldaren før du legg til reglar, vurderingsinstruks og test.",
    "adminContent.help.moduleName":
      "Bruk vanleg tekst eller locale-JSON: {\"en-GB\":\"...\",\"nb\":\"...\",\"nn\":\"...\"}.",
    "adminContent.help.moduleDescription":
      "Blir vist i modullister. Støttar same locale-JSON-format.",
    "adminContent.help.loadContent":
      "Lastar lagra vurderingsreglar, prompt, MCQ og modulversjon inn i steg 2-6.",
    "adminContent.help.deleteModule":
      "Slettar berre tomme modular utan innleveringar, versjonar eller publisert innhald.",
    "adminContent.help.moduleValidity":
      "Tomme felt betyr alltid tilgjengeleg. Dato blir tolka som UTC midnatt.",
    "adminContent.help.rubricOverview":
      "Definerer korleis kvaliteten på deltakaren si innlevering blir poengsett.",
    "adminContent.help.rubricCriteria":
      "Kriterienøklar bør matche dagens evaluator-kontrakt om kode ikkje blir endra.",
    "adminContent.help.rubricScalingRule":
      "Styrer poengskalering (til dømes vekt på innlevering og maks poeng).",
    "adminContent.help.rubricPassRule":
      "Styrer tersklar for bestått/ikkje bestått og hard-stop-reglar.",
    "adminContent.help.promptOverview":
      "Instruksen som LLM bruker under vurdering.",
    "adminContent.help.promptSystemPrompt":
      "Global oppførsel for evaluator og krav til svarformat.",
    "adminContent.help.promptUserTemplate":
      "Modulspesifikk vurderingsinstruks. Dette blir ofte kalla modulens vurderingsprompt.",
    "adminContent.help.promptExamples":
      "Valfrie eksempel (few-shot). Hald dei korte og stabile.",
    "adminContent.help.mcqOverview":
      "Definerer deltakaren sin fleirvalstest.",
    "adminContent.help.mcqTitle":
      "Blir vist i admin-kontekst og kan lokaliserast med locale-JSON.",
    "adminContent.help.mcqQuestions":
      "Støttar vanleg tekst eller locale-objekt i stem/options/correctAnswer/rationale.",
    "adminContent.help.moduleVersionOverview":
      "Bind oppgåvetekst + regelversjon + vurderingsinstruks + testversjon.",
    "adminContent.help.moduleTaskText":
      "Dette er oppgåva deltakaren ser før innlevering.",
    "adminContent.help.moduleGuidanceText":
      "Skildra kva ei god innlevering skal innehalde. Dette blir også sendt til LLM som vurderingskontekst.",
    "adminContent.help.moduleVersionIds":
      "ID-ar blir fylt automatisk når du lagrar steg 2-5.",
    "adminContent.help.publishOverview":
      "Publisering gjer versjonen aktiv for deltakarinnleveringar.",
    "adminContent.defaults.criteriaJson":
      "{\"relevance_for_case\":{\"weight\":0.2},\"quality_and_utility\":{\"weight\":0.2},\"iteration_and_improvement\":{\"weight\":0.2},\"human_quality_assurance\":{\"weight\":0.2},\"responsible_use\":{\"weight\":0.2}}",
    "adminContent.defaults.scalingRuleJson": "{\"practical_weight\":70,\"max_total\":20}",
    "adminContent.defaults.passRuleJson":
      "{\"total_min\":70,\"practical_min_percent\":50,\"mcq_min_percent\":60,\"no_open_red_flags\":true}",
    "adminContent.defaults.examplesJson":
      "[{\"example\":\"Sterkt svar med tydelege QA-kontrollar og risikohandtering.\"}]",
    "adminContent.defaults.questionsJson":
      "[{\"stem\":{\"en-GB\":\"Who owns the final decision logic?\",\"nb\":\"Hvem eier endelig beslutningslogikk?\",\"nn\":\"Kven eig endeleg avgjerdslogikk?\"},\"options\":[{\"en-GB\":\"Backend service\",\"nb\":\"Backend-tjeneste\",\"nn\":\"Backend-teneste\"},{\"en-GB\":\"LLM service\",\"nb\":\"LLM-tjeneste\",\"nn\":\"LLM-teneste\"}],\"correctAnswer\":{\"en-GB\":\"Backend service\",\"nb\":\"Backend-tjeneste\",\"nn\":\"Backend-teneste\"},\"rationale\":{\"en-GB\":\"Backend must own final business decisions.\",\"nb\":\"Backend må eie endelige forretningsbeslutninger.\",\"nn\":\"Backend må eige endelege forretningsavgjerder.\"}}]",
    "adminContent.defaults.systemPrompt":
      "You are an assessment assistant. Return strict JSON only.",
    "adminContent.defaults.userPromptTemplate":
      "Evaluate the submission against rubric criteria and explain each criterion score.",
    "adminContent.defaults.taskText":
      "Lever ein praktisk refleksjon med risikohandtering, QA-prosess og forbetringsloop.",
    "adminContent.defaults.guidanceText":
      "Inkluder konkrete døme, målbare kontrollar og ansvarleg AI-sikring.",
  },
};

export const translations = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    {
      ...(participantTranslations[locale] ?? {}),
      ...(extraTranslations[locale] ?? {}),
    },
  ]),
);
