import { describe, expect, it } from "vitest";
import { ARCHIVED_CONTENT_RETENTION_FLOOR_KEY, ARCHIVED_CONTENT_RETENTION_MONTHS, UNFINISHED_SUBMISSION_GRACE_DAYS } from "../../src/config/retention.js";
import { addCalendarDays, addCalendarMonths, archivedContentDeletesOn, latestDate, osloCalendarDate, parseRetentionFloor } from "../../src/modules/content/retentionDeadline.js";
import { courseDeleteHold } from "../../src/modules/course/contentLifecycle.js";
// @ts-expect-error — klientmodul uten typer
import { formatRetentionDate, retentionLineHtml, retentionReasonText } from "../../public/static/content-status-badge.js";
// @ts-expect-error — klientmodul uten typer
import { translations } from "../../public/i18n/admin-content-translations.js";

// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Fristen»): regnestykket for slettedatoen, og linja klienten
// tegner av svaret. Datoen er en norsk kalenderdato, seks kalendermåneder etter det seneste av `archivedAt` og overgangstidspunktet,
// med siste dag i måneden når dagen ikke finnes der.

const FLOOR = new Date("2026-01-01T00:00:00.000Z");
const on = (archivedAt: string, floor: Date = FLOOR) => archivedContentDeletesOn(new Date(archivedAt), floor);

