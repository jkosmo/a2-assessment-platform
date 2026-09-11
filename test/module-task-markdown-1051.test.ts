import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = {
  "x-user-id": "markdown-admin",
  "x-user-email": "markdown.admin@company.com",
  "x-user-name": "Markdown Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const deltaker = {
  "x-user-id": "markdown-deltaker",
  "x-user-email": "markdown.deltaker@company.com",
  "x-user-name": "Markdown Deltaker",
  "x-user-roles": "PARTICIPANT",
};

const L = (t: string) => ({ "en-GB": t, nb: t, nn: t });

// ─────────────────────────────────────────────────────────────────────────────
// #1051: oppgaveteksten skal rendres som markdown, ikke vises som rå tegn.
//
// Skill-en skriver oppgaveteksten i markdown. Klienten satte den som `textContent`, og deltakeren så
// `## Oppgave` og `**uthevet**` bokstavelig på skjermen.
//
// ⚠️ LØSNINGEN LIGGER PÅ SERVEREN, SOM FOR SEKSJONER. `renderSectionMarkdown` — `marked` med
// sanitisering — har rendret seksjoner hele tiden, og prinsippet i `sectionContent.ts` er at
// forfatterskrevet markdown aldri stoles på. Modulens tekst er samme slags innhold fra samme slags
// forfatter. Rendret vi i klienten, fikk vi to sanitiseringsregimer for samme innhold.
//
// ⚠️ DERFOR ER SANITERINGSTESTEN DEN VIKTIGSTE HER. En markdown-renderer uten sanitering er et
// XSS-hull: forfatteren skriver `<script>`, og deltakeren kjører det. At `## Oppgave` blir en
// overskrift er nyttig; at `<script>` IKKE blir et skript er hele grunnen til at dette gjøres på
// serveren.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1051 — oppgaveteksten rendres som markdown", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function modulMed(taskText: string, candidateTaskConstraints?: string) {
    const modul = await request(app)
      .post("/api/admin/content/modules")
      .set(admin)
      .send({ title: L(`Markdown ${Date.now()}`), certificationLevel: "basic" });
    expect(modul.status, "modulen skal opprettes").toBe(201);
    const moduleId = modul.body.module.id as string;

    const rubrikk = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(admin)
      .send({ criteria: { klarhet: { label: "Klarhet", maxScore: 4 } }, scalingRule: { passTerskel: 0.6 } });
    expect(rubrikk.status).toBe(201);
    const mal = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(admin)
      .send({ systemPrompt: "s", userPromptTemplate: "u", examples: [] });
    expect(mal.status).toBe(201);

    const versjon = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(admin)
      .send({
        assessmentMode: "FREETEXT_ONLY",
        taskText: L(taskText),
        ...(candidateTaskConstraints ? { candidateTaskConstraints: L(candidateTaskConstraints) } : {}),
        assessorExpectedContent: L("Forventet."),
        rubricVersionId: rubrikk.body.rubricVersion.id,
        promptTemplateVersionId: mal.body.promptTemplateVersion.id,
      });
    expect(versjon.status, `versjonen skal opprettes: ${JSON.stringify(versjon.body).slice(0, 200)}`).toBe(201);

    const publisert = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versjon.body.moduleVersion.id}/publish`)
      .set(admin);
    expect(publisert.status, `publisering: ${JSON.stringify(publisert.body).slice(0, 200)}`).toBe(200);
    return moduleId;
  }

  it("⚠️ en overskrift og uthevet tekst blir HTML, og råteksten følger fortsatt med", async () => {
    const moduleId = await modulMed("## Oppgave\n\nSkriv **kort** om saken.");

    const svar = await request(app).get(`/api/modules/${moduleId}`).set(deltaker);
    expect(svar.status, JSON.stringify(svar.body).slice(0, 200)).toBe(200);
    const m = svar.body.module ?? svar.body;

    expect(m.taskTextHtml, "HTML-en skal finnes").toBeTruthy();
    expect(m.taskTextHtml).toContain("<h2");
    expect(m.taskTextHtml).toContain("<strong>kort</strong>");
    // ⚠️ Råteksten beholdes: forhåndsvisning og redigering trenger den, og en API-konsument uten DOM
    // skal ikke måtte strippe HTML for å lese oppgaven.
    expect(m.taskText).toContain("## Oppgave");
  });

  it("⚠️ et skript i oppgaveteksten når IKKE deltakeren som skript", async () => {
    // Testens viktigste påstand. Uten sanitering er en markdown-renderer et XSS-hull, og
    // forfatteren — eller den som får tak i en forfatters konto — kjører kode hos hver deltaker.
    const moduleId = await modulMed('Les dette.\n\n<script>document.title="pwned"</script>\n\n<img src=x onerror="alert(1)">');

    const svar = await request(app).get(`/api/modules/${moduleId}`).set(deltaker);
    expect(svar.status).toBe(200);
    const html = String((svar.body.module ?? svar.body).taskTextHtml ?? "");

    expect(html, "skriptet skal være strippet").not.toContain("<script");
    expect(html, "hendelsesattributter skal være strippet").not.toMatch(/onerror\s*=/i);
    // Kontrollcase: den ufarlige teksten rundt skal FORTSATT være der. Uten denne kunne
    // saniteringen ha tømt alt, og testen over ville sett like grønn ut.
    expect(html).toContain("Les dette.");
  });

  it("veiledningen (candidateTaskConstraints) får samme behandling", async () => {
    // Samme forfatter, samme Skill, samme slags innhold. Å rendre den ene og ikke den andre ville
    // vært N−1 på den brukersynlige siden.
    const moduleId = await modulMed("Oppgave.", "- Maks *300* ord\n- Bruk egne eksempler");

    const svar = await request(app).get(`/api/modules/${moduleId}`).set(deltaker);
    expect(svar.status).toBe(200);
    const m = svar.body.module ?? svar.body;
    expect(m.candidateTaskConstraintsHtml).toContain("<li>");
    expect(m.candidateTaskConstraintsHtml).toContain("<em>300</em>");
  });

  it("en modul uten oppgavetekst gir null, ikke tom HTML — kontrollcase", async () => {
    // MCQ-only-moduler har ingen oppgavetekst. Klienten skjuler hele blokka på `taskText == null`
    // (#525); en tom streng her ville vist en tom OPPGAVE-overskrift.
    const alle = await request(app).get("/api/modules").set(deltaker);
    expect(alle.status).toBe(200);
    const utenTekst = (alle.body.modules as Array<Record<string, unknown>>).find((x) => x.taskText == null);
    if (utenTekst) {
      expect(utenTekst.taskTextHtml, "null skal gi null, ikke tom streng").toBeNull();
    }
  });
});
