import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.146.0 mot UTRULLET stage: en arkivert klasse tar ikke imot deltakere eller kurs (produkteier 2026-11-08).
// Det testen skriver på stage: én klasse («Stage-test arkivert klasse …») med testkontoen som medlem en kort stund. Klassen
// arkiveres og slettes til slutt. Synligheten i «Mine kurs» er dekket av test/m2-classes-archived.test.ts gjennom rutene.
// ⚠️ Tokenet skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.146.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { authorization: `Bearer ${auth!.accessToken}`, "x-locale": "nb", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: svar.status, json: await svar.json().catch(() => ({})) };
}

let klasseId: string | null = null;
let minId: string | null = null;
let kursId: string | null = null;

test("versjonen er minst 2.146.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.146.0"));
});

test("forberedelse: en ny klasse, testkontoens id og et kurs å tildele", async () => {
  const me = await api("GET", "/api/me");
  expect(me.status).toBe(200);
  const epost = String(me.json.user.email);
  const søk = await api("GET", `/api/admin/content/users/search?q=${encodeURIComponent(epost)}`);
  expect(søk.status, JSON.stringify(søk.json)).toBe(200);
  minId = (søk.json.users as Array<{ id: string; email: string }>).find((u) => u.email?.toLowerCase() === epost.toLowerCase())?.id ?? null;
  expect(minId, "fant ikke testkontoen i brukersøket").not.toBeNull();

  const kurs = await api("GET", "/api/courses");
  expect(kurs.status).toBe(200);
  kursId = (kurs.json.courses as Array<{ id: string }>)[0]?.id ?? null;
  noter("har et kurs å tildele", Boolean(kursId));

  const ny = await api("POST", "/api/admin/content/classes", { name: `Stage-test arkivert klasse ${new Date().toISOString()}` });
  expect(ny.status, JSON.stringify(ny.json)).toBe(201);
  klasseId = ny.json.class.id;
});

test("arkivert: ny deltaker og nytt kurs gir 400 class_archived, og ingenting er skrevet", async () => {
  expect(klasseId).not.toBeNull();
  expect((await api("POST", `/api/admin/content/classes/${klasseId}/archive`)).status).toBe(200);

  const medlem = await api("POST", `/api/admin/content/classes/${klasseId}/members`, { userId: minId });
  expect(medlem.status, JSON.stringify(medlem.json)).toBe(400);
  expect(medlem.json.error).toBe("class_archived");
  expect(medlem.json.details?.action).toBe("add_member");
  const medlemmer = await api("GET", `/api/admin/content/classes/${klasseId}/members`);
  expect(medlemmer.status).toBe(200);
  expect(JSON.stringify(medlemmer.json)).not.toContain(String(minId));

  if (kursId) {
    const tildeling = await api("POST", `/api/admin/content/classes/${klasseId}/courses`, { courseId: kursId, dueAt: null });
    expect(tildeling.status, JSON.stringify(tildeling.json)).toBe(400);
    expect(tildeling.json.error).toBe("class_archived");
    const kurs = await api("GET", `/api/admin/content/classes/${klasseId}/courses`);
    expect(kurs.status).toBe(200);
    expect(JSON.stringify(kurs.json)).not.toContain(String(kursId));
  }
});

test("gjenopprettet: deltakeren kan legges til og fjernes igjen", async () => {
  expect((await api("POST", `/api/admin/content/classes/${klasseId}/restore`)).status).toBe(200);
  const medlem = await api("POST", `/api/admin/content/classes/${klasseId}/members`, { userId: minId });
  expect(medlem.status, JSON.stringify(medlem.json)).toBe(201);
  expect((await api("DELETE", `/api/admin/content/classes/${klasseId}/members/${minId}`)).status).toBeLessThan(300);
});

test.afterAll(async () => {
  if (!klasseId) return;
  await api("POST", `/api/admin/content/classes/${klasseId}/archive`);
  const slett = await api("DELETE", `/api/admin/content/classes/${klasseId}`);
  noter("klassen slettet", slett.status);
});
