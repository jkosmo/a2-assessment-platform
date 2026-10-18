// Innholdsblokker i seksjonstekst (#1079): «Kopier»-knappen i en prompt-boks.
//
// Tjeneren tegner boksen (src/modules/course/contentBlocks.ts). Det eneste som trenger skript, er
// å legge teksten på utklippstavla. Én lytter på dokumentet, så den virker også for tekst som
// settes inn etter at siden er lastet (leseren, forhåndsvisningen).

const SHOWN_MS = 2000;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Uten tilgang til utklippstavla (eldre nettleser, ikke sikker side): marker teksten, så
    // deltakeren kan kopiere selv.
    return false;
  }
}

function selectText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// #1074 «Sjekk deg selv»: deltakeren velger ett alternativ. Det riktige markeres, et feil valg
// markeres som feil, og forklaringen vises. Ingenting sendes eller lagres — svaret teller ikke.
// aria-disabled, ikke disabled: fokus blir stående på knappen deltakeren trykket på, og
// tilbakemeldingen leses opp fra aria-live-feltet.
export function answerCheck(option) {
  const box = option.closest("[data-content-check]");
  if (!box || box.dataset.answered === "true") return;
  box.dataset.answered = "true";
  const right = option.dataset.correct === "true";
  for (const button of box.querySelectorAll("[data-check-option]")) {
    button.setAttribute("aria-disabled", "true");
    const mark = button.querySelector(".content-check-mark");
    if (button.dataset.correct === "true") {
      button.classList.add("is-correct");
      if (mark) mark.textContent = "✓";
    } else if (button === option) {
      button.classList.add("is-wrong");
      if (mark) mark.textContent = "✗";
    } else {
      button.classList.add("is-dimmed");
    }
  }
  option.setAttribute("aria-pressed", "true");
  const explanation = box.querySelector(".content-check-explanation");
  if (explanation) explanation.hidden = false;
  const verdict = box.querySelector(".content-check-verdict");
  if (verdict) {
    verdict.classList.add(right ? "is-ok" : "is-bad");
    verdict.textContent = (right ? box.dataset.right : box.dataset.wrong) ?? "";
  }
}

if (typeof document !== "undefined") document.addEventListener("click", (event) => {
  const option = event.target instanceof Element ? event.target.closest("[data-check-option]") : null;
  if (option) answerCheck(option);
});

// Uten et dokument (en enhetstest som importerer en modul som importerer denne) er det ingenting å lytte på.
if (typeof document !== "undefined") document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest(".content-prompt-copy") : null;
  if (!button) return;
  const text = button.closest(".content-prompt")?.querySelector(".content-prompt-text");
  if (!text) return;

  if (!(await copyText(text.textContent ?? ""))) {
    selectText(text);
    return;
  }
  const label = button.dataset.label ?? button.textContent ?? "";
  button.dataset.label = label;
  button.textContent = button.dataset.copiedLabel || label;
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => {
    button.textContent = label;
  }, SHOWN_MS));
});
