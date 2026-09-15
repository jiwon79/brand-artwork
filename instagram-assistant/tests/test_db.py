from pathlib import Path

from app import config, db


def test_event_insert_is_idempotent(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    item = {
        "id": "comment:1",
        "kind": "comment",
        "source_id": "1",
        "author_username": "someone",
        "body": "저요",
        "received_at": db.now(),
    }
    assert db.upsert_event(item) is True
    assert db.upsert_event(item) is False
    assert len(db.list_events()) == 1


def test_conversations_group_messages_and_preserve_order(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    for item in (
        {
            "id": "dm:1", "kind": "dm", "source_id": "1", "thread_id": "thread-1",
            "author_username": "someone", "direction": "inbound", "body": "링크 주세요",
            "received_at": "2026-09-15T01:00:00+00:00",
        },
        {
            "id": "dm:2", "kind": "dm", "source_id": "2", "thread_id": "thread-1",
            "author_username": "jiiwon.studio", "direction": "outbound", "body": "여기 있어요",
            "status": "history", "received_at": "2026-09-15T01:01:00+00:00",
        },
    ):
        db.upsert_event(item)
    conversations = db.list_conversations()
    assert conversations[0]["username"] == "someone"
    assert conversations[0]["message_count"] == 2
    assert conversations[0]["latest_body"] == "여기 있어요"
    messages = db.list_conversation_messages("thread-1")
    assert [item["direction"] for item in messages] == ["inbound", "outbound"]


def test_existing_event_is_enriched_with_shared_url(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    item = {
        "id": "dm:1", "kind": "dm", "source_id": "1", "thread_id": "thread-1",
        "author_username": "someone", "body": "공유된 콘텐츠",
        "received_at": db.now(),
    }
    assert db.upsert_event(item) is True
    assert db.upsert_event({**item, "shared_url": "https://www.instagram.com/reel/ABC/"}) is False
    assert db.get_event("dm:1")["shared_url"] == "https://www.instagram.com/reel/ABC/"


def test_existing_comment_is_enriched_with_like_state(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    item = {
        "id": "comment:1", "kind": "comment", "source_id": "1",
        "author_username": "someone", "body": "멋져요", "received_at": db.now(),
    }
    db.upsert_event(item)
    db.upsert_event({**item, "has_liked": True, "like_count": 3})
    saved = db.get_event("comment:1")
    assert saved["has_liked"] == 1
    assert saved["like_count"] == 3
