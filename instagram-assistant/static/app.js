const routes = {
  dm: { path: "/dm", view: "dm" },
  comment: { path: "/comment", view: "comments" },
  work: { path: "/work", view: "artworks" },
  setting: { path: "/setting", view: "settings" },
};
const statusRoutes = new Set(["dm", "comment"]);
const validStatuses = new Set(["active", "completed", "all"]);

let selectedThreadId = "";
let dmSearchQuery = "";
let conversations = [];
let dmSearchTimer;
let postLabels = {};

function routeFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return Object.entries(routes).find(([, value]) => value.path === path)?.[0] || "dm";
}

function statusFromLocation() {
  const status = new URLSearchParams(window.location.search).get("status");
  return validStatuses.has(status) ? status : "active";
}

function routeUrl(route, status = "active") {
  return routes[route].path + (statusRoutes.has(route) ? `?status=${status}` : "");
}

function applyRoute({ canonicalize = false } = {}) {
  const route = routeFromLocation();
  const canonical = routeUrl(route, statusFromLocation());
  if (canonicalize && `${window.location.pathname}${window.location.search}` !== canonical) {
    history.replaceState({}, "", canonical);
  }
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.dataset.route === route));
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === routes[route].view));
  document.querySelectorAll(".dm-filter, .comment-filter").forEach((node) =>
    node.classList.toggle("active", node.dataset.status === statusFromLocation()));
  return route;
}

async function navigate(route, status = "active") {
  history.pushState({}, "", routeUrl(route, status));
  applyRoute();
  document.querySelector(`#${routes[route].view}`).scrollTop = 0;
  await refreshRoute(route);
}

async function api(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`조회 실패 (${response.status})`);
  return response.json();
}

function showError(error) {
  showToast(error.message || "기록을 불러오지 못했습니다.", true);
}

function showToast(message, error = false) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.toggle("error-toast", error);
  node.classList.add("show");
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => node.classList.remove("show"), 3500);
}

async function syncRecords() {
  const button = document.querySelector("#sync");
  if (button.disabled) return;
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>동기화 중';
  try {
    const scope = routeFromLocation() === "dm" ? "?scope=dm" : "";
    const response = await fetch(`/api/viewer/sync${scope}`, {
      method: "POST",
      headers: { "X-Requested-With": "InstagramAssistant" },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `동기화 실패 (${response.status})`);
    await refreshRoute(routeFromLocation());
    const added = (result.comments || 0) + (result.comment_replies || 0) + (result.dms || 0);
    showToast(added ? `동기화 완료 · 새 기록 ${added}개` : "동기화 완료 · 새 기록 없음");
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.textContent = "동기화";
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatTime(value, short = false) {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", short ? {
    month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
  } : undefined);
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
  return `<div class="shared-content"><span>공유된 게시물</span><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></div>`;
}

function linkedMessageBody(value) {
  const text = String(value || "");
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let result = "";
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const url = safeUrl(match[0]);
    if (!url) continue;
    result += escapeHtml(text.slice(start, match.index));
    result += `<a class="message-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(match[0])}</a>`;
    start = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(start));
}

function postReference(event) {
  const fallback = event.post_code ? `https://www.instagram.com/p/${encodeURIComponent(event.post_code)}/` : "";
  const postUrl = safeUrl(event.post_url || fallback);
  const commentUrl = safeUrl(event.comment_url);
  if (!postUrl && !commentUrl) return "";
  const label = postLabels[event.post_code] || (event.post_code ? `게시물 ${event.post_code}` : "게시물");
  return `<div class="post-reference">
    <a class="post-name" href="${escapeHtml(postUrl || commentUrl)}" target="_blank" rel="noreferrer" title="게시물 열기">${escapeHtml(label)} <span aria-hidden="true">↗</span></a>
    ${commentUrl ? `<a class="comment-link" href="${escapeHtml(commentUrl)}" target="_blank" rel="noreferrer">원댓글 ↗</a>` : ""}
    ${event.post_code ? `<button class="edit-post-label" data-post-code="${escapeHtml(event.post_code)}" type="button" aria-label="${escapeHtml(label)} 별명 수정">별명 수정</button>` : ""}
  </div>`;
}

