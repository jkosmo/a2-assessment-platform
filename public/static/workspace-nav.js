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
  workspaceNav.hidden = mainItems.length === 0;

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
