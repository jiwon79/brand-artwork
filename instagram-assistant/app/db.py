from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, Iterator

from .config import paths, prepare_data_dir


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  post_code TEXT UNIQUE,
  media_id TEXT,
  demo_url TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  purchase_url TEXT NOT NULL DEFAULT '',
  product_status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('comment', 'dm')),
  source_id TEXT NOT NULL,
  parent_comment_id TEXT,
  thread_id TEXT,
  media_id TEXT,
  post_code TEXT,
  post_url TEXT,
  post_caption TEXT,
  shared_url TEXT,
  author_id TEXT,
  author_username TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound', 'outbound')),
  has_liked INTEGER,
  like_count INTEGER,
  body TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  intent TEXT,
  confidence REAL,
  proposed_action TEXT,
  draft TEXT,
  artwork_slug TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_status_received_idx
ON events(status, received_at DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  action TEXT NOT NULL,
  body TEXT NOT NULL,
  remote_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
"""


DEFAULT_SETTINGS = {
    "instagram_username": "",
    "profile_url": "https://litt.ly/jiiwon",
    "auto_send": False,
    "auto_comment": False,
    "auto_dm": False,
    "daily_send_limit": 20,
    "read_only_observation": True,
    "last_sync_at": None,
    "halted_reason": None,
}

DEFAULT_ARTWORKS = (
    {
        "slug": "line-pull",
        "title": "Line Pull",
        "post_code": "Dc8RsObTqfn",
        "demo_url": "https://brand.jiiwon.com/pages/line-pull",
        "product_name": "Line Pull 제작 자료",
        "purchase_url": "https://litt.ly/jiiwon",
        "product_status": "available",
    },
)


def now() -> str:
    return datetime.now(UTC).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    prepare_data_dir()
    conn = sqlite3.connect(paths.database)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def initialize() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(events)")}
        if "direction" not in columns:
            conn.execute(
                "ALTER TABLE events ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound'"
            )
        if "has_liked" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN has_liked INTEGER")
        if "like_count" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN like_count INTEGER")
        if "parent_comment_id" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN parent_comment_id TEXT")
        if "post_url" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN post_url TEXT")
        if "post_caption" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN post_caption TEXT")
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )
        timestamp = now()
        for item in DEFAULT_ARTWORKS:
            conn.execute(
                """
                INSERT OR IGNORE INTO artworks(
                  slug, title, post_code, demo_url, product_name,
                  purchase_url, product_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["slug"], item["title"], item["post_code"],
                    item["demo_url"], item["product_name"],
                    item["purchase_url"], item["product_status"],
                    timestamp, timestamp,
                ),
            )


def get_settings() -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {row["key"]: json.loads(row["value"]) for row in rows}


def update_settings(values: dict[str, Any]) -> dict[str, Any]:
    allowed = set(DEFAULT_SETTINGS)
    with connect() as conn:
        for key, value in values.items():
            if key not in allowed:
                continue
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value, ensure_ascii=False)),
            )
    return get_settings()


def list_artworks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM artworks ORDER BY title").fetchall()
    return [dict(row) for row in rows]


