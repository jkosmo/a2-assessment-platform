import request from "supertest";
import { app } from "../src/app.js";

// Fjernede ruter, samlet i én tabell (testgjennomgangen 2026-11, avsnitt 2).
//
// Hver rad er en adresse som har vært i bruk, og som nå enten videresender (301, fordi den står i bokmerker og gamle
// lenker) eller ikke finnes (404). Før sto de spredt i participant-console-config.test.ts, m2-completed-modules.test.ts og
// m2-certification-status-flow.test.ts. Omdirigeringene står i src/app.ts.
//
// En ny rad: metode, sti, forventet status, og `location` for en 301. Skriv hvorfor adressen er borte.

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-department": "Consulting",
  "x-user-roles": "PARTICIPANT",
};

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

type Row = {
  method: "get" | "post";
  path: string;
  status: 301 | 404;
  location?: string;
  headers?: Record<string, string>;
  /** Et felt svaret IKKE skal ha, for en sti som ellers kunne gitt det gamle svaret. */
  absentBodyKey?: string;
  why: string;
};

const ROWS: Row[] = [
  { method: "get", path: "/admin-content/classes", status: 301, location: "/deltakere/klasser", why: "#765: klassene flyttet til Deltakere" },
  { method: "get", path: "/calibration", status: 301, location: "/admin-content/calibration", why: "#836: kvalitetsarbeidsflaten erstattet siden" },
  { method: "get", path: "/participant/completed", status: 301, location: "/participant", why: "2.126.0: «Fullførte» er fjernet, «Mine kurs» viser det" },
  { method: "get", path: "/admin-content/advanced", status: 301, location: "/admin-content", why: "v1.2.18 (#352): Avansert uten modul gikk til biblioteket" },
  {
    method: "get",
    path: "/admin-content/module/test-module/advanced",
    status: 301,
    location: "/admin-content/module/test-module/conversation",
    why: "#896 S3c: Avansert er slettet; adressen lander i arbeidsflaten",
  },
  {
    method: "get",
    path: "/admin-content?moduleId=test-module",
    status: 301,
    location: "/admin-content/module/test-module/conversation",
    why: "gammel adresse til en modul, før modulen fikk sin egen sti",
  },
  {
    method: "get",
    path: "/api/modules/completed?limit=20",
    status: 404,
    headers: participantHeaders,
    absentBodyKey: "modules",
    why: "2.141.0: profilen leser beståtte moduler fra /api/me/stats. Stien treffer /:moduleId og finner ingen modul «completed»",
  },
  {
    method: "post",
    path: "/api/reports/recertification/reminders/run",
    status: 404,
    headers: adminHeaders,
    why: "#989: resertifisering er fjernet",
  },
];

describe("fjernede ruter", () => {
  it.each(ROWS)("$method $path gir $status ($why)", async (row) => {
    const call = row.method === "get" ? request(app).get(row.path) : request(app).post(row.path);
    const response = await call.set(row.headers ?? {});

    expect(response.status).toBe(row.status);
    if (row.status === 301) expect(response.headers.location).toBe(row.location);
    if (row.absentBodyKey) expect(response.body[row.absentBodyKey]).toBeUndefined();
  });
});
