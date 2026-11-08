import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMascotPack, resolveMascotRequest } from "../../src/modules/mascot/mascotPack.js";

// Maskotpakken, skive 1 (doc/design/MASKOTPAKKE.md): pakken leses så langt at koden kan lese den trygt. Den fulle
// sjekken (bildestørrelse, SVG uten skript, alle pakker i CI) er skive 2. Hva brukerne ser, måles av fasiten
// (test/fixtures/mascot-fasit).

const repo = process.cwd();
const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** En kopi av seilbåten i en egen mappe, med `change` gjort på mascot.json. */
function packWith(change: (manifest: Record<string, any>) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), "mascot-"));
  temp.push(root);
  cpSync(path.join(repo, "mascots", "seilbat"), path.join(root, "mascots", "seilbat"), { recursive: true });
  writeFileSync(path.join(root, "mascot.config.json"), JSON.stringify({ mascot: "seilbat" }));
  const file = path.join(root, "mascots", "seilbat", "mascot.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  change(manifest);
  writeFileSync(file, JSON.stringify(manifest));
  return root;
}

describe("maskotpakken leses", () => {
  it("seilbåten, valgt i mascot.config.json, har alt koden leser (kontrollcase for testene under)", () => {
    const pack = loadMascotPack(repo);
    expect(pack.id).toBe("seilbat");
    expect(Object.keys(pack.moods).sort()).toEqual(["dramatisk", "mett", "ny", "sulten", "sur"]);
    expect(Object.keys(pack.emails)).toHaveLength(9);
    expect(() => loadMascotPack(packWith(() => {}))).not.toThrow();
  });

  it("det som mangler, listes samlet, og pakken leses ikke", () => {
    const root = packWith((m) => {
      delete m.moods.sur;
      m.emails.appeal.alt.nn = "";
      m.figure.states.feiring = "../../mascot.config.json";
      m.emails.discussion.image = "finnes-ikke.jpg";
    });
    let message = "";
    try {
      loadMascotPack(root);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("moods.sur.image");
    expect(message).toContain("emails.appeal.alt.nn mangler");
    expect(message).toContain("figure.states.feiring (../../mascot.config.json) ligger utenfor pakkemappa");
    expect(message).toContain("emails.discussion.image (images/finnes-ikke.jpg) finnes ikke");
  });

  it("en pakke valgt med et navn som ikke er en mappe i mascots/, leses ikke", () => {
    const root = packWith(() => {});
    writeFileSync(path.join(root, "mascot.config.json"), JSON.stringify({ mascot: "../seilbat" }));
    expect(() => loadMascotPack(root)).toThrow(/mascot.config.json/);
  });
});

describe("adressene i nettleseren", () => {
  const pack = loadMascotPack(repo);

  it.each([
    "/static/mascot/seilbat/..%2F..%2Fpackage.json",
    "/static/mascot/seilbat/%2E%2E/%2E%2E/package.json",
    "/static/mascot/seilbat/images/..%5C..%5Cmascot.json",
    "/static/boat/..%2F..%2F..%2Fpackage.json",
    "/static/boat/%2Egitkeep",
    "/static/mascot/seilbat/images/finnes-ikke.jpg",
    "/static/mascot/seilbat/images/",
    "/static/mascot/annen/images/anke.jpg",
  ])("%s gir ingenting fra pakken", (url) => {
    expect(resolveMascotRequest(pack, url)).toBeNull();
  });

  it.each([
    ["/static/mascot/seilbat/images/anke.jpg", path.join("images", "anke.jpg")],
    ["/static/boat/anke.jpg", path.join("images", "anke.jpg")],
    ["/static/favicon.svg", "favicon.svg"],
    ["/static/mascot/figure.css", "figure.css"],
  ])("%s er %s i pakken", (url, rel) => {
    expect(resolveMascotRequest(pack, url)).toEqual({ kind: "file", file: path.join(pack.dir, rel) });
  });

  it("figuren er en JS-modul med SVG-en for hver tilstand", () => {
    const hit = resolveMascotRequest(pack, "/static/mascot/figure.js");
    expect(hit?.kind).toBe("body");
    const body = hit?.kind === "body" ? hit.body : "";
    const figure = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
    expect(Object.keys(figure.svg)).toEqual(["flatt", "fullt", "feiring"]);
    for (const svg of Object.values(figure.svg) as string[]) expect(svg).toMatch(/^<svg [^>]*class="course-boat-svg"/);
  });
});
