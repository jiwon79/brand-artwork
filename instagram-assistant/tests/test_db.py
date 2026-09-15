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


def test_delete_event_removes_only_the_selected_event(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    for source_id in ("1", "2"):
        db.upsert_event({
            "id": f"dm:{source_id}", "kind": "dm", "source_id": source_id,
            "thread_id": "thread-1", "body": "", "received_at": db.now(),
        })
    assert db.delete_event("dm:1") is True
    assert db.get_event("dm:1") is None
    assert db.get_event("dm:2") is not None
    assert db.delete_event("dm:missing") is False


def test_default_artworks_use_canonical_demo_and_purchase_urls(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    artworks = db.list_artworks()
    assert len(artworks) == 6
    assert {item["slug"] for item in artworks} == {
        "guseul", "color-text", "body-echo", "line-pull", "cursor-cat", "smile-flower",
    }
    assert all(
        item["demo_url"] == f"https://studio.jiiwon.com/{item['slug']}"
        for item in artworks
    )
    assert all(item["purchase_url"] == "https://litt.ly/jiiwon" for item in artworks)


def test_saved_artwork_derives_urls_from_slug(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    saved = db.save_artwork({"slug": "new-work", "title": "새 작품"})
    assert saved["demo_url"] == "https://studio.jiiwon.com/new-work"
    assert saved["purchase_url"] == "https://litt.ly/jiiwon"


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
    assert conversations[0]["has_actionable"] is False
    assert db.list_conversations(status="active") == []
    assert db.list_conversations(status="completed")[0]["thread_id"] == "thread-1"
    messages = db.list_conversation_messages("thread-1")
    assert [item["direction"] for item in messages] == ["inbound", "outbound"]


def test_existing_dm_is_enriched_with_heart_state(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    item = {
        "id": "dm:1", "kind": "dm", "source_id": "1", "thread_id": "thread-1",
        "author_username": "someone", "body": "좋아요", "received_at": db.now(),
    }
    db.upsert_event(item)
    db.upsert_event({**item, "has_liked": True, "like_count": 1})
    saved = db.get_event("dm:1")
    assert saved["has_liked"] == 1
    assert saved["like_count"] == 1


def test_viewer_heart_completes_dm_until_a_new_message_arrives(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.upsert_event({
        "id": "dm:1", "kind": "dm", "source_id": "1", "thread_id": "thread-1",
        "author_username": "someone", "direction": "inbound", "body": "감사합니다",
        "has_liked": True, "like_count": 1,
        "received_at": "2026-09-15T01:00:00+00:00",
    })
    assert db.list_conversations(status="active") == []
    assert db.list_conversations(status="completed")[0]["thread_id"] == "thread-1"

    db.upsert_event({
        "id": "dm:2", "kind": "dm", "source_id": "2", "thread_id": "thread-1",
        "author_username": "someone", "direction": "inbound", "body": "하나만 더 물어볼게요",
        "received_at": "2026-09-15T01:01:00+00:00",
    })
    assert db.list_conversations(status="active")[0]["thread_id"] == "thread-1"


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


def test_existing_comment_is_enriched_with_post_reference(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    item = {
        "id": "comment:1", "kind": "comment", "source_id": "1",
        "author_username": "someone", "body": "저요", "received_at": db.now(),
    }
    db.upsert_event(item)
    db.upsert_event({
        **item,
        "post_url": "https://www.instagram.com/reel/ABC/",
        "post_caption": "고양이 타이포그래피",
    })
    saved = db.get_event("comment:1")
    assert saved["post_url"].endswith("/reel/ABC/")
    assert saved["post_caption"] == "고양이 타이포그래피"


def test_comment_threads_include_replies_and_identify_own_reply(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    parent = {
        "id": "comment:1", "kind": "comment", "source_id": "1",
        "author_username": "someone", "body": "저요", "received_at": db.now(),
    }
    reply = {
        "id": "comment:2", "kind": "comment", "source_id": "2",
        "parent_comment_id": "1", "author_username": "jiiwon.studio",
        "direction": "outbound", "has_liked": True, "like_count": 1,
        "body": "디엠 드렸어요", "status": "history", "received_at": db.now(),
    }
    db.upsert_event(parent)
    db.upsert_event(reply)
    threads = db.list_comment_threads()
    assert len(threads) == 1
    assert threads[0]["replies"][0]["direction"] == "outbound"
    assert threads[0]["replies"][0]["has_liked"] == 1
    assert len(db.list_events(kind="comment")) == 1


def test_answered_comment_can_be_marked_complete(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.upsert_event({
        "id": "comment:1", "kind": "comment", "source_id": "1",
        "author_username": "someone", "body": "저요", "status": "drafted",
        "received_at": db.now(),
    })
    completed = db.update_event("comment:1", {"status": "sent"})
    assert completed["status"] == "sent"
    assert db.list_comment_threads(status="sent")[0]["source_id"] == "1"


def test_active_comment_filter_groups_actionable_statuses(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    for index, status in enumerate(("pending", "drafted", "manual", "sent"), start=1):
        db.upsert_event({
            "id": f"comment:{index}", "kind": "comment", "source_id": str(index),
            "author_username": "someone", "body": status, "status": status,
            "received_at": db.now(),
        })
    assert {item["status"] for item in db.list_comment_threads(status="active")} == {
        "pending", "drafted", "manual",
    }
