const token = document.querySelector('meta[name="instagram-assistant-token"]').content;
let currentStatus = "";

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
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
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

async function refreshEvents() {
  const query = currentStatus ? `?status=${currentStatus}` : "";
  const events = await api(`/api/events${query}`);
  const root = document.querySelector("#events");
  root.innerHTML = events.map((event) => `
    <article class="event" data-id="${escapeHtml(event.id)}">
      <div class="event-top">
        <div class="event-meta"><span class="badge">${event.kind === "comment" ? "댓글" : "DM"}</span><strong>${escapeHtml(event.author_username || "알 수 없음")}</strong><span>${new Date(event.received_at).toLocaleString("ko-KR")}</span></div>
        <span class="badge">${escapeHtml(event.intent || event.status)}</span>
      </div>
      <p class="event-body">${escapeHtml(event.body || "공유된 콘텐츠")}</p>
      ${event.draft ? `<textarea class="draft">${escapeHtml(event.draft)}</textarea>` : ""}
      <div class="event-actions">
        ${event.status === "manual" || event.status === "pending" ? `<button class="quiet" data-action="codex">Codex 판단</button>` : ""}
        ${event.status === "drafted" ? `<button class="quiet" data-action="save">초안 저장</button><button class="primary" data-action="send">보내기</button>` : ""}
        ${!["sent", "ignored"].includes(event.status) ? `<button class="quiet" data-action="ignore">무시</button>` : ""}
      </div>
    </article>
  `).join("");
  document.querySelector("#empty-events").style.display = events.length ? "none" : "block";
}

async function refreshArtworks() {
  const artworks = await api("/api/artworks");
  document.querySelector("#artwork-list").innerHTML = artworks.map((item) => `
    <article class="artwork"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.demo_url || "체험 링크 없음")}</span><span>${escapeHtml(item.purchase_url || "구매 링크 없음")}</span></article>
  `).join("") || '<p class="empty">등록된 작품이 없습니다.</p>';
}

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshEvents(), refreshArtworks()]);
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab,.view").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  document.querySelector(`#${button.dataset.view}`).classList.add("active");
}));

document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", async () => {
  document.querySelectorAll(".filter").forEach((node) => node.classList.remove("active"));
  button.classList.add("active");
  currentStatus = button.dataset.status;
  await refreshEvents();
}));

document.querySelector("#sync").addEventListener("click", async () => {
  try { const result = await api("/api/sync", { method: "POST" }); toast(`새 댓글 ${result.comments} · 새 DM ${result.dms}`); await refreshAll(); }
  catch (error) { toast(error.message, true); }
});

document.querySelector("#classify").addEventListener("click", async () => {
  try { const result = await api("/api/events/classify", { method: "POST" }); toast(`${result.classified}개 항목을 분류했습니다.`); await refreshAll(); }
  catch (error) { toast(error.message, true); }
});

document.querySelector("#events").addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  const card = event.target.closest(".event");
  const id = encodeURIComponent(card.dataset.id);
  try {
    if (action === "save") await api(`/api/events/${id}/draft`, { method: "PATCH", body: JSON.stringify({ draft: card.querySelector(".draft").value }) });
    if (action === "codex") await api(`/api/events/${id}/codex`, { method: "POST" });
    if (action === "ignore") await api(`/api/events/${id}/ignore`, { method: "POST" });
    if (action === "send") {
      await api(`/api/events/${id}/draft`, { method: "PATCH", body: JSON.stringify({ draft: card.querySelector(".draft").value }) });
      await api(`/api/events/${id}/send`, { method: "POST" });
    }
    toast(action === "send" ? "전송했습니다." : "반영했습니다.");
    await refreshAll();
  } catch (error) { toast(error.message, true); }
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
