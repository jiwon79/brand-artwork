# Instagram assistant

Local Instagram record viewer and Codex-operated reply service for a Business or Creator account. It uses Meta's **Instagram API with Instagram Login** (`graph.instagram.com`) to read media, comments and supported DM conversations, and to send approved replies. It never uses Instagram's private/mobile endpoints or asks for an Instagram password. The browser UI can manually sync and view records; it does not classify, draft, send replies, react, or change Instagram settings.

Instagram DM 답변을 준비하거나 보내기 전에는 Notion `Project → Vibe → 내부 운영`의 [Instagram DM 답변 규칙](https://app.notion.com/p/3e7a89f7e31a815b8b60c3ead057bf0a)을 읽는다. 문구, 분기, 메시지 분할과 대화별 승인 기준은 그 문서에서 관리한다. 자동 분류와 자동 발송은 사용하지 않는다.

## Meta setup

1. Create a Meta app with **Instagram API with Instagram Login** and enable Business Login for Instagram. Add the Instagram professional account to the app (or obtain the necessary access level for other accounts).
2. Grant `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`.
3. Register a redirect URI that reaches this app's `/api/auth/callback` endpoint. Meta must be able to redirect the browser to it. If Meta rejects a local HTTP URI, use an HTTPS tunnel or deployment that forwards to this local app.
4. Copy `.env.example` to `.env.local` and enter separate `META_DEV_*` and `META_PROD_*` app credentials and **exact** registered redirect URIs. Select one app with `INSTAGRAM_ENV=development` or `production`. The two app IDs must differ. `.env.local` is gitignored; keep it private (`chmod 600 .env.local`). Do not put credentials in chat, Git, or Notion.
5. Start `./start.command`. Codex can request a protected OAuth URL with `POST /api/auth/url`; sign in and grant access on Instagram's own authorization page. The app stores the resulting long-lived Graph token in `~/Library/Application Support/InstagramAssistant/graph-token.json` with mode `0600`; it refreshes near expiry. Old private API login files are not used.

Meta's Instagram Login setup says an app must be published to access live data. Direct developers using only their own Instagram business can skip App Review, but publishing still requires a public privacy-policy URL. The site's policy source is `public/instagram-assistant-privacy.html`; use its deployed URL only after confirming the public page loads. An unpublished app can report a nonzero `comments_count` while returning an empty `/{media_id}/comments` list; the assistant treats that mismatch as an error instead of an empty inbox.

The app binds to `127.0.0.1:4318`. `INSTAGRAM_ASSISTANT_DATA` overrides the shared data directory. Run only one assistant process against it at a time. `INSTAGRAM_GRAPH_VERSION` can select the Meta API version after checking its current documentation. The legacy `INSTAGRAM_APP_*` environment names only work when `INSTAGRAM_ENV` is unset, for the existing loopback installation during migration.

## Turso and administrator login

Set distinct `TURSO_DEV_DATABASE_URL`/`TURSO_DEV_AUTH_TOKEN` and `TURSO_PROD_DATABASE_URL`/`TURSO_PROD_AUTH_TOKEN` values. `INSTAGRAM_ENV` selects the matching database. The same URL for both environments is rejected. `TURSO_DRIVER=libsql` uses the libSQL Turso service; set `TURSO_DRIVER=turso` for the newer Turso Database engine. An unset URL keeps local SQLite for development. The remote driver uses direct network queries, so no writable local SQLite file is needed in a hosted process.

To preserve the current records, stop the local viewer and webhook writers, configure the destination Turso environment, then run `uv run --env-file .env.local python -m app.migrate_to_turso`. Migration takes a consistent SQLite snapshot, requires an empty destination, copies the record tables, and checks row counts. Keep the source SQLite file as a rollback copy until the hosted records have been inspected. Set `INSTAGRAM_TOKEN_ENCRYPTION_KEY` to a private Fernet key before connecting Instagram on Turso; `uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'` generates one. The Meta access token is encrypted in Turso, while OAuth state is stored there until callback completion.

Set `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` before exposing the viewer. Generate a password hash locally with `uv run python -m app.admin_auth` (it prompts without echoing the password), and generate a random session secret with a password manager. In `.env.local`, wrap the hash in single quotes so dotenv does not expand its `$` separators: `ADMIN_PASSWORD_HASH='pbkdf2_sha256$...'`. The browser receives a 12-hour HttpOnly session cookie after login; API records and actions require that session, and mutations require a same-origin request. An external host without these settings returns 503. Loopback keeps the existing local-token workflow until admin login is configured. Deploy development and production as separate services with different Meta apps and Turso databases.

For Vercel, set the project root directory to `instagram-assistant`; `index.py` exports the combined FastAPI app. The public `/webhook` accepts and stores signed events, while `/api/cron/process-webhooks` drains the durable queue with `CRON_SECRET`. Vercel Pro is required for the one-minute cron in `vercel.json`; Hobby only supports daily cron. Keep the development and production deployments in separate Vercel projects with distinct environment variables. The existing local `app.webhook:app` still runs its background processor for local testing.

## Webhook and daily reconciliation

The separate `app.webhook:app` process binds to `127.0.0.1:4319`. Expose only that process at a public HTTPS `/webhook` URL. Never expose the viewer on port 4318 through the public webhook tunnel. Configure each Meta app's callback with its own URL and `META_DEV_WEBHOOK_VERIFY_TOKEN` or `META_PROD_WEBHOOK_VERIFY_TOKEN`; subscribe to `messages`, `message_reactions`, and `comments`. Then activate those fields for the connected account with its `/subscribed_apps` edge. The endpoint checks Meta's SHA-256 signature against the matching app secret (or an explicit `META_*_WEBHOOK_APP_SECRET` override), stores the raw notification in the selected Turso/SQLite database, acknowledges it, then queries only the affected DM conversation or comment thread. Failed lookups are retried; the viewer does not send anything in this flow. Instagram's webhook `entry.id` can be the account's messaging ID, distinct from Graph `/me` ID; the assistant records that ID from a verified conversation participant before accepting its events.

Run `uv run --env-file .env.local python -m app.full_sync` repeatedly from a local scheduler, or let the hosted one-minute cron invoke it. Each call scans one media or DM conversation with all its accessible comments, replies, or messages, then saves the pagination cursor. A Meta request-limit response pauses the scan for one hour without losing that cursor. A completed pass waits 24 hours before starting again. Meta omits request-folder conversations inactive for more than 30 days. The last successful complete pass is stored as `last_full_sync_at`; `full_sync_progress` shows the current phase. Existing `app.worker` and viewer manual sync remain partial, on-demand operations.

## Review and sending

- [Codex operation API](./API.md) lists the normalized read endpoints, protected reply/reaction actions, review flow, and current limits. MCP is optional.
- The browser UI exposes no local mutation token. Its sync button calls a same-origin, sync-only endpoint; all reply and reaction actions remain protected from the browser. Codex can also sync through `uv run python -m app.worker` or the protected local API. MCP is optional; Codex can use the existing Python service and local API directly.
- New OAuth connections reset automatic sending to off. Codex prepares and sends only the individual replies approved for that batch.
- Comments are sent with `POST /{comment_id}/replies`, not `POST /{media_id}/comments`. Before sending, the assistant checks the parent's replies for an existing account reply. After sending, it looks for the returned reply ID under that parent. An uncertain result is left for manual review and is never automatically retried.
- Comment review is computed per parent thread from its stored replies. A new inbound reply after the latest account reply, heart, or review reopens the parent in `확인 필요`; a later reply, heart, or protected ignore action completes it again. Threads sort by their latest activity. The original comment's `sent` history is preserved.
- DM replies use the official Send API and require an Instagram-scoped sender ID. Meta only allows supported conversations and messages; historical request-folder messages may not all be available through the API.
- The official comment API does not expose a comment-like action. Comment hearts remain an Instagram UI action. Comment JSON includes `comment_url`, a direct link to the original comment derived from its stored post URL and comment ID; verify the target in Instagram before clicking its heart. After verifying a comment or DM heart in Instagram, Codex records it through the protected `POST /api/events/{event_id}/heart-observed` endpoint. This endpoint only records an observed reaction; it does not press the heart. Meta documents an official DM message reaction endpoint; Codex can call the protected `POST /api/events/{event_id}/heart` endpoint for an approved inbound DM. The browser viewer never sends reactions.
- Legacy events remain in SQLite for history, but can only be sent if their account ID matches the active official connection. Events without a verified account ID cannot be sent.
- Daily send limit defaults to 20. Meta API limit responses halt sending.

The previous assistant's full private-API DM history, private reaction state, and some shared-post details cannot be recovered by the official conversation read API. The app does not claim that an initial DM sync is a complete historical archive. Confirm the scope returned for the connected account before enabling automatic DM replies.

## Run and tests

```bash
./start.command
uv run pytest
```

For a single read-only sync: `uv run python -m app.worker`. This command never classifies or sends replies.

Meta references: [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login), [comment moderation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation), [Conversations API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api), [DM message reactions](https://www.postman.com/meta/instagram/request/baztwvm/react-or-unreact-to-a-message).
