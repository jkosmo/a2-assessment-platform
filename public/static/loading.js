function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clearState(container) {
  container.classList.remove("loading-target", "empty-state");
  container.removeAttribute("aria-busy");
}

function buildLineSkeleton(width = "100%") {
  return `<div class="loading-skeleton loading-skeleton-line" style="width:${width}"></div>`;
}

function buildCardSkeleton() {
  return [
    '<div class="loading-card">',
    '<div class="loading-skeleton loading-skeleton-title"></div>',
    '<div class="loading-skeleton loading-skeleton-line" style="width:92%"></div>',
    '<div class="loading-skeleton loading-skeleton-meta"></div>',
    "</div>",
  ].join("");
}

export function showLoading(container, options = {}) {
  const {
    rows = 3,
    variant = "lines",
    columns = 1,
  } = options;

  clearState(container);
  container.classList.add("loading-target");
  container.setAttribute("aria-busy", "true");

  if (container.tagName === "TBODY") {
    container.innerHTML = Array.from({ length: rows }, () =>
      `<tr><td class="loading-table-cell" colspan="${columns}"><div class="loading-stack">${buildLineSkeleton("100%")}${buildLineSkeleton("84%")}</div></td></tr>`,
    ).join("");
    return;
  }

  if (variant === "cards") {
    container.innerHTML = Array.from({ length: rows }, () => buildCardSkeleton()).join("");
    return;
  }

  container.innerHTML = `<div class="loading-stack">${Array.from({ length: rows }, (_, index) =>
    buildLineSkeleton(index === rows - 1 ? "72%" : "100%"),
  ).join("")}</div>`;
}

export function hideLoading(container) {
  clearState(container);
}

export function showEmpty(container, message, options = {}) {
  const { columns = 1 } = options;

  clearState(container);

  if (container.tagName === "TBODY") {
    container.innerHTML = `<tr class="empty-state-row"><td colspan="${columns}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
    return;
  }

  container.classList.add("empty-state");
  container.textContent = message;
}
