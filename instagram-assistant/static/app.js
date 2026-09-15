const token = document.querySelector('meta[name="instagram-assistant-token"]').content;
let currentCommentStatus = "active";
let currentDmStatus = "active";
let selectedThreadId = "";

const themeToggle = document.querySelector("#theme-toggle");
const themeMedia = matchMedia("(prefers-color-scheme: dark)");

function updateThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeToggle.checked = dark;
}

function applyTheme(theme) {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none !important}";
  document.head.append(style);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  updateThemeToggle();
}

themeToggle.addEventListener("change", () => {
  const theme = themeToggle.checked ? "dark" : "light";
  localStorage.setItem("instagram-assistant-theme", theme);
  applyTheme(theme);
});

themeMedia.addEventListener("change", (event) => {
  if (!localStorage.getItem("instagram-assistant-theme")) {
    applyTheme(event.matches ? "dark" : "light");
  }
});
updateThemeToggle();

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if ((options.method || "GET") !== "GET") headers["X-Instagram-Assistant-Token"] = token;
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `요청 실패 (${response.status})`);
  }
  return response.json();
}

function toast(message, error = false) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.toggle("error-toast", error);
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatTime(value, short = false) {
  return new Date(value).toLocaleString("ko-KR", short ? {
    month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
  } : undefined);
}

function intentLabel(value) {
  return ({
    demo_interest: "체험 요청",
    build_interest: "제작 문의",
    purchase_interest: "구매 문의",
    needs_review: "확인 필요",
    praise: "칭찬",
    reaction_or_close: "반응",
    pending: "새 댓글",
    drafted: "답변 준비",
    manual: "확인 필요",
    sent: "완료",
  })[value] || value;
}

async function refreshStatus() {
  const data = await api("/api/status");
  document.querySelector("#read-only").checked = data.settings.read_only_observation;
  document.querySelector("#auto-send").checked = data.settings.auto_send;
  document.querySelector("#auto-comment").checked = data.settings.auto_comment;
  document.querySelector("#auto-dm").checked = data.settings.auto_dm;
  document.querySelector("#daily-limit").value = data.settings.daily_send_limit;
  document.querySelector("#profile-url").value = data.settings.profile_url;
  document.querySelector("#settings-account").textContent = data.authenticated ? `@${data.settings.instagram_username || "Instagram"}` : "연결된 계정 없음";
  document.querySelector("#settings-session-note").textContent = data.settings.halted_reason ? "세션이 중지되었습니다." : data.authenticated ? "로컬 세션으로 연결되어 있습니다." : "계정을 연결하면 DM과 댓글을 가져올 수 있습니다.";
  document.querySelector("#login-open").style.display = data.authenticated ? "none" : "inline-flex";
  document.querySelector("#logout").style.display = data.authenticated ? "inline-flex" : "none";
}

function actionButtons(event) {
  if (!event) return "";
  return `
    <div class="event-actions" data-id="${escapeHtml(event.id)}">
      ${["manual", "pending"].includes(event.status) ? '<button class="quiet" data-action="codex">Codex 판단</button>' : ""}
      ${event.status === "drafted" ? '<button class="quiet" data-action="save">초안 저장</button><button class="primary" data-action="send">보내기</button>' : ""}
      ${!["sent", "ignored", "history"].includes(event.status) ? '<button class="quiet" data-action="ignore">무시</button>' : ""}
    </div>`;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function sharedLink(event) {
  const url = safeUrl(event.shared_url);
  if (!url) return "";
  return `<div class="shared-content"><span>공유된 콘텐츠</span><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></div>`;
}

function urlsInText(value = "") {
  return [...String(value).matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => {
    const trailing = match[0].match(/[.,!?;:)}\]]+$/)?.[0] || "";
    return { url: trailing ? match[0].slice(0, -trailing.length) : match[0], trailing };
  }).filter((item) => safeUrl(item.url));
}

