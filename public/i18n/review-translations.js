import { localeLabels, supportedLocales, translations as mrTranslations } from "/static/i18n/manual-review-translations.js";
import { translations as appealTranslations } from "/static/i18n/appeal-handler-translations.js";

export { localeLabels, supportedLocales };

const pageTranslations = {
  "en-GB": {
    "reviewPage.title": "Manual Review",
    "reviewPage.subtitle": "Handle manual assessments and appeals in one place.",
    "review.section.manualReview": "Manual Assessment",
    "review.section.appeal": "Appeals",
    "review.tab.manualReview": "Manual assessment",
    "review.tab.appeal": "Appeals",
    // #985: statuslinja over debug-feltet viste serverens `message` ordrett. Den er nå vår egen.
    "review.status.requestCompleted": "Request completed.",
    // #1018: sensorens formuleringer for de samme grunnkodene. Tredjeperson, nøkternt — teksten
    // leses av noen som skal etterprøve maskinens arbeid, ikke av den som ble vurdert.
    "assessor.decisionReasonCode.llmDisagreement": "Sent to review: two independent assessments disagreed.",
    "assessor.decisionReasonCode.scoreInconsistency": "Sent to review: the reported scores did not add up.",
    "assessor.decisionReasonCode.borderline": "Sent to review: total score {totalScore} is inside the borderline window {min}\u2013{max}.",
    "assessor.decisionReasonCode.redFlagOrConfidence": "Sent to review: a red-flag or confidence rule triggered.",
    "assessor.decisionReasonCode.aiDeclaration": "Sent to review: the candidate declared extensive autonomous AI use and submitted after being prompted to work further with the material.",
    "assessor.decisionReasonCode.aiDeclarationDescribed": "Sent to review: the candidate declared extensive autonomous AI use and submitted after being prompted to work further with the material. Their own description: \u00ab{description}\u00bb",
    "assessor.decisionReasonCode.contentSimilarity": "Sent to review: the answer resembles an independently generated model answer ({similarityPercent}% against a {thresholdPercent}% threshold). One signal, not proof.",
    "assessor.decisionReasonCode.insufficientEvidence": "Automatic fail: the submission did not contain enough evidence to assess reliably.",
    "assessor.decisionReasonCode.mcqBelowMinimum": "Automatic fail: multiple-choice score below the required minimum.",
    "assessor.decisionReasonCode.practicalBelowMinimum": "Automatic fail: practical score below the required minimum.",
    "assessor.decisionReasonCode.autoFail": "Automatic fail by threshold rules.",
    "assessor.decisionReasonCode.autoPass": "Automatic pass by threshold rules.",
    "assessor.decisionReasonCode.mcqOnlyPass": "Automatic pass: {scorePercent}% against a {minPercent}% requirement.",
    "assessor.decisionReasonCode.mcqOnlyFail": "Automatic fail: {scorePercent}% against a {minPercent}% requirement.",
  },
  nb: {
    "reviewPage.title": "Manuell behandling",
    "reviewPage.subtitle": "Handter fagvurderinger og anker pa ett sted.",
    "review.section.manualReview": "Fagvurdering",
    "review.section.appeal": "Ankebehandling",
    "review.tab.manualReview": "Manuell vurdering",
    "review.tab.appeal": "Anke",
    "review.status.requestCompleted": "Forespørselen er utført.",
    // #1018: sensorens formuleringer for de samme grunnkodene. Tredjeperson, nøkternt — teksten
    // leses av noen som skal etterprøve maskinens arbeid, ikke av den som ble vurdert.
    "assessor.decisionReasonCode.llmDisagreement": "Sendt til vurdering: to uavhengige vurderinger var uenige.",
    "assessor.decisionReasonCode.scoreInconsistency": "Sendt til vurdering: poengsummene gikk ikke opp.",
    "assessor.decisionReasonCode.borderline": "Sendt til vurdering: poengsummen {totalScore} ligger i grenseområdet {min}\u2013{max}.",
    "assessor.decisionReasonCode.redFlagOrConfidence": "Sendt til vurdering: en regel for rødt flagg eller konfidens slo til.",
    "assessor.decisionReasonCode.aiDeclaration": "Sendt til vurdering: kandidaten oppga omfattende autonom KI-bruk og leverte etter å ha blitt oppfordret til å bearbeide stoffet videre.",
    "assessor.decisionReasonCode.aiDeclarationDescribed": "Sendt til vurdering: kandidaten oppga omfattende autonom KI-bruk og leverte etter å ha blitt oppfordret til å bearbeide stoffet videre. Kandidatens egen beskrivelse: \u00ab{description}\u00bb",
    "assessor.decisionReasonCode.contentSimilarity": "Sendt til vurdering: besvarelsen ligner et uavhengig generert modellsvar ({similarityPercent} % mot en terskel på {thresholdPercent} %). Ett signal, ikke bevis.",
    "assessor.decisionReasonCode.insufficientEvidence": "Automatisk ikke bestått: innleveringen ga ikke nok grunnlag for en pålitelig vurdering.",
    "assessor.decisionReasonCode.mcqBelowMinimum": "Automatisk ikke bestått: flervalgspoengene var under kravet.",
    "assessor.decisionReasonCode.practicalBelowMinimum": "Automatisk ikke bestått: de praktiske poengene var under kravet.",
    "assessor.decisionReasonCode.autoFail": "Automatisk ikke bestått etter terskelregler.",
    "assessor.decisionReasonCode.autoPass": "Automatisk bestått etter terskelregler.",
    "assessor.decisionReasonCode.mcqOnlyPass": "Automatisk bestått: {scorePercent} % mot et krav på {minPercent} %.",
    "assessor.decisionReasonCode.mcqOnlyFail": "Automatisk ikke bestått: {scorePercent} % mot et krav på {minPercent} %.",
  },
  nn: {
    "reviewPage.title": "Manuell handsaming",
    "reviewPage.subtitle": "Handter fagvurderingar og ankar pa eitt stad.",
    "review.section.manualReview": "Fagvurdering",
    "review.section.appeal": "Ankebehandling",
    "review.tab.manualReview": "Manuell vurdering",
    "review.tab.appeal": "Anke",
    "review.status.requestCompleted": "Førespurnaden er utført.",
    // #1018: sensorens formuleringar for dei same grunnkodane. Tredjeperson, nøkternt.
    "assessor.decisionReasonCode.llmDisagreement": "Sendt til vurdering: to uavhengige vurderingar var ueinige.",
    "assessor.decisionReasonCode.scoreInconsistency": "Sendt til vurdering: poengsummane gjekk ikkje opp.",
    "assessor.decisionReasonCode.borderline": "Sendt til vurdering: poengsummen {totalScore} ligg i grenseområdet {min}\u2013{max}.",
    "assessor.decisionReasonCode.redFlagOrConfidence": "Sendt til vurdering: ein regel for raudt flagg eller konfidens slo til.",
    "assessor.decisionReasonCode.aiDeclaration": "Sendt til vurdering: kandidaten oppgav omfattande autonom KI-bruk og leverte etter å ha blitt oppmoda til å arbeide vidare med stoffet.",
    "assessor.decisionReasonCode.aiDeclarationDescribed": "Sendt til vurdering: kandidaten oppgav omfattande autonom KI-bruk og leverte etter å ha blitt oppmoda til å arbeide vidare med stoffet. Skildringa til kandidaten: \u00ab{description}\u00bb",
    "assessor.decisionReasonCode.contentSimilarity": "Sendt til vurdering: svaret liknar eit uavhengig generert modellsvar ({similarityPercent} % mot ein terskel på {thresholdPercent} %). Eitt signal, ikkje bevis.",
    "assessor.decisionReasonCode.insufficientEvidence": "Automatisk ikkje bestått: innleveringa gav ikkje nok grunnlag for ei påliteleg vurdering.",
    "assessor.decisionReasonCode.mcqBelowMinimum": "Automatisk ikkje bestått: fleirvalspoenga var under kravet.",
    "assessor.decisionReasonCode.practicalBelowMinimum": "Automatisk ikkje bestått: dei praktiske poenga var under kravet.",
    "assessor.decisionReasonCode.autoFail": "Automatisk ikkje bestått etter terskelreglar.",
    "assessor.decisionReasonCode.autoPass": "Automatisk bestått etter terskelreglar.",
    "assessor.decisionReasonCode.mcqOnlyPass": "Automatisk bestått: {scorePercent} % mot eit krav på {minPercent} %.",
    "assessor.decisionReasonCode.mcqOnlyFail": "Automatisk ikkje bestått: {scorePercent} % mot eit krav på {minPercent} %.",
  },
};

export const translations = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    {
      ...(mrTranslations[locale] ?? {}),
      ...(appealTranslations[locale] ?? {}),
      ...(pageTranslations[locale] ?? {}),
    },
  ]),
);
