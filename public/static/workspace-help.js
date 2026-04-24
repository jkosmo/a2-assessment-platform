import {
  getHelpUi,
  getOverviewContent,
  getWorkspaceHelpContent,
} from "/static/workspace-help-content.js";

const localePicker = document.querySelector(".locale-picker");

if (localePicker) {
  mountWorkspaceHelp();
}

function mountWorkspaceHelp() {
  const localeSelect = document.getElementById("localeSelect");
  const contextId = resolveHelpContext(window.location);
  const state = {
    view: "page",
    lastFocus: null,
  };

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "workspace-help-trigger";
  trigger.textContent = "?";

  const dialog = document.createElement("dialog");
  dialog.id = "workspaceHelpDialog";
  dialog.className = "workspace-help-dialog";
  dialog.setAttribute("aria-labelledby", "workspaceHelpTitle");
  dialog.setAttribute("aria-modal", "true");

  dialog.innerHTML = `
    <div class="workspace-help-shell">
      <div class="workspace-help-header">
        <div>
          <div class="workspace-help-eyebrow" id="workspaceHelpEyebrow"></div>
          <h2 id="workspaceHelpTitle" class="workspace-help-title"></h2>
        </div>
        <button type="button" class="workspace-help-close" id="workspaceHelpClose"></button>
      </div>
      <div class="workspace-help-tabs" role="tablist" id="workspaceHelpTabs">
        <button type="button" class="workspace-help-tab active" id="workspaceHelpPageTab" data-view="page" aria-pressed="true"></button>
        <button type="button" class="workspace-help-tab" id="workspaceHelpOverviewTab" data-view="overview" aria-pressed="false"></button>
      </div>
      <div id="workspaceHelpBody" class="workspace-help-body"></div>
    </div>
  `;

  document.body.appendChild(dialog);
  localePicker.appendChild(trigger);

  const closeButton = dialog.querySelector("#workspaceHelpClose");
  const body = dialog.querySelector("#workspaceHelpBody");
  const title = dialog.querySelector("#workspaceHelpTitle");
  const eyebrow = dialog.querySelector("#workspaceHelpEyebrow");
  const tabs = dialog.querySelector("#workspaceHelpTabs");
  const pageTab = dialog.querySelector("#workspaceHelpPageTab");
  const overviewTab = dialog.querySelector("#workspaceHelpOverviewTab");

  function currentLocale() {
    const selectValue = localeSelect?.value?.trim();
    if (selectValue) return selectValue;
    const stored = localStorage.getItem("participant.locale");
    if (stored) return stored;
    const browser = navigator.language?.toLowerCase() ?? "";
    if (browser.startsWith("nb")) return "nb";
    if (browser.startsWith("nn")) return "nn";
    return "en-GB";
  }

  function ensureTriggerLast() {
    if (localePicker.lastElementChild !== trigger) {
      localePicker.appendChild(trigger);
    }
  }

  function buildSection(section) {
    const wrapper = document.createElement("section");
    wrapper.className = "workspace-help-section";

    const heading = document.createElement("h3");
    heading.className = "workspace-help-section-title";
    heading.textContent = section.title;
    wrapper.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "workspace-help-list";
    for (const item of section.items ?? []) {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    wrapper.appendChild(list);
    return wrapper;
  }

  function render() {
    const locale = currentLocale();
    const ui = getHelpUi(locale);
    const pageContent = getWorkspaceHelpContent(contextId, locale) ?? getOverviewContent(locale);
    const overviewContent = getOverviewContent(locale);
    const activeContent = state.view === "page" ? pageContent : overviewContent;

    trigger.setAttribute("aria-label", ui.openHelp);
    trigger.title = ui.openHelp;
    closeButton.textContent = ui.close;
    pageTab.textContent = ui.pageTab;
    overviewTab.textContent = ui.overviewTab;
    tabs.setAttribute("aria-label", ui.viewTabsLabel);
    pageTab.classList.toggle("active", state.view === "page");
    pageTab.setAttribute("aria-pressed", state.view === "page" ? "true" : "false");
    overviewTab.classList.toggle("active", state.view === "overview");
    overviewTab.setAttribute("aria-pressed", state.view === "overview" ? "true" : "false");

    eyebrow.textContent = ui.dialogTitle;
    title.textContent = activeContent?.title ?? ui.dialogTitle;

    body.innerHTML = "";
    if (activeContent?.summary) {
      const summary = document.createElement("p");
      summary.className = "workspace-help-summary";
      summary.textContent = activeContent.summary;
      body.appendChild(summary);
    }

    for (const section of activeContent?.sections ?? []) {
      body.appendChild(buildSection(section));
    }
  }

  function openDialog() {
    state.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    render();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "open");
    }
    closeButton.focus();
  }

  function closeDialog() {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    (state.lastFocus ?? trigger).focus();
  }

  trigger.addEventListener("click", openDialog);
  closeButton.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  pageTab.addEventListener("click", () => {
    state.view = "page";
    render();
  });
  overviewTab.addEventListener("click", () => {
    state.view = "overview";
    render();
  });
  localeSelect?.addEventListener("change", render);

  const pickerObserver = new MutationObserver(() => {
    ensureTriggerLast();
  });
  pickerObserver.observe(localePicker, { childList: true });

  ensureTriggerLast();
  render();
}

function resolveHelpContext(location) {
  const path = location.pathname ?? "";
  const query = new URLSearchParams(location.search ?? "");

  if (path === "/participant/completed") return "participant-completed";
  if (path === "/participant") return "participant";
  if (path === "/review") return "review";
  if (path === "/calibration") return "calibration";
  if (path === "/results") return "results";
  if (path === "/profile") return "profile";
  if (path === "/admin-platform") return "admin-platform";
  if (path === "/admin-content/courses" || path === "/admin-content/courses/new" || /^\/admin-content\/courses\/[^/]+$/.test(path)) {
    return "admin-content-courses";
  }
  if (path === "/admin-content/calibration") return "admin-content-calibration";
  if (path === "/admin-content/advanced" || /^\/admin-content\/module\/[^/]+\/advanced$/.test(path)) {
    return "admin-content-advanced";
  }
  if (path === "/admin-content" || /^\/admin-content\/module\/[^/]+\/conversation$/.test(path)) {
    return query.has("moduleId") || query.has("id") ? "admin-content-shell" : "admin-content-library";
  }

  return "participant";
}
