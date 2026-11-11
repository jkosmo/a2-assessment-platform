import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1139 (doc/design/PLAN_1139.md, punkt 5 og 12.10): hvem som rører den ukentlige e-posten.
//   - `WeeklyDigest` skrives bare av weeklyDigestJob.ts (jobben, behandleren og nøytraliseringen av en prod-kopi);
//   - `User.weeklyEmailEnabled` skrives bare av PUT /api/me/preferences (routes/me.ts);
//   - ingen admin-rute eller rapport leser dem: arbeidsgiver skal ikke kunne se hvem som får, åpner eller melder seg av.
// Lesere som er lov: modulen selv (weeklyDigest/), innsynet og profilen (routes/me.ts).

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((file) => ({ rel: relative(SRC, file).replace(/\\/g, "/"), text: readFileSync(file, "utf8") }));

describe("#1139: vakt for den ukentlige e-posten", () => {
  it("bare weeklyDigestJob.ts skriver `WeeklyDigest`", () => {
    const writes = /weeklyDigest\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|(INSERT INTO|UPDATE|DELETE FROM)\s+"WeeklyDigest"/;
    const writers = files.filter((f) => writes.test(f.text)).map((f) => f.rel);
    expect(writers, "kontroll: vakta finner skriveren").toContain("modules/weeklyDigest/weeklyDigestJob.ts");
    expect(writers).toEqual(["modules/weeklyDigest/weeklyDigestJob.ts"]);
  });

  it("bare routes/me.ts skriver `weeklyEmailEnabled`", () => {
    const writers = files.filter((f) => /data:\s*\{[^}]*weeklyEmailEnabled\s*:/.test(f.text)).map((f) => f.rel);
    expect(writers).toEqual(["routes/me.ts"]);
  });

  it("ingen andre enn modulen, innsynet og profilen leser tabellen eller bryteren", () => {
    const readers = files
      .filter((f) => /weeklyDigest\b|weeklyDigests\b|"WeeklyDigest"|weeklyEmailEnabled/.test(f.text))
      .map((f) => f.rel)
      .filter((rel) => !rel.startsWith("modules/weeklyDigest/"));
    // Utboksen kjenner typen og kaller behandleren; nøytraliseringen av en prod-kopi kaller modulen; index.ts starter overvåkeren.
    expect(readers.sort()).toEqual(["index.ts", "modules/course/courseAssignmentNotice.ts", "modules/outbox/outboxService.ts", "routes/me.ts"].sort());
    for (const rel of readers.filter((r) => r !== "routes/me.ts")) {
      const text = files.find((f) => f.rel === rel).text;
      expect(text, `${rel} skal bare kalle modulen, ikke lese tabellen eller bryteren`).not.toMatch(/prisma\.weeklyDigest|"WeeklyDigest"|weeklyEmailEnabled/);
    }
  });
});
