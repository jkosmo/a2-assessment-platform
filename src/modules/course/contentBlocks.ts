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

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

interface CardsToken extends Tokens.Generic {
  type: "contentCards";
  raw: string;
  tokens: Tokens.Generic[];
}

/** `locale` er alt siktet av renderSectionBlocks: et av språkene i COPY_LABELS, eller ingen. */
function createSectionMarked(locale?: string): Marked {
  const labels = COPY_LABELS[locale ?? "nb"]!;

  return new Marked({
    extensions: [
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
            const title = this.parser.parseInline(heading.tokens).replace(/^\s*<img /, '<img class="content-icon" ');
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
        if (!label) return false;
        const name = textOf(label[1]!).replace(/[:.!\s]+$/, "").toLowerCase();
        const classes = WARNING_LABELS.has(name) ? "content-callout content-callout--warning" : "content-callout";
        return `<blockquote class="${classes}">${body.replace("<p><strong>", '<p><strong class="content-callout-label">')}</blockquote>\n`;
      },

      // Hver celle bærer navnet på kolonnen sin. På telefon står cellene under hverandre
      // (shared.css), og uten navnet vet ikke leseren hva som er hva.
      table(token: Tokens.Table) {
        const align = (value: string | null) => (value ? ` align="${value}"` : "");
        const headers = token.header.map((cell) => this.parser.parseInline(cell.tokens));
        const head = token.header.map((cell, i) => `<th${align(cell.align)}>${headers[i]}</th>`).join("");
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell, i) => `<td${align(cell.align)} data-label="${escapeHtml(textOf(headers[i] ?? ""))}">${this.parser.parseInline(cell.tokens)}</td>`)
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
