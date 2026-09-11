import { describe, expect, it } from "vitest";
import { buildSentReminderKeySet, reminderDedupKey, reminderDedupKeyFromMetadataJson } from "../../src/modules/course/courseReminderDedup.js";

// #971: dedup bodde i strengrepresentasjonen av JSON. `"daysBefore":3` traff `"daysBefore":30`, og
// et felt i ny rekkefølge ville slått av dedup uten en feil — e-poststorm hver syklus.

describe("#971 — dedup-nøkkelen er data, ikke substring", () => {
  it("⚠️ daysBefore 3 og 30 er to ulike nøkler", () => {
    const rad30 = JSON.stringify({ courseId: "c", userId: "u1", kind: "due_soon", daysBefore: 30, asOfDate: "2026-09-11" });
    const sendt = buildSentReminderKeySet([{ metadataJson: rad30 }]);
    expect(sendt.has(reminderDedupKey({ userId: "u1", kind: "due_soon", daysBefore: 30, asOfDate: "2026-09-11" }))).toBe(true);
    // Substring-søket `"daysBefore":3` traff denne raden. Nøkkelen gjør det ikke.
    expect(sendt.has(reminderDedupKey({ userId: "u1", kind: "due_soon", daysBefore: 3, asOfDate: "2026-09-11" }))).toBe(false);
  });

  it("⚠️ feltrekkefølge og mellomrom i JSON-en er irrelevant", () => {
    const a = '{"asOfDate":"2026-09-11","daysBefore":7,"kind":"due_soon","userId":"u2","dueAt":"x"}';
    const b = '{ "userId": "u2", "kind": "due_soon", "daysBefore": 7, "asOfDate": "2026-09-11" }';
    expect(reminderDedupKeyFromMetadataJson(a)).toBe(reminderDedupKeyFromMetadataJson(b));
    expect(reminderDedupKeyFromMetadataJson(a)).toBe(reminderDedupKey({ userId: "u2", kind: "due_soon", daysBefore: 7, asOfDate: "2026-09-11" }));
  });

  it("overdue er én per mottaker — dagen spiller ingen rolle", () => {
    const rad = JSON.stringify({ userId: "u3", kind: "overdue", asOfDate: "2026-09-01" });
    const sendt = buildSentReminderKeySet([{ metadataJson: rad }]);
    expect(sendt.has(reminderDedupKey({ userId: "u3", kind: "overdue", asOfDate: "2026-09-11" }))).toBe(true);
  });

  it("en bruker-id som er prefiks av en annen kolliderer ikke", () => {
    // Substring: `"userId":"u1"` traff ikke `"userId":"u12"` (anførselstegnet reddet det), men
    // nøkkelen skal heller ikke gjøre det — kontroll på at skilletegnet holder.
    const sendt = buildSentReminderKeySet([{ metadataJson: JSON.stringify({ userId: "u12", kind: "overdue" }) }]);
    expect(sendt.has(reminderDedupKey({ userId: "u1", kind: "overdue" }))).toBe(false);
  });

  it("ugyldige rader (ikke JSON, feil form) ignoreres i stedet for å krasje kjøringen", () => {
    const sendt = buildSentReminderKeySet([{ metadataJson: "{not json" }, { metadataJson: '{"kind":"due_soon"}' }, { metadataJson: "null" }]);
    expect(sendt.size).toBe(0);
  });
});
