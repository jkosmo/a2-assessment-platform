import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { fasit, sha256 } from "../support/mascotFasit.js";

// Maskotpakken, steg 0: fasit for bildefilene og faviconet, slik appen serverer dem (doc/design/MASKOTPAKKE.md).
// Båtbildene hentes fra `/static/boat/`, som står som alias etter flyttingen, så en åpen, gammel fane ikke får ødelagte
// bilder. Faviconet har faste adresser som alle sidene lenker til.

const BOAT_IMAGES = [
  "anke.jpg",
  "diskusjon.jpg",
  "flau-vind.jpg",
  "frist-forfalt.jpg",
  "frist-snart.jpg",
  "kurs-ny-versjon.jpg",
  "kurs-tildelt.jpg",
  "vurdering-bestatt.jpg",
  "vurdering-ikke-bestatt.jpg",
  "vurdering-sensor.jpg",
];
const FAVICON = ["favicon.svg", "favicon-32.png", "favicon-16.png", "apple-touch-icon-180.png"];

async function served(url: string) {
  const response = await request(app).get(url).buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  });
  expect(response.status, url).toBe(200);
  const contentType = response.headers["content-type"] as string;
  // SVG er tekst. På Windows sjekkes den ut med CRLF (core.autocrlf), i utrullingen og i CI med LF. Fasiten er bytene
  // brukerne får, altså LF, så den er den samme på alle maskiner.
  const raw = response.body as Buffer;
  const body = contentType.startsWith("image/svg") ? Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : raw;
  return { contentType, bytes: body.length, sha256: sha256(body) };
}

describe("maskotpakken, steg 0: bildene og faviconet", () => {
  it("båtbildene, fil for fil", async () => {
    const actual: Record<string, unknown> = {};
    for (const file of BOAT_IMAGES) actual[`/static/boat/${file}`] = await served(`/static/boat/${file}`);
    expect(actual).toEqual(fasit("images.json", actual));
  });

  it("faviconet og ikonet for hjemskjerm", async () => {
    const actual: Record<string, unknown> = {};
    for (const file of FAVICON) actual[`/static/${file}`] = await served(`/static/${file}`);
    expect(actual).toEqual(fasit("favicon.json", actual));
  });
});
