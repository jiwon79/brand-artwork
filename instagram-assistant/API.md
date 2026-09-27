# Codex operation API

Codex can use the assistant's own local HTTP API directly. These `/api/...` routes are **not** Meta endpoints: the assistant calls Meta's official Instagram API on Codex's behalf. An MCP server is optional; it would wrap these same local endpoints. Use `http://127.0.0.1:4318` on the Mac running the assistant. The browser at the Tailscale URL is for viewing records and starting a sync, not for sending replies or reactions.

The API returns normalized JSON from the local SQLite database. Call `POST /api/sync` before reviewing recent activity, then read the relevant records. A sync reads the connected Instagram account and can take several minutes. It does not send messages.

## Read records

| Task | Request | Useful fields |
| --- | --- | --- |
| Connection and sync time | `GET /api/status` | `connected`, `settings.last_sync_at` |
| Conversations needing review | `GET /api/conversations?status=active` | `thread_id`, `username`, `latest_body`, `latest_at`, `latest_inbound_hearted`, `has_actionable` |
| Full locally stored DM conversation | `GET /api/conversations/{thread_id}` | Message `id`, `source_id`, `direction`, `body`, `shared_url`, `received_at`, `has_liked`, `status` |
| Comment threads needing review | `GET /api/events?kind=comment&status=active&limit=100` | Original comment `id`, `body`, `received_at`, `comment_url`, `post_caption`, `replies`, `needs_review` |

Use the returned local event `id` for subsequent actions. Read the complete conversation or comment thread and its post context before drafting. `active` is the UI's **확인 필요** filter. Read endpoints return the last successful local sync, so they do not prove that no newer Instagram activity exists. The official DM API may omit older or unsupported request-folder messages.

DM sync reads each message's `reactions` field for the latest 100 conversations. `has_liked` means the connected account has a heart reaction on that inbound message; other people's reactions do not count. A heart on the latest inbound message completes the conversation, and a newer inbound message without a heart returns it to **확인 필요**. The viewer shows hearted, unhearted, and not-yet-checked states separately.

For shared Instagram posts and reels, DM sync reads `shares.link` into `shared_url`. The viewer shows that link even when the message has no text. If Meta returns neither text nor a share link, it continues to show `메시지 내용 없음`.

## Protected actions

Every request in this table needs `X-Instagram-Assistant-Token`, read from `~/Library/Application Support/InstagramAssistant/local-token` on the same Mac. Keep the token out of the browser, chat, Git, and Notion. The browser's sync-only endpoint is separate.

| Task | Request | Body / effect |
| --- | --- | --- |
| Sync from Codex | `POST /api/sync` | Fetches supported Instagram comments and DMs. |
| Save approved reply | `PATCH /api/events/{event_id}/draft` | JSON `{"draft":"답변"}`. Sets `reply_dm` or `reply_comment` from the event type. |
| Send approved reply | `POST /api/events/{event_id}/send` | Sends the saved draft through Meta's official API. |
| Heart an inbound DM | `POST /api/events/{event_id}/heart` | Sends a DM message reaction through Meta's official API. |
| Record a verified UI heart | `POST /api/events/{event_id}/heart-observed` | Records a heart already pressed in Instagram; this endpoint does **not** press it. |
| Mark an item handled without reply | `POST /api/events/{event_id}/ignore` | Changes the local review state. |

Only a connected account's pending inbound DM with a sender ID, or an original inbound comment, can receive an API draft. Leave automatic sending settings off. The user approves each reply or heart before Codex sends it. For DM wording and approval criteria, read the current [Instagram DM 답변 규칙](https://app.notion.com/p/3e7a89f7e31a815b8b60c3ead057bf0a); this file records API mechanics, not message templates.

For a reply: sync, read the thread, prepare the exact text for user review, save the approved draft, send, then reread the event and conversation or comment thread to verify the result. If a send returns an uncertain result, check Instagram before any retry. The service checks for an existing reply on an original comment before sending another.

The official API used here cannot press a **comment** heart. Open the returned `comment_url`, verify the original comment in Instagram, press its heart in the Instagram UI, and then call `heart-observed`. A DM heart uses the protected API endpoint above. A later inbound DM or comment reply returns its thread to **확인 필요** after the next sync.
