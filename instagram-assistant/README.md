# Instagram assistant

Local-first assistant for `jiiwon.studio`. It reads recent comments and DMs with `instagrapi`, stores only operational state in SQLite, and prepares narrowly scoped replies.

Instagram DM을 분류하거나 답변을 보내기 전에는 Notion `Project → Vibe → 내부 운영`의 [Instagram DM 답변 규칙](https://app.notion.com/p/3e7a89f7e31a815b8b60c3ead057bf0a)을 읽는다. 문구, 분기, 메시지 분할과 대화별 승인 기준은 그 문서에서 관리한다. 현재 `rules.py`의 자동 답변 로직은 이 규칙과 아직 동기화되지 않았다.

## Safety defaults

- Binds only to `127.0.0.1`.
- Does not save the Instagram password.
- Saves SQLite, the Instagram session, and the local token under
  `~/Library/Application Support/InstagramAssistant/` so Codex worktrees share
  the same runtime data. The session and token use mode `0600`.
- Starts in observation mode. Sending is blocked until observation mode is disabled.
- Stops on challenge, feedback, and rate-limit responses instead of retrying.
- Limits sends to 20 per UTC day by default.
- Never auto-replies to praise, emoji, thanks, collaboration, refund, error, or ambiguous requests.

This uses an unofficial Instagram API. Account restrictions remain possible even with conservative settings.

The `instagrapi` dependency is pinned to the upstream login-profile fix because the latest PyPI build still identifies itself as an obsolete Instagram Android app.

## Run

On macOS, double-click `start.command`. Or run it manually:

```bash
./start.command
```

Equivalent commands:

```bash
uv sync --dev
uv run uvicorn app.main:app --host 127.0.0.1 --port 4318
```

Open <http://127.0.0.1:4318>. Connect Instagram from Settings, then register each artwork's slug, title, Instagram post code, and product name. Demo URLs are derived as `https://studio.jiiwon.com/{slug}`, and every purchase link uses `https://litt.ly/jiiwon`.

Set `INSTAGRAM_ASSISTANT_DATA` to override the shared data directory. Run only
one Instagram Assistant process against a shared data directory at a time.

## One-shot worker

Read, classify, and persist without sending:

```bash
uv run python -m app.worker once
```

Sending remains impossible while observation mode is enabled. After validation, explicitly enable the narrow comment or DM category in SQLite/UI before running:

```bash
uv run python -m app.worker once --send
```

## Tests

```bash
uv run pytest
```
