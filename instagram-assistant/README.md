# Instagram assistant

Local review and reply assistant for an Instagram Business or Creator account. It uses Meta's **Instagram API with Instagram Login** (`graph.instagram.com`) to read media, comments and supported DM conversations, and to send replies. It never uses Instagram's private/mobile endpoints or asks for an Instagram password.

Instagram DM을 분류하거나 답변을 보내기 전에는 Notion `Project → Vibe → 내부 운영`의 [Instagram DM 답변 규칙](https://app.notion.com/p/3e7a89f7e31a815b8b60c3ead057bf0a)을 읽는다. 문구, 분기, 메시지 분할과 대화별 승인 기준은 그 문서에서 관리한다. 현재 자동 답변 로직은 이 규칙과 아직 동기화되지 않았다.

## Meta setup

1. Create a Meta app with **Instagram API with Instagram Login** and enable Business Login for Instagram. Add the Instagram professional account to the app (or obtain the necessary access level for other accounts).
2. Grant `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`.
3. Register a redirect URI that reaches this app's `/api/auth/callback` endpoint. Meta must be able to redirect the browser to it. If Meta rejects a local HTTP URI, use an HTTPS tunnel or deployment that forwards to this local app.
4. Copy `.env.example` to `.env.local` and enter the Instagram App ID, Instagram App Secret, and the **exact** registered redirect URI. `.env.local` is gitignored. Keep it private (`chmod 600 .env.local`). Do not put credentials in chat, Git, or Notion.
5. Start `./start.command`, open Settings, and choose Connect. Sign in and grant access on Instagram's own authorization page. The app stores the resulting long-lived Graph token in `~/Library/Application Support/InstagramAssistant/graph-token.json` with mode `0600`; it refreshes near expiry. Existing `instagram-session.json` files from the old private API are ignored.

The app binds to `127.0.0.1:4318`. `INSTAGRAM_ASSISTANT_DATA` overrides the shared data directory. Run only one assistant process against it at a time. `INSTAGRAM_GRAPH_VERSION` can select the Meta API version after checking its current documentation.

## Review and sending

- Starts in observation mode. New OAuth connections reset automatic sending to off.
- Comments are sent with `POST /{comment_id}/replies`, not `POST /{media_id}/comments`. Before sending, the assistant checks the parent's replies for an existing account reply. After sending, it looks for the returned reply ID under that parent. An uncertain result is left for manual review and is never automatically retried.
- DM replies use the official Send API and require an Instagram-scoped sender ID. Meta only allows supported conversations and messages; historical request-folder messages may not all be available through the API.
- The official comment API does not expose a comment-like action. Comment hearts remain a manual Instagram action. DM hearts are also disabled in this version.
- Legacy events remain in SQLite for history, but can only be sent if their account ID matches the active official connection. Events without a verified account ID cannot be sent.
- Daily send limit defaults to 20. Meta API limit responses halt sending.

The previous assistant's full private-API DM history, private reaction state, and some shared-post details cannot be recovered by the official conversation read API. The app does not claim that an initial DM sync is a complete historical archive. Confirm the scope returned for the connected account before enabling automatic DM replies.

## Run and tests

```bash
./start.command
uv run pytest
```

For a single observation pass: `uv run python -m app.worker once`. Add `--send` only after reviewing the connected account, imported events, and automation settings.

Meta references: [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login), [comment moderation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation), [Conversations API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api).
