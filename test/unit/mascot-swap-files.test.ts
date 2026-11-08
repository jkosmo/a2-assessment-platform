import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { activeMascot, loadMascotPack, mascotFigureModule, mascotMoodsJson, MASCOT_FAVICON_URLS } from "../../src/modules/mascot/mascotPack.js";
import { sha256 } from "../support/mascotFasit.js";

// Maskotpakken, skive 2 (doc/design/MASKOTPAKKE.md): et bytte endrer det appen serverer fra pakken. Med testpakken
// valgt kommer faviconet, bildene, humørene for profilen og figuren for «Mine kurs» fra den, på de samme adressene
// sidene bruker; seilbåtens bilder finnes ikke lenger under sitt pakkenavn. Hvordan profilen og figuren tegnes med
// testpakken, måles i test/e2e/mascot-swap.spec.ts; e-postene i mascot-swap-email.test.ts.

vi.mock("../../src/modules/mascot/mascotPack.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/mascot/mascotPack.js")>();
  const { SWAP_ROOT } = await import("../support/mascotFasit.js");
  actual.useMascotPack(actual.loadMascotPack(SWAP_ROOT));
  return actual;
});

async function served(url: string) {
  const response = await request(app).get(url).buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  });
  return { status: response.status, body: response.body as Buffer };
}

const testbat = activeMascot();
const seilbat = loadMascotPack(process.cwd());
const fileHash = (dir: string, rel: string) => sha256(readFileSync(path.join(dir, rel)));

describe("maskotpakken, skive 2: et bytte i det appen serverer", () => {
  it("testpakken er valgt (kontrollcase)", () => {
    expect(testbat.id).toBe("testbat");
    for (const key of Object.values(MASCOT_FAVICON_URLS)) {
      expect(fileHash(testbat.dir, testbat.favicon[key])).not.toBe(fileHash(seilbat.dir, seilbat.favicon[key]));
    }
  });

  it.each(Object.keys(MASCOT_FAVICON_URLS))("faviconet /static/%s er testpakkens", async (file) => {
    const { status, body } = await served(`/static/${file}`);
    expect(status).toBe(200);
    const key = MASCOT_FAVICON_URLS[file as keyof typeof MASCOT_FAVICON_URLS];
    expect(sha256(body)).toBe(fileHash(testbat.dir, testbat.favicon[key]));
  });

  it("bildene ligger under testpakkens navn, og under aliaset /static/boat/; seilbåtens finnes ikke", async () => {
    const image = testbat.moods.mett.image;
    for (const url of [`/static/mascot/testbat/images/${image}`, `/static/boat/${image}`]) {
      const { status, body } = await served(url);
      expect(status, url).toBe(200);
      expect(sha256(body), url).toBe(fileHash(testbat.dir, `images/${image}`));
    }
    expect((await served(`/static/mascot/seilbat/images/${seilbat.moods.mett.image}`)).status).toBe(404);
    expect((await served(`/static/boat/${seilbat.moods.mett.image}`)).status).toBe(404);
  });

  it("humørene for profilen og figuren for «Mine kurs» er laget av testpakken", async () => {
    const moods = await served("/static/mascot/moods.json");
    expect(moods.body.toString("utf8")).toBe(mascotMoodsJson(testbat));
    expect(JSON.parse(moods.body.toString("utf8")).moods.mett).toEqual({ image: `/static/mascot/testbat/images/${testbat.moods.mett.image}`, line: testbat.moods.mett.line });

    const figure = await served("/static/mascot/figure.js");
    expect(figure.body.toString("utf8")).toBe(mascotFigureModule(testbat));
    expect(figure.body.toString("utf8")).toContain("tb-ball");
    expect(figure.body.toString("utf8")).toContain('"celebrationMs":3000');

    const css = await served("/static/mascot/figure.css");
    expect(sha256(css.body)).toBe(fileHash(testbat.dir, testbat.figure.css));
  });
});