function commentHeart(event, compact = false) {
  return `<span class="comment-heart ${compact ? "compact" : ""} ${event.has_liked ? "liked" : ""}" aria-label="좋아요 ${event.like_count ?? 0}개${event.has_liked ? ", 내가 하트 표시함" : ""}">${event.has_liked ? "♥" : "♡"}<span>${event.like_count ?? 0}</span></span>`;
}

function observedCommentHeartButton(event) {
  if (event.direction !== "inbound" || event.has_liked || !event.author_username) return "";
  return `<button class="observe-comment-heart" data-event-id="${escapeHtml(event.id)}" type="button">Chrome에서 하트 눌렀음 · 완료로 기록</button>`;
}

function commentReplies(event) {
  if (!event.replies?.length) return "";
  return `<div class="comment-replies">${event.replies.map((reply) => `
    <div class="comment-reply ${reply.direction === "outbound" ? "mine" : ""}">
      <div class="reply-meta"><strong>${reply.direction === "outbound" ? "내 답글" : escapeHtml(reply.author_username || "알 수 없음")}</strong><span>${formatTime(reply.received_at, true)}</span></div>
      <p>${escapeHtml(reply.body)}</p>
      ${commentHeart(reply, true)}
      ${observedCommentHeartButton(reply)}
    </div>`).join("")}</div>`;
}

async function refreshComments() {
  const status = statusFromLocation();
  const query = status === "all" ? "" : `&status=${status}`;
  const [events, labels] = await Promise.all([
    api(`/api/events?kind=comment&limit=500${query}`), api("/api/post-labels"),
  ]);
  postLabels = labels;
  document.querySelector("#events").innerHTML = events.map((event) => `
    <article class="event">
      <div class="event-top">
        <div class="event-meta"><strong>${escapeHtml(event.author_username || "알 수 없음")}</strong><span>${formatTime(event.received_at, true)}</span></div>
        <div class="comment-state">${commentHeart(event)}</div>
      </div>
      ${postReference(event)}
      <p class="event-body">${escapeHtml(event.body)}</p>
      ${observedCommentHeartButton(event)}
      ${commentReplies(event)}
    </article>`).join("");
  const empty = document.querySelector("#empty-events");
  empty.textContent = status === "active" ? "확인할 댓글이 없습니다." : status === "completed" ? "완료된 댓글이 없습니다." : "아직 가져온 댓글이 없습니다.";
  empty.style.display = events.length ? "none" : "block";
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLocaleLowerCase();
}

async function renderConversations(keepSelection = true) {
  const query = normalizeUsername(dmSearchQuery);
  const visible = query
    ? conversations.filter((item) => normalizeUsername(item.username).includes(query))
    : conversations;
  if (!keepSelection || !visible.some((item) => item.thread_id === selectedThreadId)) {
    selectedThreadId = visible[0]?.thread_id || "";
  }
  const emptyMessage = query ? "일치하는 아이디가 없습니다." :
    statusFromLocation() === "active" ? "확인할 DM이 없습니다." :
    statusFromLocation() === "completed" ? "완료된 DM이 없습니다." : "아직 DM 대화가 없습니다.";
  document.querySelector("#conversation-list").innerHTML = visible.map((item) => `
    <button class="conversation-item ${item.thread_id === selectedThreadId ? "active" : ""}" data-thread-id="${escapeHtml(item.thread_id)}">
      <span class="conversation-name"><strong>${escapeHtml(item.username || "알 수 없음")}</strong><span class="dm-heart-state ${item.latest_inbound_hearted ? "liked" : ""}">${item.latest_inbound_hearted === null ? "? 하트 미확인" : item.latest_inbound_hearted ? "♥ 하트함" : "♡ 하트 안 함"}</span></span>
      <span class="conversation-preview">${escapeHtml(item.latest_body || "메시지 내용 없음")}</span>
      <time>${formatTime(item.latest_at, true)}</time>
    </button>`).join("") || `<p class="empty compact">${emptyMessage}</p>`;
  await refreshChat();
}

