const TOAST_REGION_ID = "toastRegion";
const MAX_VISIBLE_TOASTS = 4;
const AUTO_DISMISS_MS = 5000;

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
  document.body.appendChild(region);
  return region;
}

function normalizeType(type) {
  return ["success", "error", "info"].includes(type) ? type : "info";
}

export function showToast(message, type = "info", detail = "") {
  const region = ensureToastRegion();
  const normalizedType = normalizeType(type);

  const toast = document.createElement("section");
  toast.className = `toast toast--${normalizedType}`;
  toast.setAttribute("role", normalizedType === "error" ? "alert" : "status");

  const header = document.createElement("div");
  header.className = "toast__header";

  const messageElement = document.createElement("p");
  messageElement.className = "toast__message";
  messageElement.textContent = String(message);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "toast__close";
  closeButton.setAttribute("aria-label", "Dismiss notification");
  closeButton.textContent = "x";

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

  region.appendChild(toast);

  while (region.children.length > MAX_VISIBLE_TOASTS) {
    region.firstElementChild?.remove();
  }

  window.setTimeout(removeToast, AUTO_DISMISS_MS);
  return toast;
}
