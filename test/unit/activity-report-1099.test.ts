import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  buildActivityReport,
  mondayOfKey,
  osloDayKey,
  type ActivityEvent,
  type ActivityPerson,
} from "../../src/modules/reporting/activityReport.js";

// #1099: utregningen bak «Aktivitet». Den er ren (ingen database), så hver regel kan måles alene.

// Onsdag 14. oktober 2026 kl. 11:30 norsk tid (sommertid, UTC+2).
const NOW = new Date("2026-10-14T09:30:00Z");

function person(userId: string, extra: Partial<ActivityPerson> = {}): ActivityPerson {
  return { userId, name: userId.toUpperCase(), email: `${userId}@x.test`, department: "Salg", lastLoginAt: null, ...extra };
}
function at(iso: string, userId: string, type: ActivityEvent["type"] = "read"): ActivityEvent {
  return { userId, at: new Date(iso), type };
}

describe("norske kalenderdager", () => {
  it("en hendelse kl. 00:30 norsk tid hører til den norske dagen, ikke UTC-dagen før", () => {
    expect(osloDayKey(new Date("2026-10-13T22:30:00Z"))).toBe("2026-10-14");
    expect(osloDayKey(new Date("2026-10-13T21:59:00Z"))).toBe("2026-10-13");
  });

  it("vintertid: midnatt flytter seg til 23:00 UTC", () => {
    expect(osloDayKey(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
    expect(osloDayKey(new Date("2026-12-01T22:59:00Z"))).toBe("2026-12-01");
  });

  it("dagregning går over sommertidsskiftet uten å miste en dag", () => {
    expect(addDaysToKey("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDaysToKey("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDaysToKey("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("mandagen i uka", () => {
    expect(mondayOfKey("2026-10-14")).toBe("2026-10-12");
    expect(mondayOfKey("2026-10-12")).toBe("2026-10-12");
    expect(mondayOfKey("2026-10-18")).toBe("2026-10-12");
  });
});

describe("buildActivityReport", () => {
  it("12 uker per uke: tolv bøtter fra mandag, den siste er ikke ferdig", () => {
    const report = buildActivityReport({ now: NOW, period: "12", grain: "week", department: null, people: [person("a")], events: [] });
    expect(report.buckets).toHaveLength(12);
    expect(report.buckets[0]!.from).toBe("2026-07-27");
    expect(report.buckets[11]!.from).toBe("2026-10-12");
    expect(report.buckets[11]!.to).toBe("2026-10-18");
    expect(report.buckets[11]!.partial).toBe(true);
    expect(report.buckets[10]!.partial).toBe(false);
    expect(report.range).toEqual({ from: "2026-07-27", to: "2026-10-14" });
  });

  it("4 uker per dag: én bøtte per dag fram til i dag", () => {
    const report = buildActivityReport({ now: NOW, period: "4", grain: "day", department: null, people: [person("a")], events: [] });
    expect(report.buckets[0]!.from).toBe("2026-09-21");
    expect(report.buckets.at(-1)!.from).toBe("2026-10-14");
    expect(report.buckets).toHaveLength(24);
  });

  it("hele perioden begynner mandagen i uka for den første hendelsen", () => {
    const report = buildActivityReport({
      now: NOW, period: "all", grain: "week", department: null,
      people: [person("a")],
      events: [at("2026-07-08T10:00:00Z", "a")],
    });
    expect(report.buckets[0]!.from).toBe("2026-07-06");
  });

  it("teller aktive personer og hendelser per bøtte, og hvor mange som har kommet i gang totalt", () => {
    const report = buildActivityReport({
      now: NOW, period: "4", grain: "week", department: null,
      people: [person("a"), person("b"), person("c")],
      events: [
        at("2026-09-02T10:00:00Z", "a"), // før perioden: a har kommet i gang tidligere
        at("2026-09-22T10:00:00Z", "a"),
        at("2026-09-22T11:00:00Z", "a", "submitted"),
        at("2026-10-06T10:00:00Z", "b"),
        at("2026-10-13T10:00:00Z", "b", "passed"),
        at("2026-10-13T10:05:00Z", "b", "completed"),
      ],
    });
    const byFrom = Object.fromEntries(report.buckets.map((b) => [b.from, b]));
    expect(byFrom["2026-09-21"]).toMatchObject({ active: 1, startedTotal: 1, counts: { read: 1, submitted: 1, passed: 0, completed: 0 } });
    expect(byFrom["2026-09-28"]).toMatchObject({ active: 0, startedTotal: 1 });
    expect(byFrom["2026-10-05"]).toMatchObject({ active: 1, startedTotal: 2 });
    expect(byFrom["2026-10-12"]).toMatchObject({ active: 1, startedTotal: 2, counts: { read: 0, submitted: 0, passed: 1, completed: 1 } });
    expect(report.population).toBe(3);
  });

  it("nøkkeltallene er glidende vinduer på tidspunkt", () => {
    const report = buildActivityReport({
      now: NOW, period: "12", grain: "week", department: null,
      people: [person("a"), person("b"), person("c"), person("d")],
      events: [
        at("2026-10-13T08:00:00Z", "a"), // siste 7 dager
        at("2026-10-05T08:00:00Z", "b"), // 7–14 dager siden
        at("2026-09-20T08:00:00Z", "c"), // 24 dager siden: siste 30, ikke 14
        at("2026-10-08T08:00:00Z", "a", "submitted"), // a: første hendelse 6 dager siden
      ],
    });
    expect(report.kpis.active7).toBe(1);
    expect(report.kpis.active7Prev).toBe(1);
    expect(report.kpis.active30).toBe(3);
    expect(report.kpis.started).toBe(3);
    expect(report.kpis.startedBefore7).toBe(2); // b og c; a begynte for 6 dager siden
    expect(report.kpis.events7).toEqual({ read: 1, submitted: 1, passed: 0, completed: 0 });
  });

  it("status: aktiv de siste 14 dagene, rolig etter det, ikke startet uten hendelser", () => {
    const report = buildActivityReport({
      now: NOW, period: "12", grain: "week", department: null,
      people: [person("a"), person("b"), person("c")],
      events: [at("2026-10-01T10:00:00Z", "a"), at("2026-09-29T10:00:00Z", "b")],
    });
    const status = Object.fromEntries(report.people.map((p) => [p.userId, p.status]));
    expect(status).toEqual({ a: "active", b: "quiet", c: "not_started" });
  });

  it("personraden: sist aktiv, sist innlogget, aktive dager per uke og tall for perioden", () => {
    const login = new Date("2026-10-14T07:00:00Z");
    const report = buildActivityReport({
      now: NOW, period: "4", grain: "week", department: null,
      people: [person("a", { lastLoginAt: login })],
      events: [
        at("2026-07-20T10:00:00Z", "a"), // utenfor perioden og utenfor 12 uker (de begynner 27.07)
        at("2026-10-12T08:00:00Z", "a"),
        at("2026-10-12T09:00:00Z", "a"), // samme dag: én aktiv dag
        at("2026-10-13T09:00:00Z", "a", "submitted"),
        at("2026-10-05T09:00:00Z", "a"),
      ],
    });
    const row = report.people[0]!;
    expect(row.lastActivityAt).toBe("2026-10-13T09:00:00.000Z");
    expect(row.lastLoginAt).toBe(login.toISOString());
    expect(row.activeDaysByWeek).toHaveLength(12);
    expect(row.activeDaysByWeek.slice(-2)).toEqual([1, 2]);
    expect(row.activeDaysByWeek.slice(0, 10).every((n) => n === 0)).toBe(true);
    expect(row.counts).toEqual({ read: 3, submitted: 1, passed: 0, completed: 0 });
  });

  it("avdelingsfilteret snevrer alt inn, men lista over avdelinger viser alle", () => {
    const report = buildActivityReport({
      now: NOW, period: "4", grain: "week", department: "IT",
      people: [person("a", { department: "IT" }), person("b", { department: "Salg" }), person("c", { department: null })],
      events: [at("2026-10-13T08:00:00Z", "a"), at("2026-10-13T08:00:00Z", "b")],
    });
    expect(report.departments).toEqual(["IT", "Salg"]);
    expect(report.population).toBe(1);
    expect(report.people.map((p) => p.userId)).toEqual(["a"]);
    expect(report.kpis.active7).toBe(1);
    expect(report.buckets.at(-1)!.active).toBe(1);
  });

  it("hendelser fra personer utenfor deltakerne, og fra fremtiden, telles ikke", () => {
    const report = buildActivityReport({
      now: NOW, period: "4", grain: "week", department: null,
      people: [person("a")],
      events: [at("2026-10-13T08:00:00Z", "fremmed"), at("2026-10-14T12:00:00Z", "a")],
    });
    expect(report.kpis.started).toBe(0);
    expect(report.buckets.at(-1)!.active).toBe(0);
  });

  it("lista sorteres etter sist aktiv, nyeste først", () => {
    const report = buildActivityReport({
      now: NOW, period: "4", grain: "week", department: null,
      people: [person("a"), person("b"), person("c")],
      events: [at("2026-10-01T08:00:00Z", "a"), at("2026-10-13T08:00:00Z", "b")],
    });
    expect(report.people.map((p) => p.userId)).toEqual(["b", "a", "c"]);
  });
});
