import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.139.0 mot UTRULLET stage: rekkefølgen i kursgjennomføringsrapporten, med ekte data. Bare lesing. Fila med CSV-en er testet i
// test/e2e/results-course-export.spec.ts; om Excel leser den riktig, må et menneske se.
// ⚠️ Tokenet skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.139.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(sti: string): Promise<{ status: number; json: any }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, { headers: { authorization: `Bearer ${auth!.accessToken}`, "x-locale": "nb" } });
  return { status: svar.status, json: await svar.json().catch(() => ({})) };
}

const STATUS = ["COMPLETED", "NEEDS_NEW_VERSION", "IN_PROGRESS", "NOT_STARTED"];

test("versjonen er 2.139.0", async () => {
  const svar = await fetch(`${BASE}/version`);
  expect((await svar.json()).version).toBe("2.139.0");
});

test("deltakerne står med Fullført øverst, og nyeste aktivitet først innenfor hver status", async () => {
  test.setTimeout(240_000);
  const kurs = await api("/api/reports/courses");
  expect(kurs.status).toBe(200);
  const aktuelle = (kurs.json.rows as Array<{ courseId: string; courseTitle: string; enrolledParticipants: number }>)
    .filter((rad) => rad.enrolledParticipants >= 2)
    .sort((a, b) => b.enrolledParticipants - a.enrolledParticipants)
    .slice(0, 8);
  noter("kurs med minst to deltakere", aktuelle.length);
  expect(aktuelle.length, "ingen kurs å måle på med denne kontoen").toBeGreaterThan(0);

  let medFlereStatuser = 0;
  for (const rad of aktuelle) {
    const detaljer = await api(`/api/reports/courses/details?selectedCourseId=${encodeURIComponent(rad.courseId)}`);
    expect(detaljer.status).toBe(200);
    const rader = detaljer.json.rows as Array<{ status: string; latestActivityAt: string | null }>;
    if (new Set(rader.map((r) => r.status)).size > 1) medFlereStatuser += 1;
    noter(`rekkefølge ${rad.courseId}`, rader.map((r) => r.status[0]).join(""));
    rader.forEach((r, i) => {
      if (i === 0) return;
      const før = rader[i - 1]!;
      const forskjell = STATUS.indexOf(før.status) - STATUS.indexOf(r.status);
      expect(forskjell, `${rad.courseId} rad ${i}: ${før.status} før ${r.status}`).toBeLessThanOrEqual(0);
      if (forskjell === 0) {
        expect((før.latestActivityAt ?? "") >= (r.latestActivityAt ?? ""), `${rad.courseId} rad ${i}: aktivitet`).toBe(true);
      }
    });
  }
  noter("kurs med flere statuser", medFlereStatuser);
  expect(medFlereStatuser, "ingen kurs viste mer enn én status, så rekkefølgen er ikke målt").toBeGreaterThan(0);
});
