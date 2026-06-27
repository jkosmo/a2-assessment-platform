// Diskusjon / Q&A — gjenbrukbart deltaker- og moderator-panel (#495/T-QA-3 + T-QA-4).
//
// Monteres både på kurs-nivå (courseItemId = null) og per seksjon/modul (courseItemId satt).
// Alle UGC-felter (thread.bodyHtml / reply.bodyHtml) er ALLEREDE server-sanitert via
// renderDiscussionMarkdown — derfor er innerHTML trygt for dem. All annen tekst escapes.
// Moderatorkontroller (pin/lås/slett andres) og «marker som svar» vises ut fra server-flaggene
// canModerate / canDelete / canAccept, ikke fra klient-side ID-sammenligning.

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
      <div class="discussion-panel-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <strong>${escapeHtml(t("discussion.title"))}</strong>
        <button type="button" class="btn-secondary" data-disc-new style="font-size:12px;padding:4px 10px;">${escapeHtml(t("discussion.new"))}</button>
      </div>
      <div data-disc-body><p class="small" style="color:var(--color-meta)">${escapeHtml(t("discussion.loading"))}</p></div>
    </div>`;
  const bodyEl = container.querySelector("[data-disc-body]");
  const newBtn = container.querySelector("[data-disc-new]");

  function err(error) {
    showToast(error instanceof Error ? error.message : t("discussion.error.generic"), "error");
  }

  function badge(text, kind) {
    const colors = {
      open: "background:#e6f4ea;color:#137333;",
      resolved: "background:#e8f0fe;color:#1a73e8;",
      locked: "background:#fce8e6;color:#c5221f;",
      question: "background:#fef7e0;color:#b06000;",
      discussion: "background:#f1f3f4;color:#5f6368;",
      pinned: "background:#fff;color:#b06000;border:1px solid #f0c36d;",
      accepted: "background:#e6f4ea;color:#137333;",
    };
    return `<span style="font-size:11px;padding:2px 8px;border-radius:10px;${colors[kind] ?? colors.discussion}">${escapeHtml(text)}</span>`;
  }

  function authorName(author) {
    if (!author) return escapeHtml(t("discussion.deletedUser"));
    if (author.anonymized || author.name === null) return escapeHtml(t("discussion.deletedUser"));
    return escapeHtml(author.name);
  }

  // ---- Liste-visning -------------------------------------------------------
  async function showList() {
    newBtn.style.display = "";
    bodyEl.innerHTML = `<p class="small" style="color:var(--color-meta)">${escapeHtml(t("discussion.loading"))}</p>`;
    try {
      const { threads } = await apiFetch(`${base}${itemQuery}`, headers);
      if (!threads.length) {
        bodyEl.innerHTML = `<p class="small" style="color:var(--color-meta)" data-disc-empty>${escapeHtml(t("discussion.empty"))}</p>`;
        return;
      }
      const list = document.createElement("div");
      list.className = "discussion-thread-list";
      list.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      for (const thread of threads) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "btn-secondary";
        row.setAttribute("data-disc-thread", thread.id);
        row.style.cssText = "text-align:left;display:flex;flex-direction:column;gap:4px;padding:8px 10px;";
        const title = thread.deleted ? t("discussion.deletedPost") : thread.title;
        const badges = [
          thread.pinned ? badge("📌 " + t("discussion.pinned"), "pinned") : "",
          badge(t(`discussion.kind.${thread.kind.toLowerCase()}`), thread.kind.toLowerCase()),
          badge(t(`discussion.status.${thread.status.toLowerCase()}`), thread.status.toLowerCase()),
        ].join(" ");
        row.innerHTML = `
          <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${badges}</span>
          <span style="font-weight:600;">${escapeHtml(title)}</span>
          <span class="small" style="color:var(--color-meta)">${authorName(thread.author)} · ${thread.replyCount} ${escapeHtml(t("discussion.repliesSuffix"))}</span>`;
        row.addEventListener("click", () => showThread(thread.id));
        list.appendChild(row);
      }
      bodyEl.innerHTML = "";
      bodyEl.appendChild(list);
    } catch (error) {
      err(error);
      bodyEl.innerHTML = `<p class="small" style="color:var(--color-error)">${escapeHtml(t("discussion.error.generic"))}</p>`;
    }
  }

  // ---- Ny tråd -------------------------------------------------------------
  function showNewThreadForm() {
    newBtn.style.display = "none";
    bodyEl.innerHTML = `
      <form data-disc-new-form style="display:flex;flex-direction:column;gap:8px;">
        <label class="small">${escapeHtml(t("discussion.form.kindLabel"))}
          <select data-disc-kind class="locale-select-compact" style="display:block;margin-top:4px;">
            <option value="QUESTION">${escapeHtml(t("discussion.kind.question"))}</option>
            <option value="DISCUSSION">${escapeHtml(t("discussion.kind.discussion"))}</option>
          </select>
        </label>
        <input type="text" data-disc-title maxlength="300" placeholder="${escapeHtml(t("discussion.form.titlePlaceholder"))}" style="padding:8px;" />
        <textarea data-disc-text rows="4" maxlength="10000" placeholder="${escapeHtml(t("discussion.form.bodyPlaceholder"))}" style="padding:8px;"></textarea>
        <div style="display:flex;gap:8px;">
          <button type="submit" class="btn-primary" style="font-size:13px;">${escapeHtml(t("discussion.form.submit"))}</button>
          <button type="button" class="btn-secondary" data-disc-cancel style="font-size:13px;">${escapeHtml(t("discussion.action.cancel"))}</button>
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
  function moderationButton(label, action) {
    return `<button type="button" class="btn-secondary" data-disc-act="${action}" style="font-size:12px;padding:2px 8px;">${escapeHtml(label)}</button>`;
  }

  function renderThread(thread) {
    newBtn.style.display = "none";
    const title = thread.deleted ? t("discussion.deletedPost") : thread.title;
    const bodyHtml = thread.deleted ? `<em class="small" style="color:var(--color-meta)">${escapeHtml(t("discussion.deletedPost"))}</em>` : (thread.bodyHtml ?? "");

    const modControls = [];
    if (thread.canModerate && !thread.deleted) {
      modControls.push(moderationButton(thread.pinned ? t("discussion.action.unpin") : t("discussion.action.pin"), thread.pinned ? "unpin" : "pin"));
      modControls.push(moderationButton(thread.status === "LOCKED" ? t("discussion.action.unlock") : t("discussion.action.lock"), thread.status === "LOCKED" ? "unlock" : "lock"));
    }
    if (thread.canDelete) modControls.push(moderationButton(t("discussion.action.delete"), "delete-thread"));
    const subLabel = thread.isSubscribed ? t("discussion.action.unsubscribe") : t("discussion.action.subscribe");

    const badges = [
      thread.pinned ? badge("📌 " + t("discussion.pinned"), "pinned") : "",
      badge(t(`discussion.kind.${thread.kind.toLowerCase()}`), thread.kind.toLowerCase()),
      badge(t(`discussion.status.${thread.status.toLowerCase()}`), thread.status.toLowerCase()),
    ].join(" ");

    const repliesHtml = thread.replies.map((reply) => {
      const accepted = reply.isAccepted ? badge("✓ " + t("discussion.acceptedBadge"), "accepted") : "";
      const rbody = reply.deleted
        ? `<em class="small" style="color:var(--color-meta)">${escapeHtml(t("discussion.deletedPost"))}</em>`
        : (reply.bodyHtml ?? "");
      const actions = [];
      if (thread.canAccept && !reply.deleted) {
        actions.push(reply.isAccepted
          ? moderationButton(t("discussion.action.unaccept"), `unaccept:${reply.id}`)
          : moderationButton(t("discussion.action.accept"), `accept:${reply.id}`));
      }
      if (reply.canDelete) actions.push(moderationButton(t("discussion.action.delete"), `delete-reply:${reply.id}`));
      return `
        <div class="discussion-reply" style="border-top:1px solid var(--color-border-soft,#e5e7eb);padding:8px 0;">
          <div class="small" style="color:var(--color-meta);display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${authorName(reply.author)} ${accepted}</div>
          <div class="discussion-body">${rbody}</div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">${actions.join(" ")}</div>
        </div>`;
    }).join("");

    const composeHtml = thread.status === "LOCKED"
      ? `<p class="small" style="color:var(--color-meta)" data-disc-locked>${escapeHtml(t("discussion.lockedNotice"))}</p>`
      : `<form data-disc-reply-form style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
           <textarea data-disc-reply-text rows="3" maxlength="5000" placeholder="${escapeHtml(t("discussion.reply.placeholder"))}" style="padding:8px;"></textarea>
           <div><button type="submit" class="btn-primary" style="font-size:13px;">${escapeHtml(t("discussion.reply.submit"))}</button></div>
         </form>`;

    bodyEl.innerHTML = `
      <button type="button" class="btn-secondary" data-disc-back style="font-size:12px;margin-bottom:8px;">← ${escapeHtml(t("discussion.action.back"))}</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">${badges}</div>
      <h4 style="margin:0 0 4px 0;">${escapeHtml(title)}</h4>
      <div class="small" style="color:var(--color-meta);margin-bottom:6px;">${authorName(thread.author)}</div>
      <div class="discussion-body">${bodyHtml}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
        ${moderationButton(subLabel, thread.isSubscribed ? "unsubscribe" : "subscribe")}
        ${modControls.join(" ")}
      </div>
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

    bodyEl.querySelectorAll("[data-disc-act]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(thread, btn.getAttribute("data-disc-act")));
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
    bodyEl.innerHTML = `<p class="small" style="color:var(--color-meta)">${escapeHtml(t("discussion.loading"))}</p>`;
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
