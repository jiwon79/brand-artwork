const routes = {
  dm: { path: "/dm", view: "dm" },
  comment: { path: "/comment", view: "comments" },
  work: { path: "/work", view: "artworks" },
  setting: { path: "/setting", view: "settings" },
};

let selectedThreadId = "";
let dmSearchQuery = "";
let conversations = [];
let dmSearchTimer;

function routeFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return Object.entries(routes).find(([, value]) => value.path === path)?.[0] || "dm";
}

function applyRoute({ canonicalize = false } = {}) {
  const route = routeFromLocation();
  if (canonicalize && `${window.location.pathname}${window.location.search}` !== routes[route].path) {
    history.replaceState({}, "", routes[route].path);
  }
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.dataset.route === route));
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === routes[route].view));
  return route;
}

async function navigate(route) {
  history.pushState({}, "", routes[route].path);
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
  const node = document.querySelector("#toast");
  node.textContent = error.message || "기록을 불러오지 못했습니다.";
  node.classList.add("error-toast", "show");
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => node.classList.remove("show"), 3500);
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
  return `<div class="shared-content"><span>공유된 콘텐츠</span><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></div>`;
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
  const url = safeUrl(event.post_url || fallback);
  if (!url) return "";
  const caption = String(event.post_caption || `게시물 ${event.post_code}`).trim();
  return `<a class="post-reference" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>게시물</span><strong>${escapeHtml(caption)}</strong><span aria-hidden="true">↗</span></a>`;
}

function commentHeart(event, compact = false) {
  return `<span class="comment-heart ${compact ? "compact" : ""}" aria-label="좋아요 ${event.like_count ?? 0}개">♡<span>${event.like_count ?? 0}</span></span>`;
}

function commentReplies(event) {
  if (!event.replies?.length) return "";
  return `<div class="comment-replies">${event.replies.map((reply) => `
    <div class="comment-reply ${reply.direction === "outbound" ? "mine" : ""}">
      <div class="reply-meta"><strong>${reply.direction === "outbound" ? "내 답글" : escapeHtml(reply.author_username || "알 수 없음")}</strong><span>${formatTime(reply.received_at, true)}</span></div>
      <p>${escapeHtml(reply.body)}</p>
      ${commentHeart(reply, true)}
    </div>`).join("")}</div>`;
}

async function refreshComments() {
  const events = await api("/api/events?kind=comment&limit=500");
  document.querySelector("#events").innerHTML = events.map((event) => `
    <article class="event">
      <div class="event-top">
        <div class="event-meta"><strong>${escapeHtml(event.author_username || "알 수 없음")}</strong><span>${formatTime(event.received_at, true)}</span></div>
        <div class="comment-state">${commentHeart(event)}</div>
      </div>
      ${postReference(event)}
      <p class="event-body">${escapeHtml(event.body)}</p>
      ${commentReplies(event)}
    </article>`).join("");
  document.querySelector("#empty-events").style.display = events.length ? "none" : "block";
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
  document.querySelector("#conversation-list").innerHTML = visible.map((item) => `
    <button class="conversation-item ${item.thread_id === selectedThreadId ? "active" : ""}" data-thread-id="${escapeHtml(item.thread_id)}">
      <span class="conversation-name"><strong>${escapeHtml(item.username || "알 수 없음")}</strong></span>
      <span class="conversation-preview">${escapeHtml(item.latest_body || "메시지 내용 없음")}</span>
      <time>${formatTime(item.latest_at, true)}</time>
    </button>`).join("") || `<p class="empty compact">${query ? "일치하는 아이디가 없습니다." : "아직 DM 대화가 없습니다."}</p>`;
  await refreshChat();
}

async function refreshConversations(keepSelection = true) {
  conversations = await api("/api/conversations");
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
  const profile = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  panel.innerHTML = `
    <header class="chat-header"><button class="chat-back" aria-label="대화 목록으로 돌아가기">‹</button><div class="chat-identity"><strong>${escapeHtml(username)}</strong><span>${messages.length}개 메시지</span></div><div class="chat-header-actions"><a href="${profile}" target="_blank" rel="noreferrer">프로필 ↗</a></div></header>
    <div class="chat-messages">${messages.map((message) => `
      <div class="message-row ${message.direction}">
        <div class="message-bubble">
          ${message.body ? `<p>${linkedMessageBody(message.body)}</p>` : (!message.shared_url ? "<p>메시지 내용 없음</p>" : "")}
          ${sharedLink(message)}
          <time>${formatTime(message.received_at, true)}</time>
        </div>
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
  document.querySelector("#settings-session-note").textContent = data.authenticated ? "Meta 공식 API 인증 정보가 저장돼 있습니다." : "Codex에서 계정을 연결해야 합니다.";
  document.querySelector("#last-sync").textContent = formatTime(data.settings.last_sync_at);
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
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshRoute(routeFromLocation()).catch(showError);
});

refreshRoute(applyRoute({ canonicalize: true })).catch(showError);
