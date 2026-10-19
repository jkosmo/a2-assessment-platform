import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.js";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1075 «Steg for steg», #1076 «Skriv selv» og #1078 «Repetisjonskort»: tre rammer i seksjonsteksten,
// som «sjekk deg selv» (#1074). Disse testene holder tegningen og rensingen på tjeneren. Det som skjer i
// nettleseren, står i test/dom/content-practice-blocks.dom.test.js og
// test/e2e/participant-practice-blocks-1075-1076-1078.spec.ts.

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const lines = (...rows: string[]) => rows.join(NL);

const STEPS = lines(
  "Før gjennomgangen.",
  "",
  ":::steg Slik behandler du en **innsynsbegjæring**",
  "### Registrer begjæringen",
  "Før den inn i arkivet.",
  "![Steg 1 uthevet](asset:fig-innsyn-1)",
  "",
  "### Finn dokumentene",
  "Søk i arkivet.",
  "",
  "### Svar og begrunn",
  "- Send svaret",
  "- Begrunn et avslag",
  ":::",
  "",
  "Etter gjennomgangen.",
);

const WRITE = lines(
  ":::skriv Skriv vedtakspunktet for at møtene flyttes.",
  "**Vedtak:** Møtene flyttes til torsdag.",
  "",
  "- et punkt i eksempelsvaret",
  "- et punkt til",
  "",
  "- [ ] hva som ble bestemt?",
  "- [ ] fra når det gjelder?",
  ":::",
);

const FLASH = lines(
  ":::repetisjon Fagord i møtearbeid",
  "### Vedtak",
  "Det møtet bestemte, med ansvarlig og frist.",
  "",
  "### Referent",
  "Den som skriver **referatet**.",
  "",
  "### Habil",
  "Uten personlig interesse i saken.",
  ":::",
);

describe("#1075 «Steg for steg»: en ramme rundt underoverskrifter", () => {
  it("blir en nummerert liste med ett punkt per overskrift, med merkelapp, tittel og tekstene skriptet trenger", () => {
    const html = renderSectionBlocks(STEPS, "nb");
    expect(html).toContain(
      '<div class="content-steps" data-content-steps role="group" aria-label="Steg for steg: Slik behandler du en innsynsbegjæring" data-count="Steg {n} av {total}" data-prev="Forrige" data-next="Neste">',
    );
    expect(html).toContain('<span class="content-steps-label">Steg for steg</span><span class="content-steps-title">Slik behandler du en <strong>innsynsbegjæring</strong></span>');
    expect(html.match(/<li class="content-step">/g)).toHaveLength(3);
    expect(html).toContain('<ol class="content-steps-list"><li class="content-step"><h3 class="content-step-title">Registrer begjæringen</h3><div class="content-step-body"><p>Før den inn i arkivet.');
    expect(html).toContain('<h3 class="content-step-title">Svar og begrunn</h3><div class="content-step-body"><ul>');
    expect(html).not.toContain(":::");
    expect(html.indexOf("<p>Før gjennomgangen.</p>")).toBeLessThan(html.indexOf("content-steps"));
    expect(html.indexOf("<p>Etter gjennomgangen.</p>")).toBeGreaterThan(html.lastIndexOf("</ol>"));
  });

  it("en figur i et steg peker på figuren, på deltakerens språk", () => {
    expect(renderSectionMarkdown(STEPS, "nn")).toContain('<img src="/api/content-assets/fig-innsyn-1?locale=nn" alt="Steg 1 uthevet">');
  });

  it("etikettene følger språket; «steps» er samme blokk, og store bokstaver spiller ingen rolle", () => {
    const en = renderSectionBlocks(STEPS.replace(":::steg", ":::Steps"), "en-GB");
    expect(en).toContain('data-count="Step {n} of {total}" data-prev="Previous" data-next="Next"');
    expect(en).toContain('<span class="content-steps-label">Step by step</span>');
    expect(renderSectionBlocks(STEPS, "nn")).toContain('data-prev="Førre"');
  });

  it("tittelen er valgfri", () => {
    const html = renderSectionBlocks(lines(":::steg", "### A", "en", "### B", "to", ":::"), "nb");
    expect(html).toContain('aria-label="Steg for steg"');
    expect(html).toContain('<p class="content-steps-head"><span class="content-steps-label">Steg for steg</span></p>');
    expect(html.match(/<li class="content-step">/g)).toHaveLength(2);
  });

  it("tekst mellom åpningen og første overskrift står i blokken, over stegene", () => {
    const html = renderSectionBlocks(lines(":::steg Tittel", "Slik gjør du det.", "", "### A", "en", "### B", "to", ":::"), "nb");
    expect(html).toMatch(/<\/p><p>Slik gjør du det\.<\/p>\s*<ol class="content-steps-list">/);
  });

  it("overskriftsnivået følger teksten, men et steg er aldri en hovedoverskrift", () => {
    const html = renderSectionBlocks(lines(":::steg", "#### A", "en", "# B", "to", ":::"), "nb");
    expect(html).toContain('<h4 class="content-step-title">A</h4>');
    expect(html).toContain('<h3 class="content-step-title">B</h3>');
  });

  it.each<[string, string]>([
    ["bare ett steg", lines(":::steg Tittel", "### Eneste", "Tekst.", ":::")],
    ["ingen overskrift", lines(":::steg Tittel", "Bare tekst.", ":::")],
    ["tom ramme", lines(":::steg Tittel", ":::")],
    ["en ramme som aldri lukkes", lines(":::steg Tittel", "### A", "en", "### B", "to")],
  ])("%s: ingen blokk, og teksten står som den er", (_name, markdown) => {
    const html = renderSectionBlocks(markdown, "nb");
    expect(html).not.toContain("content-steps");
    expect(html).toContain(":::steg Tittel");
  });

  it("Windows-linjeskift (CRLF) gir samme blokk", () => {
    const html = renderSectionBlocks(lines(":::steg T", "### A", "", "en", "", "### B", "", "to", ":::").split(NL).join(CRLF), "nb");
    expect(html.match(/<li class="content-step">/g)).toHaveLength(2);
    expect(html).not.toContain(":::");
  });

  it("rammer kan ikke nøstes: første ::: lukker, og en ramme inni blir ikke tegnet", () => {
    const html = renderSectionBlocks(lines(":::steg T", "### A", "en", "### B", ":::tenk Hva tror du?", "Svaret.", ":::", ":::"), "nb");
    expect(html).toContain("content-steps");
    expect(html).not.toContain("content-think");
  });

  it("«:::stegvis» er ikke en ramme", () => {
    expect(renderSectionBlocks(lines(":::stegvis", "### A", "en", "### B", "to", ":::"), "nb")).not.toContain("content-steps");
  });
});

