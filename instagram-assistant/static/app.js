const token = document.querySelector('meta[name="instagram-assistant-token"]').content;
let currentStatus = "active";
let selectedThreadId = "";

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
  node.style.background = error ? "#9c3229" : "#171714";
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
  document.querySelector("#pending-count").textContent = data.counts.pending;
  document.querySelector("#drafted-count").textContent = data.counts.drafted;
  document.querySelector("#manual-count").textContent = data.counts.manual;
  document.querySelector("#sent-count").textContent = data.counts.sent_today;
  document.querySelector("#read-only").checked = data.settings.read_only_observation;
  document.querySelector("#auto-send").checked = data.settings.auto_send;
  document.querySelector("#auto-comment").checked = data.settings.auto_comment;
  document.querySelector("#auto-dm").checked = data.settings.auto_dm;
  document.querySelector("#daily-limit").value = data.settings.daily_send_limit;
  document.querySelector("#profile-url").value = data.settings.profile_url;
  const status = document.querySelector(".status");
  status.className = `status ${data.settings.halted_reason ? "halted" : data.authenticated ? "connected" : ""}`;
  document.querySelector("#status-text").textContent = data.settings.halted_reason ? "중지됨" : data.authenticated ? "연결됨" : "연결 필요";
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

function commentHeart(event, compact = false) {
  return `<button class="comment-heart ${event.has_liked ? "liked" : ""} ${compact ? "compact" : ""}" data-action="comment-heart" data-liked="${event.has_liked ? "true" : "false"}" aria-label="${event.has_liked ? "댓글 하트 취소" : "댓글에 하트"}" aria-pressed="${event.has_liked ? "true" : "false"}">${event.has_liked ? "♥" : "♡"}<span>${event.like_count ?? 0}</span></button>`;
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
  const query = currentStatus ? `&status=${currentStatus}` : "";
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
  const conversations = await api("/api/conversations");
  if (!keepSelection || !conversations.some((item) => item.thread_id === selectedThreadId)) {
    selectedThreadId = conversations[0]?.thread_id || "";
  }
  document.querySelector("#conversation-list").innerHTML = conversations.map((item) => `
    <button class="conversation-item ${item.thread_id === selectedThreadId ? "active" : ""}" data-thread-id="${escapeHtml(item.thread_id)}">
      <span class="conversation-name">${escapeHtml(item.username || "알 수 없음")}${item.needs_attention ? `<b>${item.needs_attention}</b>` : ""}</span>
      <span class="conversation-preview">${escapeHtml(item.latest_body || "공유된 콘텐츠")}</span>
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
  const target = [...messages].reverse().find((item) => item.direction === "inbound" && ["pending", "drafted", "manual"].includes(item.status));
  panel.innerHTML = `
    <header class="chat-header"><div><strong>${escapeHtml(username)}</strong><span>${messages.length}개 메시지</span></div><a href="https://www.instagram.com/${escapeHtml(username)}/" target="_blank" rel="noreferrer">프로필 ↗</a></header>
    <div class="chat-messages">
      ${messages.map((message) => `
        <div class="message-row ${message.direction}">
          <div class="message-bubble">
            ${message.body ? `<p>${escapeHtml(message.body)}</p>` : ""}
            ${sharedLink(message)}
            <time>${formatTime(message.received_at, true)}</time>
          </div>
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
}

async function refreshArtworks() {
  const artworks = await api("/api/artworks");
  document.querySelector("#artwork-list").innerHTML = artworks.map((item) => `
    <article class="artwork"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.demo_url || "체험 링크 없음")}</span><span>${escapeHtml(item.purchase_url || "구매 링크 없음")}</span></article>
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
  document.querySelector(`#${button.dataset.view}`).classList.add("active");
}));

document.querySelectorAll(".inbox-mode").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".inbox-mode").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  const dmMode = button.dataset.mode === "dm";
  document.querySelector("#dm-inbox").hidden = !dmMode;
  document.querySelector("#comment-inbox").hidden = dmMode;
}));

document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", async () => {
  document.querySelectorAll(".filter").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  currentStatus = button.dataset.status;
  await refreshComments();
}));

document.querySelector("#conversation-list").addEventListener("click", async (event) => {
  const item = event.target.closest(".conversation-item");
  if (!item) return;
  selectedThreadId = item.dataset.threadId;
  document.querySelectorAll(".conversation-item").forEach((node) => node.classList.toggle("active", node === item));
  await refreshChat();
});

document.querySelector("#sync").addEventListener("click", async () => {
  try {
    const result = await api("/api/sync", { method: "POST" });
    toast(`새 댓글 ${result.comments} · 새 대댓글 ${result.comment_replies || 0} · 새 DM ${result.dms}`);
    await refreshAll();
  } catch (error) { toast(error.message, true); }
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
  try { if (await runEventAction(event.target.closest(".chat-panel"), event.target)) await refreshAll(); }
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
