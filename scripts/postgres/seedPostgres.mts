import { PrismaClient } from "@prisma/client";
import { runSeed } from "../../prisma/seedCore.ts";

const prisma = new PrismaClient();

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  await runSeed(prisma);
}