function outboundMessageBody(value) {
  const text = String(value || "");
  const links = urlsInText(text);
  if (!links.length) return escapeHtml(text);
  let cursor = 0;
  return links.map(({ url, trailing }) => {
    const index = text.indexOf(url, cursor);
    const before = escapeHtml(text.slice(cursor, index));
    cursor = index + url.length + trailing.length;
    return `${before}<a class="message-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
  }).join("") + escapeHtml(text.slice(cursor));
}

function outboundLinkPreviews(value) {
  const urls = [...new Set(urlsInText(value).map((item) => item.url))];
  return urls.map((url) => `<a class="link-preview" data-preview-url="${escapeHtml(url)}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" hidden></a>`).join("");
}

async function hydrateLinkPreviews(root) {
  await Promise.all([...root.querySelectorAll("[data-preview-url]")].map(async (preview) => {
    try {
      const data = await api(`/api/link-preview?url=${encodeURIComponent(preview.dataset.previewUrl)}`);
      const imageUrl = safeUrl(data.image_url);
      if (!imageUrl) return;
      const image = new Image();
      image.alt = data.title ? `${data.title} 미리보기` : "링크 미리보기";
      image.referrerPolicy = "no-referrer";
      image.src = imageUrl;
      image.addEventListener("load", () => {
        const scroll = preview.closest(".chat-messages");
        const wasAtBottom = scroll && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 40;
        preview.append(image);
        preview.hidden = false;
        if (wasAtBottom) requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
      }, { once: true });
    } catch {
      // The link remains usable when preview metadata is unavailable.
    }
  }));
}

function commentHeart(event, compact = false) {
  return `<button class="comment-heart ${event.has_liked ? "liked" : ""} ${compact ? "compact" : ""}" data-action="comment-heart" data-liked="${event.has_liked ? "true" : "false"}" aria-label="${event.has_liked ? "댓글 하트 취소" : "댓글에 하트"}" aria-pressed="${event.has_liked ? "true" : "false"}">${event.has_liked ? "♥" : "♡"}<span>${event.like_count ?? 0}</span></button>`;
}

function dmHeart(message) {
  const hasReaction = Number(message.like_count || 0) > 0;
  return `<button class="dm-heart ${hasReaction ? "visible" : ""} ${message.has_liked ? "mine" : ""}" data-action="dm-heart" data-liked="${message.has_liked ? "true" : "false"}" aria-label="${message.has_liked ? "DM 하트 취소" : "DM에 하트"}" aria-pressed="${message.has_liked ? "true" : "false"}" title="${message.has_liked ? "하트 취소" : "하트 보내기"}">♥</button>`;
}

function postReference(event) {
  const fallback = event.post_code ? `https://www.instagram.com/p/${encodeURIComponent(event.post_code)}/` : "";
  const url = safeUrl(event.post_url || fallback);
  if (!url) return "";
  const caption = String(event.post_caption || `게시물 ${event.post_code}`).trim();
  return `<a class="post-reference" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>게시물</span><strong>${escapeHtml(caption)}</strong><span aria-hidden="true">↗</span></a>`;
}

function commentReplies(event) {
  if (!event.replies?.length) return "";
  return `<div class="comment-replies">${event.replies.map((reply) => `
    <div class="comment-reply ${reply.direction === "outbound" ? "mine" : ""}" data-id="${escapeHtml(reply.id)}">
      <div class="reply-meta"><strong>${reply.direction === "outbound" ? "내 답글" : escapeHtml(reply.author_username || "알 수 없음")}</strong><span>${formatTime(reply.received_at, true)}</span></div>
      <p>${escapeHtml(reply.body)}</p>
      ${commentHeart(reply, true)}
    </div>`).join("")}</div>`;
}

async function refreshComments() {
  const query = currentCommentStatus ? `&status=${currentCommentStatus}` : "";
  const events = await api(`/api/events?kind=comment&limit=500${query}`);
  const root = document.querySelector("#events");
  root.innerHTML = events.map((event) => `
    <article class="event" data-id="${escapeHtml(event.id)}">
      <div class="event-top">
        <div class="event-meta"><strong>${escapeHtml(event.author_username || "알 수 없음")}</strong><span>${formatTime(event.received_at, true)}</span><span class="badge">${escapeHtml(intentLabel(event.intent || event.status))}</span></div>
        <div class="comment-state">${commentHeart(event)}</div>
      </div>
      ${postReference(event)}
      <p class="event-body">${escapeHtml(event.body)}</p>
      ${commentReplies(event)}
      ${event.status === "drafted" && event.draft ? `<textarea class="draft">${escapeHtml(event.draft)}</textarea>` : ""}
      ${actionButtons(event)}
    </article>
  `).join("");
  document.querySelector("#empty-events").style.display = events.length ? "none" : "block";
}

async function refreshConversations(keepSelection = true) {
  const query = currentDmStatus ? `?status=${currentDmStatus}` : "";
  const conversations = await api(`/api/conversations${query}`);
  if (!keepSelection || !conversations.some((item) => item.thread_id === selectedThreadId)) {
    selectedThreadId = conversations[0]?.thread_id || "";
  }
  document.querySelector("#conversation-list").innerHTML = conversations.map((item) => `
    <button class="conversation-item ${item.thread_id === selectedThreadId ? "active" : ""}" data-thread-id="${escapeHtml(item.thread_id)}">
      <span class="conversation-name">${escapeHtml(item.username || "알 수 없음")}</span>
      <span class="conversation-preview">${escapeHtml(item.latest_body || "메시지 내용 없음")}</span>
      <time>${formatTime(item.latest_at, true)}</time>
    </button>
  `).join("") || '<p class="empty compact">아직 DM 대화가 없습니다.</p>';
  await refreshChat();
}

async function refreshChat() {
  const panel = document.querySelector("#chat-panel");
  if (!selectedThreadId) {
    panel.innerHTML = '<p class="empty">대화를 선택하세요.</p>';
    return;
  }
  const messages = await api(`/api/conversations/${encodeURIComponent(selectedThreadId)}`);
  const username = [...messages].reverse().find((item) => item.direction === "inbound" && item.author_username)?.author_username || "알 수 없음";
  const lastResolutionIndex = messages.findLastIndex((item) => (
    item.direction === "outbound" || (item.direction === "inbound" && item.has_liked)
  ));
  const target = [...messages].reverse().find((item, reverseIndex) => {
    const index = messages.length - reverseIndex - 1;
    return index > lastResolutionIndex && item.direction === "inbound" && ["pending", "drafted", "manual"].includes(item.status);
  });
  panel.innerHTML = `
    <header class="chat-header"><button class="chat-back" data-action="chat-back" aria-label="대화 목록으로 돌아가기">‹</button><div><strong>${escapeHtml(username)}</strong><span>${messages.length}개 메시지</span></div><a href="https://www.instagram.com/${escapeHtml(username)}/" target="_blank" rel="noreferrer">프로필 ↗</a></header>
    <div class="chat-messages">
      ${messages.map((message) => `
        <div class="message-row ${message.direction}" data-id="${escapeHtml(message.id)}">
          ${message.direction === "outbound" ? dmHeart(message) : ""}
          <div class="message-bubble">
            ${message.body ? `<p>${message.direction === "outbound" ? outboundMessageBody(message.body) : escapeHtml(message.body)}</p>` : (!message.shared_url ? "<p>메시지 내용 없음</p>" : "")}
            ${message.direction === "outbound" ? outboundLinkPreviews(message.body) : ""}
            ${sharedLink(message)}
            <time>${formatTime(message.received_at, true)}</time>
          </div>
          ${message.direction === "inbound" ? dmHeart(message) : ""}
        </div>
      `).join("")}
    </div>
    ${target ? `<footer class="chat-compose">
      <div class="compose-context"><span class="badge">${escapeHtml(target.intent || target.status)}</span><span>${escapeHtml(target.body || "공유된 콘텐츠")}</span></div>
      ${target.draft ? `<textarea class="draft" placeholder="답변 초안">${escapeHtml(target.draft)}</textarea>` : ""}
      ${actionButtons(target)}
    </footer>` : '<footer class="chat-compose done">처리할 새 메시지가 없습니다.</footer>'}
  `;
  requestAnimationFrame(() => {
    const scroll = panel.querySelector(".chat-messages");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
  hydrateLinkPreviews(panel);
}

async function refreshArtworks() {
  const artworks = await api("/api/artworks");
  document.querySelector("#artwork-list").innerHTML = artworks.map((item) => `
    <article class="artwork"><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(safeUrl(item.demo_url))}" target="_blank" rel="noreferrer">${escapeHtml(item.demo_url)}</a><span>${escapeHtml(item.product_name)}</span></article>
  `).join("") || '<p class="empty">등록된 작품이 없습니다.</p>';
}

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshComments(), refreshArtworks(), refreshConversations()]);
}

async function runEventAction(container, clicked) {
  const action = clicked.dataset.action;
  if (!action) return false;
  const actionRoot = clicked.closest(".event-actions");
  const id = encodeURIComponent(actionRoot.dataset.id);
  const draft = container.querySelector(".draft");
  if (action === "save") await api(`/api/events/${id}/draft`, { method: "PATCH", body: JSON.stringify({ draft: draft.value }) });
  if (action === "codex") await api(`/api/events/${id}/codex`, { method: "POST" });
  if (action === "ignore") await api(`/api/events/${id}/ignore`, { method: "POST" });
  if (action === "send") {
    await api(`/api/events/${id}/draft`, { method: "PATCH", body: JSON.stringify({ draft: draft.value }) });
    await api(`/api/events/${id}/send`, { method: "POST" });
  }
  toast(action === "send" ? "전송했습니다." : "반영했습니다.");
  return true;
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab,.view").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  const view = document.querySelector(`#${button.dataset.view}`);
  view.classList.add("active");
  view.scrollTop = 0;
}));

