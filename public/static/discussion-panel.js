// Diskusjon / Q&A — gjenbrukbart deltaker- og moderator-panel (#495/T-QA-3 + T-QA-4).
//
// Monteres både på kurs-nivå (courseItemId = null) og per seksjon/modul (courseItemId satt).
// Alle UGC-felter (thread.bodyHtml / reply.bodyHtml) er ALLEREDE server-sanitert via
// renderDiscussionMarkdown — derfor er innerHTML trygt for dem. All annen tekst escapes.
//
// UI (lett distinkt, #495-UX): panelet er en avgrenset «sone» (.discussion-panel) som beholder
// app-ens designspråk, men med kompakte verktøylinjer i stedet for stablede fullbreddeknapper, og
// en egen, dempet modererings-verktøylinje (.disc-mod-toolbar) med fare-farge på Lås/Slett.
// Moderatorkontroller vises ut fra server-flaggene canModerate/canDelete/canAccept.

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container   tom node panelet eier
 * @param {string} opts.courseId
 * @param {string|null} opts.courseItemId  null = kurs-nivå board
 * @param {Function} opts.apiFetch       (url, headers, options?) => Promise<any>
 * @param {Function} opts.headers        () => headers-objekt
 * @param {Function} opts.t              (key) => lokalisert streng
 * @param {Function} opts.escapeHtml     (text) => trygg HTML-streng
 * @param {Function} [opts.showToast]    (message, kind?) => void
 */
