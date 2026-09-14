const TOAST_REGION_ID = "toastRegion";
const MAX_VISIBLE_TOASTS = 4;
// v1.1.95: per-type auto-dismiss. Bruker rapporterte å gå glipp av success-toaster (5s)
// fordi de dukker opp i øvre høyre hjørne mens handlingen som trigget dem (f.eks. Lagre)
// var nederst i chat-spalten — for kort tid å bemerke. Errors auto-dismiss ikke i det
// hele tatt (krever brukerklikk på ×) siden feil bør bekreftes manuelt.
const AUTO_DISMISS_MS = {
  success: 8000,
  info: 8000,
  warning: 0, // 0 = no auto-dismiss — a warning needs the user to acknowledge it (#601)
  error: 0, // 0 = no auto-dismiss
};

// v1.1.94: small built-in label map so shared toast widget can be localised without
// depending on any specific page's translation bundle. Keys mirror the participant.locale
// stored by every workspace shell.
const TOAST_CLOSE_LABELS = {
  "en-GB": "Close notification",
  nb: "Lukk varsel",
  nn: "Lukk varsel",
};
function resolveCloseLabel() {
  let locale = null;
  try {
    locale = localStorage.getItem("participant.locale");
  } catch {
    // some browsing contexts block localStorage — fall through to default
  }
  return TOAST_CLOSE_LABELS[locale] ?? TOAST_CLOSE_LABELS["en-GB"];
}

function ensureToastRegion() {
  let region = document.getElementById(TOAST_REGION_ID);
  if (region) {
    return region;
  }

  region = document.createElement("div");
  region.id = TOAST_REGION_ID;
  region.className = "toast-region";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "false");
  // Stage 14.09: en åpen <dialog> (modal) ligger i toppsjiktet, og alt utenfor — også toastene —
  // ble liggende dimmet og uklikkbart bak bakteppet. Framdrift og feil fra jobber som startes i
  // en dialog («Generer innhold», crawl) forsvant. Som popover ligger regionen i samme toppsjikt;
  // raiseRegion() legger den øverst hver gang en toast kommer.
  region.setAttribute("popover", "manual");
  document.body.appendChild(region);
  return region;
}

function raiseRegion(region) {
  if (typeof region.showPopover !== "function") return;
  try {
    if (region.matches(":popover-open")) region.hidePopover();
    region.showPopover();
  } catch {
    // Ikke koblet til dokumentet, eller nettleser uten popover — regionen er fortsatt position:fixed.
  }
}

function normalizeType(type) {
  return ["success", "error", "warning", "info"].includes(type) ? type : "info";
}

export function showToast(message, type = "info", detail = "", options = {}) {
  const region = ensureToastRegion();
  raiseRegion(region);
  const normalizedType = normalizeType(type);
  // Samme melding to ganger på én gang er støy, ikke informasjon (#1046: modulskallet speiler
  // samtaleutfall som toast når samtaleruta er skjult, og noen flyter toaster alt selv).
  for (const el of region.querySelectorAll(".toast__message")) {
    if (el.textContent === String(message)) return;
  }

  const toast = document.createElement("section");
  toast.className = `toast toast--${normalizedType}`;
  toast.setAttribute("role", normalizedType === "error" || normalizedType === "warning" ? "alert" : "status");

  const header = document.createElement("div");
  header.className = "toast__header";

  const messageElement = document.createElement("p");
  messageElement.className = "toast__message";
  messageElement.textContent = String(message);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "toast__close";
  closeButton.setAttribute("aria-label", resolveCloseLabel());
  // v1.1.95: ekte close-glyph (multiplication sign) i stedet for latinsk "x" — typografisk
  // mer presist og matcher resten av appen.
  closeButton.textContent = "×";

  const removeToast = () => {
    toast.remove();
  };

  closeButton.addEventListener("click", removeToast);

  header.appendChild(messageElement);
  header.appendChild(closeButton);
  toast.appendChild(header);

  if (detail) {
    const detailElement = document.createElement("p");
    detailElement.className = "toast__detail";
    detailElement.textContent = String(detail);
    toast.appendChild(detailElement);
  }
  // #1046: én valgfri handling («Avbryt» på en lagring som pågår). Kalleren fjerner toasten selv
  // når handlingen ikke lenger gjelder (options.sticky = ingen automatisk lukking).
  if (options.actionLabel && typeof options.onAction === "function") {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "toast__action";
    actionButton.textContent = String(options.actionLabel);
    actionButton.addEventListener("click", () => { options.onAction(); removeToast(); });
    toast.appendChild(actionButton);
  }

  region.appendChild(toast);

  while (region.children.length > MAX_VISIBLE_TOASTS) {
    region.firstElementChild?.remove();
  }

  const dismissMs = options.sticky ? 0 : (AUTO_DISMISS_MS[normalizedType] ?? AUTO_DISMISS_MS.info);
  if (dismissMs > 0) {
    window.setTimeout(removeToast, dismissMs);
  }
  return toast;
}