describe("#1076 «Skriv selv»: eksempelsvar og sjekkliste", () => {
  it("blir tekstfelt, hint, eksempelsvar bak <details> og sjekklista som avkrysningsbokser", () => {
    const html = renderSectionBlocks(WRITE, "nb");
    expect(html).toMatch(/^<div class="content-write" data-content-write data-write-key="[0-9a-f]{16}">/);
    expect(html).toContain('<span class="content-write-label">Skriv selv</span><span class="content-write-task">Skriv vedtakspunktet for at møtene flyttes.</span>');
    expect(html).toContain('<textarea class="content-write-field" data-write-field rows="4" aria-label="Skriv vedtakspunktet for at møtene flyttes." placeholder="Skriv svaret ditt her …"></textarea>');
    expect(html).toContain('<p class="content-write-hint">Teksten blir bare i denne nettleseren. Den sendes ikke og teller ikke.</p>');
    expect(html).toContain('<details class="content-write-reveal"><summary class="content-write-show">Vis eksempelsvar</summary>');
    expect(html).toContain('<p class="content-write-example-label">Eksempelsvar</p><p><strong>Vedtak:</strong> Møtene flyttes til torsdag.</p>');
    expect(html).toContain('<legend class="content-write-checklist-label">Fikk du med …</legend>');
    expect(html.match(/<input type="checkbox">/g)).toHaveLength(2);
    expect(html).toContain('<li><label><input type="checkbox"> <span>hva som ble bestemt?</span></label></li>');
  });

  it("en liste i eksempelsvaret står i eksempelsvaret; bare de avsluttende `- [ ]`-linjene er sjekklista", () => {
    const html = renderSectionBlocks(WRITE, "nb");
    const example = html.slice(html.indexOf("content-write-example"), html.indexOf("content-write-check"));
    expect(example).toContain("<li>et punkt i eksempelsvaret</li>");
    expect(example).not.toContain("hva som ble bestemt");
    // En avkrysningsliste midt i eksempelsvaret, med tekst etter, er en del av svaret.
    const mid = renderSectionBlocks(lines(":::skriv Oppgave", "- [ ] et punkt i svaret", "", "Mer svar.", "", "- [ ] sjekk", ":::"), "nb");
    expect(mid.match(/<input type="checkbox">/g)).toHaveLength(1);
  });

  it("uten sjekkliste: bare eksempelsvaret", () => {
    const html = renderSectionBlocks(lines(":::skriv Oppgave", "Svaret.", ":::"), "nb");
    expect(html).toContain("content-write-example");
    expect(html).not.toContain("<fieldset");
  });

  it.each<[string, string]>([
    ["bare sjekkliste, ikke noe eksempelsvar", lines(":::skriv Oppgave", "- [ ] a", "- [ ] b", ":::")],
    ["ingen oppgave på åpningslinja", lines(":::skriv", "Svaret.", ":::")],
    ["tom ramme", lines(":::skriv Oppgave", ":::")],
    ["en ramme som aldri lukkes", lines(":::skriv Oppgave", "Svaret.")],
  ])("%s: ingen blokk, og teksten står som den er", (_name, markdown) => {
    const html = renderSectionBlocks(markdown, "nb");
    expect(html).not.toContain("content-write");
    expect(html).toContain(":::skriv");
  });

  it("etikettene følger språket; «write» er samme blokk", () => {
    const en = renderSectionBlocks(WRITE.replace(":::skriv", ":::write"), "en-GB");
    expect(en).toContain('<span class="content-write-label">Write it yourself</span>');
    expect(en).toContain('<summary class="content-write-show">Show an example answer</summary>');
    expect(en).toContain("Did you include …");
    const nn = renderSectionBlocks(WRITE, "nn");
    expect(nn).toContain("Skriv sjølv");
    expect(nn).toContain("Vis døme på svar");
  });

  it("nøkkelen i nettleseren: lik for samme øvelse, ulik når oppgaven eller eksempelsvaret er en annen", () => {
    const key = (markdown: string) => /data-write-key="([0-9a-f]{16})"/.exec(renderSectionBlocks(markdown, "nb"))![1];
    const base = key(WRITE);
    expect(key(WRITE)).toBe(base);
    // Samme oppgavetekst i en annen seksjon, med et annet eksempelsvar, er en annen øvelse.
    expect(key(WRITE.replace("Møtene flyttes til torsdag.", "Møtene flyttes til onsdag."))).not.toBe(base);
    expect(key(WRITE.replace("Skriv vedtakspunktet", "Skriv referatpunktet"))).not.toBe(base);
    // Sjekklista er ikke med: en forfatter som legger til et punkt, sletter ikke det deltakeren skrev.
    expect(key(WRITE.replace("- [ ] fra når det gjelder?", "- [ ] fra når det gjelder?\n- [ ] hvem?"))).toBe(base);
  });

  it("Windows-linjeskift (CRLF): samme sjekkliste og samme nøkkel", () => {
    const crlf = renderSectionBlocks(WRITE.split(NL).join(CRLF), "nb");
    expect(crlf.match(/<input type="checkbox">/g)).toHaveLength(2);
    expect(/data-write-key="(\w+)"/.exec(crlf)![1]).toBe(/data-write-key="(\w+)"/.exec(renderSectionBlocks(WRITE, "nb"))![1]);
  });

  it("forfatter-HTML i oppgaven bryter ikke ut av aria-label, og blir ikke et skript", () => {
    const html = renderSectionMarkdown(lines(':::skriv Skriv " onfocus="alert(1) <img src=x onerror="alert(2)">', "Svar.", ":::"), "nb");
    const doc = new JSDOM(html).window.document;
    const field = doc.querySelector("textarea.content-write-field")!;
    // Anførselstegnet står som tekst i etiketten, ikke som slutten på attributtet.
    expect(field.getAttribute("aria-label")).toBe('Skriv " onfocus="alert(1)');
    expect(doc.querySelectorAll("[onfocus], [onerror]")).toHaveLength(0);
  });
});

