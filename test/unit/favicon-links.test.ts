import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 2.130.0: portalen fikk favicon (merket fra gamifiseringen, godkjent av produkteier 2026-11-02). Før
// viste fanen nettleserens standardikon. Hver side i public/*.html skal lenke til ikonet — en ny side
// som glemmer det, får igjen et blankt ark i fanen, og ingen ser det i en test som ikke leter.

const publicDir = path.resolve(__dirname, "../../public");
const pages = fs.readdirSync(publicDir).filter((f) => f.endsWith(".html"));

const required = [
  '<link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="/static/favicon-32.png" type="image/png" sizes="32x32" />',
  '<link rel="icon" href="/static/favicon-16.png" type="image/png" sizes="16x16" />',
  '<link rel="apple-touch-icon" href="/static/apple-touch-icon-180.png" sizes="180x180" />',
];

describe("favicon på alle sider", () => {
  it("finner sidene (kontrollcase: en tom liste ville bestått alt under)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
  });

  it.each(pages)("%s lenker til favicon og ikon for hjemskjerm i <head>", (page) => {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    for (const link of required) expect(head, `${page} mangler ${link}`).toContain(link);
  });

  it("filene lenkene peker på finnes under /static (public/static)", () => {
    for (const file of ["favicon.svg", "favicon-32.png", "favicon-16.png", "apple-touch-icon-180.png"]) {
      expect(fs.existsSync(path.join(publicDir, "static", file)), file).toBe(true);
    }
  });
});
