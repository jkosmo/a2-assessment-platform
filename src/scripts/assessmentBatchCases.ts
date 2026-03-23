export type BatchExpectedOutcome = "PASS" | "FAIL" | "UNDER_REVIEW";

export type AssessmentBatchCase = {
  id: string;
  description: string;
  expectedOutcome: BatchExpectedOutcome;
  mcqScaledScore: number;
  mcqPercentScore: number;
  moduleId: string;
  responseLocale: "en-GB" | "nb" | "nn";
  responseJson: Record<string, unknown>;
  moduleTaskText: string;
  moduleGuidanceText: string;
  /** Module-specific rubric criterion IDs. If omitted, DEFAULT_CRITERIA_IDS are used. */
  rubricCriteriaIds?: string[];
};

export const assessmentBatchCases: AssessmentBatchCase[] = [
  {
    id: "red_insufficient_content",
    responseLocale: "en-GB",
    description: "Minimal, clearly incomplete submission should fail automatically.",
    expectedOutcome: "FAIL",
    mcqScaledScore: 0,
    mcqPercentScore: 0,
    moduleId: "seed_module_genai_foundations",
    responseJson: {
      response: "Hepp Hepp Hepp som det. Hvorfor er alt rødt nå",
    },
    moduleTaskText: "Complete the assignment and submit your response.",
    moduleGuidanceText: "Include concrete examples and reasoning that support your answer.",
  },
  {
    id: "yellow_sensitive_data",
    responseLocale: "en-GB",
    description: "Sensitive-data handling case should go to manual review.",
    expectedOutcome: "UNDER_REVIEW",
    mcqScaledScore: 18,
    mcqPercentScore: 60,
    moduleId: "seed_module_genai_foundations",
    responseJson: {
      response:
        "I copied a customer list containing full names, email addresses, and personal identification numbers into a shared public document to prepare a summary for a project handoff. I then distributed the output to the full project team without masking any identifiable details or obtaining approval for the data handling.",
    },
    moduleTaskText: "Complete the assignment and submit your response.",
    moduleGuidanceText:
      "Responsible-use and data-handling concerns should be surfaced clearly when content includes sensitive or non-compliant handling.",
  },
  {
    id: "green_clear_pass",
    responseLocale: "en-GB",
    description: "Substantive, well-structured submission should pass.",
    expectedOutcome: "PASS",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "seed_module_genai_foundations",
    responseJson: {
      response:
        "I completed the task by first reviewing the brief and identifying the core objective, then structured my approach into three stages: initial draft, quality review, and final output. In the first stage I produced a draft addressing each required element. In the second stage I compared the draft against the original requirements, corrected two factual gaps, and tightened the action items. In the third stage I confirmed the output met the acceptance criteria and removed content that was not grounded in the source material. The final result was a clear, evidence-based response that directly addressed the task with concrete examples and a documented review step.",
    },
    moduleTaskText: "Complete the assignment and submit your response.",
    moduleGuidanceText: "Include concrete examples and reasoning that support your answer.",
  },
  {
    id: "bourdieu_nb_pass",
    description: "Real nb Bourdieu submission that received automatic PASS in staging (totalScore 91.43). Strong analytical response with habitus, capital, field and distinction correctly applied.",
    expectedOutcome: "PASS",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "cmn0qyxjp0000pcfhx0tim603",
    responseLocale: "nb",
    rubricCriteriaIds: ["conceptAccuracy", "applicationToScenario", "reflectionOnPower"],
    responseJson: {
      response:
        "Hos Bourdieu avgjøres plassering i det sosiale rommet av hvor mye og hvilken type kapital en person har, særlig økonomisk, kulturell, sosial og symbolsk kapital. Hvilken kapital som teller mest, bestemmes av feltet, altså den sosiale arenaen der aktørene konkurrerer etter feltets egne regler og verdier. Habitus gjør at mennesker handler, vurderer og orienterer seg på måter som passer deres bakgrunn, mens distinksjon brukes til å markere smak og status forskjellig fra andre. Slik kan privilegier reproduseres, fordi de som allerede behersker kodene i feltet lettere får anerkjennelse og omsetter kapitalen sin til nye fordeler.",
      reflection:
        "Makt og ulikhet reproduseres fordi det som framstår som «naturlig» talent, god smak eller riktige valg, ofte egentlig bygger på kapital og vaner man har fått gjennom oppvekst og miljø. Når feltet gir høy verdi til bestemte former for språk, utdanning, nettverk eller væremåter, blir fordelene til de privilegerte også oppfattet som legitime i stedet for som sosialt skapte. Dermed skjules makten bak forestillinger om kvalitet og fortjeneste, og forskjeller videreføres uten at de alltid oppleves som urettferdige. Hos Bourdieu er dette nettopp poenget: dominans virker sterkest når den blir anerkjent som legitim.",
      promptExcerpt:
        "Bourdieu, Pierre. 1984. Distinction: A Social Critique of the Judgement of Taste. Cambridge, MA: Harvard University Press.\n\nBourdieu, Pierre. 1986. «The Forms of Capital». I Handbook of Theory and Research for the Sociology of Education, redigert av John G. Richardson, 241-258. New York: Greenwood.",
    },
    moduleTaskText:
      "Les scenarioet og skriv en kort analyse med minst tre av Bourdieus begreper. Forklar hvordan former for kapital påvirker plassering i det sosiale rommet, hvordan det relevante feltet setter reglene, og hvordan habitus eller distinksjon kan bidra til å reprodusere fordel.",
    moduleGuidanceText:
      "Et godt svar definerer begrepene riktig, knytter dem til konkrete detaljer i scenarioet og viser hvordan skjult makt eller legitimitet virker. Sterke svar er klare, selektive og analytiske heller enn beskrivende.",
  },
  {
    id: "bourdieu_nb_borderline_fail",
    description: "Real nb Bourdieu submission that narrowly failed on practical score (totalScore 79.43, perfect MCQ). Written content is correct but too general and lacks concrete application. Run with --cases=bourdieu_nb_borderline_fail.",
    expectedOutcome: "FAIL",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "cmn0qyxjp0000pcfhx0tim603",
    responseLocale: "nb",
    rubricCriteriaIds: ["conceptAccuracy", "applicationToScenario", "reflectionOnPower"],
    responseJson: {
      response:
        "Bourdieu mener at plasseringen i samfunnet henger sammen med hvilken kapital en person har. Det kan være økonomisk kapital, kulturell kapital eller sosial kapital. Feltet setter reglene for hva som gir status, så det varierer fra område til område. Habitus og distinksjon kan bidra til at folk holder seg innenfor bestemte mønstre og at forskjeller mellom grupper fortsetter.",
      reflection:
        "Ulikhet reproduseres når samfunnet godtar noen egenskaper og vaner som mer riktige enn andre. Da får personer fra sterkere grupper lettere makt og anerkjennelse. Samtidig kan dette virke legitimt fordi det framstår som normalt. På den måten blir maktforhold videreført.",
      promptExcerpt:
        "Bourdieu, Pierre. 1984. Distinction.\nBourdieu, Pierre. 1986. \"The Forms of Capital\".",
    },
    moduleTaskText:
      "Les scenarioet og skriv en kort analyse med minst tre av Bourdieus begreper. Forklar hvordan former for kapital påvirker plassering i det sosiale rommet, hvordan det relevante feltet setter reglene, og hvordan habitus eller distinksjon kan bidra til å reprodusere fordel.",
    moduleGuidanceText:
      "Et godt svar definerer begrepene riktig, knytter dem til konkrete detaljer i scenarioet og viser hvordan skjult makt eller legitimitet virker. Sterke svar er klare, selektive og analytiske heller enn beskrivende.",
  },
  {
    id: "snasa_nb_pass",
    description: "Real nb submission about Snåsa that received automatic PASS in staging (totalScore 89.71).",
    expectedOutcome: "PASS",
    mcqScaledScore: 30, // TODO: verify actual MCQ score from staging
    mcqPercentScore: 100, // TODO: verify actual MCQ percent from staging
    moduleId: "cmmx9hm6n0000o0fh2xg1t5ja",
    responseLocale: "nb",
    responseJson: {
      response:
        "Snåsa ligger i Trøndelag mot svenskegrensen, og mellom Steinkjer, Grong og Lierne. Snåsa er et viktig Sørsamisk kultur-senter, med bla. Samien Siltje og Sørsamisk skole. Sørsamisk språk er et truet språk med få som kan det. Snåsa har mye fjell, og ligger også langs et stort og langt vann Snåsavannet.",
    },
    moduleTaskText:
      "Read the source text about Snåsa and write a short factual summary for a general audience. Include where Snåsa is, one notable cultural or linguistic feature, and one geographic or natural characteristic.",
    moduleGuidanceText:
      "A good submission is accurate, concise, and based only on the source text. It should mention Snåsa's location in Trøndelag, its significance for the South Sami language, and at least one relevant fact about nature, geography, or local identity.",
  },
];
