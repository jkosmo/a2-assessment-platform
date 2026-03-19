import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const profile = process.argv[2] ?? "dev";

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const [users, modules, moduleVersions, manualReviews] = await Promise.all([
    prisma.user.count(),
    prisma.module.count(),
    prisma.moduleVersion.count(),
    prisma.manualReview.count(),
  ]);

  if (users < 4) {
    throw new Error(`PostgreSQL smoke check failed for ${profile}: expected at least 4 users, got ${users}.`);
  }

  if (modules < 2) {
    throw new Error(`PostgreSQL smoke check failed for ${profile}: expected at least 2 modules, got ${modules}.`);
  }

  if (moduleVersions < 2) {
    throw new Error(
      `PostgreSQL smoke check failed for ${profile}: expected at least 2 module versions, got ${moduleVersions}.`,
    );
  }

  if (manualReviews < 1) {
    throw new Error(
      `PostgreSQL smoke check failed for ${profile}: expected at least 1 pending manual review, got ${manualReviews}.`,
    );
  }

  console.log(`PostgreSQL smoke check passed for ${profile}.`, {
    users,
    modules,
    moduleVersions,
    manualReviews,
  });
}
