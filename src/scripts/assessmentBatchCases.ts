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
  /** LLM assessor system prompt. If omitted, DEFAULT_SYSTEM_PROMPT is used. */
  promptTemplateSystem?: string;
  /** LLM assessor user prompt template appended as "Prompt template context:". */
  promptTemplateUserTemplate?: string;
};

// Module: "Ny_Bourdieu: habitus, felt og kapital" (cmn45hjjc000kmbfg7kw3iqo5)
// Version: cmn45hotw000ymbfglgq2xmjb (v1)
const MODULE_SYSTEM_PROMPT =
  "Vurder svaret for nøyaktighet, begrepsskille og analytisk dybde. Belønn presis forklaring av habitus, felt, kapital, doxa og symbolsk vold.";
const MODULE_USER_PROMPT_TEMPLATE = "Forklar begrepene direkte, sammenlign dem nøye og bruk termene konsekvent.";
const MODULE_TASK_TEXT =
  "Forklar og sammenlign fem begreper knyttet til Pierre Bourdieu: habitus, felt, doxa, kapital og symbolsk vold. I svaret ditt skal du definere habitus som et varig system av tilegnede disposisjoner som former persepsjon, tenkning og handling på en praktisk og ofte før-refleksiv måte; definere et felt som en sosial arena der aktører har posisjoner og kjemper om verdsatte ressurser under bestemte regler; definere doxa som dype, lærte, tatt-for-gitte forestillinger og verdier innenfor et felt; forklare kapital som ressurser som former sosial posisjon, inkludert kulturell kapital, sosial kapital og symbolsk kapital; og forklare symbolsk vold som påtvinging av kategorier for tenkning og persepsjon som får dominerte aktører til å akseptere en ulik orden som naturlig eller legitim. Sammenlign hvordan habitus og felt henger sammen, og tolk hvorfor smaksdommer kan fungere som handlinger av sosial posisjonering.";
const MODULE_GUIDANCE_TEXT =
  "Et sterkt svar definerer hvert begrep tydelig og holder skillene presise. Det forklarer at habitus består av tilegnede disposisjoner, at et felt er en strukturert arena av posisjoner og kamper, og at doxa viser til forestillinger som behandles som selvinnlysende innenfor et felt. Det skiller mellom kulturell kapital, sosial kapital og symbolsk kapital uten å slå dem sammen. Det forklarer også at symbolsk vold virker når påtvungne klassifikasjoner aksepteres som legitime, og det knytter smaksdommer til sosial posisjonering i stedet for å behandle smak som rent individuell preferanse. De sterkeste svarene viser hvordan habitus, felt og kapital virker sammen i reproduksjonen av sosial orden.";

