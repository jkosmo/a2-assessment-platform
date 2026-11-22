/**
 * #934 skive 5a-3: slår på regelen om beståtte per kurs (doc/DESIGN_934.md, «5a-3 — bygget», «Utrulling»). Den eneste planlagte
 * skrivingen av bryteren. Under den eksklusive innholdslåsen, så ingen publisering og ingen utstedelse står midt i overgangen.
 *
 * Fast regel: den slås ikke av igjen etter at første krav er hevet, og det rulles ikke tilbake til kode eldre enn 2.135.0. Derfor
 * finnes det ingen «av» her. Kjøres etter siste tilbakefylling og en rapport med kode 0.
 *
 * Kjører mot DATABASE_URL i miljøet, så velg miljøet med vilje:
 *   dotenv -e .env.<miljø> -- npm run module-credit:switch-on
 */
import { runContentWrite } from "../../src/db/contentLock.js";
import { prisma } from "../../src/db/prisma.js";
import { isModulePassPerCourseOn, MODULE_PASS_SWITCH_KEY } from "../../src/modules/course/modulePassSwitch.js";

async function main() {
  const result = await runContentWrite(async (tx) => {
    const alreadyOn = await isModulePassPerCourseOn(tx);
    if (!alreadyOn) {
      await tx.platformConfig.upsert({
        where: { key: MODULE_PASS_SWITCH_KEY },
        create: { key: MODULE_PASS_SWITCH_KEY, value: "on", updatedBy: "module-credit:switch-on" },
        update: { value: "on", updatedBy: "module-credit:switch-on" },
      });
    }
    return { alreadyOn };
  });
  console.log(JSON.stringify({ event: "module_pass_switch_on", ...result }));
}

main()
  .catch((error) => {
    console.error("module_pass_switch_on_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
