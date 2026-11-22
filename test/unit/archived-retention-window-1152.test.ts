import { describe, expect, it } from "vitest";
import { insidePurgeWindow } from "../../src/modules/content/archivedRetentionJob.js";

// #1152 4c (QA 2.175.0): vinduet for slettejobben er 02:00–05:00 norsk tid, med 02:00 inne og 05:00 ute. Grensene og nettene klokka
// stilles om, festet her; integrasjonstesten prøver bare kl. 03 og kl. 12.

const at = (iso: string) => insidePurgeWindow(new Date(iso));

describe("#1152 4c: nattvinduet, norsk tid", () => {
  it("vintertid (UTC+1): 01:59 ute, 02:00 inne, 04:59 inne, 05:00 ute", () => {
    expect(at("2027-01-15T00:59:00.000Z")).toBe(false);
    expect(at("2027-01-15T01:00:00.000Z")).toBe(true);
    expect(at("2027-01-15T03:59:00.000Z")).toBe(true);
    expect(at("2027-01-15T04:00:00.000Z")).toBe(false);
  });

  it("sommertid (UTC+2): 02:00 er 00:00 UTC, 05:00 er 03:00 UTC", () => {
    expect(at("2027-05-14T23:59:00.000Z")).toBe(false);
    expect(at("2027-05-15T00:00:00.000Z")).toBe(true);
    expect(at("2027-05-15T02:59:00.000Z")).toBe(true);
    expect(at("2027-05-15T03:00:00.000Z")).toBe(false);
  });

  it("natten klokka stilles fram (28.03.2027, 02:00 → 03:00): vinduet er 03–05", () => {
    expect(at("2027-03-28T00:59:00.000Z")).toBe(false); // 01:59 vintertid
    expect(at("2027-03-28T01:00:00.000Z")).toBe(true); // 03:00 sommertid
    expect(at("2027-03-28T02:59:00.000Z")).toBe(true); // 04:59
    expect(at("2027-03-28T03:00:00.000Z")).toBe(false); // 05:00
  });

  it("natten klokka stilles tilbake (31.10.2027, 03:00 → 02:00): vinduet er 02:00 sommertid til 05:00 vintertid", () => {
    expect(at("2027-10-30T23:59:00.000Z")).toBe(false); // 01:59 sommertid
    expect(at("2027-10-31T00:00:00.000Z")).toBe(true); // 02:00 sommertid
    expect(at("2027-10-31T01:30:00.000Z")).toBe(true); // 02:30 vintertid (andre gang)
    expect(at("2027-10-31T03:59:00.000Z")).toBe(true); // 04:59 vintertid
    expect(at("2027-10-31T04:00:00.000Z")).toBe(false); // 05:00 vintertid
  });
});