export const assessmentBatchCases: AssessmentBatchCase[] = [
  {
    // Submission cmn45n2t40012mbfgjlfsjk0a — totalScore 91.43, automatic PASS
    id: "new_bourdieu_nb_strong",
    description:
      "Sterk nb-besvarelse om Bourdieu (totalScore 91.43 i staging). Detaljert definisjon av habitus, felt, doxa, kapital og symbolsk vold med konkret anvendelse på utdanningssystemet.",
    expectedOutcome: "PASS",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "cmn45hjjc000kmbfg7kw3iqo5",
    responseLocale: "nb",
    moduleTaskText: MODULE_TASK_TEXT,
    moduleGuidanceText: MODULE_GUIDANCE_TEXT,
    promptTemplateSystem: MODULE_SYSTEM_PROMPT,
    promptTemplateUserTemplate: MODULE_USER_PROMPT_TEMPLATE,
    responseJson: {
      response:
        "Habitus er hos Bourdieu et varig system av tilegnede disposisjoner som former hvordan mennesker oppfatter, tenker og handler på en praktisk og ofte før-refleksiv måte, mens et felt er en strukturert sosial arena der aktører inntar posisjoner og kjemper om verdsatte ressurser etter bestemte regler.\nDoxa viser til de dype, lærte og tatt-for-gitte forestillingene som innenfor et felt framstår som selvinnlysende, og nettopp derfor sjelden blir utfordret av dem som deltar i det.\nKapital betegner ressursene som gir sosial posisjon og makt, der kulturell kapital handler om kunnskaper, dannelse og kompetanser, sosial kapital om nettverk og relasjoner, og symbolsk kapital om anerkjennelse, prestisje og legitimitet.\nSymbolsk vold oppstår når dominerende kategorier for tenkning og persepsjon blir påtvunget slik at de dominerte selv oppfatter en ulik sosial orden som naturlig, rimelig eller legitim, som om verden bare tilfeldigvis var rigget for de samme menneskene hver gang.\nHabitus og felt henger sammen ved at habitus formes gjennom erfaringer i bestemte felt og samtidig gjør aktører i stand til å orientere seg i dem, og derfor fungerer smaksdommer ikke bare som personlige preferanser, men som handlinger av sosial posisjonering som markerer forskjeller og bidrar til å reprodusere sosial orden.",
      reflection:
        "Svaret mitt kan knyttes konkret til utdanningssystemet, der elevers språk, smak, væremåte og kulturelle referanser ofte blir vurdert som tegn på evner, selv om de også speiler sosial bakgrunn. I en norsk skolekontekst kan for eksempel elever fra hjem med mye boklig kultur lettere framstå som «flinke» fordi habitus deres passer bedre med skolens felt og dets doxa om hva som teller som riktig kunnskap og riktig måte å uttrykke seg på. Da ser vi også hvordan kulturell kapital kan omsettes til symbolsk kapital i form av anerkjennelse, mens symbolsk vold oppstår når denne ulikheten framstår som naturlig og fortjent heller enn sosialt produsert. Dermed blir poenget i svaret mitt mer konkret: smaksdommer og vurderinger virker ikke bare beskrivende, men bidrar aktivt til sosial posisjonering og reproduksjon av forskjeller i den faktiske verden, fordi mennesker tydeligvis elsker å late som om privilegier er personlige kvaliteter.",
      promptExcerpt:
        "Habitus, felt, doxa, kapital, kulturell kapital, sosial kapital, symbolsk kapital, symbolsk vold, sosial posisjonering, sosial reproduksjon.",
    },
  },
  {
    // Submission cmn45toe2001gmbfgkxzapxga — totalScore 80.29, automatic PASS
    id: "new_bourdieu_nb_decent",
    description:
      "Middels sterk nb-besvarelse om Bourdieu (totalScore 80.29 i staging). Korrekt om hoveddelen, men forklarer ikke begrepene veldig grundig og mangler presis skille mellom kapitalformer.",
    expectedOutcome: "PASS",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "cmn45hjjc000kmbfg7kw3iqo5",
    responseLocale: "nb",
    moduleTaskText: MODULE_TASK_TEXT,
    moduleGuidanceText: MODULE_GUIDANCE_TEXT,
    promptTemplateSystem: MODULE_SYSTEM_PROMPT,
    promptTemplateUserTemplate: MODULE_USER_PROMPT_TEMPLATE,
    responseJson: {
      response:
        "Habitus er måten mennesker tenker og handler på ut fra erfaringene sine, mens felt er et område i samfunnet der folk prøver å få makt og anerkjennelse. Doxa er det som blir sett på som normalt og selvfølgelig i et felt. Kapital er ressurser som gir fordeler, for eksempel kunnskap, nettverk og status, og symbolsk vold er når slike forskjeller blir godtatt som naturlige. Habitus og felt henger sammen fordi mennesker formes av omgivelsene sine, og smaksdommer kan vise hvilken sosial gruppe noen hører til.",
      reflection:
        "Svaret mitt får fram hovedideen i Bourdieus teori, men det er ganske enkelt og forklarer ikke begrepene veldig grundig. For eksempel sier det noe riktig om smak og sosial plass, men uten å gå så mye inn i hvordan dette faktisk virker i praksis. Det kunne også vært tydeligere forskjell mellom de ulike typene kapital. Derfor fungerer svaret greit som en oversikt, men ikke som en veldig sterk faglig forklaring.",
      promptExcerpt:
        "Habitus, felt, doxa, kapital, kulturell kapital, sosial kapital, symbolsk kapital, symbolsk vold, smak, sosial forskjell.",
    },
  },
  {
    // Submission cmn45xsb2001umbfgqmc54f3d — totalScore 65, routed to manual review
    id: "new_bourdieu_nb_weak",
    description:
      "Svak nb-besvarelse om Bourdieu (totalScore 65 i staging, rutet til manuell gjennomgang). Overflatisk — nevner begrepene men forklarer dem ikke nøye.",
    expectedOutcome: "UNDER_REVIEW",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "cmn45hjjc000kmbfg7kw3iqo5",
    responseLocale: "nb",
    moduleTaskText: MODULE_TASK_TEXT,
    moduleGuidanceText: MODULE_GUIDANCE_TEXT,
    promptTemplateSystem: MODULE_SYSTEM_PROMPT,
    promptTemplateUserTemplate: MODULE_USER_PROMPT_TEMPLATE,
    responseJson: {
      response:
        "Habitus er hvordan folk blir preget av oppvekst og miljø, og felt er ulike deler av samfunnet der folk møter hverandre. Doxa er det man tar for gitt, og kapital er ting som gjør at noen får fordeler. Symbolsk vold betyr at ulikheter kan virke normale selv om de ikke er det. Habitus og felt henger sammen fordi folk formes av samfunnet, og smak kan vise sosial plass.",
      reflection:
        "Svaret mitt sier noe om de viktigste begrepene, men det er ganske overflatisk. Jeg forklarer ikke så nøye forskjellen mellom begrepene, og det blir litt enkelt. Det gjør at svaret virker mer som en kort oppsummering enn en faglig drøfting. Derfor er det ikke et veldig sterkt svar.",
      promptExcerpt: "Habitus, felt, doxa, kapital, symbolsk vold, smak, sosial plass.",
    },
  },
];