export function mountDiscussionPanel(opts) {
  const { container, courseId, courseItemId, apiFetch, headers, t, escapeHtml } = opts;
  const showToast = opts.showToast ?? (() => {});
  const base = `/api/courses/${encodeURIComponent(courseId)}/discussions`;
  const itemQuery = courseItemId ? `?itemId=${encodeURIComponent(courseItemId)}` : "";

  container.innerHTML = `
    <div class="discussion-panel" data-discussion-panel>
      <div class="discussion-head">
        <span class="discussion-head-title">💬 ${escapeHtml(t("discussion.title"))}</span>
        <button type="button" class="disc-btn disc-btn-primary" data-disc-new>${escapeHtml(t("discussion.new"))}</button>
      </div>
      <div data-disc-body><p class="disc-meta">${escapeHtml(t("discussion.loading"))}</p></div>
    </div>`;
  const bodyEl = container.querySelector("[data-disc-body]");
  const newBtn = container.querySelector("[data-disc-new]");

  function err(error) {
    showToast(error instanceof Error ? error.message : t("discussion.error.generic"), "error");
  }

  // Liten, auto-bredde knapp i panelet (ikke app-ens fullbredde .btn-*).
  function btn(label, action, extraClass = "") {
    return `<button type="button" class="disc-btn ${extraClass}" data-disc-act="${action}">${escapeHtml(label)}</button>`;
  }

  // Helhetlig badge-palett ligger i shared.css (.disc-badge--*). Semantikk: grønn=Løst/Akseptert,
  // gul=Åpen (trenger svar), rød=Låst, blå=Spørsmål, grå=Diskusjon.
  function badge(text, variant) {
    return `<span class="disc-badge disc-badge--${variant}">${escapeHtml(text)}</span>`;
  }

  function authorName(author) {
    if (!author) return escapeHtml(t("discussion.deletedUser"));
    if (author.anonymized || author.name === null) return escapeHtml(t("discussion.deletedUser"));
    return escapeHtml(author.name);
  }

  function threadBadges(thread) {
    return [
      thread.pinned ? badge("📌 " + t("discussion.pinned"), "pinned") : "",
      badge(t(`discussion.kind.${thread.kind.toLowerCase()}`), thread.kind.toLowerCase()),
      badge(t(`discussion.status.${thread.status.toLowerCase()}`), thread.status.toLowerCase()),
    ].join(" ");
  }

  // ---- Liste-visning -------------------------------------------------------
  async function showList() {
    newBtn.style.display = "";
    bodyEl.innerHTML = `<p class="disc-meta">${escapeHtml(t("discussion.loading"))}</p>`;
    try {
      const { threads } = await apiFetch(`${base}${itemQuery}`, headers);
      if (!threads.length) {
        bodyEl.innerHTML = `<p class="disc-meta" data-disc-empty>${escapeHtml(t("discussion.empty"))}</p>`;
        return;
      }
      const list = document.createElement("div");
      list.className = "disc-thread-list";
      for (const thread of threads) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "disc-thread-row";
        row.setAttribute("data-disc-thread", thread.id);
        const title = thread.deleted ? t("discussion.deletedPost") : thread.title;
        row.innerHTML = `
          <span class="disc-badges">${threadBadges(thread)}</span>
          <span style="font-weight:600;">${escapeHtml(title)}</span>
          <span class="disc-meta">${authorName(thread.author)} · ${thread.replyCount} ${escapeHtml(t("discussion.repliesSuffix"))}</span>`;
        row.addEventListener("click", () => showThread(thread.id));
        list.appendChild(row);
      }
      bodyEl.innerHTML = "";
      bodyEl.appendChild(list);
    } catch (error) {
      err(error);
      bodyEl.innerHTML = `<p class="disc-meta" style="color:var(--color-error)">${escapeHtml(t("discussion.error.generic"))}</p>`;
    }
  }

  // ---- Ny tråd -------------------------------------------------------------
  function showNewThreadForm() {
    newBtn.style.display = "none";
    bodyEl.innerHTML = `
      <form data-disc-new-form class="disc-compose">
        <label class="disc-meta">${escapeHtml(t("discussion.form.kindLabel"))}
          <select data-disc-kind class="locale-select-compact" style="display:block;margin-top:4px;">
            <option value="QUESTION">${escapeHtml(t("discussion.kind.question"))}</option>
            <option value="DISCUSSION">${escapeHtml(t("discussion.kind.discussion"))}</option>
          </select>
        </label>
        <input type="text" data-disc-title maxlength="300" placeholder="${escapeHtml(t("discussion.form.titlePlaceholder"))}" />
        <textarea data-disc-text rows="4" maxlength="10000" placeholder="${escapeHtml(t("discussion.form.bodyPlaceholder"))}"></textarea>
        <div class="disc-toolbar" style="justify-content:flex-end;">
          <button type="button" class="disc-btn disc-btn-ghost" data-disc-cancel>${escapeHtml(t("discussion.action.cancel"))}</button>
          <button type="submit" class="disc-btn disc-btn-primary">${escapeHtml(t("discussion.form.submit"))}</button>
        </div>
      </form>`;
    bodyEl.querySelector("[data-disc-cancel]").addEventListener("click", showList);
    bodyEl.querySelector("[data-disc-new-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const kind = bodyEl.querySelector("[data-disc-kind]").value;
      const title = bodyEl.querySelector("[data-disc-title]").value.trim();
      const bodyMarkdown = bodyEl.querySelector("[data-disc-text]").value.trim();
      if (!title || !bodyMarkdown) return;
      try {
        const { thread } = await apiFetch(base, headers, {
          method: "POST",
          body: JSON.stringify({ kind, title, bodyMarkdown, courseItemId: courseItemId ?? undefined }),
        });
        await showThread(thread.id);
      } catch (error) {
        err(error);
      }
    });
  }

  // ---- Tråd-visning --------------------------------------------------------
  function renderThread(thread) {
    newBtn.style.display = "none";
    const title = thread.deleted ? t("discussion.deletedPost") : thread.title;
    const bodyHtml = thread.deleted
      ? `<em class="disc-meta">${escapeHtml(t("discussion.deletedPost"))}</em>`
      : (thread.bodyHtml ?? "");

    // Deltaker-verktøylinje: abonnement + (forfatterens egen sletting hvis ikke moderator).
    const subLabel = thread.isSubscribed ? t("discussion.action.unsubscribe") : t("discussion.action.subscribe");
    const participantTools = [
      btn((thread.isSubscribed ? "🔔 " : "🔕 ") + subLabel, thread.isSubscribed ? "unsubscribe" : "subscribe", "disc-btn-ghost"),
    ];
    if (thread.canDelete && !thread.canModerate && !thread.deleted) {
      participantTools.push(btn(t("discussion.action.delete"), "delete-thread", "disc-btn-ghost disc-btn-danger"));
    }

    // Egen, dempet modererings-verktøylinje (kun for SMO/admin).
    let modToolbar = "";
    if (thread.canModerate && !thread.deleted) {
      const mods = [
        btn(thread.pinned ? t("discussion.action.unpin") : t("discussion.action.pin"), thread.pinned ? "unpin" : "pin"),
        btn(thread.status === "LOCKED" ? t("discussion.action.unlock") : t("discussion.action.lock"), thread.status === "LOCKED" ? "unlock" : "lock", "disc-btn-danger"),
        btn(t("discussion.action.delete"), "delete-thread", "disc-btn-danger"),
      ].join(" ");
      modToolbar = `<div class="disc-mod-toolbar"><span class="disc-mod-label">${escapeHtml(t("discussion.moderation"))}</span>${mods}</div>`;
    }

    const repliesHtml = thread.replies.map((reply) => {
      const accepted = reply.isAccepted ? badge("✓ " + t("discussion.acceptedBadge"), "accepted") : "";
      const rbody = reply.deleted
        ? `<em class="disc-meta">${escapeHtml(t("discussion.deletedPost"))}</em>`
        : (reply.bodyHtml ?? "");
      const actions = [];
      if (thread.canAccept && !reply.deleted) {
        actions.push(reply.isAccepted
          ? btn(t("discussion.action.unaccept"), `unaccept:${reply.id}`, "disc-btn-ghost")
          : btn("✓ " + t("discussion.action.accept"), `accept:${reply.id}`, "disc-btn-ghost"));
      }
      if (reply.canDelete) actions.push(btn(t("discussion.action.delete"), `delete-reply:${reply.id}`, "disc-btn-ghost disc-btn-danger"));
      return `
        <div class="disc-reply">
          <div class="disc-meta disc-badges">${authorName(reply.author)} ${accepted}</div>
          <div class="discussion-body">${rbody}</div>
          <div class="disc-reply-actions">${actions.join(" ")}</div>
        </div>`;
    }).join("");

    const composeHtml = thread.status === "LOCKED"
      ? `<p class="disc-meta" data-disc-locked>🔒 ${escapeHtml(t("discussion.lockedNotice"))}</p>`
      : `<form data-disc-reply-form class="disc-compose">
           <textarea data-disc-reply-text rows="3" maxlength="5000" placeholder="${escapeHtml(t("discussion.reply.placeholder"))}"></textarea>
           <div class="disc-compose-actions"><button type="submit" class="disc-btn disc-btn-primary">${escapeHtml(t("discussion.reply.submit"))}</button></div>
         </form>`;

    bodyEl.innerHTML = `
      <button type="button" class="disc-back" data-disc-back>← ${escapeHtml(t("discussion.action.back"))}</button>
      <div class="disc-badges" style="margin:6px 0 4px;">${threadBadges(thread)}</div>
      <h4 style="margin:0 0 4px 0;">${escapeHtml(title)}</h4>
      <div class="disc-meta" style="margin-bottom:6px;">${authorName(thread.author)}</div>
      <div class="discussion-body">${bodyHtml}</div>
      <div class="disc-toolbar">${participantTools.join(" ")}</div>
      ${modToolbar}
      <div data-disc-replies style="margin-top:8px;">${repliesHtml}</div>
      ${composeHtml}`;

    bodyEl.querySelector("[data-disc-back]").addEventListener("click", showList);

    const replyForm = bodyEl.querySelector("[data-disc-reply-form]");
    if (replyForm) {
      replyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = bodyEl.querySelector("[data-disc-reply-text]").value.trim();
        if (!text) return;
        try {
          const { thread: updated } = await apiFetch(`${base}/${encodeURIComponent(thread.id)}/replies`, headers, {
            method: "POST",
            body: JSON.stringify({ bodyMarkdown: text }),
          });
          renderThread(updated);
        } catch (error) {
          err(error);
        }
      });
    }

    bodyEl.querySelectorAll("[data-disc-act]").forEach((b) => {
      b.addEventListener("click", () => handleAction(thread, b.getAttribute("data-disc-act")));
    });
  }

  async function handleAction(thread, action) {
    try {
      if (action === "pin" || action === "unpin") {
        const { thread: u } = await apiFetch(`${base}/${encodeURIComponent(thread.id)}`, headers, {
          method: "PATCH", body: JSON.stringify({ pinned: action === "pin" }),
        });
        renderThread(u);
      } else if (action === "lock" || action === "unlock") {
        const { thread: u } = await apiFetch(`${base}/${encodeURIComponent(thread.id)}`, headers, {
          method: "PATCH", body: JSON.stringify({ lock: action === "lock" }),
        });
        renderThread(u);
      } else if (action.startsWith("accept:") || action.startsWith("unaccept:")) {
        const replyId = action.split(":")[1];
        const { thread: u } = await apiFetch(`${base}/${encodeURIComponent(thread.id)}`, headers, {
          method: "PATCH",
          body: JSON.stringify({ acceptedReplyId: action.startsWith("accept:") ? replyId : null }),
        });
        renderThread(u);
      } else if (action === "delete-thread") {
        if (!confirm(t("discussion.confirmDelete"))) return;
        await apiFetch(`${base}/${encodeURIComponent(thread.id)}`, headers, { method: "DELETE" });
        showList();
      } else if (action.startsWith("delete-reply:")) {
        if (!confirm(t("discussion.confirmDelete"))) return;
        const replyId = action.split(":")[1];
        await apiFetch(`${base}/${encodeURIComponent(thread.id)}/replies/${encodeURIComponent(replyId)}`, headers, { method: "DELETE" });
        await showThread(thread.id);
      } else if (action === "subscribe" || action === "unsubscribe") {
        await apiFetch(`${base}/${encodeURIComponent(thread.id)}/subscription`, headers, {
          method: action === "subscribe" ? "PUT" : "DELETE",
        });
        await showThread(thread.id);
      }
    } catch (error) {
      err(error);
    }
  }

  async function showThread(threadId) {
    bodyEl.innerHTML = `<p class="disc-meta">${escapeHtml(t("discussion.loading"))}</p>`;
    try {
      const { thread } = await apiFetch(`${base}/${encodeURIComponent(threadId)}`, headers);
      renderThread(thread);
    } catch (error) {
      err(error);
      showList();
    }
  }

  newBtn.addEventListener("click", showNewThreadForm);
  showList();
}
