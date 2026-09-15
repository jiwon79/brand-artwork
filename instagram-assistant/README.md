# Instagram assistant

Local-first assistant for `jiiwon.studio`. It reads recent comments and DMs with `instagrapi`, stores only operational state in SQLite, and prepares narrowly scoped replies.

## Safety defaults

- Binds only to `127.0.0.1`.
- Does not save the Instagram password.
- Saves the Instagram session under `.data/` with mode `0600`.
- Starts in observation mode. Sending is blocked until observation mode is disabled.
- Stops on challenge, feedback, and rate-limit responses instead of retrying.
- Limits sends to 20 per UTC day by default.
- Never auto-replies to praise, emoji, thanks, collaboration, refund, error, or ambiguous requests.

This uses an unofficial Instagram API. Account restrictions remain possible even with conservative settings.

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

Open <http://127.0.0.1:4318>. Connect Instagram from Settings, then register each artwork's Instagram post code, demo URL, and purchase URL.

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
