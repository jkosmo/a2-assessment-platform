import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = {
  "x-user-id": "kursport-admin",
  "x-user-email": "kursport.admin@company.com",
  "x-user-name": "Kursport Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const L = (t: string) => ({ "en-GB": t, nb: t, nn: t });

// ─────────────────────────────────────────────────────────────────────────────
// #1001: publiseringsporten krever «minst ett ELEMENT», ikke «minst én modul».
//
// Regelen ga mening da et kurs var en beholder for moduler. Etter #916 er seksjoner likeverdige
// kurselementer med egen publiseringsgate, og da ble kravet vilkårlig: et kurs av rent lesestoff
// kunne ikke publiseres uansett hvor mange publiserte seksjoner det hadde.
//
// ⚠️ TO STEDER I KODEBASEN BEHANDLET ALLEREDE RENE LESEKURS SOM NORMALE. Rapportlaget regner ut
// fullføringsgrad for dem (#969, «reports a completion rate for a module-free reading course»), og
// `m2-section-export-import-916` måtte legge inn en dummy-modul for å komme forbi porten. Når et
// fikstur må jukse forbi en regel for å teste noe annet, er regelen selv funnet.
//
// Produkteier 2026-08-24: «jeg tviler på at rene seksjonskurs vil trengs, men det krever
// kompleksitet å aktivt hindre det samt at vi ville måtte forklare brukere begrensningen som også
// krever mer.» Beslutningen er altså ikke at rene lesekurs er ØNSKET — den er at det koster mer å
// hindre dem enn å tillate dem.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1001 — et kurs publiseres på elementer, ikke på moduler", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const opprettKurs = async (tittel: string) => {
    const svar = await request(app)
      .post("/api/admin/content/courses")
      .set(admin)
      .send({ title: L(tittel), description: L("d") });
    expect(svar.status, `kurset skal opprettes: ${JSON.stringify(svar.body).slice(0, 200)}`).toBe(201);
    return svar.body.course?.id ?? svar.body.id;
  };

  it("⚠️ et kurs med bare seksjoner kan publiseres", async () => {
    const courseId = await opprettKurs(`Rent lesekurs ${Date.now()}`);

    const seksjon = await request(app)
      .post("/api/admin/content/sections")
      .set(admin)
      .send({ title: L("Kapittel 1"), bodyMarkdown: L("Innhold som skal leses.") });
    expect(seksjon.status, `seksjonen skal opprettes: ${JSON.stringify(seksjon.body).slice(0, 200)}`)
      .toBeLessThan(300);
    const sectionId = seksjon.body.section?.id ?? seksjon.body.id;

    const publisertSeksjon = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/publish`)
      .set(admin)
      .send({});
    expect(publisertSeksjon.status, "seksjonen må være publisert før kurset kan bli det")
      .toBeLessThan(300);

    const koblet = await request(app)
      .put(`/api/admin/content/courses/${courseId}/items`)
      .set(admin)
      .send({ items: [{ type: "SECTION", sectionId }] });
    expect(koblet.status, `elementet skal kobles: ${JSON.stringify(koblet.body).slice(0, 200)}`)
      .toBeLessThan(300);

    const publisert = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(admin)
      .send({});

    expect(
      publisert.status,
      "et kurs av rent lesestoff skal kunne publiseres etter #1001: " +
        JSON.stringify(publisert.body).slice(0, 300),
    ).toBeLessThan(300);

    const rad = await prisma.course.findUnique({
      where: { id: courseId },
      select: { publishedAt: true },
    });
    expect(rad?.publishedAt, "publiseringen skal faktisk ha skjedd, ikke bare svart 200").not.toBeNull();
  });

  it("⚠️ men et HELT TOMT kurs avvises fortsatt — kontrollcase", async () => {
    // Blokkeringens makker, og grunnen til at testen over betyr noe. Uten denne kunne porten vært
    // fjernet helt, og den første testen ville sett nøyaktig like grønn ut.
    //
    // Saken var uttrykkelig at porten IKKE skulle fjernes: null elementer er reell beskyttelse mot
    // å publisere et tomt skall. Det eneste som falt bort var filteret på itemType.
    const courseId = await opprettKurs(`Tomt kurs ${Date.now()}`);

    const svar = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(admin)
      .send({});

    expect(svar.status, "et kurs uten elementer skal fortsatt avvises").toBe(400);

    // ⚠️ EGEN KODE, IKKE BARE EN SETNING (#972/#999). En `ValidationError` gir `validation_error`
    // uten `issues`, og da viser `api-error.js` serverens engelske `message` ordrett midt i et
    // norsk grensesnitt. Med en kode treffer feilen den delte oversetteren.
    expect(
      svar.body.error,
      "koden er kontrakten, ikke teksten — uten den kan ikke klienten oversette avslaget",
    ).toBe("course_has_no_items");
  });
});