async function refreshConversations(keepSelection = true) {
  const status = statusFromLocation();
  conversations = await api(`/api/conversations${status === "all" ? "" : `?status=${status}`}`);
  await renderConversations(keepSelection);
}

async function refreshChat() {
  const panel = document.querySelector("#chat-panel");
  if (!selectedThreadId) {
    panel.innerHTML = '<p class="empty">대화를 선택하세요.</p>';
    return;
  }
  const messages = await api(`/api/conversations/${encodeURIComponent(selectedThreadId)}`);
  const selected = conversations.find((item) => item.thread_id === selectedThreadId);
  const username = selected?.username || [...messages].reverse().find((item) => item.direction === "inbound" && item.author_username)?.author_username || "알 수 없음";
  const userId = messages.find((item) => item.direction === "inbound" && /^\d+$/.test(item.author_id || ""))?.author_id;
  const profile = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  panel.innerHTML = `
    <header class="chat-header"><button class="chat-back" aria-label="대화 목록으로 돌아가기">‹</button><div class="chat-identity"><strong>${escapeHtml(username)}</strong><span>${messages.length}개 메시지</span></div><div class="chat-header-actions">${userId ? `<button class="quiet sync-thread" data-user-id="${escapeHtml(userId)}" type="button">이 대화 동기화</button>` : ""}<a href="${profile}" target="_blank" rel="noreferrer">프로필 ↗</a></div></header>
    <div class="chat-messages">${messages.map((message) => `
      <div class="message-row ${message.direction}">
        <div class="message-bubble">
          ${message.body && !(message.shared_url && message.body === "메시지 내용 없음") ? `<p>${linkedMessageBody(message.body)}</p>` : (!message.shared_url ? "<p>메시지 내용 없음</p>" : "")}
          ${sharedLink(message)}
          <time>${formatTime(message.received_at, true)}</time>
        </div>
        ${message.direction === "inbound" ? `<span class="dm-heart ${message.has_liked ? "liked" : ""}" aria-label="${message.own_reaction ? `내가 ${escapeHtml(message.own_reaction)} 반응함` : message.has_liked === null ? "내 반응 상태 미확인" : "내가 반응하지 않음"}">${message.own_reaction ? escapeHtml(message.own_reaction) : message.has_liked === null ? "?" : "♡"}</span>` : ""}
        ${message.peer_reaction ? `<span class="dm-heart liked" aria-label="상대가 ${escapeHtml(message.peer_reaction)} 반응함">${escapeHtml(message.peer_reaction)}</span>` : ""}
      </div>`).join("")}</div>`;
  requestAnimationFrame(() => {
    const scroll = panel.querySelector(".chat-messages");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
}

async function refreshArtworks() {
  const artworks = await api("/api/artworks");
  document.querySelector("#artwork-list").innerHTML = artworks.map((item) => `
    <article class="artwork"><strong>${escapeHtml(item.title)}</strong><a href="${escapeHtml(safeUrl(item.demo_url))}" target="_blank" rel="noreferrer">${escapeHtml(item.demo_url)}</a><span>${escapeHtml(item.product_name)}</span></article>
  `).join("") || '<p class="empty">등록된 작품이 없습니다.</p>';
}

async function refreshStatus() {
  const data = await api("/api/status");
  const account = data.settings.instagram_username;
  document.querySelector("#settings-account").textContent = data.authenticated && account ? `@${account}` : "연결된 계정 없음";
  document.querySelector("#last-sync").textContent = formatTime(data.settings.last_sync_at);
  document.querySelector("#admin-logout").hidden = !data.admin_login;
}

async function refreshRoute(route) {
  if (route === "dm") await refreshConversations();
  if (route === "comment") await refreshComments();
  if (route === "work") await refreshArtworks();
  if (route === "setting") await refreshStatus();
}

const themeToggle = document.querySelector("#theme-toggle");
themeToggle.checked = document.documentElement.dataset.theme === "dark";
themeToggle.addEventListener("change", () => {
  const theme = themeToggle.checked ? "dark" : "light";
  localStorage.setItem("instagram-assistant-theme", theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
});

document.querySelectorAll(".tab").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  navigate(link.dataset.route).catch(showError);
}));
document.querySelector("#sync").addEventListener("click", syncRecords);
document.querySelector("#events").addEventListener("click", async (event) => {
  const labelButton = event.target.closest(".edit-post-label");
  if (labelButton) {
    const dialog = document.querySelector("#post-label-dialog");
    const input = dialog.querySelector("input");
    dialog.dataset.postCode = labelButton.dataset.postCode;
    input.value = postLabels[labelButton.dataset.postCode] || "";
    dialog.showModal();
    input.focus();
    input.select();
    return;
  }
  const button = event.target.closest(".observe-comment-heart");
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(button.dataset.eventId)}/heart-observed`, {
      method: "POST",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `하트 기록 실패 (${response.status})`);
    await refreshComments();
    showToast("댓글 하트를 기록하고 대화를 완료로 옮겼습니다.");
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
});
document.querySelector("#post-label-dialog form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const dialog = document.querySelector("#post-label-dialog");
  const submit = dialog.querySelector("button[type=submit]");
  const label = dialog.querySelector("input").value.trim();
  if (!label || submit.disabled) return;
  submit.disabled = true;
  try {
    const response = await fetch(`/api/post-labels/${encodeURIComponent(dialog.dataset.postCode)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `별명 저장 실패 (${response.status})`);
    dialog.close();
    await refreshComments();
    showToast("게시물 별명을 저장했습니다.");
  } catch (error) {
    showError(error);
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#cancel-post-label").addEventListener("click", () =>
  document.querySelector("#post-label-dialog").close());
