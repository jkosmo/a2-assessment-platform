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

/** `locale` er alt siktet av renderSectionBlocks: et av språkene i COPY_LABELS, eller ingen. */
function createSectionMarked(locale?: string): Marked {
  const labels = COPY_LABELS[locale ?? "nb"]!;
  const think = THINK_LABELS[locale ?? "nb"]!;
  const check = CHECK_LABELS[locale ?? "nb"]!;

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
          const inner = (token as CardsToken).tokens;
          const first = inner.findIndex((t) => t.type === "heading");
          // En ramme uten en eneste overskrift har ingen kort: innholdet står som vanlig tekst.
          if (first < 0) return this.parser.parse(inner as never);

          const intro = this.parser.parse(inner.slice(0, first) as never);
          const cards: string[] = [];
          let at = first;
          while (at < inner.length) {
            const heading = inner[at] as Tokens.Heading;
            let end = at + 1;
            while (end < inner.length && inner[end]!.type !== "heading") end += 1;
            // Et bilde først i overskriften er kortets ikon.
            const title = markLeadingIcon(this.parser.parseInline(heading.tokens));
            const body = this.parser.parse(inner.slice(at + 1, end) as never);
            const level = Math.min(Math.max(heading.depth, 3), 6);
            cards.push(
              `<section class="content-card"><h${level} class="content-card-title">${title}</h${level}><div class="content-card-body">${body}</div></section>`,
            );
            at = end;
          }
          return `${intro}<div class="content-cards">${cards.join("")}</div>\n`;
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
