const fallbackLocale = "en-GB";

function pickLocale(map, locale) {
  return map?.[locale] ?? map?.[fallbackLocale] ?? "";
}

const helpUi = {
  "en-GB": {
    openHelp: "Open help",
    dialogTitle: "Help",
    pageTab: "This page",
    overviewTab: "About the platform",
    viewTabsLabel: "Help views",
    close: "Close",
  },
  nb: {
    openHelp: "Åpne hjelp",
    dialogTitle: "Hjelp",
    pageTab: "Denne siden",
    overviewTab: "Om løsningen",
    viewTabsLabel: "Hjelpevisninger",
    close: "Lukk",
  },
  nn: {
    openHelp: "Opne hjelp",
    dialogTitle: "Hjelp",
    pageTab: "Denne sida",
    overviewTab: "Om løysinga",
    viewTabsLabel: "Hjelpevisingar",
    close: "Lukk",
  },
};

const overviewContent = {
  title: {
    "en-GB": "About the platform",
    nb: "Om løsningen",
    nn: "Om løysinga",
  },
  summary: {
    "en-GB": "The platform brings learning, assessment, follow-up, and content work into one shared flow.",
    nb: "Løsningen samler læring, vurdering, oppfølging og innholdsarbeid i ett felles løp.",
    nn: "Løysinga samlar læring, vurdering, oppfølging og innhaldsarbeid i eitt felles løp.",
  },
  sections: {
    "en-GB": [
      {
        title: "Main areas",
        items: [
          "Participant is where learners take modules, submit answers, and follow progress.",
          "Review, calibration, and results are for quality control, follow-up, and reporting.",
          "Admin Content and Platform Settings are for authors and administrators.",
        ],
      },
      {
        title: "How the roles fit together",
        items: [
          "Participants complete modules and courses.",
          "Reviewers and appeal handlers quality-check decisions when needed.",
          "Content owners maintain modules, courses, and calibration settings.",
        ],
      },
      {
        title: "Good to know",
        items: [
          "Help follows the language selected in the top bar.",
          "Some actions only appear when your role allows them.",
          "Published content is what learners see. Drafts stay inside the authoring workspaces.",
        ],
      },
    ],
    nb: [
      {
        title: "Hovedområder",
        items: [
          "Participant er stedet der deltakere gjennomfører moduler, leverer svar og følger fremdrift.",
          "Vurdering, kalibrering og resultat brukes til kvalitetssikring, oppfølging og rapportering.",
          "Admin Content og Plattforminnstillinger brukes av innholdsansvarlige, ledere og administratorer.",
        ],
      },
      {
        title: "Slik henger rollene sammen",
        items: [
          "Deltakere gjennomfører moduler og kurs.",
          "Vurderere og klagebehandlere kvalitetssikrer ved behov.",
          "Innholdsansvarlige vedlikeholder moduler, kurs og kalibrering.",
        ],
      },
      {
        title: "Greit å vite",
        items: [
          "Hjelpetekstene følger språket du velger i toppmenyen.",
          "Noen handlinger vises bare når rollen din gir tilgang.",
          "Publisert innhold er det deltakerne ser. Utkast blir i arbeidsflatene for innhold.",
        ],
      },
    ],
    nn: [
      {
        title: "Hovudområde",
        items: [
          "Participant er staden der deltakarar gjennomfører modular, leverer svar og følgjer framdrift.",
          "Vurdering, kalibrering og resultat blir brukte til kvalitetssikring, oppfølging og rapportering.",
          "Admin Content og plattforminnstillingar blir brukte av innhaldsansvarlege, leiarar og administratorar.",
        ],
      },
      {
        title: "Slik heng rollene saman",
        items: [
          "Deltakarar gjennomfører modular og kurs.",
          "Vurderarar og klagebehandlarar kvalitetssikrar ved behov.",
          "Innhaldsansvarlege held ved like modular, kurs og kalibrering.",
        ],
      },
      {
        title: "Greitt å vite",
        items: [
          "Hjelpetekstane følgjer språket du vel i toppmenyen.",
          "Nokre handlingar blir berre viste når rolla di gir tilgang.",
          "Publisert innhald er det deltakarane ser. Utkast blir verande i arbeidsflatene for innhald.",
        ],
      },
    ],
  },
};