describe("#1078 «Repetisjonskort»: begrep på forsiden, forklaring på baksiden", () => {
  it("blir en definisjonsliste med begrep og forklaring i par, og tekstene øvingen trenger", () => {
    const html = renderSectionBlocks(FLASH, "nb");
    expect(html).toContain('<div class="content-flash" data-content-flash role="group" aria-label="Repetisjonskort: Fagord i møtearbeid"');
    for (const attribute of [
      'data-front="Begrep"', 'data-back="Forklaring"', 'data-flip="Snu kortet"', 'data-count="Kort {n} av {total}"', 'data-hint="klikk for å snu"',
      'data-known="Kunne det"', 'data-again="Øv mer"', 'data-done="Ferdig!"', 'data-score="Du kunne {known} av {total}."',
      'data-again-many="Øv på de {n} igjen"', 'data-again-one="Øv på det igjen"', 'data-restart="Begynn på nytt"',
    ]) expect(html, attribute).toContain(attribute);
    expect(html.match(/<dt class="content-flash-front">/g)).toHaveLength(3);
    expect(html).toContain('<dt class="content-flash-front">Referent</dt><dd class="content-flash-back"><p>Den som skriver <strong>referatet</strong>.</p>');
    expect(html).toContain('<span class="content-flash-label">Repetisjonskort</span><span class="content-flash-title">Fagord i møtearbeid</span>');
  });

  it("etikettene følger språket; «flashcards» er samme blokk; tittelen er valgfri", () => {
    const en = renderSectionBlocks(FLASH.replace(":::repetisjon Fagord i møtearbeid", ":::flashcards"), "en-GB");
    expect(en).toContain('aria-label="Flashcards"');
    expect(en).toContain('data-known="Knew it" data-again="Practise more"');
    expect(renderSectionBlocks(FLASH, "nn")).toContain('data-front="Omgrep"');
  });

  it.each<[string, string]>([
    ["bare ett kort", lines(":::repetisjon", "### Vedtak", "Det møtet bestemte.", ":::")],
    ["ingen overskrift", lines(":::repetisjon", "Bare tekst.", ":::")],
    ["tom ramme", lines(":::repetisjon", ":::")],
  ])("%s: ingen blokk, og teksten står som den er", (_name, markdown) => {
    const html = renderSectionBlocks(markdown, "nb");
    expect(html).not.toContain("content-flash");
    expect(html).toContain(":::repetisjon");
  });

  it("«:::kort» er fortsatt kort ved siden av hverandre, ikke repetisjonskort", () => {
    const html = renderSectionBlocks(lines(":::kort", "### A", "en", "### B", "to", ":::"), "nb");
    expect(html).toContain("content-cards");
    expect(html).not.toContain("content-flash");
  });

  it("Windows-linjeskift (CRLF) gir samme kort", () => {
    expect(renderSectionBlocks(FLASH.split(NL).join(CRLF), "nb").match(/<dt class="content-flash-front">/g)).toHaveLength(3);
  });
});

