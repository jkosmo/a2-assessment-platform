import { createHash } from "node:crypto";
import { Marked, type Tokens } from "marked";

/**
 * Innholdsblokker i seksjonstekst (#1079): uthevet boks, prompt-boks, kort og ikon — pluss
 * tabeller som kan leses på telefon.
 *
 * Blokkene er vanlig markdown som leses annerledes, ikke et eget format. Teksten lagres,
 * oversettes, eksporteres og importeres som før, og den gir mening også der ingen tegner
 * blokkene (redigeringsfeltet, en eksportfil, en eldre versjon av plattformen):
 *
 *   > **Husk:** …            et sitat som åpner med fet merkelapp      → uthevet boks
 *   ```prompt … ```          en kodeblokk merket «prompt»              → prompt-boks med «Kopier»
 *   :::kort … :::            en ramme rundt underoverskrifter          → kort ved siden av hverandre
 *   :::tenk Spørsmål? … :::  et spørsmål med svaret inni rammen        → «tenk først», svaret bak et
 *                                                                        klikk (<details>, #1072)
 *   :::sjekk Spørsmål? … ::: alternativer `- [ ]`/`- [x]`             → «sjekk deg selv» (#1074)
 *   :::steg Tittel … :::     en ramme rundt underoverskrifter          → steg for steg (#1075)
 *   :::skriv Oppgave … :::   eksempelsvaret, så en sjekkliste `- [ ]`  → skriv selv (#1076)
 *   :::repetisjon … :::      en ramme rundt underoverskrifter          → repetisjonskort (#1078)
 *   ### ![](asset:x) Tittel  et bilde først i en kortoverskrift        → ikon
 *
 * Alt gjøres mens markdown blir til HTML (marked), som tekst. Ingen DOM bygges: plattformens
 * rensing kjører etterpå på resultatet, og et jsdom-tre per forespørsel er minne tjeneren ikke har.
 */

/** Merkelapper som gir boksen varselfarge. Sammenlignes uten kolon og med små bokstaver. */
const WARNING_LABELS = new Set(["viktig", "nb", "obs", "advarsel", "åtvaring", "important", "warning", "caution", "note well"]);

const COPY_LABELS: Record<string, { copy: string; copied: string }> = {
  nb: { copy: "Kopier", copied: "Kopiert" },
  nn: { copy: "Kopier", copied: "Kopiert" },
  "en-GB": { copy: "Copy", copied: "Copied" },
};

// #1072: merkelappen foran spørsmålet, og hintet som står til svaret er åpnet.
const THINK_LABELS: Record<string, { label: string; show: string }> = {
  nb: { label: "Tenk først", show: "Vis svaret" },
  nn: { label: "Tenk først", show: "Vis svaret" },
  "en-GB": { label: "Think first", show: "Show the answer" },
};

// #1074: merkelappen og tilbakemeldingen. Tilbakemeldingen settes av content-blocks.js fra data-
// attributtene, så skriptet trenger ingen oversettelser.
// srRight/srChosen: skjult tekst for skjermlesere på det riktige og det valgte alternativet, når
// deltakeren har svart — merket (✓/✗) og fargen er ellers det eneste som viser det.
const CHECK_LABELS: Record<string, { label: string; right: string; wrong: string; srRight: string; srChosen: string }> = {
  nb: { label: "Sjekk deg selv", right: "Riktig!", wrong: "Ikke helt. Riktig svar er markert.", srRight: "riktig svar", srChosen: "ditt svar" },
  nn: { label: "Sjekk deg sjølv", right: "Rett!", wrong: "Ikkje heilt. Rett svar er markert.", srRight: "rett svar", srChosen: "svaret ditt" },
  "en-GB": { label: "Check yourself", right: "Correct!", wrong: "Not quite. The right answer is marked.", srRight: "right answer", srChosen: "your answer" },
};

