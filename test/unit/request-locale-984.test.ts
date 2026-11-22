import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// `config/env.js` validerer hele miljøet ved import og avslutter prosessen uten DATABASE_URL m.m.
// Enhetstesten trenger bare én verdi, så den erstattes — og settes til noe som IKKE er «en-GB»,
// slik at en hjelper som falt tilbake på literalen ville bli avslørt.
vi.mock("../../src/config/env.js", () => ({ env: { DEFAULT_LOCALE: "nn" } }));
import { requestLocale } from "../../src/i18n/requestLocale.js";
import { env } from "../../src/config/env.js";

// ─────────────────────────────────────────────────────────────────────────────
// #984: 28 reserver for «hvilket språk gjelder», med tre ulike svar.
//
// `?? "nb"` femten steder, `?? "en-GB"` ti, `?? env.DEFAULT_LOCALE` to, én i `authorization.ts`.
// Alle DØDE — `authenticate` setter alltid `context.locale`. Men de leses som om de gjaldt, og de
// blir levende den dagen en rute monteres uten `authenticate`. Da ville modul-lista svart engelsk
// og ankeflaten bokmål for samme bruker.
//
// ⚠️ Saken hevdet også at `User.locale` var en død kolonne. Den finnes ikke — linjen som ble lest
// var `Submission.locale`. Det er ingen lagret språkpreferanse per bruker i dag; det er #970s sak.
// ─────────────────────────────────────────────────────────────────────────────

describe("#984 — requestLocale er den ene reserven", () => {
  it("konteksten vinner når den finnes", () => {
    expect(requestLocale({ context: { locale: "nb" } } as never)).toBe("nb");
  });

  it("⚠️ uten kontekst: den KONFIGURERTE standarden, ikke et språk noen skrev i en rute", () => {
    expect(requestLocale({ context: undefined } as never)).toBe(env.DEFAULT_LOCALE);
  });
});

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const FALLBACK = /context\??\.locale\s*\?\?/;
describe("#984 — vakt: ingen rute har sin egen reserve lenger", () => {
  // Testgjennomgangen 2026-11 (avsnitt 5.3): kontrollen. Skrives reserven om i hjelperen, kan mønsteret slutte å treffe
  // noe, og vakta under blir grønn uten å se. Da skal denne bli rød.
  it("kontroll: mønsteret treffer reserven i hjelperen selv", () => {
    const helper = readFileSync(join(SRC, "i18n", "requestLocale.ts"), "utf8");
    expect(helper.split("\n").filter((line) => FALLBACK.test(line))).toHaveLength(1);
  });

  it("⚠️ `context?.locale ?? <noe>` finnes bare i hjelperen", () => {
    const treff: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith("requestLocale.ts")) continue;
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (FALLBACK.test(line)) treff.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(treff.join("\n"), "bruk requestLocale(request) fra src/i18n/requestLocale.ts").toBe("");
  });
});
