# Codex operation API

Codex can use the assistant's HTTP API. These `/api/...` routes are **not** Meta endpoints: the assistant calls Meta's official Instagram API on Codex's behalf. An MCP server is optional. Local service: `http://127.0.0.1:4318`. Hosted service: `https://instagram-assistant-prod.vercel.app`, with administrator login in Chrome. The browser viewer reads records and starts syncs; it does not press Instagram hearts or send replies.

The API returns normalized JSON from the local SQLite database. Call `POST /api/sync` before reviewing recent activity, then read the relevant records. A sync reads the connected Instagram account and can take several minutes. It does not send messages.

## Read records

| Task | Request | Useful fields |
| --- | --- | --- |
| Connection and sync time | `GET /api/status` | `connected`, `settings.last_sync_at` |
| Conversations needing review | `GET /api/conversations?status=active` | `thread_id`, `username`, `latest_body`, `latest_at`, `has_actionable` |
| Full locally stored DM conversation | `GET /api/conversations/{thread_id}` | Message `id`, `source_id`, `direction`, `body`, `received_at`, `has_liked`, `status` |
| Comment threads needing review | `GET /api/events?kind=comment&status=active&limit=100` | Original comment `id`, `body`, `received_at`, `comment_url`, `post_caption`, `replies`, `needs_review` |

Use the returned local event `id` for subsequent actions. Read the complete conversation or comment thread and its post context before drafting. `active` is the UI's **확인 필요** filter. Read endpoints return the last successful local sync, so they do not prove that no newer Instagram activity exists. The official DM API may omit older or unsupported request-folder messages.

## Protected actions

On the loopback service, these requests need `X-Instagram-Assistant-Token` from `~/Library/Application Support/InstagramAssistant/local-token`. Keep it out of the browser, chat, Git, and Notion. The hosted service instead requires the administrator session cookie; mutation requests must be same-origin. A local token header alone cannot authorize a hosted request. Use the signed-in viewer controls for the heart workflow below.

| Task | Request | Body / effect |
| --- | --- | --- |
| Sync from Codex | `POST /api/sync` | Fetches supported Instagram comments and DMs. |
| Save approved reply | `PATCH /api/events/{event_id}/draft` | JSON `{"draft":"답변"}`. Sets `reply_dm` or `reply_comment` from the event type. |
| Send approved reply | `POST /api/events/{event_id}/send` | Sends the saved draft through Meta's official API. |
| Record a verified UI heart | `POST /api/events/{event_id}/heart-observed` | Records a heart already pressed in Instagram; this endpoint does **not** press it. |
| Mark an item handled without reply | `POST /api/events/{event_id}/ignore` | Changes the local review state. |

Only a connected account's pending inbound DM with a sender ID, or an original inbound comment, can receive an API draft. Leave automatic sending settings off. The user approves each reply or heart before Codex sends it. For DM wording and approval criteria, read the current [Instagram DM 답변 규칙](https://app.notion.com/p/3e7a89f7e31a815b8b60c3ead057bf0a); this file records API mechanics, not message templates.

For a reply: sync, read the thread, prepare the exact text for user review, save the approved draft, send, then reread the event and conversation or comment thread to verify the result. If a send returns an uncertain result, check Instagram before any retry. The service checks for an existing reply on an original comment before sending another.

## Chrome heart workflow

For every approved heart, first match the account, original text, and exact message or comment. Check whether the heart is already present; clicking it again can remove it. Use the existing Chrome Instagram session for **both DM and comment hearts**. Reload the Instagram conversation or post and confirm the reaction remains on the same item before updating the assistant.

- **DM:** In the signed-in viewer, open that conversation and click `이 대화 동기화`. Confirm the same inbound message now has `own_reaction` / `has_liked` and the visible `내가 ❤ 반응함` marker. This targets one conversation through `POST /api/viewer/sync?scope=dm&user_id={IGSID}`; `user_id` is the other participant's numeric Instagram-scoped ID, not their username. The viewer obtains it from the selected conversation. If the target is not found or the read fails, leave it unconfirmed.
- **Comment or reply:** The Graph comment response supplies `like_count` but not whether this account liked the comment. A Graph refresh alone cannot confirm the Chrome heart. After reloading Instagram and confirming the exact comment's heart, use that comment's `Chrome 하트 확인 후 기록` button in the signed-in viewer. It calls `POST /api/events/{event_id}/heart-observed` for that one `comment:{id}` and rereads the comment list. Confirm `has_liked` and the updated review state. This is an observation record, not a remote reaction send or Graph verification. If the stored author is unknown, the button is hidden and the API refuses to record the heart; first resolve the author by syncing or checking the exact Instagram item.

The legacy protected `POST /api/events/{event_id}/heart` DM reaction route remains in the code, but the current operating rule does not use it: Meta returned HTTP 500/code 2 in the live test without creating a heart. Never mark an API error or a mere click as sent. A later inbound DM or comment reply returns its thread to **확인 필요** after the next sync. The current wording and per-item approval rules live in [Instagram DM 답변 규칙](https://app.notion.com/p/3e7a89f7e31a815b8b60c3ead057bf0a) and [Instagram 댓글 답변 규칙](https://app.notion.com/p/3e7a89f7e31a80d2b15aee2e02963e42).
