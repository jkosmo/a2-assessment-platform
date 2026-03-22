/**
 * Consent version management (GDPR Art. 7 + Art. 25).
 *
 * CURRENT_CONSENT_VERSION must be bumped whenever the substance of what is
 * disclosed to users changes (new data categories, new processors, changed
 * retention periods, etc.). Bumping the version will cause all existing users
 * to be shown the consent dialog again on next login.
 *
 * The changelog is shown to returning users so they understand what changed.
 */

export const CURRENT_CONSENT_VERSION = "1.0";

export const CONSENT_CHANGELOG: Record<string, string> = {
  "1.0": "Første versjon av personvernerklæringen.",
};

/**
 * Default consent body texts used when the admin has not configured custom
 * text via PlatformConfig. Admins may override these per locale through the
 * admin interface.
 *
 * The text covers GDPR Art. 13 disclosure requirements:
 *  - identity of the controller
 *  - purposes and legal basis (Art. 6(1)(b) — employment contract)
 *  - categories of personal data
 *  - recipients / processors
 *  - automated decision-making (Art. 22)
 *  - data subject rights
 *  - retention
 */
export const DEFAULT_CONSENT_BODY: Record<string, string> = {
  nb: `Vi behandler følgende personopplysninger om deg:
• Navn og e-postadresse (fra din arbeidsgiver via Azure Active Directory)
• Dine besvarelser og vurderingsresultater
• Logg over hvem som har hatt tilgang til dine data

Behandlingsgrunnlaget er arbeidsavtalen din (GDPR art. 6 (1) b) — kompetanseutvikling er en del av ansettelsesforholdet.

Hvem har tilgang:
• Du — alle egne data
• Fagansvarlige — dine besvarelser ved manuell gjennomgang av klage eller overprøving
• Administrator — alle data

Automatiserte avgjørelser:
Vurderinger settes automatisk av AI. Dersom du ikke består, har du alltid rett til menneskelig gjennomgang.

Dine besvarelser sendes til en AI-tjeneste for evaluering. Svarene sendes uten personidentifiserende opplysninger som navn eller e-post. Tjenesten er hostet i Norge (Azure OpenAI).

Advarsel: Skriv ikke inn personopplysninger om deg selv eller andre i besvarelsene dine.

Dine rettigheter:
Du kan når som helst be om innsyn i, eksport av, eller pseudonymisering av dine data via profilsiden. Pseudonymisering betyr at navn og e-post kobles fra alle oppføringer. Statistiske aggregater beholdes uten personkobling.

Data pseudonymiseres automatisk 90 dager etter at du ikke lenger er registrert i organisasjonens brukerkatalog, eller etter 2 år uten innlogging.`,

  "en-GB": `We process the following personal data about you:
• Name and email address (from your employer via Azure Active Directory)
• Your assessment submissions and results
• Access log showing who has accessed your data

The legal basis for processing is your employment contract (GDPR Art. 6(1)(b)) — competence development is part of the employment relationship.

Who has access:
• You — all your own data
• Subject matter owners — your submissions during manual review of appeals or overrides
• Administrator — all data

Automated decision-making:
Assessments are scored automatically by AI. If you do not pass, you always have the right to human review.

Your submissions are sent to an AI service for evaluation. Submissions are sent without personally identifying information such as name or email. The service is hosted in Norway (Azure OpenAI).

Warning: Do not include personal information about yourself or others in your submission responses.

Your rights:
You can at any time request access to, export of, or pseudonymisation of your data via your profile page. Pseudonymisation means your name and email are decoupled from all records. Statistical aggregates are retained without personal linkage.

Data is pseudonymised automatically 90 days after you are no longer registered in the organisation's user directory, or after 2 years of inactivity.`,

  nn: `Vi behandlar følgjande personopplysningar om deg:
• Namn og e-postadresse (frå arbeidsgjevaren din via Azure Active Directory)
• Besvaringane dine og vurderingsresultat
• Logg over kven som har hatt tilgang til dataa dine

Behandlingsgrunnlaget er arbeidsavtalen din (GDPR art. 6 (1) b) — kompetanseutvikling er ein del av tilsetjingsforholdet.

Kven har tilgang:
• Du — alle eigne data
• Fagansvarleg — besvaringane dine ved manuell gjennomgang av klage eller overprøving
• Administrator — alle data

Automatiserte avgjersler:
Vurderingar vert sette automatisk av KI. Dersom du ikkje består, har du alltid rett til menneskeleg gjennomgang.

Besvaringane dine vert sende til ein KI-teneste for evaluering. Svara vert sende utan personidentifiserande opplysningar som namn eller e-post. Tenesta er drifta i Noreg (Azure OpenAI).

Åtvaring: Skriv ikkje inn personopplysningar om deg sjølv eller andre i besvaringane dine.

Rettane dine:
Du kan når som helst be om innsyn i, eksport av, eller pseudonymisering av dataa dine via profilsida. Pseudonymisering tyder at namn og e-post vert kopla frå alle oppføringane. Statistiske aggregat vert bevarte utan personkopling.

Data vert pseudonymiserte automatisk 90 dagar etter at du ikkje lenger er registrert i organisasjonen sin brukarkatalogg, eller etter 2 år utan innlogging.`,
};
