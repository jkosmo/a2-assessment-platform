import { toCsv } from "../src/modules/reporting/csvExport.js";

// Guards the architecture-review finding "CSV exports allow spreadsheet formula injection": exports
// contain author-controlled titles + participant identity fields, so a cell like =HYPERLINK(...) would
// execute when a report reader opens the CSV in Excel/Sheets (CWE-1236).
describe("csv formula-injection neutralization", () => {
  it("prefixes an apostrophe on string cells that start with a formula trigger", () => {
    for (const payload of ["=1+1", "+1", "-cmd", "@SUM(A1)", "\tx", "\rx"]) {
      const line = toCsv([{ title: payload }], ["title"]).split("\n")[1];
      // The rendered cell (unwrapped of any CSV quoting) must begin with the neutralizing apostrophe.
      const cell = line.startsWith('"') ? line.slice(1) : line;
      expect(cell.startsWith("'")).toBe(true);
    }
  });

  it("neutralizes a real =HYPERLINK payload", () => {
    const line = toCsv([{ title: '=HYPERLINK("http://evil","x")' }], ["title"]).split("\n")[1];
    expect(line).toContain("'=HYPERLINK");
  });

  it("does NOT corrupt numeric or date cells (negative numbers stay numeric)", () => {
    const line = toCsv([{ score: -5, when: new Date("2026-07-19T00:00:00.000Z") }], ["score", "when"]).split("\n")[1];
    expect(line).toBe("-5,2026-07-19T00:00:00.000Z");
    expect(line).not.toContain("'");
  });

  it("leaves ordinary text untouched", () => {
    const line = toCsv([{ title: "Introduction to Safety" }], ["title"]).split("\n")[1];
    expect(line).toBe("Introduction to Safety");
  });
});