// #1075 «Steg for steg». `count` har plassholdere; content-blocks.js setter inn tallene. Uten skript
// brukes bare `label` — stegene står da som en nummerert liste.
const STEPS_LABELS: Record<string, { label: string; count: string; prev: string; next: string }> = {
  nb: { label: "Steg for steg", count: "Steg {n} av {total}", prev: "Forrige", next: "Neste" },
  nn: { label: "Steg for steg", count: "Steg {n} av {total}", prev: "Førre", next: "Neste" },
  "en-GB": { label: "Step by step", count: "Step {n} of {total}", prev: "Previous", next: "Next" },
};

// #1076 «Skriv selv». Alt tegnes av tjeneren og virker uten skript; skriptet tar bare vare på teksten.
const WRITE_LABELS: Record<string, { label: string; placeholder: string; hint: string; show: string; example: string; checklist: string }> = {
  nb: {
    label: "Skriv selv",
    placeholder: "Skriv svaret ditt her …",
    hint: "Teksten blir bare i denne nettleseren. Den sendes ikke og teller ikke.",
    show: "Vis eksempelsvar",
    example: "Eksempelsvar",
    checklist: "Fikk du med …",
  },
  nn: {
    label: "Skriv sjølv",
    placeholder: "Skriv svaret ditt her …",
    hint: "Teksten blir berre i denne nettlesaren. Han blir ikkje send og tel ikkje.",
    show: "Vis døme på svar",
    example: "Døme på svar",
    checklist: "Fekk du med …",
  },
  "en-GB": {
    label: "Write it yourself",
    placeholder: "Write your answer here …",
    hint: "Your text stays in this browser. It is not sent and does not count.",
    show: "Show an example answer",
    example: "Example answer",
    checklist: "Did you include …",
  },
};

// #1078 «Repetisjonskort». Uten skript står kortene som en definisjonsliste; skriptet bygger øvingen
// av lista og henter tekstene herfra (data-attributter), så det trenger ingen oversettelser.
const FLASH_LABELS: Record<string, {
  label: string; front: string; back: string; flip: string; count: string; hint: string; known: string;
  again: string; done: string; score: string; againMany: string; againOne: string; restart: string; practice: string;
}> = {
  nb: {
    label: "Repetisjonskort", front: "Begrep", back: "Forklaring", flip: "Snu kortet", count: "Kort {n} av {total}",
    hint: "klikk for å snu", known: "Kunne det", again: "Øv mer", done: "Ferdig!", score: "Du kunne {known} av {total}.",
    againMany: "Øv på de {n} igjen", againOne: "Øv på det igjen", restart: "Begynn på nytt", practice: "Øv med kortene",
  },
  nn: {
    label: "Repetisjonskort", front: "Omgrep", back: "Forklaring", flip: "Snu kortet", count: "Kort {n} av {total}",
    hint: "klikk for å snu", known: "Kunne det", again: "Øv meir", done: "Ferdig!", score: "Du kunne {known} av {total}.",
    againMany: "Øv på dei {n} igjen", againOne: "Øv på det igjen", restart: "Byrj på nytt", practice: "Øv med korta",
  },
  "en-GB": {
    label: "Flashcards", front: "Term", back: "Explanation", flip: "Turn the card", count: "Card {n} of {total}",
    hint: "click to turn", known: "Knew it", again: "Practise more", done: "Done!", score: "You knew {known} of {total}.",
    againMany: "Practise the {n} again", againOne: "Practise that one again", restart: "Start again", practice: "Practise with the cards",
  },
};

/** Et alternativ: `- [ ] tekst` eller `- [x] tekst` (også `*`, og stor X). */
const CHECK_OPTION = /^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+(\S.*)$/;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Et bilde først i en kortoverskrift, eller i en tabellcelle i en kolonne uten navn, er et ikon: fast
 *  størrelse (shared.css), ikke et bilde over hele bredden. I tabellen ble ikonet ellers klemt til 8 px i
 *  en smal spalte (stage, 2.85.0). Et bilde i en navngitt kolonne er et bilde (skjermbilde, foto) og
 *  beholder størrelsen sin — QA-porten målte 480 × 270 som ble 24 × 24. En tabell der ingen kolonne har
 *  navn, er den vanlige måten å sette bilder ved siden av hverandre på, ikke en stegtabell. */
