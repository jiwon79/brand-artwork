from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, Iterator

from .config import paths, prepare_data_dir
from .database_backend import open_connection, remote_url


STUDIO_URL = "https://studio.jiiwon.com"
PURCHASE_URL = "https://litt.ly/jiiwon"


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

CREATE TABLE IF NOT EXISTS post_labels (
  post_code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  account_id TEXT,
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
  own_reaction TEXT,
  peer_reaction TEXT,
  like_count INTEGER,
  body TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TEXT,
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

CREATE TABLE IF NOT EXISTS dm_send_items (
  event_id TEXT NOT NULL REFERENCES events(id),
  item_index INTEGER NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  remote_id TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(event_id, item_index)
);

CREATE TABLE IF NOT EXISTS dm_sync_state (
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  updated_time TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY(account_id, thread_id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_ready_idx
ON webhook_events(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS pending_dm_reactions (
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  emoji TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, message_id, actor_id)
);

CREATE TABLE IF NOT EXISTS private_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


DEFAULT_SETTINGS = {
    "instagram_username": "",
    "instagram_account_id": "",
    "instagram_messaging_account_id": "",
    "profile_url": "https://litt.ly/jiiwon",
    "auto_send": False,
    "auto_comment": False,
    "auto_dm": False,
    "last_sync_at": None,
    "last_full_sync_at": None,
    "full_sync_progress": None,
    "full_sync_retry_after": None,
    "dm_backfill_complete": False,
    "dm_requests_backfill_complete": False,
    "halted_reason": None,
}

DEFAULT_ARTWORKS = (
    {
        "slug": "guseul", "title": "구슬", "post_code": "DbMzWyMT_10",
        "product_name": "예쁜 거 첫 번째 · 구슬",
    },
    {
        "slug": "color-text", "title": "녹는 글자", "post_code": "Db1_p35TbhR",
        "product_name": "예쁜 거 두 번째 · 녹는 글자",
    },
    {
        "slug": "body-echo", "title": "잔상", "post_code": "DcTkgu6z53y",
        "product_name": "예쁜 거 세 번째 · 잔상",
    },
    {
        "slug": "line-pull", "title": "틈", "post_code": "Dc8RsObTqfn",
        "product_name": "예쁜 거 네 번째 · 틈",
    },
    {
        "slug": "cursor-cat", "title": "고양이", "post_code": "DcsE80uTrM5",
        "product_name": "귀여운 거 첫 번째 · 고양이",
    },
    {
        "slug": "smile-flower", "title": "웃음꽃", "post_code": "DdL5H0szhCc",
        "product_name": "예쁜 거 다섯 번째 · 웃음꽃",
    },
)

DEFAULT_ARTWORK_VALUES = tuple(
    {
        **item,
        "demo_url": f"{STUDIO_URL}/{item['slug']}",
        "purchase_url": PURCHASE_URL,
        "product_status": "available",
    }
    for item in DEFAULT_ARTWORKS
)


def now() -> str:
    return datetime.now(UTC).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    if not remote_url():
        prepare_data_dir()
    conn = open_connection(paths.database)
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
        if "account_id" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN account_id TEXT")
        if "has_liked" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN has_liked INTEGER")
        if "own_reaction" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN own_reaction TEXT")
        if "peer_reaction" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN peer_reaction TEXT")
        if "like_count" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN like_count INTEGER")
        if "parent_comment_id" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN parent_comment_id TEXT")
        if "post_url" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN post_url TEXT")
        if "post_caption" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN post_caption TEXT")
        if "reviewed_at" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN reviewed_at TEXT")
        conn.execute("DELETE FROM settings WHERE key='read_only_observation'")
        conn.execute("DELETE FROM settings WHERE key='daily_send_limit'")
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )
        timestamp = now()
        for item in DEFAULT_ARTWORK_VALUES:
            conn.execute(
                """
                INSERT INTO artworks(
                  slug, title, post_code, demo_url, product_name,
                  purchase_url, product_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                  title=excluded.title,
                  post_code=excluded.post_code,
                  demo_url=excluded.demo_url,
                  product_name=excluded.product_name,
                  purchase_url=excluded.purchase_url,
                  product_status=excluded.product_status,
                  updated_at=excluded.updated_at
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


def get_private_state(key: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT value FROM private_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_private_state(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute("INSERT INTO private_state(key,value,updated_at) VALUES(?,?,?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                     (key, value, now()))


def delete_private_state(key: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM private_state WHERE key=?", (key,))


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


def get_dm_sync_state(account_id: str, thread_id: str) -> dict[str, str] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT updated_time, checked_at FROM dm_sync_state WHERE account_id=? AND thread_id=?",
            (account_id, thread_id),
        ).fetchone()
    return dict(row) if row else None


def save_dm_sync_state(account_id: str, thread_id: str, updated_time: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO dm_sync_state(account_id, thread_id, updated_time, checked_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(account_id, thread_id) DO UPDATE SET "
            "updated_time=excluded.updated_time, checked_at=excluded.checked_at",
            (account_id, thread_id, updated_time, now()),
        )


def enqueue_webhook(event_id: str, payload: dict[str, Any]) -> bool:
    timestamp = now()
    with connect() as conn:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO webhook_events(id,payload,next_attempt_at,created_at) "
            "VALUES (?,?,?,?)",
            (event_id, json.dumps(payload, ensure_ascii=False), timestamp, timestamp),
        )
    return cursor.rowcount > 0


def next_webhook() -> dict[str, Any] | None:
    from datetime import timedelta
    lease_until = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
    with connect() as conn:
        row = conn.execute(
            "UPDATE webhook_events SET status='processing',next_attempt_at=? WHERE id=("
            "SELECT id FROM webhook_events WHERE status IN ('pending','processing') "
            "AND next_attempt_at<=? ORDER BY created_at LIMIT 1) RETURNING *",
            (lease_until, now()),
        ).fetchone()
    return dict(row) if row else None


def finish_webhook(event_id: str, error: str | None = None) -> None:
    from datetime import timedelta
    with connect() as conn:
        if error is None:
            conn.execute("UPDATE webhook_events SET status='done',processed_at=?,error=NULL "
                         "WHERE id=?", (now(), event_id))
        else:
            row = conn.execute("SELECT attempts FROM webhook_events WHERE id=?", (event_id,)).fetchone()
            attempts = int(row["attempts"]) + 1 if row else 1
            delay = min(3600, 2 ** min(attempts, 10))
            retry_at = (datetime.now(UTC) + timedelta(seconds=delay)).isoformat()
            conn.execute("UPDATE webhook_events SET status='pending',attempts=?,next_attempt_at=?,error=? "
                         "WHERE id=?", (attempts, retry_at, error[:500], event_id))


def set_dm_shared_url(message_id: str, url: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE events SET shared_url=COALESCE(shared_url, ?),updated_at=? "
                     "WHERE id=? AND kind='dm'", (url, now(), f"dm:{message_id}"))


def list_artworks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM artworks ORDER BY title").fetchall()
    return [dict(row) for row in rows]


def list_post_labels() -> dict[str, str]:
    with connect() as conn:
        artworks = conn.execute("SELECT post_code, title FROM artworks WHERE post_code IS NOT NULL").fetchall()
        custom = conn.execute("SELECT post_code, label FROM post_labels").fetchall()
    return {**{row["post_code"]: row["title"] for row in artworks},
            **{row["post_code"]: row["label"] for row in custom}}


def save_post_label(post_code: str, label: str) -> dict[str, str]:
    with connect() as conn:
        conn.execute(
            "INSERT INTO post_labels(post_code, label, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(post_code) DO UPDATE SET label=excluded.label, updated_at=excluded.updated_at",
            (post_code, label, now()),
        )
    return {"post_code": post_code, "label": label}


def save_artwork(item: dict[str, Any]) -> dict[str, Any]:
    timestamp = now()
    slug = item["slug"]
    post_code = item.get("post_code") or None
    media_id = item.get("media_id") or None
    demo_url = f"{STUDIO_URL}/{slug}"
    product_name = item.get("product_name") or item["title"]
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
                slug, item["title"], post_code,
                media_id, demo_url,
                product_name, PURCHASE_URL,
                item.get("product_status", "available"), timestamp, timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM artworks WHERE slug=?", (slug,)).fetchone()
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
              id, account_id, kind, source_id, parent_comment_id, thread_id, media_id, post_code,
              post_url, post_caption, shared_url,
              author_id, author_username, direction, has_liked, own_reaction, peer_reaction, like_count, body,
              received_at, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"], event.get("account_id"), event["kind"], event["source_id"], event.get("parent_comment_id"),
                event.get("thread_id"), event.get("media_id"), event.get("post_code"),
                event.get("post_url"), event.get("post_caption"), event.get("shared_url"),
                event.get("author_id"),
                event.get("author_username", ""), event.get("direction", "inbound"),
                event.get("has_liked"), event.get("own_reaction"), event.get("peer_reaction"),
                event.get("like_count"), event.get("body", ""),
                event.get("received_at", timestamp),
                event.get("status", "pending"), timestamp, timestamp,
            ),
        )
        if exists:
            conn.execute(
                """
                UPDATE events SET
                  account_id=COALESCE(account_id, ?),
                  parent_comment_id=COALESCE(?, parent_comment_id),
                  thread_id=COALESCE(?, thread_id),
                  post_url=COALESCE(?, post_url),
                  post_caption=COALESCE(?, post_caption),
                  shared_url=COALESCE(?, shared_url),
                  body=CASE WHEN body='메시지 내용 없음' AND ? IS NOT NULL THEN '' ELSE body END,
                  author_id=COALESCE(?, author_id),
                  direction=COALESCE(?, direction),
                  has_liked=COALESCE(?, has_liked),
                  own_reaction=COALESCE(?, own_reaction),
                  peer_reaction=COALESCE(?, peer_reaction),
                  like_count=COALESCE(?, like_count),
                  author_username=CASE WHEN ? <> '' THEN ? ELSE author_username END,
                  body=CASE WHEN ? <> '' THEN ? ELSE body END,
                  updated_at=?
                WHERE id=?
                """,
                (
                    event.get("account_id"), event.get("parent_comment_id"), event.get("thread_id"),
                    event.get("post_url"), event.get("post_caption"), event.get("shared_url"),
                    event.get("shared_url"),
                    event.get("author_id"),
                    event.get("direction"), event.get("has_liked"),
                    event.get("own_reaction"), event.get("peer_reaction"),
                    event.get("like_count"), event.get("author_username", ""),
                    event.get("author_username", ""), event.get("body", ""),
                    event.get("body", ""), timestamp, event["id"],
                ),
            )
        return cursor.rowcount > 0


def set_dm_reactions(event_id: str, own_reaction: str | None,
                     peer_reaction: str | None) -> bool:
    """Replace the complete reaction snapshot returned by Graph for one DM."""
    with connect() as conn:
        cursor = conn.execute(
            "UPDATE events SET own_reaction=?, peer_reaction=?, has_liked=?, updated_at=? "
            "WHERE id=? AND kind='dm'",
            (own_reaction, peer_reaction, int(own_reaction in {"❤", "❤️", "♥"}), now(), event_id),
        )
    return cursor.rowcount > 0


def apply_dm_reaction(account_id: str, message_id: str, actor_id: str,
                      own_ids: set[str], action: str, emoji: str | None) -> bool:
    """Apply a signed Meta reaction webhook, including unreact, to a known DM."""
    if action not in {"react", "unreact"} or not actor_id or not message_id:
        return False
    with connect() as conn:
        row = conn.execute(
            "SELECT id,author_id,direction FROM events WHERE kind='dm' AND account_id=? "
            "AND source_id=?", (account_id, message_id),
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO pending_dm_reactions(account_id,message_id,actor_id,action,emoji,updated_at) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,message_id,actor_id) DO UPDATE SET "
                "action=excluded.action,emoji=excluded.emoji,updated_at=excluded.updated_at",
                (account_id, message_id, actor_id, action, emoji, now()),
            )
            return False
        is_own = actor_id in own_ids
        if not is_own and row["direction"] == "inbound" and actor_id != row["author_id"]:
            return False
        field = "own_reaction" if is_own else "peer_reaction"
        value = emoji if action == "react" else None
        if is_own:
            conn.execute(
                f"UPDATE events SET {field}=?, has_liked=?, updated_at=? WHERE id=?",
                (value, int(value in {"❤", "❤️", "♥"}), now(), row["id"]),
            )
        else:
            conn.execute(f"UPDATE events SET {field}=?, updated_at=? WHERE id=?",
                         (value, now(), row["id"]))
        conn.execute("DELETE FROM pending_dm_reactions WHERE account_id=? AND message_id=? AND actor_id=?",
                     (account_id, message_id, actor_id))
    return True


def reconcile_pending_dm_reactions(account_id: str, message_id: str,
                                   own_ids: set[str]) -> int:
    """Apply reaction webhooks received before their message became available."""
    with connect() as conn:
        pending = conn.execute(
            "SELECT actor_id,action,emoji FROM pending_dm_reactions WHERE account_id=? AND message_id=? "
            "ORDER BY updated_at,actor_id", (account_id, message_id),
        ).fetchall()
    return sum(apply_dm_reaction(account_id, message_id, row["actor_id"], own_ids,
                                 row["action"], row["emoji"]) for row in pending)


def reconcile_own_dm_messages(account_id: str, messaging_id: str, username: str) -> int:
    """Correct stored messages after confirming this account's ID in DM participants."""
    with connect() as conn:
        cursor = conn.execute(
            """UPDATE events SET direction='outbound', status='history',
               author_username=?, proposed_action=NULL, draft=NULL, intent=NULL,
               confidence=NULL, artwork_slug=NULL, error=NULL, updated_at=?
               WHERE kind='dm' AND account_id=? AND author_id=?
               AND (direction!='outbound' OR status!='history')""",
            (username, now(), account_id, messaging_id),
        )
    return cursor.rowcount


def list_events(
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = "SELECT * FROM events"
    params: list[Any] = []
    conditions: list[str] = []
    account_id = get_settings().get("instagram_account_id")
    if account_id:
        conditions.append("account_id=?")
        params.append(account_id)
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
    account_id = get_settings().get("instagram_account_id")
    with connect() as conn:
        comments = [dict(row) for row in conn.execute(
            "SELECT * FROM events WHERE kind='comment' AND parent_comment_id IS NULL "
            "AND (? = '' OR account_id=?)",
            (account_id, account_id),
        )]
        rows = conn.execute(
            "SELECT * FROM events WHERE kind='comment' AND parent_comment_id IS NOT NULL "
            "AND (? = '' OR account_id=?) ORDER BY received_at ASC",
            (account_id, account_id),
        ).fetchall()
    replies_by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        reply = dict(row)
        replies_by_parent.setdefault(str(reply["parent_comment_id"]), []).append(reply)
    for comment in comments:
        replies = replies_by_parent.get(str(comment["source_id"]), [])
        comment["replies"] = replies
        messages = [comment, *replies]
        latest_inbound_at = max(
            (item["received_at"] for item in messages if item["direction"] == "inbound"),
            default="",
        )
        resolution_times = [item["reviewed_at"] for item in messages if item.get("reviewed_at")]
        resolution_times.extend(
            item["received_at"] for item in messages
            if item["direction"] == "outbound"
            or item["has_liked"]
            or item["status"] in {"sent", "completed", "ignored"}
        )
        comment["needs_review"] = latest_inbound_at > max(resolution_times, default="")
        comment["latest_activity_at"] = max(
            [comment["received_at"], *(reply["received_at"] for reply in replies)]
        )
        if comment.get("post_url") and comment.get("source_id"):
            comment["comment_url"] = (
                str(comment["post_url"]).rstrip("/") + "/c/" + str(comment["source_id"]) + "/"
            )
    if status == "active":
        comments = [comment for comment in comments if comment["needs_review"]]
    elif status == "completed":
        comments = [comment for comment in comments if not comment["needs_review"]]
    elif status == "sent":
        comments = [comment for comment in comments if comment["status"] == "sent" and not comment["needs_review"]]
    elif status:
        comments = [comment for comment in comments if comment["status"] == status]
    comments.sort(key=lambda comment: (comment["latest_activity_at"], comment["source_id"]), reverse=True)
    return comments[:min(max(limit, 1), 500)]


def mark_comment_reviewed(event_id: str) -> None:
    with connect() as conn:
        event = conn.execute(
            "SELECT account_id, source_id, parent_comment_id FROM events WHERE id=? AND kind='comment'",
            (event_id,),
        ).fetchone()
        if event:
            parent_id = event["parent_comment_id"] or event["source_id"]
            timestamp = now()
            conn.execute(
                "UPDATE events SET reviewed_at=?, updated_at=? WHERE id=?",
                (timestamp, timestamp, event_id),
            )
            conn.execute(
                "UPDATE events SET reviewed_at=?, updated_at=? "
                "WHERE kind='comment' AND parent_comment_id IS NULL "
                "AND source_id=? AND account_id IS ?",
                (timestamp, timestamp, parent_id, event["account_id"]),
            )


def count_events_by_status() -> dict[str, int]:
    account_id = get_settings().get("instagram_account_id")
    with connect() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS count FROM events "
            "WHERE (? = '' OR account_id=?) GROUP BY status",
            (account_id, account_id),
        ).fetchall()
    return {row["status"]: int(row["count"]) for row in rows}


def get_event(event_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    return dict(row) if row else None


def delete_event(event_id: str) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM events WHERE id=?", (event_id,))
    return cursor.rowcount > 0


def list_conversations(status: str | None = None) -> list[dict[str, Any]]:
    account_id = get_settings().get("instagram_account_id")
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE kind='dm' AND thread_id IS NOT NULL "
            "AND (? = '' OR account_id=?) ORDER BY received_at DESC",
            (account_id, account_id),
        ).fetchall()
    conversations: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = dict(row)
        thread_id = str(item["thread_id"])
        conversation = conversations.setdefault(thread_id, {
            "thread_id": thread_id,
            "username": "",
            "latest_body": item["body"] or item["shared_url"] or "메시지 내용 없음",
            "latest_at": item["received_at"],
            "latest_inbound_hearted": None,
            "_seen_inbound": False,
            "message_count": 0,
            "has_actionable": False,
            "_has_newer_resolution": False,
        })
        conversation["message_count"] += 1
        if item["direction"] == "inbound" and not conversation["_seen_inbound"]:
            conversation["latest_inbound_hearted"] = (
                None if item["has_liked"] is None else bool(item["has_liked"])
            )
            conversation["_seen_inbound"] = True
        if item["direction"] == "outbound" or item["has_liked"] or item["status"] in {"sent", "completed", "ignored"}:
            conversation["_has_newer_resolution"] = True
        elif item["direction"] == "inbound" and item["status"] in {"pending", "drafted", "manual"}:
            if not conversation["_has_newer_resolution"]:
                conversation["has_actionable"] = True
        if item["direction"] == "inbound" and item["author_username"]:
            conversation["username"] = conversation["username"] or item["author_username"]
    items = list(conversations.values())
    for item in items:
        item.pop("_has_newer_resolution")
        item.pop("_seen_inbound")
    if status == "active":
        return [item for item in items if item["has_actionable"]]
    if status == "completed":
        return [item for item in items if not item["has_actionable"]]
    return items


def list_conversation_messages(thread_id: str) -> list[dict[str, Any]]:
    account_id = get_settings().get("instagram_account_id")
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE kind='dm' AND thread_id=? "
            "AND (? = '' OR account_id=?) "
            "ORDER BY received_at ASC",
            (thread_id, account_id, account_id),
        ).fetchall()
    return [dict(row) for row in rows]


def update_event(event_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {
        "status", "intent", "confidence", "proposed_action", "draft",
        "artwork_slug", "error", "has_liked", "own_reaction", "peer_reaction", "like_count",
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


def dm_send_items(event_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM dm_send_items WHERE event_id=? ORDER BY item_index",
            (event_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_dm_send_items(event_id: str, messages: list[str]) -> list[dict[str, Any]]:
    # The first approved sequence is immutable. A retry may only resume those exact texts.
    with connect() as conn:
        stamp = now()
        for index, body in enumerate(messages):
            conn.execute(
                "INSERT OR IGNORE INTO dm_send_items(event_id,item_index,body,status,updated_at) "
                "VALUES(?,?,?,'pending',?)",
                (event_id, index, body, stamp),
            )
    items = dm_send_items(event_id)
    if [item["body"] for item in items] != messages:
        raise ValueError("Saved DM sequence differs from requested messages")
    return items


def claim_dm_send_item(event_id: str, index: int) -> bool:
    with connect() as conn:
        cursor = conn.execute(
            "UPDATE dm_send_items SET status='sending',updated_at=? "
            "WHERE event_id=? AND item_index=? AND status='pending'",
            (now(), event_id, index),
        )
        return cursor.rowcount == 1


def finish_dm_send_item(event_id: str, index: int, status: str,
                        remote_id: str | None = None, error: str | None = None) -> None:
    with connect() as conn:
        cursor = conn.execute(
            "UPDATE dm_send_items SET status=?,remote_id=?,error=?,updated_at=? "
            "WHERE event_id=? AND item_index=? AND status='sending'",
            (status, remote_id, error, now(), event_id, index),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("DM send state changed while recording the result")


def sent_today_count() -> int:
    day = datetime.now(UTC).date().isoformat()
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM deliveries WHERE status='sent' AND created_at >= ?",
            (day,),
        ).fetchone()
    return int(row["count"])