// Det tjeneren tegner, må overleve tjenerens rensing (DOMPurify). Klientens rensing har samme regel
// (public/static/sanitize.js) og prøves i e2e-testen.
describe("rensingen på tjeneren slipper gjennom det blokkene tegner", () => {
  it("steg: lista, rollen, aria-feltet og data-attributtene", () => {
    const html = renderSectionMarkdown(STEPS, "nb");
    expect(html).toContain('data-content-steps=""');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Steg for steg: Slik behandler du en innsynsbegjæring"');
    expect(html).toContain('data-count="Steg {n} av {total}"');
    expect(html).toContain('<ol class="content-steps-list"><li class="content-step"><h3 class="content-step-title">');
  });

  it("skriv selv: tekstfeltet med etikett og plassholder, avkrysningsboksene, <details>, <fieldset> og nøkkelen", () => {
    const html = renderSectionMarkdown(WRITE, "nb");
    expect(html).toMatch(/<textarea class="content-write-field" data-write-field="" rows="4" aria-label="Skriv vedtakspunktet for at møtene flyttes\." placeholder="Skriv svaret ditt her …"><\/textarea>/);
    expect(html.match(/<input type="checkbox">/g)).toHaveLength(2);
    expect(html).toContain('<details class="content-write-reveal"><summary class="content-write-show">');
    expect(html).toContain('<fieldset class="content-write-check"><legend class="content-write-checklist-label">');
    expect(html).toMatch(/data-write-key="[0-9a-f]{16}"/);
  });

  it("repetisjonskort: definisjonslista og data-attributtene", () => {
    const html = renderSectionMarkdown(FLASH, "nb");
    expect(html).toContain('<dl class="content-flash-list"><dt class="content-flash-front">Vedtak</dt><dd class="content-flash-back">');
    expect(html).toContain('data-again-many="Øv på de {n} igjen"');
    expect(html).toContain('data-content-flash=""');
  });

  it.each<[string, string]>([
    ["et steg", lines(":::steg", "### <img src=x onerror=alert(1)> A", '<script>alert(2)</script><a href="javascript:alert(3)">lenke</a>', "### B", "to", ":::")],
    ["et eksempelsvar og en sjekkliste", lines(":::skriv Oppgave", '<span onclick="alert(1)">svar</span>', "", "- [ ] <img src=x onerror=alert(2)>", ":::")],
    ["et kort", lines(":::repetisjon", "### <img src=x onerror=alert(1)> A", "<script>alert(2)</script>", "### B", "to", ":::")],
  ])("skript og hendelser fjernes i %s", (_name, markdown) => {
    expect(renderSectionMarkdown(markdown, "nb")).not.toMatch(/<script|onerror|onclick|javascript:/i);
  });
});