def save_artwork(item: dict[str, Any]) -> dict[str, Any]:
    timestamp = now()
    post_code = item.get("post_code") or None
    media_id = item.get("media_id") or None
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO artworks(
              slug, title, post_code, media_id, demo_url, product_name,
              purchase_url, product_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
              title=excluded.title,
              post_code=excluded.post_code,
              media_id=excluded.media_id,
              demo_url=excluded.demo_url,
              product_name=excluded.product_name,
              purchase_url=excluded.purchase_url,
              product_status=excluded.product_status,
              updated_at=excluded.updated_at
            """,
            (
                item["slug"], item["title"], post_code,
                media_id, item.get("demo_url", ""),
                item.get("product_name", ""), item.get("purchase_url", ""),
                item.get("product_status", "available"), timestamp, timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM artworks WHERE slug=?", (item["slug"],)).fetchone()
    return dict(row)


def upsert_event(event: dict[str, Any]) -> bool:
    timestamp = now()
    with connect() as conn:
        exists = conn.execute(
            "SELECT 1 FROM events WHERE id=?", (event["id"],)
        ).fetchone() is not None
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO events(
              id, kind, source_id, parent_comment_id, thread_id, media_id, post_code,
              post_url, post_caption, shared_url,
              author_id, author_username, direction, has_liked, like_count, body,
              received_at, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"], event["kind"], event["source_id"], event.get("parent_comment_id"),
                event.get("thread_id"), event.get("media_id"), event.get("post_code"),
                event.get("post_url"), event.get("post_caption"), event.get("shared_url"),
                event.get("author_id"),
                event.get("author_username", ""), event.get("direction", "inbound"),
                event.get("has_liked"), event.get("like_count"), event.get("body", ""),
                event.get("received_at", timestamp),
                event.get("status", "pending"), timestamp, timestamp,
            ),
        )
        if exists:
            conn.execute(
                """
                UPDATE events SET
                  parent_comment_id=COALESCE(?, parent_comment_id),
                  thread_id=COALESCE(?, thread_id),
                  post_url=COALESCE(?, post_url),
                  post_caption=COALESCE(?, post_caption),
                  shared_url=COALESCE(?, shared_url),
                  direction=COALESCE(?, direction),
                  has_liked=COALESCE(?, has_liked),
                  like_count=COALESCE(?, like_count),
                  author_username=CASE WHEN ? <> '' THEN ? ELSE author_username END,
                  updated_at=?
                WHERE id=?
                """,
                (
                    event.get("parent_comment_id"), event.get("thread_id"),
                    event.get("post_url"), event.get("post_caption"), event.get("shared_url"),
                    event.get("direction"), event.get("has_liked"),
                    event.get("like_count"), event.get("author_username", ""),
                    event.get("author_username", ""), timestamp, event["id"],
                ),
            )
        return cursor.rowcount > 0


def list_events(
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = "SELECT * FROM events"
    params: list[Any] = []
    conditions: list[str] = []
    if status == "active":
        conditions.append("status IN ('pending', 'drafted', 'manual')")
    elif status:
        conditions.append("status=?")
        params.append(status)
    if kind:
        conditions.append("kind=?")
        params.append(kind)
    if kind == "comment":
        conditions.append("parent_comment_id IS NULL")
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY received_at DESC LIMIT ?"
    params.append(min(max(limit, 1), 500))
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def list_comment_threads(
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    comments = list_events(status=status, kind="comment", limit=limit)
    if not comments:
        return []
    parent_ids = [comment["source_id"] for comment in comments]
    placeholders = ",".join("?" for _ in parent_ids)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM events WHERE kind='comment' "
            f"AND parent_comment_id IN ({placeholders}) ORDER BY received_at ASC",
            parent_ids,
        ).fetchall()
    replies_by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        reply = dict(row)
        replies_by_parent.setdefault(str(reply["parent_comment_id"]), []).append(reply)
    for comment in comments:
        comment["replies"] = replies_by_parent.get(str(comment["source_id"]), [])
    return comments


def count_events_by_status() -> dict[str, int]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS count FROM events GROUP BY status"
        ).fetchall()
    return {row["status"]: int(row["count"]) for row in rows}


def get_event(event_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    return dict(row) if row else None


def list_conversations() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE kind='dm' AND thread_id IS NOT NULL "
            "ORDER BY received_at DESC"
        ).fetchall()
    conversations: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = dict(row)
        thread_id = str(item["thread_id"])
        conversation = conversations.setdefault(thread_id, {
            "thread_id": thread_id,
            "username": "",
            "latest_body": item["body"],
            "latest_at": item["received_at"],
            "message_count": 0,
            "needs_attention": 0,
        })
        conversation["message_count"] += 1
        if item["direction"] == "inbound" and item["author_username"]:
            conversation["username"] = conversation["username"] or item["author_username"]
        if item["status"] in {"pending", "drafted", "manual"}:
            conversation["needs_attention"] += 1
    return list(conversations.values())


def list_conversation_messages(thread_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE kind='dm' AND thread_id=? "
            "ORDER BY received_at ASC",
            (thread_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def update_event(event_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {
        "status", "intent", "confidence", "proposed_action", "draft",
        "artwork_slug", "error", "has_liked", "like_count",
    }
    selected = {key: value for key, value in values.items() if key in allowed}
    if not selected:
        return get_event(event_id)
    selected["updated_at"] = now()
    assignments = ", ".join(f"{key}=?" for key in selected)
    with connect() as conn:
        conn.execute(
            f"UPDATE events SET {assignments} WHERE id=?",
            [*selected.values(), event_id],
        )
    return get_event(event_id)


def add_delivery(
    event_id: str,
    action: str,
    body: str,
    status: str,
    remote_id: str | None = None,
    error: str | None = None,
) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO deliveries(event_id, action, body, remote_id, status, error, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (event_id, action, body, remote_id, status, error, now()),
        )


def sent_today_count() -> int:
    day = datetime.now(UTC).date().isoformat()
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM deliveries WHERE status='sent' AND created_at >= ?",
            (day,),
        ).fetchone()
    return int(row["count"])
