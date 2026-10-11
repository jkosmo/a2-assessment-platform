import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// #1079: ikonbiblioteket plattformen serverer selv (Lucide). Produkteier valgte ett bibliotek som
// standard for alle kurs: skillets gamle regel «bare presentasjonens egne ikoner» ga ingen ikoner i
// to av tre testpresentasjoner, og ingen i kurs som ikke kommer fra en presentasjon.
//
// Tre ting holdes: navnene er Lucides og ingenting annet slipper inn i oppslaget; ruta tegner ikonet
// i plattformens farge og sier 404 (ikke tomt bilde) for det som ikke finnes; og `![](icon:navn)` i
// seksjonstekst blir et ikon med fast størrelse uansett hvor det står.

vi.mock("../../src/db/prisma.js", () => ({ prisma: {} }));

const { ICON_STROKE, hasIcon, iconLibraryInfo, iconSvg, iconUrl, listIconNames } = await import("../../src/modules/course/iconLibrary.js");
const { iconsRouter } = await import("../../src/routes/icons.js");
const { renderSectionMarkdown } = await import("../../src/modules/course/sectionContent.js");
const { validateAuthoringPackage } = await import("../../src/modules/adminContent/agentAuthoringValidationService.js");

describe("ikonbiblioteket — navn og oppslag (#1079)", () => {
  it("er Lucide under ISC-lisens, med godt over tusen ikoner — kontrollcase: biblioteksfila er lest", () => {
    const info = iconLibraryInfo();
    expect(info.name).toBe("lucide");
    expect(info.license).toBe("ISC");
    expect(info.count).toBeGreaterThan(1500);
    expect(listIconNames()).toHaveLength(info.count);
  });

  it("navnene står sortert, og hvert navn er små bokstaver, tall og bindestrek", () => {
    const names = listIconNames();
    expect([...names].sort()).toEqual(names);
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("kjente navn finnes; ukjente, tomme og farlige navn gjør det ikke", () => {
    for (const name of ["check", "file-text", "lightbulb", "users"]) expect(hasIcon(name), name).toBe(true);
    for (const name of ["", "Check", "check.svg", "../check", "check/../x", "constructor", "__proto__", "hasOwnProperty", "ikke-et-ikon"]) {
      expect(hasIcon(name), `«${name}» skal ikke finnes`).toBe(false);
    }
  });

  it("tegner ikonet i egen 24 × 24-ramme med strek i plattformens tekstfarge", () => {
    const svg = iconSvg("check")!;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"')).toBe(true);
    expect(svg).toContain(`stroke="${ICON_STROKE}"`);
    expect(svg).toContain('<path d="M20 6 9 17l-5-5"/>');
    expect(svg).not.toContain("currentColor");
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(iconSvg("ikke-et-ikon")).toBeNull();
  });

  it("adressen er /static/icons/<navn>.svg", () => {
    expect(iconUrl("file-text")).toBe("/static/icons/file-text.svg");
  });
});

describe("ruta /static/icons/<navn>.svg (#1079)", () => {
  const app = express();
  app.use("/static/icons", iconsRouter);

  it("serverer et kjent ikon som SVG, med mellomlager i én dag", async () => {
    const response = await request(app).get("/static/icons/check.svg");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.headers["cache-control"]).toBe("public, max-age=86400");
    // supertest legger ikke-tekstlige svar (image/svg+xml) i body som Buffer, ikke i text.
    expect(Buffer.isBuffer(response.body) ? response.body.toString("utf8") : response.text).toBe(iconSvg("check"));
  });

  it("svarer 404 for et navn som ikke finnes — ikke et tomt bilde", async () => {
    const response = await request(app).get("/static/icons/ikke-et-ikon.svg");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "unknown_icon" });
  });

  it("svarer 404 uten .svg, for store bokstaver og for forsøk på å gå ut av mappa", async () => {
    for (const path of ["/static/icons/check", "/static/icons/Check.svg", "/static/icons/..%2Fcheck.svg", "/static/icons/check.svg.svg"]) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(404);
    }
  });
});

describe("`![](icon:navn)` i seksjonstekst (#1079)", () => {
  it("blir et ikon med fast størrelse: klassen content-icon og adressen til ruta", () => {
    const html = renderSectionMarkdown("Se ![](icon:check) her.", "nb");
    expect(html).toContain('<img class="content-icon" src="/static/icons/check.svg" alt="">');
    expect(html).not.toContain("icon:");
  });

  it("et navn som ikke finnes, tas helt bort — ingen brukket bilde", () => {
    const html = renderSectionMarkdown("Se ![](icon:ikke-et-ikon) her.", "nb");
    expect(html).not.toContain("<img");
    expect(html).toContain("Se  her.");
  });

  it("i en kortoverskrift får ikonet klassen én gang", () => {
    const html = renderSectionMarkdown(":::kort\n### ![](icon:lightbulb) Idé\n\nTekst.\n:::", "nb");
    expect(html).toContain('<img class="content-icon" src="/static/icons/lightbulb.svg" alt="">');
    expect(html.match(/content-icon/g)).toHaveLength(1);
  });

  it("i en tabell er et bibliotekikon et ikon også i en navngitt kolonne", () => {
    const html = renderSectionMarkdown("| Steg | Ikon |\n|---|---|\n| Forstå | ![](icon:target) |", "nb");
    expect(html).toContain('<td data-label="Ikon"><span><img class="content-icon" src="/static/icons/target.svg" alt=""></span></td>');
  });

  it("asset-bilder er som før: ingen ikonklasse av seg selv", () => {
    const html = renderSectionMarkdown("![Flyt](asset:fig1)", "nb");
    expect(html).toContain('src="/api/content-assets/fig1?locale=nb"');
    expect(html).not.toContain("content-icon");
  });
});

describe("validering av en forfatterpakke: ukjent ikon (#1079)", () => {
  const lookups = {
    listActiveModuleTitles: async () => [],
    listActiveCourseTitles: async () => [],
    listActiveSectionTitles: async () => [],
    findExistingModuleIds: async () => new Set<string>(),
    findExistingSectionIds: async () => new Set<string>(),
  };
  const pkg = (bodyMarkdown: unknown) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{ clientRef: "sec", type: "section", payload: { title: "S", bodyMarkdown } }],
  });

  it("et kjent ikon går gjennom uten en assets[]-post", async () => {
    const report = await validateAuthoringPackage(pkg("### ![](icon:check) Gjort"), lookups);
    expect(report.issues).toEqual([]);
  });

  it("et ukjent ikon er en feil med navnet i meldingen, én gang per navn, på alle språk", async () => {
    const report = await validateAuthoringPackage(pkg({ nb: "![](icon:ikke-et-ikon) og ![](icon:ikke-et-ikon)", nn: "![](icon:heller-ikke)" }), lookups);
    expect(report.valid).toBe(false);
    const unknown = report.issues.filter((issue) => issue.code === "unknown_icon");
    expect(unknown).toHaveLength(2);
    expect(unknown[0]).toMatchObject({ severity: "error", path: "objects[0].payload.bodyMarkdown" });
    expect(unknown.map((issue) => issue.message).join(" ")).toContain("icon:ikke-et-ikon");
  });
});