const workspaceContent = {
  participant: {
    title: { "en-GB": "Participant", nb: "Participant", nn: "Participant" },
    summary: {
      "en-GB": "Use this page to load modules and courses, submit answers, and follow the assessment flow.",
      nb: "Bruk denne siden til å laste inn moduler og kurs, levere svar og følge vurderingsløpet.",
      nn: "Bruk denne sida til å laste inn modular og kurs, levere svar og følgje vurderingsløpet.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Load courses or modules first, then choose the module you want to work on.",
            "Create a submission before you expect MCQ or assessment actions to open.",
            "After assessment, check the result and use appeal only when you need a new review.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "For written modules, only the assignment text is shown to you. Assessment guidance stays with the evaluators.",
            "Once a submission is created, your answer is kept visible in read mode.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Last først inn kurs eller moduler, og velg deretter modulen du skal jobbe med.",
            "Opprett en innlevering før du forventer at MCQ eller vurdering skal åpne seg.",
            "Etter vurdering kan du se resultatet og bare bruke anke når du trenger ny vurdering.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "For skriftlige moduler ser du bare oppgaveteksten. Vurderingsveiledningen er skjult for deltaker.",
            "Når innleveringen er opprettet, vises svaret ditt videre i lesemodus.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Last først inn kurs eller modular, og vel deretter modulen du skal jobbe med.",
            "Opprett ei innlevering før du ventar at MCQ eller vurdering skal opne seg.",
            "Etter vurdering kan du sjå resultatet og berre bruke klage når du treng ny vurdering.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "For skriftlege modular ser du berre oppgåveteksten. Vurderingsrettleiinga er skjult for deltakar.",
            "Når innleveringa er oppretta, blir svaret ditt vidare vist i lesemodus.",
          ],
        },
      ],
    },
  },
  "participant-completed": {
    title: {
      "en-GB": "Completed modules and courses",
      nb: "Fullførte moduler og kurs",
      nn: "Fullførte modular og kurs",
    },
    summary: {
      "en-GB": "Use this page to review what you have completed, see course certificates, and submit appeals on finished results.",
      nb: "Bruk denne siden til å se hva du har fullført, finne kursbevis og sende anke på ferdige resultater.",
      nn: "Bruk denne sida til å sjå kva du har fullført, finne kursbevis og sende klage på ferdige resultat.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Load completed modules to see latest status, score, and appeal state.",
            "Use the appeal area when you need a new review of a finished result.",
            "Certificates for completed courses are listed lower on the page.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "This page is for finished items. New submissions start in Participant.",
            "The latest course certificate details are also shown in Profile.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Last inn fullførte moduler for å se siste status, skår og ankestatus.",
            "Bruk ankeområdet når du trenger ny vurdering av et ferdig resultat.",
            "Kursbevis for fullførte kurs vises lenger ned på siden.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Denne siden er for ferdige saker. Nye innleveringer starter i Participant.",
            "Siste opplysninger om kursbevis vises også i Profil.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Last inn fullførte modular for å sjå siste status, skår og klagestatus.",
            "Bruk klageområdet når du treng ny vurdering av eit ferdig resultat.",
            "Kursbevis for fullførte kurs blir viste lenger nede på sida.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Denne sida er for ferdige saker. Nye innleveringar startar i Participant.",
            "Siste opplysningar om kursbevis blir også viste i Profil.",
          ],
        },
      ],
    },
  },
  profile: {
    title: { "en-GB": "Profile", nb: "Profil", nn: "Profil" },
    summary: {
      "en-GB": "Use Profile to see account details, completed modules and courses, and privacy choices.",
      nb: "Bruk Profil til å se kontodetaljer, fullførte moduler og kurs, og personvernvalg.",
      nn: "Bruk Profil til å sjå kontodetaljar, fullførte modular og kurs, og personvernval.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Check that your account details and role information are correct.",
            "Review completed modules and courses in one place.",
            "Use the privacy actions if you need export or deletion handling.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Profile is personal. It shows your own history, not team-wide reporting.",
            "Courses completed in Participant are listed here after completion data is updated.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Kontroller at kontoinformasjon og rolleopplysninger stemmer.",
            "Se fullførte moduler og kurs samlet på ett sted.",
            "Bruk personvernhandlingene hvis du trenger eksport eller sletting.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Profil er personlig. Den viser din egen historikk, ikke rapportering for flere brukere.",
            "Kurs du fullfører i Participant blir listet her når fullføringsdata er oppdatert.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Kontroller at kontoinformasjon og rolleopplysningar stemmer.",
            "Sjå fullførte modular og kurs samla på ein stad.",
            "Bruk personvernhandlingane dersom du treng eksport eller sletting.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Profil er personleg. Ho viser di eiga historikk, ikkje rapportering for fleire brukarar.",
            "Kurs du fullfører i Participant blir lista her når fullføringsdata er oppdaterte.",
          ],
        },
      ],
    },
  },
  review: {
    title: {
      "en-GB": "Review and appeals",
      nb: "Vurdering og anker",
      nn: "Vurdering og klager",
    },
    summary: {
      "en-GB": "Use this workspace to claim manual review cases, process appeals, and record decisions with reasons.",
      nb: "Bruk denne arbeidsflaten til å overta manuelle vurderinger, behandle anker og registrere begrunnelser.",
      nn: "Bruk denne arbeidsflata til å ta over manuelle vurderingar, behandle klager og registrere grunngivingar.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Choose the manual review or appeal tab based on the case you are handling.",
            "Claim the case before you resolve or override it.",
            "Add a clear reason so the next handler can understand the decision.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Status filters help you focus on open and in-progress items.",
            "Administrators can take over claimed items when they need to intervene.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Velg fanen for manuell vurdering eller anke ut fra saken du jobber med.",
            "Overta saken før du løser eller overstyrer den.",
            "Legg inn en tydelig begrunnelse slik at neste behandler forstår beslutningen.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Statusfiltre hjelper deg å fokusere på åpne og pågående saker.",
            "Administratorer kan ta over saker som allerede er claimet når det trengs.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Vel fana for manuell vurdering eller klage ut frå saka du jobbar med.",
            "Ta over saka før du løyser eller overstyrer henne.",
            "Legg inn ei tydeleg grunngiving slik at neste behandlar forstår avgjerda.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Statusfilter hjelper deg å fokusere på opne og pågåande saker.",
            "Administratorar kan ta over saker som alt er claima når det trengst.",
          ],
        },
      ],
    },
  },
  calibration: {
    title: { "en-GB": "Calibration", nb: "Kalibrering", nn: "Kalibrering" },
    summary: {
      "en-GB": "Use calibration to inspect past outcomes, compare quality signals, and adjust pass thresholds.",
      nb: "Bruk kalibrering til å se historiske utfall, sammenligne kvalitetssignaler og justere beståttgrenser.",
      nn: "Bruk kalibrering til å sjå historiske utfall, samanlikne kvalitetssignal og justere beståttgrensar.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Filter on module, version, status, and dates before you load a snapshot.",
            "Read the quality signals before you change thresholds.",
            "Save threshold updates only when you are confident the module has enough outcome data.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Calibration affects future assessments for the selected module setup.",
            "If you need to change module content, do that in Admin Content, not here.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Filtrer på modul, versjon, status og dato før du laster et øyeblikksbilde.",
            "Les kvalitetssignalene før du endrer tersklene.",
            "Lagre bare terskelendringer når du er trygg på at modulen har nok utfallsdata.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Kalibrering påvirker framtidige vurderinger for den valgte moduloppsetningen.",
            "Hvis du må endre modulinnhold, gjør du det i Admin Content, ikke her.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Filtrer på modul, versjon, status og dato før du lastar eit augeblinksbilete.",
            "Les kvalitetssignala før du endrar tersklane.",
            "Lagre berre terskelendringar når du er trygg på at modulen har nok utfallsdata.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Kalibrering påverkar framtidige vurderingar for det valde moduloppsettet.",
            "Viss du må endre modulinnhald, gjer du det i Admin Content, ikkje her.",
          ],
        },
      ],
    },
  },
  results: {
    title: { "en-GB": "Results", nb: "Resultat", nn: "Resultat" },
    summary: {
      "en-GB": "Use Results to filter reporting data, compare module and course totals, and inspect participant-level detail.",
      nb: "Bruk Resultat til å filtrere rapportdata, sammenligne modul- og kurstall og se detaljdata på deltakernivå.",
      nn: "Bruk Resultat til å filtrere rapportdata, samanlikne modul- og kurstal og sjå detaljdata på deltakarnivå.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Set filters at the top before you load results.",
            "Use the module and course tables to compare totals, rates, and score patterns.",
            "Click a module or course row to open participant details under the table.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "The same top filters also shape the detail tables.",
            "Summary exports are separate from future participant-level CSV work.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Sett filtrene øverst før du laster resultater.",
            "Bruk modul- og kurstabellene til å sammenligne totaler, rater og skårmønstre.",
            "Klikk på en modul- eller kursrad for å åpne deltakerdetaljer under tabellen.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "De samme toppfiltrene styrer også detaljtabellene.",
            "Dagens eksport gjelder sammendrag. Deltakernivå i CSV er et eget videre arbeid.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Set filtra øvst før du lastar resultat.",
            "Bruk modul- og kurstabellane til å samanlikne totalar, ratar og skårmønster.",
            "Klikk på ei modul- eller kursrad for å opne deltakar-detaljar under tabellen.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Dei same toppfiltra styrer også detaljtabellane.",
            "Dagens eksport gjeld samandrag. Deltakarnivå i CSV er eit eige vidare arbeid.",
          ],
        },
      ],
    },
  },
  "admin-content-library": {
    title: { "en-GB": "Module library", nb: "Modulbibliotek", nn: "Modulbibliotek" },
    summary: {
      "en-GB": "Use the library to find modules, create new ones, and open the right editing mode.",
      nb: "Bruk biblioteket til å finne moduler, opprette nye og åpne riktig redigeringsmodus.",
      nn: "Bruk biblioteket til å finne modular, opprette nye og opne rett redigeringsmodus.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Search and filter the list before you open or manage a module.",
            "Create a new module from the button at the top right.",
            "Open conversation for fast content work, or advanced for full setup and rules.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Publishing controls what learners can see. Drafts and archived modules stay in admin only.",
            "Course usage can be inspected from the library when you need impact awareness.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Søk og filtrer listen før du åpner eller forvalter en modul.",
            "Opprett ny modul med knappen øverst til høyre.",
            "Åpne samtale for raskt innholdsarbeid, eller avansert for full oppsett og regler.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Publisering styrer hva deltakerne kan se. Utkast og arkiverte moduler blir bare i admin.",
            "Bruk i kurs kan inspiseres fra biblioteket når du trenger konsekvensoversikt.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Søk og filtrer lista før du opnar eller forvaltar ein modul.",
            "Opprett ny modul med knappen øvst til høgre.",
            "Opne samtale for raskt innhaldsarbeid, eller avansert for fullt oppsett og reglar.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Publisering styrer kva deltakarane kan sjå. Utkast og arkiverte modular blir berre i admin.",
            "Bruk i kurs kan sjåast frå biblioteket når du treng konsekvensoversikt.",
          ],
        },
      ],
    },
  },
  "admin-content-shell": {
    title: { "en-GB": "Conversation editing", nb: "Samtaleredigering", nn: "Samtaleredigering" },
    summary: {
      "en-GB": "Use conversation editing for quick content changes with a live preview beside the chat.",
      nb: "Bruk samtaleredigering til raske innholdsendringer med levende forhåndsvisning ved siden av chatten.",
      nn: "Bruk samtaleredigering til raske innhaldsendringar med levande førehandsvising ved sida av chatten.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Choose a module, ask for concrete content changes, and inspect the preview as you work.",
            "Use the preview language buttons to check the learner-facing text in each locale.",
            "Save or publish from the action flow when the draft looks right.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Conversation editing is best for title, assignment text, guidance, MCQ, and translation refresh.",
            "Move to advanced editing when you need deeper changes to rubric, prompt, policy, or schema.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Velg en modul, be om konkrete innholdsendringer og se på forhåndsvisningen mens du jobber.",
            "Bruk språkknappene i preview for å kontrollere deltakerteksten i hvert språk.",
            "Lagre eller publiser fra handlingsflyten når utkastet ser riktig ut.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Samtaleredigering passer best for tittel, oppgavetekst, veiledning, MCQ og oppfrisking av oversettelser.",
            "Gå til avansert redigering når du trenger dypere endringer i rubric, prompt, policy eller schema.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Vel ein modul, be om konkrete innhaldsendringar og sjå på førehandsvisinga medan du jobbar.",
            "Bruk språkknappane i preview for å kontrollere deltakarteksten i kvart språk.",
            "Lagre eller publiser frå handlingsflyten når utkastet ser riktig ut.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Samtaleredigering passar best for tittel, oppgåvetekst, rettleiing, MCQ og oppfrisking av omsetjingar.",
            "Gå til avansert redigering når du treng djupare endringar i rubric, prompt, policy eller schema.",
          ],
        },
      ],
    },
  },
  "admin-content-advanced": {
    title: {
      "en-GB": "Advanced module editing",
      nb: "Avansert modulredigering",
      nn: "Avansert modulredigering",
    },
    summary: {
      "en-GB": "Use advanced editing when you need full control of content, scoring rules, and publication settings.",
      nb: "Bruk avansert redigering når du trenger full kontroll over innhold, vurderingsregler og publiseringsinnstillinger.",
      nn: "Bruk avansert redigering når du treng full kontroll over innhald, vurderingsreglar og publiseringsinnstillingar.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Work through the editor sections to update module data, version content, and scoring setup.",
            "Use the preview toggle and language controls to check what the learner will see.",
            "Save before you publish so you keep a clean draft history.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Advanced editing is the right place for rubric, prompt, policy, and schema changes.",
            "Back to conversation when you want lighter wording work and fast iteration.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Jobb deg gjennom editorseksjonene for å oppdatere moduldata, versjonsinnhold og vurderingsoppsett.",
            "Bruk preview-toggle og språkkontroller for å kontrollere hva deltakeren vil se.",
            "Lagre før du publiserer, slik at du beholder en ryddig utkastshistorikk.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Avansert redigering er riktig sted for endringer i rubric, prompt, policy og schema.",
            "Gå tilbake til samtale når du vil ha lettere ordlydsarbeid og rask iterasjon.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Jobb deg gjennom editorseksjonane for å oppdatere moduldata, versjonsinnhald og vurderingsoppsett.",
            "Bruk preview-toggle og språkkontrollar for å kontrollere kva deltakaren vil sjå.",
            "Lagre før du publiserer, slik at du tek vare på ei ryddig utkastshistorikk.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Avansert redigering er rett stad for endringar i rubric, prompt, policy og schema.",
            "Gå tilbake til samtale når du vil ha lettare ordlydsarbeid og rask iterasjon.",
          ],
        },
      ],
    },
  },
  "admin-content-courses": {
    title: { "en-GB": "Course management", nb: "Kursforvaltning", nn: "Kursforvaltning" },
    summary: {
      "en-GB": "Use the course workspace to create courses, combine modules, and publish the finished learning path.",
      nb: "Bruk kursarbeidsflaten til å opprette kurs, sette sammen moduler og publisere læringsstien.",
      nn: "Bruk kursarbeidsflata til å opprette kurs, setje saman modular og publisere læringsstigen.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Create a course from the list view, then add modules in the order learners should take them.",
            "Use the detail view to edit title, description, level, and module set.",
            "Publish the course when it is ready. Unpublished courses do not appear in Participant.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Course content uses the current editing language, but saved changes can refresh the other locales.",
            "Modules stay in the library even if you remove them from a course.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Opprett kurs fra listevisningen, og legg deretter til moduler i den rekkefølgen deltakerne skal ta dem.",
            "Bruk detaljvisningen til å redigere tittel, beskrivelse, nivå og modulsett.",
            "Publiser kurset når det er klart. Upubliserte kurs vises ikke i Participant.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Kursinnhold bruker språket du redigerer i, men lagring kan oppfriske de andre språkene.",
            "Moduler blir i biblioteket selv om du fjerner dem fra et kurs.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Opprett kurs frå listevisinga, og legg deretter til modular i den rekkjefølgja deltakarane skal ta dei.",
            "Bruk detaljvisinga til å redigere tittel, skildring, nivå og modulsett.",
            "Publiser kurset når det er klart. Upubliserte kurs blir ikkje viste i Participant.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Kursinnhald brukar språket du redigerer i, men lagring kan oppfriske dei andre språka.",
            "Modular blir verande i biblioteket sjølv om du fjernar dei frå eit kurs.",
          ],
        },
      ],
    },
  },
  "admin-content-calibration": {
    title: {
      "en-GB": "Calibration in Admin Content",
      nb: "Kalibrering i Admin Content",
      nn: "Kalibrering i Admin Content",
    },
    summary: {
      "en-GB": "Use this page to calibrate from the content area when threshold work should stay close to modules and courses.",
      nb: "Bruk denne siden til å kalibrere fra innholdsområdet når terskelarbeidet bør ligge tett på moduler og kurs.",
      nn: "Bruk denne sida til å kalibrere frå innhaldsområdet når terskelarbeidet bør liggje tett på modular og kurs.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Pick the module and filters you want before you load the calibration snapshot.",
            "Inspect quality signals and outcome spread before you adjust the pass threshold.",
            "Use this page when you want calibration from the same admin area as modules and courses.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "This page focuses on thresholds and evidence, not module text authoring.",
            "If calibration access is hidden, your current role or environment does not allow it.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Velg modul og filtre før du laster kalibreringssnapshot.",
            "Se på kvalitetssignaler og utfallsfordeling før du justerer beståttgrensen.",
            "Bruk denne siden når du vil kalibrere fra samme adminområde som moduler og kurs.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Denne siden fokuserer på terskler og grunnlag, ikke på redigering av modultekst.",
            "Hvis kalibrering er skjult, tillater ikke rollen eller miljøet ditt tilgang akkurat nå.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Vel modul og filter før du lastar kalibreringssnapshot.",
            "Sjå på kvalitetssignal og utfallsfordeling før du justerer beståttgrensa.",
            "Bruk denne sida når du vil kalibrere frå same adminområde som modular og kurs.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Denne sida fokuserer på tersklar og grunnlag, ikkje på redigering av modultekst.",
            "Viss kalibrering er skjult, tillèt ikkje rolla eller miljøet ditt tilgang akkurat no.",
          ],
        },
      ],
    },
  },
  "admin-platform": {
    title: {
      "en-GB": "Platform settings",
      nb: "Plattforminnstillinger",
      nn: "Plattforminnstillingar",
    },
    summary: {
      "en-GB": "Use platform settings to maintain system-wide text and privacy settings.",
      nb: "Bruk plattforminnstillinger til å vedlikeholde systemtekster og personverninnstillinger.",
      nn: "Bruk plattforminnstillingar til å halde ved like systemtekstar og personverninnstillingar.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Update the platform name and DPO information when those details change.",
            "Edit consent text per language when legal or communication requirements change.",
            "Use the re-consent checkbox only when users must accept the privacy text again.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Changes here affect the whole solution, not just one workspace.",
            "Keep the language tabs aligned so users get equivalent information across locales.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "Oppdater plattformnavn og personvernombud når disse opplysningene endrer seg.",
            "Rediger samtykketekst per språk når juridiske eller kommunikative krav endrer seg.",
            "Bruk avkryssingen for nytt samtykke bare når brukerne faktisk må godta teksten på nytt.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Endringer her påvirker hele løsningen, ikke bare én arbeidsflate.",
            "Hold språkfanene på linje slik at brukerne får likeverdig informasjon på tvers av språk.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Oppdater plattformnamn og personvernombod når desse opplysningane endrar seg.",
            "Rediger samtykketekst per språk når juridiske eller kommunikative krav endrar seg.",
            "Bruk avkryssinga for nytt samtykke berre når brukarane faktisk må godta teksten på nytt.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Endringar her påverkar heile løysinga, ikkje berre éi arbeidsflate.",
            "Hald språkfanene på line slik at brukarane får likeverdig informasjon på tvers av språk.",
          ],
        },
      ],
    },
  },
};

function materializeContent(entry, locale) {
  if (!entry) return null;
  return {
    title: pickLocale(entry.title, locale),
    summary: pickLocale(entry.summary, locale),
    sections: pickLocale(entry.sections, locale),
  };
}

export function getHelpUi(locale) {
  return helpUi[locale] ?? helpUi[fallbackLocale];
}

export function getOverviewContent(locale) {
  return materializeContent(overviewContent, locale);
}

export function getWorkspaceHelpContent(contextId, locale) {
  return materializeContent(workspaceContent[contextId], locale);
}

export function getAllWorkspaceHelpContextIds() {
  return Object.keys(workspaceContent);
}