document.querySelectorAll(".comment-filter").forEach((button) => button.addEventListener("click", async () => {
  document.querySelectorAll(".comment-filter").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  currentCommentStatus = button.dataset.status;
  await refreshComments();
}));

document.querySelectorAll(".dm-filter").forEach((button) => button.addEventListener("click", async () => {
  document.querySelectorAll(".dm-filter").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  currentDmStatus = button.dataset.status;
  document.querySelector("#dm-inbox").classList.remove("chat-open");
  await refreshConversations(false);
}));

document.querySelector("#conversation-list").addEventListener("click", async (event) => {
  const item = event.target.closest(".conversation-item");
  if (!item) return;
  selectedThreadId = item.dataset.threadId;
  document.querySelectorAll(".conversation-item").forEach((node) => node.classList.toggle("active", node === item));
  await refreshChat();
  document.querySelector("#dm-inbox").classList.add("chat-open");
});

document.querySelector("#sync").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>동기화 중</span>';
  try {
    const result = await api("/api/sync", { method: "POST" });
    const dmMode = result.dm_full_sync ? "DM 전체 가져오기 완료" : `새 DM ${result.dms}`;
    toast(`${dmMode} · 새 댓글 ${result.comments} · 새 대댓글 ${result.comment_replies || 0}`);
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "동기화";
  }
});

