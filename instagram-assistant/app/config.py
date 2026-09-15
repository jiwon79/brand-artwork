from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = (
    Path.home() / "Library" / "Application Support" / "InstagramAssistant"
)
DATA_DIR = Path(
    os.environ.get("INSTAGRAM_ASSISTANT_DATA", DEFAULT_DATA_DIR)
).resolve()


@dataclass
class Paths:
    data: Path = DATA_DIR
    database: Path = DATA_DIR / "assistant.sqlite3"
    session: Path = DATA_DIR / "instagram-session.json"
    token: Path = DATA_DIR / "local-token"
    codex_schema: Path = ROOT / "app" / "codex-output-schema.json"


paths = Paths()


def prepare_data_dir() -> None:
    paths.data.mkdir(parents=True, exist_ok=True, mode=0o700)
    paths.data.chmod(0o700)


def local_token() -> str:
    prepare_data_dir()
    if paths.token.exists():
        return paths.token.read_text().strip()
    value = secrets.token_urlsafe(32)
    paths.token.write_text(value)
    paths.token.chmod(0o600)
    return value