describe("#1152 4b: fristen", () => {
  it("seks kalendermåneder, ikke 182 dager", () => {
    expect(ARCHIVED_CONTENT_RETENTION_MONTHS).toBe(6);
    expect(on("2026-11-13T12:00:00.000Z")).toBe("2027-05-13");
    expect(on("2026-05-13T12:00:00.000Z")).toBe("2026-11-13");
  });

  it("månedsslutt: 31. august + 6 = 28. februar, 29. i et skuddår; 31. mars + 6 = 30. september; 30. august står", () => {
    expect(on("2026-08-31T10:00:00.000Z")).toBe("2027-02-28");
    expect(on("2027-08-31T10:00:00.000Z")).toBe("2028-02-29");
    expect(on("2026-03-31T10:00:00.000Z")).toBe("2026-09-30");
    expect(on("2026-08-30T10:00:00.000Z")).toBe("2027-02-28");
    expect(on("2026-08-28T10:00:00.000Z")).toBe("2027-02-28");
    expect(on("2026-08-27T10:00:00.000Z")).toBe("2027-02-27");
    // Over årsskiftet.
    expect(on("2026-07-15T10:00:00.000Z")).toBe("2027-01-15");
    expect(on("2026-12-31T10:00:00.000Z")).toBe("2027-06-30");
  });

  it("norsk kalender, ikke UTC: rett etter midnatt norsk tid er neste dag, vinter og sommer", () => {
    // Vintertid (UTC+1): 23:30 UTC 13. november er 00:30 14. november.
    expect(on("2026-11-13T23:30:00.000Z")).toBe("2027-05-14");
    expect(on("2026-11-13T22:59:00.000Z")).toBe("2027-05-13");
    // Sommertid (UTC+2): 22:30 UTC 14. juni er 00:30 15. juni.
    expect(on("2026-06-14T22:30:00.000Z")).toBe("2026-12-15");
    expect(on("2026-06-14T21:59:00.000Z")).toBe("2026-12-14");
  });

  it("natta tida skifter: sommertid slutter 25.10.2026, begynner 29.03.2026", () => {
    // 22:30 UTC 24. oktober er 00:30 sommertid 25. oktober.
    expect(on("2026-10-24T22:30:00.000Z")).toBe("2027-04-25");
    // 23:30 UTC 25. oktober er 00:30 vintertid 26. oktober.
    expect(on("2026-10-25T23:30:00.000Z")).toBe("2027-04-26");
    // 23:30 UTC 28. mars er 00:30 vintertid 29. mars (tida skifter 02:00).
    expect(on("2026-03-28T23:30:00.000Z")).toBe("2026-09-29");
    // 22:30 UTC 29. mars er 00:30 sommertid 30. mars.
    expect(on("2026-03-29T22:30:00.000Z")).toBe("2026-09-30");
  });

  it("det seneste av arkiveringen og overgangstidspunktet", () => {
    const floor = new Date("2026-12-01T00:00:00.000Z");
    // Arkivert før overgangen: fra overgangen (01:00 norsk tid 1. desember).
    expect(archivedContentDeletesOn(new Date("2026-08-31T10:00:00.000Z"), floor)).toBe("2027-06-01");
    // Arkivert etter overgangen: fra arkiveringen.
    expect(archivedContentDeletesOn(new Date("2027-01-31T10:00:00.000Z"), floor)).toBe("2027-07-31");
    // Overgangen sent på kvelden UTC: norsk dato.
    expect(archivedContentDeletesOn(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-11-30T23:30:00.000Z"))).toBe("2027-06-01");
    // Like: samme svar.
    expect(archivedContentDeletesOn(floor, floor)).toBe("2027-06-01");
  });

  it("hjelperne: norsk kalenderdato, måneder fram, seneste dato", () => {
    expect(osloCalendarDate(new Date("2026-12-31T23:30:00.000Z"))).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addCalendarMonths({ year: 2026, month: 1, day: 31 }, 1)).toBe("2026-02-28");
    expect(addCalendarMonths({ year: 2026, month: 11, day: 30 }, 3)).toBe("2027-02-28");
    expect(addCalendarMonths({ year: 2026, month: 12, day: 1 }, 12)).toBe("2027-12-01");
    expect(latestDate(["2027-02-28", "2027-03-15", "2027-01-01"])).toBe("2027-03-15");
  });
});

describe("#1152 4b: overgangsraden leses strengt", () => {
  it("ISO 8601 i UTC med Z, slik migreringen skriver den", () => {
    expect(ARCHIVED_CONTENT_RETENTION_FLOOR_KEY).toBe("archived_content_retention_floor");
    expect(parseRetentionFloor("2026-11-14T12:34:56.789Z")?.toISOString()).toBe("2026-11-14T12:34:56.789Z");
    expect(parseRetentionFloor(" 2026-11-14T12:34:56Z ")?.toISOString()).toBe("2026-11-14T12:34:56.000Z");
  });

  it("alt annet er «ukjent» (null): mangler, tomt, uten tidssone, med forskyvning, norsk dato, tull", () => {
    for (const value of [null, undefined, "", "2026-11-14", "2026-11-14T12:00:00", "2026-11-14T12:00:00+01:00", "14.11.2026", "now", "2026-13-40T99:99:99Z"]) {
      expect(parseRetentionFloor(value), String(value)).toBeNull();
    }
  });

  it("en umulig dato som JavaScript ville flyttet, er også «ukjent» (QA-porten 4b); kontroll: skuddårsdag og siste sekund går", () => {
    for (const value of ["2026-02-31T00:00:00Z", "2026-11-14T24:00:00Z", "2027-02-29T12:00:00.000Z", "2026-04-31T10:00:00.000Z"]) {
      expect(parseRetentionFloor(value), value).toBeNull();
    }
    expect(parseRetentionFloor("2028-02-29T12:00:00.000Z")?.toISOString()).toBe("2028-02-29T12:00:00.000Z");
    expect(parseRetentionFloor("2026-12-31T23:59:59.999Z")?.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });
});

describe("#1152 4b: «ligger i et kurs» når kursene som slettes først, er tatt ut", () => {
  const archived = { id: "k-arkivert", title: "Arkivert", archived: true };
  const active = { id: "k-aktiv", title: "Aktivt", archived: false };

  it("et arkivert kurs i settet holder ikke lenger; et aktivt kurs holder alltid, også om det står i settet", () => {
    expect(courseDeleteHold("Modulen", [archived], new Set(["k-arkivert"]))).toBeNull();
    const held = courseDeleteHold("Modulen", [archived, active], new Set(["k-arkivert", "k-aktiv"]));
    expect(held?.courses.map((c) => c.id)).toEqual(["k-aktiv"]);
    expect(held?.error.code).toBe("module_in_use");
  });

  it("KONTROLL: uten settet holder alle kursene, med koden «Slett» gir", () => {
    expect(courseDeleteHold("Seksjonen", [archived])?.error.code).toBe("content_in_archived_course");
    expect(courseDeleteHold("Seksjonen", [active])?.error.code).toBe("content_in_use");
    expect(courseDeleteHold("Seksjonen", [])).toBeNull();
  });
});

// ── Klienten ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const tFor = (locale: "nb" | "nn" | "en-GB") => (key: string) => (translations as Record<string, Record<string, string>>)[locale]?.[key] ?? key;

describe("#1152 4b: linja i lista", () => {
  it("datoen: 13.05.2027 på norsk, 13 May 2027 på engelsk, uten å flytte seg i nettleserens tidssone", () => {
    expect(formatRetentionDate("2027-05-13", "nb")).toBe("13.05.2027");
    expect(formatRetentionDate("2027-05-13", "nn")).toBe("13.05.2027");
    expect(formatRetentionDate("2027-05-13", "en-GB")).toBe("13 May 2027");
    expect(formatRetentionDate("2027-02-01", "nb")).toBe("01.02.2027");
    expect(formatRetentionDate("ikke en dato", "nb")).toBe("");
  });

  it("«Slettes <dato>» og «Beholdes: <grunn>» på tre språk; nynorsk bøyer etter kjønnet", () => {
    const archived = { lifecycle: "archived" };
    expect(retentionLineHtml({ ...archived, retention: { deletesAt: "2027-05-13" } }, "course", tFor("nb"), "nb")).toBe(
      '<span class="retention-line" data-retention="deletes">Slettes 13.05.2027</span>',
    );
    expect(retentionLineHtml({ ...archived, retention: { deletesAt: "2027-05-13" } }, "module", tFor("en-GB"), "en-GB")).toContain(">To be deleted 13 May 2027<");
    expect(retentionLineHtml({ ...archived, retention: { deletesAt: "2027-05-13" } }, "section", tFor("nn"), "nn")).toContain(">Slettast 13.05.2027<");

    const kept = (code: string, details: Record<string, unknown> | null = null) => ({ ...archived, retention: { kept: { code, details } } });
    expect(retentionLineHtml(kept("course_has_completions", { count: 2 }), "course", tFor("nb"), "nb")).toBe(
      '<span class="retention-line" data-retention="kept" data-retention-code="course_has_completions">Beholdes: har kursbevis</span>',
    );
    expect(retentionLineHtml(kept("course_has_completions"), "course", tFor("nn"), "nn")).toContain(">Blir behalde: har kursbevis<");
    expect(retentionLineHtml(kept("module_has_submissions"), "module", tFor("nn"), "nn")).toContain(">Blir behalden: har svar frå deltakarar<");
    expect(retentionLineHtml(kept("content_in_archived_course"), "section", tFor("nb"), "nb")).toContain(">Beholdes: ligger i et kurs som beholdes<");
    expect(retentionLineHtml(kept("module_has_certification"), "module", tFor("en-GB"), "en-GB")).toContain(">Kept: has certifications<");
  });

  it("hver kode «Slett» kan svare med, har en grunn på hvert språk; en ukjent kode får den generelle", () => {
    const codes = [
      "course_has_completions", "course_has_completed_without_certificate", "course_requirement_unclear", "course_has_pending_reviews",
      "course_has_unfinished_submissions",
      "module_has_submissions", "module_has_certification", "content_in_issued_certificate", "content_in_legacy_certificate",
      "content_in_archived_course", "content_in_use", "module_in_use", "delete_blocked_by_course_draft",
    ];
    for (const locale of ["nb", "nn", "en-GB"] as const) {
      const t = tFor(locale);
      for (const code of codes) {
        const text = retentionReasonText({ code, details: { count: 1, untilDate: "2026-11-28" } }, t, locale);
        expect(text, `${locale} ${code}`).not.toMatch(/adminContent\.|\{/);
        expect(text, `${locale} ${code}`).not.toBe(t("adminContent.retention.reason.other"));
      }
      expect(retentionReasonText({ code: "noe_nytt", details: null }, t)).toBe(t("adminContent.retention.reason.other"));
    }
    expect(retentionReasonText({ code: "course_has_completed_without_certificate", details: { count: 1 } }, tFor("nb"))).toBe("en deltaker har fullført kravet uten kursbevis");
    expect(retentionReasonText({ code: "course_has_completed_without_certificate", details: { count: 3 } }, tFor("nb"))).toBe("3 deltakere har fullført kravet uten kursbevis");
    expect(retentionReasonText({ code: "course_has_completed_without_certificate", details: { count: 3 } }, tFor("en-GB"))).toBe("3 participants have completed the requirement without a certificate");
    // 2.169.0: kravet kunne ikke gjenskapes. Tallet bøyes som over.
    expect(retentionReasonText({ code: "course_requirement_unclear", details: { count: 1 } }, tFor("nb"))).toBe("uklart hva kurset krevde, og en deltaker har bestått eller lest noe av det");
    expect(retentionReasonText({ code: "course_requirement_unclear", details: { count: 2 } }, tFor("nn"))).toBe("uklart kva kurset kravde, og 2 deltakarar har bestått eller lese noko av det");
    // #1185: levert tekst uten å fullføre, med datoen på forfatterens språk.
    const unfinished = (count: number, untilDate?: string) => ({ code: "course_has_unfinished_submissions", details: { count, untilDate } });
    expect(retentionReasonText(unfinished(1, "2026-11-28"), tFor("nb"), "nb")).toBe("en deltaker har levert tekst uten å fullføre, til 28.11.2026");
    expect(retentionReasonText(unfinished(2, "2026-11-28"), tFor("nn"), "nn")).toBe("2 deltakarar har levert tekst utan å fullføre, til 28.11.2026");
    expect(retentionReasonText(unfinished(2, "2026-11-28"), tFor("en-GB"), "en-GB")).toBe("2 participants have delivered text without finishing, until 28 November 2026");
    // Uten lesbar dato: den generelle grunnen, ikke en setning som stopper på «til ».
    expect(retentionReasonText(unfinished(1), tFor("nb"), "nb")).toBe(tFor("nb")("adminContent.retention.reason.other"));
    expect(retentionLineHtml({ lifecycle: "archived", retention: { kept: unfinished(1, "2026-11-28") } }, "course", tFor("nb"), "nb"))
      .toContain(">Beholdes: en deltaker har levert tekst uten å fullføre, til 28.11.2026<");
  });

  it("#1185: kalenderdager i Norge — levert sent på kvelden norsk tid teller den norske datoen", () => {
    // 23:30 UTC 20. november er 00:30 21. november i Norge: sju dager fra 21. november.
    expect(addCalendarDays(osloCalendarDate(new Date("2026-11-20T23:30:00.000Z")), 7)).toBe("2026-11-28");
    expect(addCalendarDays({ year: 2026, month: 12, day: 28 }, 7)).toBe("2027-01-04");
    expect(addCalendarDays({ year: 2028, month: 2, day: 25 }, 7)).toBe("2028-03-03");
    expect(UNFINISHED_SUBMISSION_GRACE_DAYS).toBe(7);
  });

  it("ingenting for «ukjent», uten felt, eller på en rad som ikke er arkivert", () => {
    const t = tFor("nb");
    expect(retentionLineHtml({ lifecycle: "archived", retention: { unknown: true } }, "module", t, "nb")).toBe("");
    expect(retentionLineHtml({ lifecycle: "archived" }, "module", t, "nb")).toBe("");
    expect(retentionLineHtml({ lifecycle: "published", retention: { deletesAt: "2027-05-13" } }, "module", t, "nb")).toBe("");
  });
});
