import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import {
  buildCourseExportEnvelope,
  buildModuleExportEnvelope,
} from "../src/modules/adminContent/adminContentQueries.js";
import {
  courseExportPayloadSchema,
  moduleExportPayloadSchema,
} from "../src/modules/adminContent/adminContentSchemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// RUNDTURSVAKT (#1015): det eksporten skriver, skal importen kunne lese.
//
// ⚠️ HVORFOR DENNE FINNES. Nøyaktig den samme feilen har oppstått TRE ganger, med samme signatur
// hver gang — «eksporten lyktes, importen avviste fila den nettopp hadde laget»:
//
//   #912  `certificationLevel: null`   — valgfritt ved opprettelse, eksporten skrev null, skjemaet
//                                         krevde en verdi. Brøt rundturen for modulene laget raskest.
//   #905  `taskText` delvis oversatt   — lagringen tillot et delvis kart, skjemaet krevde streng
//                                         eller alle tre.
//   #930  `title` delvis oversatt      — samme, ett felt senere.
//
// Hver gang ble ETT felt rettet. Ingen av gangene ble klassen stengt, og filveien er hovedveien
// innhold flyttes på (doc/DECISIONS.md) — så et tap her er permanent.
//
// ⚠️ HVORFOR EN RUNDTUR OG IKKE PÅSTANDER OM FELTENE. En liste over felt måtte vedlikeholdes, og
// nettopp det gikk galt: #905 myknet `taskText`, `assessorExpectedContent` og
// `candidateTaskConstraints`, men lot `title` og `description` stå strenge. Neste felt som får lov
// til noe på skrivesiden faller ut av lista på samme måte. Rundturen har ingen liste å glemme.
//
// Fiksturen er bevisst UBEKVEM, men lovlig: hvert felt står i den formen som brakk sist.
// ─────────────────────────────────────────────────────────────────────────────

const delvisOversatt = (grunn: string) => JSON.stringify({ "en-GB": `${grunn} (en)`, nb: `${grunn} (nb)` });

/**
 * En modul i den formen som har brukket rundturen tidligere: delvis oversatte felt og uten
 * sertifiseringsnivå. FREETEXT_ONLY, fordi det er den modusen som faktisk EKSPORTERER de tre
 * feltene #905 myknet — MCQ_ONLY ville utelatt dem, og vakta ville vært grønn uten å måle noe.
 */
async function lagModul(merke: string) {
  const modul = await prisma.module.create({
    data: {
      // Delvis oversatt: nn mangler, som er en ekte tilstand etter #930 — «skrevet på engelsk og
      // bokmål, ikke oversatt til nynorsk ennå». Før #930 ga nettopp dette 400 ved import.
      title: delvisOversatt(`${merke} ${Date.now()}`),
      description: delvisOversatt("Beskrivelse"),
      // #912: aldri satt. Eksporten skriver null.
      certificationLevel: null,
    },
    select: { id: true },
  });
  const rubrikk = await prisma.rubricVersion.create({
    data: {
      moduleId: modul.id,
      versionNo: 1,
      criteriaJson: JSON.stringify({ klarhet: { vekt: 1 } }),
      scalingRuleJson: JSON.stringify({ passTerskel: 0.6 }),
    },
    select: { id: true },
  });
  const mal = await prisma.promptTemplateVersion.create({
    data: { moduleId: modul.id, versionNo: 1, systemPrompt: "s", userPromptTemplate: "u", examplesJson: "[]" },
    select: { id: true },
  });
  const versjon = await prisma.moduleVersion.create({
    data: {
      moduleId: modul.id,
      versionNo: 1,
      assessmentMode: "FREETEXT_ONLY",
      rubricVersionId: rubrikk.id,
      promptTemplateVersionId: mal.id,
      // #905: de tre feltene som ble myknet den gangen.
      taskText: delvisOversatt("Oppgavetekst"),
      assessorExpectedContent: delvisOversatt("Sensorveiledning"),
      candidateTaskConstraints: delvisOversatt("Rammer"),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: modul.id }, data: { activeVersionId: versjon.id } });

  return {
    modulId: modul.id,
    async rydd() {
      await prisma.module.update({ where: { id: modul.id }, data: { activeVersionId: null } });
      await prisma.moduleVersion.delete({ where: { id: versjon.id } });
      await prisma.rubricVersion.delete({ where: { id: rubrikk.id } });
      await prisma.promptTemplateVersion.delete({ where: { id: mal.id } });
      await prisma.module.delete({ where: { id: modul.id } });
    },
  };
}

describe("Moduleksport kan leses av importskjemaet (#1015)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("godtar sin egen eksport av en modul med delvis oversatte felt og uten sertifiseringsnivå", async () => {
    const modul = await lagModul("Rundtur");

    const konvolutt = await buildModuleExportEnvelope(modul.modulId, { userId: null, email: null });

    // Kontrollcase: uten dette er testen grønn hvis eksporten slutter å ta med modulen i det hele
    // tatt. «Ingenting å validere» og «alt validerer» ser like ut nedenfra.
    expect(konvolutt.module, "eksporten skal inneholde modulen").toBeTruthy();
    expect(konvolutt.module?.module?.title, "tittelen skal være med").toBeTruthy();

    const resultat = moduleExportPayloadSchema.safeParse(konvolutt.module);
    expect(
      resultat.success ? "" : JSON.stringify(resultat.error.issues, null, 2),
      "Importskjemaet avviste eksportens egen fil. Skrivesiden har fått lov til noe lesesiden ikke,\n" +
        "og modulen kan da lagres, men aldri dupliseres, eksporteres eller flyttes mellom miljøer.",
    ).toBe("");

    await modul.rydd();
  });
  it("godtar sin egen KURS-eksport, der de samme tre feltene finnes en gang til", async () => {
    // ⚠️ `courseExportPayloadSchema` speiler modulskjemaet felt for felt — title, description og
    // certificationLevel, med de samme kommentarene om de samme tre feilene. Et skjema som er kopiert,
    // brekker kopiert: retter man ett felt ett sted, står tvillingen igjen. Derfor måler vakta begge.
    const modul = await lagModul("Kursrundtur");

    const kurs = await prisma.course.create({
      data: {
        title: delvisOversatt(`Kurs ${Date.now()}`),
        description: delvisOversatt("Kursbeskrivelse"),
        certificationLevel: null,
      },
      select: { id: true },
    });
    const post = await prisma.courseItem.create({
      data: { courseId: kurs.id, itemType: "MODULE", sortOrder: 0, moduleId: modul.modulId },
      select: { id: true },
    });

    const konvolutt = await buildCourseExportEnvelope(kurs.id, { userId: null, email: null });

    // Kontrollcase: uten dette er testen grønn hvis eksporten slutter å ta med kurset.
    expect(konvolutt.course?.course?.items?.length ?? 0, "kurset skal eksportere posten sin").toBeGreaterThan(0);

    const resultat = courseExportPayloadSchema.safeParse(konvolutt.course);
    expect(
      resultat.success ? "" : JSON.stringify(resultat.error.issues, null, 2),
      "Importskjemaet avviste kurseksportens egen fil.",
    ).toBe("");

    await prisma.courseItem.delete({ where: { id: post.id } });
    await prisma.course.delete({ where: { id: kurs.id } });
    await modul.rydd();
  });
});