document.querySelector("#classify").addEventListener("click", async () => {
  try {
    const result = await api("/api/events/classify", { method: "POST" });
    toast(`${result.classified}개 항목을 분류했습니다.`);
    await refreshAll();
  } catch (error) { toast(error.message, true); }
});

document.querySelector("#events").addEventListener("click", async (event) => {
  try {
    const card = event.target.closest(".comment-reply") || event.target.closest(".event");
    const heart = event.target.closest('[data-action="comment-heart"]');
    if (heart) {
      await api(`/api/events/${encodeURIComponent(card.dataset.id)}/comment-like`, {
        method: "POST",
        body: JSON.stringify({ liked: heart.dataset.liked !== "true" }),
      });
      toast(heart.dataset.liked === "true" ? "하트를 취소했습니다." : "댓글에 하트를 눌렀습니다.");
      await refreshAll();
      return;
    }
    if (await runEventAction(card, event.target)) await refreshAll();
  }
  catch (error) { toast(error.message, true); }
});

document.querySelector("#chat-panel").addEventListener("click", async (event) => {
  try {
    if (event.target.closest('[data-action="chat-back"]')) {
      document.querySelector("#dm-inbox").classList.remove("chat-open");
      return;
    }
    const heart = event.target.closest('[data-action="dm-heart"]');
    if (heart) {
      const row = heart.closest(".message-row");
      const liked = heart.dataset.liked === "true";
      await api(`/api/events/${encodeURIComponent(row.dataset.id)}/dm-like`, {
        method: "POST",
        body: JSON.stringify({ liked: !liked }),
      });
      toast(liked ? "DM 하트를 취소했습니다." : "DM에 하트를 눌렀습니다.");
      document.querySelector("#dm-inbox").classList.remove("chat-open");
      await refreshConversations(false);
      return;
    }
    if (await runEventAction(event.target.closest(".chat-panel"), event.target)) await refreshAll();
  }
  catch (error) { toast(error.message, true); }
});

const loginDialog = document.querySelector("#login-dialog");
document.querySelector("#login-open").addEventListener("click", () => loginDialog.showModal());
document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const errorNode = document.querySelector("#login-error");
  errorNode.textContent = "연결 중…";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    event.target.reset(); loginDialog.close(); toast("Instagram을 연결했습니다."); await refreshAll();
  } catch (error) { errorNode.textContent = error.message; }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); toast("연결을 해제했습니다."); await refreshAll(); }
  catch (error) { toast(error.message, true); }
});

const artworkDialog = document.querySelector("#artwork-dialog");
document.querySelector("#add-artwork").addEventListener("click", () => artworkDialog.showModal());
document.querySelector("#artwork-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  try { await api("/api/artworks", { method: "POST", body: JSON.stringify(values) }); event.target.reset(); artworkDialog.close(); toast("작품을 저장했습니다."); await refreshArtworks(); }
  catch (error) { toast(error.message, true); }
});

document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

document.querySelector("#save-settings").addEventListener("click", async () => {
  try {
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({
      profile_url: document.querySelector("#profile-url").value,
      daily_send_limit: Number(document.querySelector("#daily-limit").value),
      read_only_observation: document.querySelector("#read-only").checked,
      auto_send: document.querySelector("#auto-send").checked,
      auto_comment: document.querySelector("#auto-comment").checked,
      auto_dm: document.querySelector("#auto-dm").checked,
    }) });
    toast("설정을 저장했습니다."); await refreshStatus();
  } catch (error) { toast(error.message, true); }
});

refreshAll().catch((error) => toast(error.message, true));