function markLeadingIcon(html: string): string {
  return html.replace(/^\s*<img /, '<img class="content-icon" ');
}

/** Teksten i en bit HTML, uten merkene — til `data-label` og til å kjenne igjen merkelappen. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // «&amp;» til slutt: ellers blir «&amp;lt;» lest som «<».
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Regelen kort (#1079), steg (#1075) og repetisjonskort (#1078) deler: en overskrift (`###` i malen,
 * men nivået spiller ingen rolle) begynner et nytt element, og alt under den til neste overskrift hører
 * til elementet. Det som står før første overskrift, er en innledning. Bare overskrifter på øverste
 * nivå i rammen teller — en overskrift inni et sitat eller en liste begynner ikke noe.
 */
function splitAtHeadings(tokens: Tokens.Generic[]): { intro: Tokens.Generic[]; items: Array<{ heading: Tokens.Heading; body: Tokens.Generic[] }> } {
  const first = tokens.findIndex((t) => t.type === "heading");
  if (first < 0) return { intro: tokens, items: [] };
  const items: Array<{ heading: Tokens.Heading; body: Tokens.Generic[] }> = [];
  let at = first;
  while (at < tokens.length) {
    let end = at + 1;
    while (end < tokens.length && tokens[end]!.type !== "heading") end += 1;
    items.push({ heading: tokens[at] as Tokens.Heading, body: tokens.slice(at + 1, end) });
    at = end;
  }
  return { intro: tokens.slice(0, first), items };
}

/** Overskriftsnivået følger teksten, men et element i en ramme er aldri en hovedoverskrift. */
const itemLevel = (heading: Tokens.Heading) => Math.min(Math.max(heading.depth, 3), 6);

interface CheckToken extends Tokens.Generic {
  type: "contentCheck";
  raw: string;
  question: Tokens.Generic[];
  options: Array<{ correct: boolean; tokens: Tokens.Generic[] }>;
  tokens: Tokens.Generic[];
}

interface CardsToken extends Tokens.Generic {
  type: "contentCards";
  raw: string;
  tokens: Tokens.Generic[];
}

interface ThinkToken extends Tokens.Generic {
  type: "contentThink";
  raw: string;
  question: Tokens.Generic[];
  tokens: Tokens.Generic[];
}

/** #1075 og #1078: en ramme med tittel (valgfri) og minst to elementer, hvert med overskrift og innhold. */
interface ItemsToken extends Tokens.Generic {
  type: "contentSteps" | "contentFlash";
  raw: string;
  title: Tokens.Generic[];
  tokens: Tokens.Generic[];
}

interface WriteToken extends Tokens.Generic {
  type: "contentWrite";
  raw: string;
  task: Tokens.Generic[];
  key: string;
  tokens: Tokens.Generic[];
  checklist: Tokens.Generic[][];
}

/** En linje i sjekklista i «skriv selv»: `- [ ] tekst` (en `x` godtas og betyr det samme). */
const WRITE_CHECK_ITEM = /^[ \t]*[-*][ \t]+\[[ xX]\][ \t]+(\S.*?)[ \t]*$/;

/**
 * #1076: innholdet i en «skriv selv»-ramme delt i eksempelsvaret og sjekklista. Sjekklista er rekken av
 * `- [ ]`-linjer HELT til slutt i rammen — eksempelsvaret kan selv ha lister, også med avkrysning, så
 * lenge noe annet står etter dem. Ingen sjekkliste er lov; et tomt eksempelsvar er det ikke (`null`).
 */
function splitWriteFrame(inner: string): { example: string; checklist: string[] } | null {
  const lines = inner.split(/\r?\n/);
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") end -= 1;
  let start = end;
  while (start > 0 && WRITE_CHECK_ITEM.test(lines[start - 1]!)) start -= 1;
  const example = lines.slice(0, start).join("\n");
  if (example.trim() === "") return null;
  const checklist = lines.slice(start, end).map((line) => WRITE_CHECK_ITEM.exec(line)![1]!);
  return { example, checklist };
}