document.querySelectorAll(".dm-filter, .comment-filter").forEach((button) => button.addEventListener("click", () => {
  document.querySelector("#dm-inbox").classList.remove("chat-open");
  navigate(routeFromLocation(), button.dataset.status).catch(showError);
}));
window.addEventListener("popstate", () => refreshRoute(applyRoute({ canonicalize: true })).catch(showError));
document.querySelector("#dm-search").addEventListener("input", (event) => {
  dmSearchQuery = event.currentTarget.value;
  clearTimeout(dmSearchTimer);
  dmSearchTimer = setTimeout(() => renderConversations().catch(showError), 100);
});
document.querySelector("#conversation-list").addEventListener("click", (event) => {
  const item = event.target.closest(".conversation-item");
  if (!item) return;
  selectedThreadId = item.dataset.threadId;
  document.querySelectorAll(".conversation-item").forEach((node) => node.classList.toggle("active", node === item));
  refreshChat().then(() => document.querySelector("#dm-inbox").classList.add("chat-open")).catch(showError);
});
document.querySelector("#chat-panel").addEventListener("click", (event) => {
  if (event.target.closest(".chat-back")) document.querySelector("#dm-inbox").classList.remove("chat-open");
  const button = event.target.closest(".sync-thread");
  if (!button || button.disabled) return;
  button.disabled = true;
  button.textContent = "동기화 중";
  fetch(`/api/viewer/sync?scope=dm&user_id=${encodeURIComponent(button.dataset.userId)}`, {
    method: "POST", headers: { "X-Requested-With": "InstagramAssistant" },
  }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `동기화 실패 (${response.status})`);
    await refreshConversations();
    showToast(result.dm_threads_checked ? "이 대화 동기화 완료" : "해당 대화를 API에서 찾지 못했습니다.");
  }).catch(showError).finally(() => {
    button.disabled = false;
    button.textContent = "이 대화 동기화";
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshRoute(routeFromLocation()).catch(showError);
});

refreshRoute(applyRoute({ canonicalize: true })).catch(showError);
