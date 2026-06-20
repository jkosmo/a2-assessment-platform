/**
 * Dev-only helper: record privacy-consent for every mock identity used by the
 * local consoles (AUTH_MODE=mock).
 *
 * Why: each console page sends a different mock identity (see
 * participant-console identityDefaults + the MOCK_DEFAULT_USER_ID "dev-user-1").
 * Consent is stored per user, so on a fresh database every one of these
 * identities would otherwise hit the 403 consent_required gate until it accepts
 * the notice individually. This pre-accepts the current consent version for all
 * of them so local testing flows straight through.
 *
 * Safe to run anywhere: it only touches these fixed mock externalIds, which do
 * not correspond to real Entra users. Idempotent.
 *
 *   npm run dev:seed:consent
 */
import { PrismaClient } from "@prisma/client";
import { upsertUserFromPrincipal } from "../../src/repositories/userRepository.js";
import { getActiveConsentVersion } from "../../src/modules/platformConfig/consentConfigService.js";

const prisma = new PrismaClient();

// externalId + email for each mock identity (roles are irrelevant for consent).
const MOCK_IDENTITIES: Array<{ externalId: string; email: string; name: string }> = [
  { externalId: "dev-user-1", email: "dev.user@company.com", name: "Dev User" },
  { externalId: "participant-1", email: "participant@company.com", name: "Platform Participant" },
  { externalId: "content-owner-1", email: "content.owner@company.com", name: "Platform Content Owner" },
  { externalId: "smo-1", email: "smo@company.com", name: "Platform Subject Matter Owner" },
  { externalId: "reviewer-user-1", email: "reviewer1@company.com", name: "Platform Reviewer" },
  { externalId: "handler-1", email: "appeal.handler@company.com", name: "Platform Appeal Handler" },
  { externalId: "admin-1", email: "admin@company.com", name: "Platform Admin" },
];

async function main() {
  const consentVersion = await getActiveConsentVersion();
  for (const identity of MOCK_IDENTITIES) {
    const user = await upsertUserFromPrincipal({ ...identity, tokenRoles: [], groupIds: [] });
    await prisma.userConsent.upsert({
      where: { userId_consentVersion: { userId: user.id, consentVersion } },
      update: {},
      create: { userId: user.id, consentVersion },
    });
    console.log(`✓ consent ${consentVersion} for ${identity.externalId}`);
  }
  console.log(`Done — ${MOCK_IDENTITIES.length} mock identities consented to version ${consentVersion}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
