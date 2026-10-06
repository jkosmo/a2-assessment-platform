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
