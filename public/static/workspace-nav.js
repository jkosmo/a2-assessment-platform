import { setHidden } from "/static/dom-visibility.js";

export function renderWorkspaceNavigationWithProfile({
  workspaceNav,
  localePicker,
  items,
  buildLabel,
}) {
  if (!workspaceNav) {
    return;
  }

  const visibleItems = Array.isArray(items) ? items.filter((item) => item?.visible) : [];
  const profileItem = visibleItems.find((item) => item.id === "profile") ?? null;
  const mainItems = visibleItems.filter((item) => item.id !== "profile");

  let profileLink = document.getElementById("profileNavLink");
  if (profileItem && localePicker) {
    if (!profileLink) {
      profileLink = document.createElement("a");
      profileLink.id = "profileNavLink";
      localePicker.appendChild(profileLink);
    }
    profileLink.href = profileItem.path;
    profileLink.textContent = buildLabel(profileItem);
    profileLink.className = profileItem.active ? "workspace-nav-link active" : "workspace-nav-link";
    if (profileItem.active) {
      profileLink.setAttribute("aria-current", "page");
    } else {
      profileLink.removeAttribute("aria-current");
    }
  } else if (profileLink) {
    profileLink.remove();
  }

  workspaceNav.innerHTML = "";
  // #975: `.workspace-nav{display:flex}` slår `hidden`-attributtet (forfatter-origin vs UA-ark).
  // At den tomme menyen likevel forsvinner i dag skyldes en HELT ANNEN regel — `:not(:has(> …link ~
  // …link))` i shared.css, som skjuler menyen med færre enn to lenker. Den er en lapp oppå lappen:
  // to regler for samme intensjon, med hver sin terskel. setHidden gjør linja her sann igjen.
  setHidden(workspaceNav, mainItems.length === 0);

  for (const item of mainItems) {
    const link = document.createElement("a");
    link.href = item.path;
    link.className = item.active ? "workspace-nav-link active" : "workspace-nav-link";
    link.textContent = buildLabel(item);
    if (item.active) {
      link.setAttribute("aria-current", "page");
    }
    workspaceNav.appendChild(link);
  }
}