/**
 * #1076: nøkkelen teksten lagres under i nettleseren. Oppgaven og eksempelsvaret sammen skiller én
 * øvelse fra en annen — også i to seksjoner med samme generelle oppgavetekst, og på hvert språk for seg.
 * Ikke seksjonen eller adressen: leseren har samme adresse for alle seksjoner, og tegningen vet ikke
 * hvilken seksjon den er i. En forfatter som endrer oppgaven eller eksempelsvaret, får en ny øvelse.
 */
const writeKey = (task: string, example: string) => createHash("sha256").update(`${task}\n${example}`).digest("hex").slice(0, 16);

/** `locale` er alt siktet av renderSectionBlocks: et av språkene i COPY_LABELS, eller ingen. */
function createSectionMarked(locale?: string): Marked {
  const labels = COPY_LABELS[locale ?? "nb"]!;
  const think = THINK_LABELS[locale ?? "nb"]!;
  const check = CHECK_LABELS[locale ?? "nb"]!;
  const steps = STEPS_LABELS[locale ?? "nb"]!;
  const write = WRITE_LABELS[locale ?? "nb"]!;
  const flash = FLASH_LABELS[locale ?? "nb"]!;

  return new Marked({
    extensions: [
      {
        // #1072: «Tenk først» — et spørsmål midt i teksten, svaret skjult til deltakeren trykker.
        //   :::tenk Hva tror du skjer hvis …?
        //   Svaret, i vanlig markdown (avsnitt, lister, fet skrift).
        //   :::
        // Spørsmålet står på åpningslinja (uten spørsmål er det ingen blokk, og teksten står som den
        // er). Tegnes som <details>/<summary>: åpnes med klikk, Enter eller mellomrom uten skript, og
        // rensingen slipper elementene gjennom. «think» er samme blokk på engelsk.
        name: "contentThink",
        level: "block",
        start(src: string) {
          return src.match(/^:::[ \t]*(?:tenk|think)[ \t]+\S/im)?.index;
        },
        tokenizer(src: string) {
          const match = /^:::[ \t]*(?:tenk|think)[ \t]+([^\r\n]*\S)[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/i.exec(src);
          if (!match) return undefined;
          const token: ThinkToken = { type: "contentThink", raw: match[0], question: [], tokens: [] };
          this.lexer.inlineTokens(match[1]!, token.question as Tokens.Generic[] as never);
          this.lexer.blockTokens(match[2]!, token.tokens as Tokens.Generic[] as never);
          return token;
        },
        renderer(token) {
          const t = token as ThinkToken;
          const question = this.parser.parseInline(t.question as never);
          const answer = this.parser.parse(t.tokens as never);
          return (
            `<details class="content-think"><summary class="content-think-question">` +
            `<span class="content-think-label">${escapeHtml(think.label)}</span>` +
            `<span class="content-think-text">${question}</span>` +
            `<span class="content-think-hint">${escapeHtml(think.show)}</span>` +
            `</summary><div class="content-think-answer">${answer}</div></details>\n`
          );
        },
      },
      {
        // #1074: «Sjekk deg selv» — et flervalgsspørsmål midt i teksten. Teller ikke og lagres ikke.
        //   :::sjekk Hvilken kilde er viktigst?
        //   - [ ] Innkallingen
        //   - [x] Notatene fra møtet
        //   Forklaringen, i vanlig markdown.
        //   :::
        // Minst to alternativer og nøyaktig ett riktig; ellers er det ingen blokk, og teksten står som
        // den er (skillets kontroll melder det). Klikket håndteres av public/static/content-blocks.js.
        // Rensingen beholder data-attributter, så en forfatter KAN skrive en lignende knapp selv; det er
        // ufarlig — skript og hendelsesattributter fjernes, og klikket endrer bare utseende og tekst.
        name: "contentCheck",
        level: "block",
        start(src: string) {
          return src.match(/^:::[ \t]*(?:sjekk|check)[ \t]+\S/im)?.index;
        },
        tokenizer(src: string) {
          const match = /^:::[ \t]*(?:sjekk|check)[ \t]+([^\r\n]*\S)[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/i.exec(src);
          if (!match) return undefined;
          const lines = match[2]!.split(/\r?\n/);
          let at = 0;
          while (at < lines.length && lines[at]!.trim() === "") at += 1;
          const options: Array<{ correct: boolean; text: string }> = [];
          while (at < lines.length) {
            const option = CHECK_OPTION.exec(lines[at]!);
            if (!option) break;
            options.push({ correct: option[1]!.toLowerCase() === "x", text: option[2]! });
            at += 1;
          }
          if (options.length < 2 || options.filter((o) => o.correct).length !== 1) return undefined;
          const token: CheckToken = { type: "contentCheck", raw: match[0], question: [], options: [], tokens: [] };
          this.lexer.inlineTokens(match[1]!, token.question as Tokens.Generic[] as never);
          for (const option of options) {
            const tokens: Tokens.Generic[] = [];
            this.lexer.inlineTokens(option.text, tokens as never);
            token.options.push({ correct: option.correct, tokens });
          }
          this.lexer.blockTokens(lines.slice(at).join("\n"), token.tokens as Tokens.Generic[] as never);
          return token;
        },
        renderer(token) {
          const t = token as CheckToken;
          const question = this.parser.parseInline(t.question as never);
          const options = t.options
            .map((option, i) =>
              `<button type="button" class="content-check-option" data-check-option data-correct="${option.correct ? "true" : "false"}">` +
              `<span class="content-check-mark" aria-hidden="true">${String.fromCharCode(65 + i)}</span>` +
              `<span class="content-check-option-text">${this.parser.parseInline(option.tokens as never)}</span></button>`,
            )
            .join("");
          const explanation = this.parser.parse(t.tokens as never);
          return (
            `<div class="content-check" data-content-check data-right="${escapeHtml(check.right)}" data-wrong="${escapeHtml(check.wrong)}" data-sr-right="${escapeHtml(check.srRight)}" data-sr-chosen="${escapeHtml(check.srChosen)}">` +
            `<p class="content-check-question"><span class="content-check-label">${escapeHtml(check.label)}</span>` +
            `<span class="content-check-text">${question}</span></p>` +
            `<div class="content-check-options" role="group" aria-label="${escapeHtml(textOf(question))}">${options}</div>` +
            `<div class="content-check-feedback" aria-live="polite"><p class="content-check-verdict"></p>` +
            `<div class="content-check-explanation" hidden>${explanation}</div></div></div>\n`
          );
        },
      },
      {
        name: "contentCards",
        level: "block",
        // Sier hvor en ramme kan begynne, så et avsnitt rett over ikke sluker åpningslinja.
        start(src: string) {
          return src.match(/^:::[ \t]*(?:kort|cards)[ \t]*$/im)?.index;
        },
        tokenizer(src: string) {
          const match = /^:::[ \t]*(?:kort|cards)[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/i.exec(src);
          if (!match) return undefined;
          const token: CardsToken = { type: "contentCards", raw: match[0], tokens: [] };
          this.lexer.blockTokens(match[1]!, token.tokens as Tokens.Generic[] as never);
          return token;
        },
        renderer(token) {
          const { intro, items } = splitAtHeadings((token as CardsToken).tokens);
          // En ramme uten en eneste overskrift har ingen kort: innholdet står som vanlig tekst.
          if (items.length === 0) return this.parser.parse(intro as never);
          const cards = items.map(({ heading, body }) => {
            // Et bilde først i overskriften er kortets ikon.
            const title = markLeadingIcon(this.parser.parseInline(heading.tokens));
            const level = itemLevel(heading);
            return `<section class="content-card"><h${level} class="content-card-title">${title}</h${level}><div class="content-card-body">${this.parser.parse(body as never)}</div></section>`;
          });
          return `${this.parser.parse(intro as never)}<div class="content-cards">${cards.join("")}</div>\n`;
        },
      },
      {
        // #1075: «Steg for steg» — en prosess deltakeren blar gjennom ett steg av gangen.
        //   :::steg Slik behandler du en innsynsbegjæring
        //   ### Registrer begjæringen
        //   Teksten for steget, gjerne med en figur ![](asset:id).
        //   ### Finn dokumentene
        //   …
        //   :::
        // Tittelen er valgfri. Hver overskrift begynner et steg (samme regel som :::kort). Færre enn to
        // steg er ingen gjennomgang: da er det ingen blokk, og teksten står som den er. Tegnes som en
        // nummerert liste med alle stegene — det er det som vises uten skript, og det skjermlesere får
        // uten skript. public/static/content-blocks.js gjør lista til ett steg av gangen med Forrige og
        // Neste. «steps» er samme blokk på engelsk.
        name: "contentSteps",
        level: "block",
        start(src: string) {
          return src.match(/^:::[ \t]*(?:steg|steps)(?=[ \t\r\n]|$)/im)?.index;
        },
        tokenizer(src: string) {
          const match = /^:::[ \t]*(?:steg|steps)(?:[ \t]+([^\r\n]*?))?[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/i.exec(src);
          if (!match) return undefined;
          const token: ItemsToken = { type: "contentSteps", raw: match[0], title: [], tokens: [] };
          this.lexer.blockTokens(match[2]!, token.tokens as Tokens.Generic[] as never);
          if (splitAtHeadings(token.tokens).items.length < 2) return undefined;
          if (match[1]) this.lexer.inlineTokens(match[1], token.title as Tokens.Generic[] as never);
          return token;
        },
        renderer(token) {
          const t = token as ItemsToken;
          const { intro, items } = splitAtHeadings(t.tokens);
          const title = this.parser.parseInline(t.title as never);
          const name = textOf(title);
          const list = items
            .map(({ heading, body }) => {
              const level = itemLevel(heading);
              return (
                `<li class="content-step"><h${level} class="content-step-title">${this.parser.parseInline(heading.tokens)}</h${level}>` +
                `<div class="content-step-body">${this.parser.parse(body as never)}</div></li>`
              );
            })
            .join("");
          return (
            `<div class="content-steps" data-content-steps role="group" aria-label="${escapeHtml(name ? `${steps.label}: ${name}` : steps.label)}"` +
            ` data-count="${escapeHtml(steps.count)}" data-prev="${escapeHtml(steps.prev)}" data-next="${escapeHtml(steps.next)}">` +
            `<p class="content-steps-head"><span class="content-steps-label">${escapeHtml(steps.label)}</span>` +
            (title ? `<span class="content-steps-title">${title}</span>` : "") +
            `</p>${this.parser.parse(intro as never)}<ol class="content-steps-list">${list}</ol></div>\n`
          );
        },
      },
      {
        // #1076: «Skriv selv, sammenlign med fasit» — deltakeren skriver et svar og sammenligner med
        // et eksempelsvar og en sjekkliste. Teller ikke, sendes ikke.
        //   :::skriv Skriv vedtakspunktet for at styremøtene flyttes.
        //   **Vedtak:** Styremøtene flyttes … (eksempelsvaret, i vanlig markdown)
        //
        //   - [ ] hva som ble bestemt?
        //   - [ ] fra når det gjelder?
        //   :::
        // Oppgaven står på åpningslinja og er påkrevd. Sjekklista er `- [ ]`-linjene helt til slutt;
        // resten er eksempelsvaret, som ikke kan være tomt (ellers ingen blokk, og teksten står som den
        // er). Alt virker uten skript: tekstfeltet, <details> for eksempelsvaret og vanlige
        // avkrysningsbokser. content-blocks.js tar bare vare på teksten i nettleseren. «write» er samme
        // blokk på engelsk.
        name: "contentWrite",
        level: "block",
        start(src: string) {
          return src.match(/^:::[ \t]*(?:skriv|write)[ \t]+\S/im)?.index;
        },
        tokenizer(src: string) {
          const match = /^:::[ \t]*(?:skriv|write)[ \t]+([^\r\n]*\S)[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/i.exec(src);
          if (!match) return undefined;
          const parts = splitWriteFrame(match[2]!);
          if (!parts) return undefined;
          const token: WriteToken = {
            type: "contentWrite", raw: match[0], task: [], key: writeKey(match[1]!, parts.example), tokens: [], checklist: [],
          };
          this.lexer.inlineTokens(match[1]!, token.task as Tokens.Generic[] as never);
          this.lexer.blockTokens(parts.example, token.tokens as Tokens.Generic[] as never);
          for (const item of parts.checklist) {
            const tokens: Tokens.Generic[] = [];
            this.lexer.inlineTokens(item, tokens as never);
            token.checklist.push(tokens);
          }
          return token;
        },
        renderer(token) {
          const t = token as WriteToken;
          const task = this.parser.parseInline(t.task as never);
          const items = t.checklist
            .map((tokens) => `<li><label><input type="checkbox"> <span>${this.parser.parseInline(tokens as never)}</span></label></li>`)
            .join("");
          const checklist = items
            ? `<fieldset class="content-write-check"><legend class="content-write-checklist-label">${escapeHtml(write.checklist)}</legend><ul class="content-write-checklist">${items}</ul></fieldset>`
            : "";
          return (
            `<div class="content-write" data-content-write data-write-key="${t.key}">` +
            `<p class="content-write-head"><span class="content-write-label">${escapeHtml(write.label)}</span>` +
            `<span class="content-write-task">${task}</span></p>` +
            `<textarea class="content-write-field" data-write-field rows="4" aria-label="${escapeHtml(textOf(task))}" placeholder="${escapeHtml(write.placeholder)}"></textarea>` +
            `<p class="content-write-hint">${escapeHtml(write.hint)}</p>` +
            `<details class="content-write-reveal"><summary class="content-write-show">${escapeHtml(write.show)}</summary>` +
            `<div class="content-write-answer"><div class="content-write-example"><p class="content-write-example-label">${escapeHtml(write.example)}</p>` +
            `${this.parser.parse(t.tokens as never)}</div>${checklist}</div></details></div>\n`
          );
        },
      },
      {
        // #1078: «Repetisjonskort» — begrep på forsiden, forklaring på baksiden. Ingenting lagres.
        //   :::repetisjon
        //   ### Vedtak
        //   Det møtet bestemte, med ansvarlig og frist.
        //   ### Referent
        //   Den som skriver referatet.
        //   :::
        // Hver overskrift er en forside (samme regel som :::kort og :::steg), innholdet under den er
        // baksiden. Tittel på åpningslinja er valgfri. Færre enn to kort: ingen blokk. Tegnes som en
        // definisjonsliste, begrep og forklaring i par — det er det som vises uten skript, og det
        // skjermlesere leser. content-blocks.js bygger øvingen (snu, «kunne det»/«øv mer») av lista.
        // ⚠️ Ikke «:::kort» — det er kort ved siden av hverandre (#1079). «flashcards» er samme blokk på
        // engelsk.
        name: "contentFlash",
        level: "block",
        start(src: string) {
          return src.match(/^:::[ \t]*(?:repetisjon|flashcards)(?=[ \t\r\n]|$)/im)?.index;
        },
        tokenizer(src: string) {
          const match = /^:::[ \t]*(?:repetisjon|flashcards)(?:[ \t]+([^\r\n]*?))?[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/i.exec(src);
          if (!match) return undefined;
          const token: ItemsToken = { type: "contentFlash", raw: match[0], title: [], tokens: [] };
          this.lexer.blockTokens(match[2]!, token.tokens as Tokens.Generic[] as never);
          if (splitAtHeadings(token.tokens).items.length < 2) return undefined;
          if (match[1]) this.lexer.inlineTokens(match[1], token.title as Tokens.Generic[] as never);
          return token;
        },
        renderer(token) {
          const t = token as ItemsToken;
          const { intro, items } = splitAtHeadings(t.tokens);
          const title = this.parser.parseInline(t.title as never);
          const name = textOf(title);
          const pairs = items
            .map(({ heading, body }) => `<dt class="content-flash-front">${this.parser.parseInline(heading.tokens)}</dt><dd class="content-flash-back">${this.parser.parse(body as never)}</dd>`)
            .join("");
          const data = [
            ["front", flash.front], ["back", flash.back], ["flip", flash.flip], ["count", flash.count], ["hint", flash.hint],
            ["known", flash.known], ["again", flash.again], ["done", flash.done], ["score", flash.score],
            ["again-many", flash.againMany], ["again-one", flash.againOne], ["restart", flash.restart], ["practice", flash.practice],
          ]
            .map(([key, value]) => ` data-${key}="${escapeHtml(value!)}"`)
            .join("");
          return (
            `<div class="content-flash" data-content-flash role="group" aria-label="${escapeHtml(name ? `${flash.label}: ${name}` : flash.label)}"${data}>` +
            `<p class="content-flash-head"><span class="content-flash-label">${escapeHtml(flash.label)}</span>` +
            (title ? `<span class="content-flash-title">${title}</span>` : "") +
            `</p>${this.parser.parse(intro as never)}<dl class="content-flash-list">${pairs}</dl></div>\n`
          );
        },
      },
    ],
    renderer: {
      // ```prompt — en prompt, mal eller et eksempel deltakeren skal kopiere.
      code(token: Tokens.Code) {
        if ((token.lang ?? "").trim().toLowerCase() !== "prompt") return false;
        return (
          `<div class="content-prompt"><div class="content-prompt-header"><span>Prompt</span>` +
          `<button type="button" class="content-prompt-copy" data-copied-label="${escapeHtml(labels.copied)}">${escapeHtml(labels.copy)}</button></div>` +
          `<pre class="content-prompt-text">${escapeHtml(token.text)}</pre></div>\n`
        );
      },

      // > **Husk:** … — bare et sitat som ÅPNER med fet merkelapp. Et vanlig sitat står som sitat.
      blockquote(token: Tokens.Blockquote) {
        const body = this.parser.parse(token.tokens);
        const label = /^<p><strong>([^<]{1,60})<\/strong>/.exec(body);
        // Ikke `return false` her: da tegner marked sitatet en gang til, og i et nøstet sitat dobles
        // arbeidet for hvert nivå (QA-porten målte 30 nivåer til minutter). Dette er markeds eget resultat.
        if (!label) return `<blockquote>\n${body}</blockquote>\n`;
        const name = textOf(label[1]!).replace(/[:.!\s]+$/, "").toLowerCase();
        const classes = WARNING_LABELS.has(name) ? "content-callout content-callout--warning" : "content-callout";
        return `<blockquote class="${classes}">${body.replace("<p><strong>", '<p><strong class="content-callout-label">')}</blockquote>\n`;
      },

      // Hver celle bærer navnet på kolonnen sin. På telefon står cellene under hverandre
      // (shared.css), og uten navnet vet ikke leseren hva som er hva. Innholdet står i én <span>:
      // cellen er flex på telefon, og uten den blir hvert ord og hver fet bit sitt eget element.
      table(token: Tokens.Table) {
        const align = (value: string | null) => (value ? ` align="${value}"` : "");
        const headers = token.header.map((cell) => this.parser.parseInline(cell.tokens));
        const head = token.header.map((cell, i) => `<th${align(cell.align)}>${headers[i]}</th>`).join("");
        const hasNamedColumn = headers.some((header) => textOf(header) !== "");
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell, i) => {
                  const label = textOf(headers[i] ?? "");
                  const inner = this.parser.parseInline(cell.tokens);
                  return `<td${align(cell.align)} data-label="${escapeHtml(label)}"><span>${!label && hasNamedColumn ? markLeadingIcon(inner) : inner}</span></td>`;
                })
                .join("")}</tr>`,
          )
          .join("\n");
        return `<table class="content-table"><thead><tr>${head}</tr></thead>${rows ? `<tbody>${rows}</tbody>` : ""}</table>\n`;
      },
    },
  });
}

const byLocale = new Map<string, Marked>();

/** Seksjonsmarkdown til HTML, med innholdsblokkene tegnet. Resultatet er IKKE renset. */
export function renderSectionBlocks(markdown: string, locale?: string): string {
  const key = locale && Object.hasOwn(COPY_LABELS, locale) ? locale : "";
  let instance = byLocale.get(key);
  if (!instance) {
    instance = createSectionMarked(key || undefined);
    byLocale.set(key, instance);
  }
  return instance.parse(markdown, { async: false }) as string;
}
