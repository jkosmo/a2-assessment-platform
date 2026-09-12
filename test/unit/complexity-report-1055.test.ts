import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// #1055: rapporten skal alltid kunne kjøres. Den leser tellerne fra andre tester ved navn
// (`const TAK = …`, `const BASELINE = {…}`); døper noen om en av dem, skal det synes her — ikke
// først når noen prøver å lage rapporten før en release.
describe("#1055 — kompleksitetsrapporten kjører", () => {
  it("--check skriver en rapport med samlet skår og alle fem dimensjonene", () => {
    const ut = execFileSync("npx", ["tsx", "scripts/complexity/report.ts", "--check"], { encoding: "utf8", shell: true, timeout: 120_000 });
    expect(ut).toMatch(/## Samlet: \*\*\d{1,3} \/ 100\*\*/);
    for (const overskrift of ["## 1. Regler som er skrevet flere steder", "## 2. Viktige regler", "## 3. Filer alt må gjennom", "## 4. Filer som alltid endres sammen", "## 5. Størrelse"]) {
      expect(ut).toContain(overskrift);
    }
    // Ingen egne uttrykk fra utviklingsarbeidet i rapporten — den skal kunne leses av alle.
    expect(ut).not.toMatch(/\b(ratsj|vakt|vakta|samendring|nav(et|ene)?)\b/i);
  }, 150_000);
});
