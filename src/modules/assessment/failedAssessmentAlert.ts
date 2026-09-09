import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { platformConfigRepository } from "../platformConfig/platformConfigRepository.js";
import { sendViaAcs } from "../certification/participantNotificationService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";

/**
 * #953 (produkteier 2026-08-26): «Hvis mange vurderinger begynner å hope seg opp bør administrator
 * varsles.»
 *
 * ⚠️ Hvorfor en KARENSTID og ikke én e-post per feilet vurdering: når LLM-tjenesten er nede feiler
 * alle vurderinger samtidig. Uten et tak ville administratorer fått ti e-poster på ti minutter,
 * lært at varselet er støy, og laget en innboksregel. Da er varselet verre enn ingenting — det ser
 * ut som dekning man ikke har.
 *
 * Tidspunktet lagres i `PlatformConfig` framfor i minnet, fordi worker-en restartes ved hver
 * utrulling. Et minnebasert tak ville nullstilt seg selv og gitt en ny e-post per restart.
 */
const LAST_ALERT_KEY = "assessment.failedBacklogAlert.lastSentAt";

export async function alertOnFailedAssessmentBacklog(now: Date = new Date()): Promise<void> {
  // ⚠️ Teller INNLEVERINGER SOM STÅR FAST, ikke FAILED-jobbrader. En jobbrad blir stående for
  // alltid — et gjenforsøk lager en ny rad. Med den gamle tellingen ville dette varselet gått
  // til alle administratorer hvert døgn i all framtid etter én enkelt nedetid.
  const failedCount = await assessmentJobRepository.countStuckFailedAssessments();
  if (failedCount < env.ASSESSMENT_FAILED_ALERT_THRESHOLD) {
    return;
  }

  const stored = await platformConfigRepository.getMany([LAST_ALERT_KEY]);
  const lastSentAt = stored[LAST_ALERT_KEY] ? Date.parse(stored[LAST_ALERT_KEY]) : Number.NaN;
  const withinCooldown =
    Number.isFinite(lastSentAt) && now.getTime() - lastSentAt < env.ASSESSMENT_FAILED_ALERT_COOLDOWN_MS;
  if (withinCooldown) {
    return;
  }

  const administrators = await findActiveAdministrators(now);

  // ⚠️ Loggraden skrives UANSETT om det finnes mottakere. Uten den ville en plattform uten
  // administrator-tildelinger vært helt stille i nettopp den situasjonen varselet finnes for.
  logOperationalEvent(
    operationalEvents.assessment.failedBacklogAlert,
    {
      failedCount,
      threshold: env.ASSESSMENT_FAILED_ALERT_THRESHOLD,
      recipientCount: administrators.length,
    },
    "error",
  );

  if (administrators.length === 0) {
    // ⚠️ Karenstiden skrives selv om ingen kunne varsles. Uten dette gjentas loggraden over hver
    // worker-runde (poll 4 s) — den ville flommet driftsloggen i nøyaktig den situasjonen den
    // finnes for. Å returnere «tidlig» er ikke gratis når kalleren er en løkke.
    await platformConfigRepository.set(LAST_ALERT_KEY, now.toISOString(), "system");
    return;
  }

  const subject = `${failedCount} vurderinger har feilet`;
  const body = [
    `${failedCount} vurderinger har brukt opp alle gjenforsøkene sine og venter på at noen kjører dem på nytt.`,
    "",
    "Dette skjer typisk når LLM-tjenesten har vært nede. Innleveringene er ikke tapt — de står og",
    "venter, og kandidatene har ikke fått noe resultat.",
    "",
    "Åpne plattformadministrasjon og se «Vurderinger som ga opp». Der kan du kjøre dem på nytt.",
  ].join("\n");

  // ⚠️ Respekter kanalvalget. Første utgave kalte `sendViaAcs` DIREKTE, forbi
  // `PARTICIPANT_NOTIFICATION_CHANNEL`. I et miljø der kanalen er `log` eller `disabled` — lokalt,
  // i CI, ev. stage — ville `EmailClient(undefined)` kastet per mottaker, kastet blitt svelget, og
  // karenstiden likevel blitt satt. Varselet ville uteblitt STILLE i et døgn av gangen, og
  // «disabled» hadde ikke betydd disabled.
  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  if (channel === "disabled") {
    await platformConfigRepository.set(LAST_ALERT_KEY, now.toISOString(), "system");
    return;
  }

  for (const admin of administrators) {
    // Én mottaker som feiler skal ikke stanse de andre — derfor fanges hver sending for seg.
    try {
      if (channel === "acs_email") {
        await sendViaAcs({
          recipientEmail: admin.email,
          recipientName: admin.name,
          subject,
          body,
          logPayload: { channel, alert: "assessment_failed_backlog", failedCount },
        });
      } else {
        // `log` og `webhook`: varselet er en driftsmelding, ikke deltakerpost. Loggraden over
        // bærer allerede innholdet, så her holder det å registrere mottakeren.
        logOperationalEvent(
          operationalEvents.certification.participantNotificationSent,
          { channel, recipientEmail: admin.email, subject },
        );
      }
    } catch {
      /* sendViaAcs logger selv; en død mottakeradresse skal ikke skjule varselet for resten */
    }
  }

  await platformConfigRepository.set(LAST_ALERT_KEY, now.toISOString(), "system");
}

/**
 * Aktive administratorer, med gyldig rolletildeling akkurat nå.
 *
 * ⚠️ `validTo: null` betyr «løper fortsatt» — en tildeling uten sluttdato er ikke utløpt. Skrevet
 * som en OR framfor et enkelt `gt`, fordi `validTo: { gt: now }` alene ville utelatt nettopp de
 * permanente tildelingene, altså de fleste.
 */
async function findActiveAdministrators(now: Date): Promise<Array<{ email: string; name: string }>> {
  const assignments = await prisma.roleAssignment.findMany({
    where: {
      appRole: "ADMINISTRATOR",
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      user: { activeStatus: true, isAnonymized: false },
    },
    select: { user: { select: { email: true, name: true } } },
  });

  const byEmail = new Map<string, { email: string; name: string }>();
  for (const row of assignments) {
    byEmail.set(row.user.email, { email: row.user.email, name: row.user.name });
  }
  return [...byEmail.values()];
}
