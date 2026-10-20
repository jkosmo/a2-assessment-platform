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
    nb: "Om plattformen",
    nn: "Om plattforma",
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
          "Deltaker er stedet der deltakere gjennomfører moduler, leverer svar og følger fremdrift.",
          "Manuell behandling, kalibrering og resultater brukes til kvalitetssikring, oppfølging og rapportering.",
          "Innholdsforvaltning og plattforminnstillinger brukes av innholdsansvarlige og administratorer.",
        ],
      },
      {
        title: "Slik henger rollene sammen",
        items: [
          "Deltakere gjennomfører moduler og kurs.",
          "Vurderere og ankebehandlere kvalitetssikrer ved behov.",
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
          "Deltakar er staden der deltakarar gjennomfører modular, leverer svar og følgjer framdrift.",
          "Manuell handsaming, kalibrering og resultat blir brukte til kvalitetssikring, oppfølging og rapportering.",
          "Innhaldsforvaltning og plattforminnstillingar blir brukte av innhaldsansvarlege og administratorar.",
        ],
      },
      {
        title: "Slik heng rollene saman",
        items: [
          "Deltakarar gjennomfører modular og kurs.",
          "Vurderarar og ankebehandlarar kvalitetssikrar ved behov.",
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
    title: { "en-GB": "Participant", nb: "Deltaker", nn: "Deltakar" },
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
            "Opprett en innlevering før du forventer at flervalg eller vurdering skal åpne seg.",
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
            "Opprett ei innlevering før du ventar at flerval eller vurdering skal opne seg.",
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
            "Denne siden er for ferdige saker. Nye innleveringer starter i Deltaker.",
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
            "Denne sida er for ferdige saker. Nye innleveringar startar i Deltakar.",
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
            "Kurs du fullfører i Deltaker blir listet her når fullføringsdata er oppdatert.",
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
            "Kurs du fullfører i Deltakar blir lista her når fullføringsdata er oppdaterte.",
          ],
        },
      ],
    },
  },
  review: {
    title: {
      "en-GB": "Review and appeals",
      nb: "Manuell behandling og ankebehandling",
      nn: "Manuell handsaming og ankebehandling",
    },
    summary: {
      "en-GB": "Use this workspace to claim manual review cases, process appeals, and record decisions with reasons.",
      nb: "Bruk denne arbeidsflaten til å overta manuelle vurderinger, behandle anker og registrere begrunnelser.",
      nn: "Bruk denne arbeidsflata til å ta over manuelle vurderingar, behandle anker og registrere grunngivingar.",
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
            "Administratorer kan ta over saker som allerede er overtatt når det trengs.",
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
            "Administratorar kan ta over saker som alt er tekne over når det trengst.",
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
            "Hvis du må endre modulinnhold, gjør du det i Innholdsforvaltning, ikke her.",
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
            "Viss du må endre modulinnhald, gjer du det i Innhaldsforvaltning, ikkje her.",
          ],
        },
      ],
    },
  },
  results: {
    title: { "en-GB": "Results", nb: "Resultater", nn: "Resultat" },
    summary: {
      "en-GB": "Use Results to filter reporting data, compare module and course totals, and inspect participant-level detail.",
      nb: "Bruk Resultater til å filtrere rapportdata, sammenligne modul- og kurstall og se detaljdata på deltakernivå.",
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
    title: { "en-GB": "Module library", nb: "Innholdsforvaltning: moduler", nn: "Innhaldsforvaltning: modular" },
    summary: {
      "en-GB": "Use the library to find modules, create new ones, and open the right editing mode.",
      nb: "Bruk denne siden til å finne moduler, opprette nye og åpne riktig redigeringsmodus.",
      nn: "Bruk denne sida til å finne modular, opprette nye og opne rett redigeringsmodus.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "Search and filter the list before you open or manage a module.",
            "Create a new module from the button at the top right.",
            "Open a module to edit its content, its setup and its assessment rules in one place.",
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
            "Åpne en modul for å redigere innhold, oppsett og vurderingsregler på ett sted.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Publisering styrer hva deltakerne kan se. Utkast og arkiverte moduler vises bare i innholdsforvaltningen.",
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
            "Opne ein modul for å redigere innhald, oppsett og vurderingsreglar på éin stad.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Publisering styrer kva deltakarane kan sjå. Utkast og arkiverte modular blir berre viste i innhaldsforvaltninga.",
            "Bruk i kurs kan sjåast frå biblioteket når du treng konsekvensoversikt.",
          ],
        },
      ],
    },
  },
  "admin-content-shell": {
    title: { "en-GB": "Conversation editing", nb: "Innholdsforvaltning: samtale", nn: "Innhaldsforvaltning: samtale" },
    summary: {
      "en-GB": "Use conversation editing for quick content changes with a live preview beside the chat.",
      nb: "Bruk samtaledelen i Innholdsforvaltning til raske innholdsendringer med forhåndsvisning ved siden av samtalen.",
      nn: "Bruk samtaledelen i Innhaldsforvaltning til raske innhaldsendringar med førehandsvising ved sida av samtalen.",
    },
    sections: {
      "en-GB": [
        {
          title: "What to do here",
          items: [
            "A module opens on the Edit tab: the conversation and the content fields side by side.",
            "Choose a module, ask for concrete content changes, and inspect the preview as you work.",
            "Preview shows the same module full width, without the conversation, the way a learner meets it.",
            "Use the preview language buttons to check the learner-facing text in each locale.",
            "Save or publish from the action flow when the draft looks right.",
          ],
        },
        {
          title: "Good to know",
          items: [
            "Conversation editing is best for title, assignment text, guidance, MCQ, and translation refresh.",
            "Settings holds the module type, the pass rules, the criteria and the assessment instruction.",
          ],
        },
      ],
      nb: [
        {
          title: "Dette gjør du her",
          items: [
            "En modul åpner på fanen Rediger: samtalen og innholdsfeltene side om side.",
            "Velg en modul, be om konkrete innholdsendringer og se på forhåndsvisningen mens du jobber.",
            "Forhåndsvisning viser den samme modulen i full bredde, uten samtalen, slik deltakeren møter den.",
            "Bruk språkknappene i forhåndsvisningen for å kontrollere deltakerteksten i hvert språk.",
            "Lagre eller publiser fra handlingsflyten når utkastet ser riktig ut.",
          ],
        },
        {
          title: "Greit å vite",
          items: [
            "Samtaledelen passer best for tittel, oppgavetekst, veiledning, flervalg og oppfrisking av oversettelser.",
            "Innstillinger holder modultype, poenggrenser, kriterier og vurderingsinstruks.",
          ],
        },
      ],
      nn: [
        {
          title: "Dette gjer du her",
          items: [
            "Ein modul opnar på fana Rediger: samtalen og innhaldsfelta side om side.",
            "Vel ein modul, be om konkrete innhaldsendringar og sjå på førehandsvisinga medan du jobbar.",
            "Førehandsvising viser den same modulen i full breidd, utan samtalen, slik deltakaren møter han.",
            "Bruk språkknappane i førehandsvisinga for å kontrollere deltakarteksten i kvart språk.",
            "Lagre eller publiser frå handlingsflyten når utkastet ser riktig ut.",
          ],
        },
        {
          title: "Greitt å vite",
          items: [
            "Samtaledelen passar best for tittel, oppgåvetekst, rettleiing, flerval og oppfrisking av omsetjingar.",
            "Innstillingar held modultype, poenggrenser, kriterium og vurderingsinstruks.",
          ],
        },
      ],
    },
  },
  "admin-content-courses": {
    title: { "en-GB": "Course management", nb: "Innholdsforvaltning: kurs", nn: "Innhaldsforvaltning: kurs" },
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
            "Publiser kurset når det er klart. Upubliserte kurs vises ikke i Deltaker.",
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
            "Publiser kurset når det er klart. Upubliserte kurs blir ikkje viste i Deltakar.",
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
  "admin-content-sections": {
    title: { "en-GB": "Sections", nb: "Seksjoner", nn: "Seksjonar" },
    summary: {
      "en-GB": "Reading material you can use in several courses. Write it once, place it in any course.",
      nb: "Lesestoff du kan bruke i flere kurs. Skriv det én gang, legg det inn i de kursene som trenger det.",
      nn: "Lesestoff du kan bruke i fleire kurs. Skriv det éin gong, legg det inn i dei kursa som treng det.",
    },
    sections: {
      "en-GB": [
        { title: "What to do here", items: [
          "Open a section to write or change it. Text is written in Markdown; the preview shows what participants see.",
          "Save creates a new version. Publish when it is ready — the course shows the published version.",
          "Use Duplicate to start from an existing section, and Export/Import to move one between environments.",
        ] },
        { title: "Good to know", items: [
          "A section needs all three languages before it can be published.",
          "Archive a section you no longer use; it can be deleted from inside the archived section.",
        ] },
        { title: "Blocks in the text", items: [
          "Highlighted box: start a paragraph with > **Remember:** and the text. The labels Important, NB and Warning give the warning colour.",
          "Prompt with a copy button: a code block that starts with ```prompt on its own line and ends with ``` on its own line.",
          "Cards: :::kort on its own line, one ### heading per card with its text below, and ::: on its own line at the end.",
          "Think first: :::tenk followed by the question on the same line, the answer on the lines below, and ::: on its own line at the end. The participant sees the question and opens the answer when ready. Put it after a problem has been set out, before the text explains it; one or two per section. Never inside a card frame.",
          "Check yourself: :::sjekk followed by the question on the same line, then the options as - [ ] and the right one as - [x], an explanation, and ::: on its own line at the end. The participant picks an answer and sees at once whether it was right; it does not count. Two to four options, exactly one right.",
          "Step by step: :::steg followed by a title on the same line, one ### heading per step with its text (and a figure, if any) below, and ::: on its own line at the end. The participant pages through one step at a time with Next and Previous. Three to seven steps; each says what changes.",
          "Write it yourself: :::skriv followed by the task on the same line, the example answer below, then the checklist as - [ ] lines at the end, and ::: on its own line. The participant writes, then opens the example answer and ticks off the checklist. Nothing is sent or counted; the text stays in the participant's browser tab until it is closed. Good as a warm-up before a free-text module.",
          "Flashcards: :::repetisjon on its own line, one ### heading per card (the term) with the explanation below, and ::: on its own line at the end. The participant turns each card and marks «Knew it» or «Practise more». Four to ten terms the section explains. Not :::kort — that is cards side by side.",
          "A blank line above every frame. Frames cannot be placed inside each other. Step by step, write it yourself and flashcards work only in sections; in a module's task text they show as plain text.",
          "Icon: ![](icon:name) first in a card heading, for example ### ![](icon:lightbulb) Idea. The names are Lucide's own, in small letters (lucide.dev/icons); an unknown name shows no icon.",
          "In the other languages the markers stay as they are (:::kort, :::tenk, :::sjekk, :::steg, :::skriv, :::repetisjon, - [x], - [ ], ```prompt) and every ### heading stays; translate only the text.",
        ] },
      ],
      nb: [
        { title: "Dette gjør du her", items: [
          "Åpne en seksjon for å skrive eller endre. Teksten skrives i Markdown; forhåndsvisningen viser det deltakerne ser.",
          "Lagre lager en ny versjon. Publiser når den er klar — kurset viser den publiserte versjonen.",
          "Bruk Dupliser for å starte fra en seksjon som finnes, og Eksporter/Importer for å flytte en mellom miljøer.",
        ] },
        { title: "Greit å vite", items: [
          "En seksjon må ha alle tre språk før den kan publiseres.",
          "Arkiver en seksjon du ikke bruker lenger; den kan slettes inne på den arkiverte seksjonen.",
        ] },
        { title: "Blokker i teksten", items: [
          "Uthevet boks: start et avsnitt med > **Husk:** og teksten. Merkelappene Viktig, NB og Advarsel gir varselfarge.",
          "Prompt med kopiknapp: en kodeblokk som starter med ```prompt på egen linje og slutter med ``` på egen linje.",
          "Kort: :::kort på egen linje, én ### overskrift per kort med teksten under, og ::: på egen linje til slutt.",
          "Tenk først: :::tenk og spørsmålet på samme linje, svaret på linjene under, og ::: på egen linje til slutt. Deltakeren ser spørsmålet og åpner svaret selv. Sett den etter at et problem er lagt fram, før teksten forklarer det; én eller to per seksjon. Aldri inni en kortramme.",
          "Sjekk deg selv: :::sjekk og spørsmålet på samme linje, så alternativene som - [ ] og det riktige som - [x], en forklaring, og ::: på egen linje til slutt. Deltakeren velger et svar og ser med en gang om det var riktig; det teller ikke. To til fire alternativer, nøyaktig ett riktig.",
          "Steg for steg: :::steg og en tittel på samme linje, én ### overskrift per steg med teksten (og eventuelt en figur) under, og ::: på egen linje til slutt. Deltakeren blar gjennom ett steg av gangen med Neste og Forrige. Tre til sju steg; hvert steg sier hva som endrer seg.",
          "Skriv selv: :::skriv og oppgaven på samme linje, eksempelsvaret under, så sjekklista som - [ ]-linjer til slutt, og ::: på egen linje. Deltakeren skriver, åpner eksempelsvaret og krysser av i sjekklista. Ingenting sendes eller teller; teksten blir i deltakerens nettleserfane til den lukkes. Passer som oppvarming før en fritekstmodul.",
          "Repetisjonskort: :::repetisjon på egen linje, én ### overskrift per kort (begrepet) med forklaringen under, og ::: på egen linje til slutt. Deltakeren snur kortene og markerer «Kunne det» eller «Øv mer». Fire til ti begreper seksjonen forklarer. Ikke :::kort — det er kort ved siden av hverandre.",
          "En blank linje over hver ramme. Rammer kan ikke stå inni hverandre. Steg for steg, skriv selv og repetisjonskort virker bare i seksjoner; i en moduls oppgavetekst står de som vanlig tekst.",
          "Ikon: ![](icon:navn) først i en kortoverskrift, for eksempel ### ![](icon:lightbulb) Idé. Navnene er Lucides egne, med små bokstaver (lucide.dev/icons); et ukjent navn gir ikke noe ikon.",
          "På de andre språkene står markørene som de er (:::kort, :::tenk, :::sjekk, :::steg, :::skriv, :::repetisjon, - [x], - [ ], ```prompt), og hver ### overskrift blir stående; bare teksten oversettes.",
        ] },
      ],
      nn: [
        { title: "Dette gjer du her", items: [
          "Opne ein seksjon for å skrive eller endre. Teksten blir skriven i Markdown; førehandsvisinga viser det deltakarane ser.",
          "Lagre lagar ein ny versjon. Publiser når han er klar — kurset viser den publiserte versjonen.",
          "Bruk Dupliser for å starte frå ein seksjon som finst, og Eksporter/Importer for å flytte ein mellom miljø.",
        ] },
        { title: "Greitt å vite", items: [
          "Ein seksjon må ha alle tre språka før han kan publiserast.",
          "Arkiver ein seksjon du ikkje brukar lenger; han kan slettast inne på den arkiverte seksjonen.",
        ] },
        { title: "Blokker i teksten", items: [
          "Utheva boks: start eit avsnitt med > **Hugs:** og teksten. Merkelappane Viktig, NB og Åtvaring gir varselfarge.",
          "Prompt med kopiknapp: ein kodeblokk som startar med ```prompt på eiga linje og sluttar med ``` på eiga linje.",
          "Kort: :::kort på eiga linje, éi ### overskrift per kort med teksten under, og ::: på eiga linje til slutt.",
          "Tenk først: :::tenk og spørsmålet på same linja, svaret på linjene under, og ::: på eiga linje til slutt. Deltakaren ser spørsmålet og opnar svaret sjølv. Set det etter at eit problem er lagt fram, før teksten forklarer det; eitt eller to per seksjon. Aldri inni ei kortramme.",
          "Sjekk deg sjølv: :::sjekk og spørsmålet på same linja, så alternativa som - [ ] og det rette som - [x], ei forklaring, og ::: på eiga linje til slutt. Deltakaren vel eit svar og ser med ein gong om det var rett; det tel ikkje. To til fire alternativ, nøyaktig eitt rett.",
          "Steg for steg: :::steg og ein tittel på same linja, éi ### overskrift per steg med teksten (og eventuelt ein figur) under, og ::: på eiga linje til slutt. Deltakaren blar gjennom eitt steg om gongen med Neste og Førre. Tre til sju steg; kvart steg seier kva som endrar seg.",
          "Skriv sjølv: :::skriv og oppgåva på same linja, dømesvaret under, så sjekklista som - [ ]-linjer til slutt, og ::: på eiga linje. Deltakaren skriv, opnar dømesvaret og kryssar av i sjekklista. Ingenting blir sendt eller tel; teksten blir verande i nettlesarfana til deltakaren til ho blir lukka. Passar som oppvarming før ein fritekstmodul.",
          "Repetisjonskort: :::repetisjon på eiga linje, éi ### overskrift per kort (omgrepet) med forklaringa under, og ::: på eiga linje til slutt. Deltakaren snur korta og markerer «Kunne det» eller «Øv meir». Fire til ti omgrep som seksjonen forklarer. Ikkje :::kort — det er kort ved sida av kvarandre.",
          "Ei blank linje over kvar ramme. Rammer kan ikkje stå inni kvarandre. Steg for steg, skriv sjølv og repetisjonskort verkar berre i seksjonar; i oppgåveteksten til ein modul står dei som vanleg tekst.",
          "Ikon: ![](icon:namn) først i ei kortoverskrift, til dømes ### ![](icon:lightbulb) Idé. Namna er dei same som hos Lucide, med små bokstavar (lucide.dev/icons); eit ukjent namn gir ikkje noko ikon.",
          "På dei andre språka står markørane som dei er (:::kort, :::tenk, :::sjekk, :::steg, :::skriv, :::repetisjon, - [x], - [ ], ```prompt), og kvar ### overskrift blir ståande; berre teksten blir omsett.",
        ] },
      ],
    },
  },
  "admin-content-classes": {
    title: { "en-GB": "Classes", nb: "Klasser", nn: "Klassar" },
    summary: {
      "en-GB": "Groups of participants who are assigned courses together. Everyone with the participant role is in the system class «All participants».",
      nb: "Grupper av deltakere som får kurs tildelt samlet. Alle med deltakerrolle er i systemklassen «Alle deltakere».",
      nn: "Grupper av deltakarar som får kurs tildelt samla. Alle med deltakarrolle er i systemklassen «Alle deltakarar».",
    },
    sections: {
      "en-GB": [
        { title: "What to do here", items: [
          "Open a class to add participants and assign courses, with an optional deadline for reminders.",
          "Assigning a course to a class enrols everyone in it — also those added later.",
          "Archive a class you no longer use; it can be deleted once archived.",
        ] },
      ],
      nb: [
        { title: "Dette gjør du her", items: [
          "Åpne en klasse for å legge til deltakere og tildele kurs, med en frist for påminnelser om du vil.",
          "Tildeler du et kurs til en klasse, får alle i klassen kurset — også de som legges til senere.",
          "Arkiver en klasse du ikke bruker lenger; den kan slettes når den er arkivert.",
        ] },
      ],
      nn: [
        { title: "Dette gjer du her", items: [
          "Opne ein klasse for å leggje til deltakarar og tildele kurs, med ein frist for påminningar om du vil.",
          "Tildeler du eit kurs til ein klasse, får alle i klassen kurset — òg dei som blir lagde til seinare.",
          "Arkiver ein klasse du ikkje brukar lenger; han kan slettast når han er arkivert.",
        ] },
      ],
    },
  },
  "cohort-status": {
    title: { "en-GB": "Status", nb: "Status", nn: "Status" },
    summary: {
      "en-GB": "Where each participant stands in a course: assigned, in progress, overdue or completed — in total and per class.",
      nb: "Hvor hver deltaker står i et kurs: tildelt, påbegynt, forfalt eller fullført — samlet og per klasse.",
      nn: "Kvar kvar deltakar står i eit kurs: tildelt, påbyrja, forfalle eller fullført — samla og per klasse.",
    },
    sections: {
      "en-GB": [ { title: "What to do here", items: [ "Choose a course. The numbers update at once.", "«Overdue» means the class deadline has passed without completion." ] } ],
      nb: [ { title: "Dette gjør du her", items: [ "Velg et kurs. Tallene oppdateres med en gang.", "«Forfalt» betyr at klassens frist er passert uten at kurset er fullført." ] } ],
      nn: [ { title: "Dette gjer du her", items: [ "Vel eit kurs. Tala blir oppdaterte med ein gong.", "«Forfalle» tyder at fristen til klassen er passert utan at kurset er fullført." ] } ],
    },
  },
  "participant-activity": {
    title: { "en-GB": "Activity", nb: "Aktivitet", nn: "Aktivitet" },
    summary: {
      "en-GB": "What participants do on the platform, across all courses: how activity grows, and who is active.",
      nb: "Hva deltakerne gjør i plattformen, samlet for alle kurs: hvordan aktiviteten øker, og hvem som er aktive.",
      nn: "Kva deltakarane gjer i plattforma, samla for alle kurs: korleis aktiviteten aukar, og kven som er aktive.",
    },
    sections: {
      "en-GB": [
        { title: "What to do here", items: [
          "Choose the period, whether to count per day or per week, and a department if you want one.",
          "Click a person in the list to see what they did most recently.",
        ] },
        { title: "Good to know", items: [
          "Active means the person read a section, submitted an attempt, passed a module or completed a course. «Active» in the list covers the last 14 days.",
          "Last seen is the last visit to the platform, also when the person did nothing.",
          "Participants are everyone who has done something on the platform — not those who have left or been anonymised.",
        ] },
      ],
      nb: [
        { title: "Dette gjør du her", items: [
          "Velg periode, om du vil telle per dag eller per uke, og eventuelt en avdeling.",
          "Klikk på en person i lista for å se det siste hen har gjort.",
        ] },
        { title: "Greit å vite", items: [
          "Aktiv betyr at personen har lest en seksjon, levert et forsøk, bestått en modul eller fullført et kurs. «Aktiv» i lista gjelder de siste 14 dagene.",
          "Sist sett er siste besøk i plattformen, også når personen ikke gjorde noe.",
          "Deltakere er alle som har gjort noe i plattformen — ikke de som har sluttet eller er anonymisert.",
        ] },
      ],
      nn: [
        { title: "Dette gjer du her", items: [
          "Vel periode, om du vil telje per dag eller per veke, og eventuelt ei avdeling.",
          "Klikk på ein person i lista for å sjå det siste hen har gjort.",
        ] },
        { title: "Greitt å vite", items: [
          "Aktiv tyder at personen har lese ein seksjon, levert eit forsøk, bestått ein modul eller fullført eit kurs. «Aktiv» i lista gjeld dei siste 14 dagane.",
          "Sist sett er siste besøk i plattforma, også når personen ikkje gjorde noko.",
          "Deltakarar er alle som har gjort noko i plattforma — ikkje dei som har slutta eller er anonymiserte.",
        ] },
      ],
    },
  },
  "admin-content-calibration": {
    title: {
      "en-GB": "Calibration in Admin Content",
      nb: "Innholdsforvaltning: kalibrering",
      nn: "Innhaldsforvaltning: kalibrering",
    },
    summary: {
      "en-GB": "Use this page to calibrate from the content area when threshold work should stay close to modules and courses.",
      nb: "Bruk denne siden til å kalibrere fra Innholdsforvaltning når terskelarbeidet bør ligge tett på moduler og kurs.",
      nn: "Bruk denne sida til å kalibrere frå Innhaldsforvaltning når terskelarbeidet bør liggje tett på modular og kurs.",
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
            "Velg modul og filtre før du laster kalibreringsbilde.",
            "Se på kvalitetssignaler og utfallsfordeling før du justerer beståttgrensen.",
            "Bruk denne siden når du vil kalibrere fra samme område som moduler og kurs.",
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
            "Vel modul og filter før du lastar kalibreringsbilete.",
            "Sjå på kvalitetssignal og utfallsfordeling før du justerer beståttgrensa.",
            "Bruk denne sida når du vil kalibrere frå same området som modular og kurs.",
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
