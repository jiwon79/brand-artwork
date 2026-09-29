from pathlib import Path

from app import config, db


def test_initialize_removes_legacy_daily_send_limit(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    with db.connect() as conn:
        conn.execute("INSERT INTO settings(key, value) VALUES ('daily_send_limit', '20')")
    db.initialize()
    assert "daily_send_limit" not in db.get_settings()


def test_dm_reactions_track_both_people_and_unreact(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.update_settings({"instagram_account_id": "account-1"})
    for source_id, direction, author in (("in", "inbound", "visitor-1"),
                                         ("out", "outbound", "own-1")):
        db.upsert_event({"id": f"dm:{source_id}", "kind": "dm", "account_id": "account-1",
                         "source_id": source_id, "thread_id": "thread-1", "author_id": author,
                         "direction": direction, "body": "test", "received_at": db.now()})
    assert db.apply_dm_reaction("account-1", "out", "visitor-1", {"own-1"}, "react", "❤")
    assert db.get_event("dm:out")["peer_reaction"] == "❤"
    assert db.get_event("dm:out")["has_liked"] is None
    assert db.apply_dm_reaction("account-1", "in", "own-1", {"own-1"}, "react", "❤")
    assert db.get_event("dm:in")["has_liked"] == 1
    assert db.list_conversations(status="active") == []
    assert db.apply_dm_reaction("account-1", "in", "own-1", {"own-1"}, "unreact", None)
    assert db.get_event("dm:in")["own_reaction"] is None
    assert db.get_event("dm:in")["has_liked"] == 0
    assert db.apply_dm_reaction("account-1", "out", "visitor-1", {"own-1"}, "unreact", None)
    assert db.get_event("dm:out")["peer_reaction"] is None


def test_graph_reaction_snapshot_clears_removed_heart(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.upsert_event({"id": "dm:1", "kind": "dm", "source_id": "1", "body": "test"})
    db.set_dm_reactions("dm:1", "❤", "👍")
    assert db.get_event("dm:1")["has_liked"] == 1
    db.set_dm_reactions("dm:1", None, None)
    assert db.get_event("dm:1")["has_liked"] == 0
    assert db.get_event("dm:1")["peer_reaction"] is None


def test_reaction_for_unknown_message_is_saved_until_message_sync(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    assert not db.apply_dm_reaction("account-1", "later", "visitor-1", {"own-1"},
                                    "react", "❤")
    db.upsert_event({"id": "dm:later", "account_id": "account-1", "kind": "dm",
                     "source_id": "later", "author_id": "own-1", "direction": "outbound"})
    assert db.reconcile_pending_dm_reactions("account-1", "later", {"own-1"}) == 1
    assert db.get_event("dm:later")["peer_reaction"] == "❤"
    assert db.reconcile_pending_dm_reactions("account-1", "later", {"own-1"}) == 0


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
    assert "classification" not in conversations[0]
    assert conversations[0]["has_actionable"] is False
    messages = db.list_conversation_messages("thread-1")
    assert [item["direction"] for item in messages] == ["inbound", "outbound"]


def test_dm_review_filter_uses_latest_unresolved_inbound_message(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    for item in (
        {"id": "dm:1", "kind": "dm", "source_id": "1", "thread_id": "thread-1",
         "direction": "inbound", "body": "첫 질문", "received_at": "2026-09-15T01:00:00+00:00"},
        {"id": "dm:2", "kind": "dm", "source_id": "2", "thread_id": "thread-1",
         "direction": "outbound", "status": "history", "body": "답변",
         "received_at": "2026-09-15T01:01:00+00:00"},
        {"id": "dm:3", "kind": "dm", "source_id": "3", "thread_id": "thread-1",
         "direction": "inbound", "body": "추가 질문", "received_at": "2026-09-15T01:02:00+00:00"},
        {"id": "dm:4", "kind": "dm", "source_id": "4", "thread_id": "thread-2",
         "direction": "inbound", "has_liked": True, "body": "좋아요",
         "received_at": "2026-09-15T01:03:00+00:00"},
    ):
        db.upsert_event(item)
    assert [item["thread_id"] for item in db.list_conversations(status="active")] == ["thread-1"]
    assert [item["thread_id"] for item in db.list_conversations(status="completed")] == ["thread-2"]
    assert len(db.list_conversations()) == 2


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
        "post_url": "https://www.instagram.com/reel/ABC/",
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
    assert threads[0]["comment_url"] == "https://www.instagram.com/reel/ABC/c/1/"
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


def test_new_comment_reply_reopens_review_until_handled(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    events = (
        {"id": "comment:root", "kind": "comment", "source_id": "root", "status": "sent",
         "body": "첫 질문", "received_at": "2026-09-15T01:00:00+00:00"},
        {"id": "comment:reply-1", "kind": "comment", "source_id": "reply-1",
         "parent_comment_id": "root", "direction": "outbound", "status": "history",
         "body": "첫 답변", "received_at": "2026-09-15T01:01:00+00:00"},
        {"id": "comment:reply-2", "kind": "comment", "source_id": "reply-2",
         "parent_comment_id": "root", "direction": "inbound", "status": "history",
         "body": "추가 질문", "received_at": "2026-09-15T01:02:00+00:00"},
    )
    for event in events[:2]:
        db.upsert_event(event)
    assert [item["source_id"] for item in db.list_comment_threads(status="completed")] == ["root"]
    db.upsert_event(events[2])
    active = db.list_comment_threads(status="active")
    assert [item["source_id"] for item in active] == ["root"]
    assert active[0]["status"] == "sent"
    assert active[0]["latest_activity_at"] == "2026-09-15T01:02:00+00:00"
    db.upsert_event(events[2])
    assert len(db.list_comment_threads(status="active")) == 1
    db.mark_comment_reviewed("comment:reply-2")
    assert db.list_comment_threads(status="active") == []
    db.upsert_event({**events[2], "id": "comment:reply-3", "source_id": "reply-3",
                     "received_at": "2099-09-15T01:03:00+00:00"})
    assert [item["source_id"] for item in db.list_comment_threads(status="active")] == ["root"]
    db.upsert_event({**events[1], "id": "comment:reply-4", "source_id": "reply-4",
                     "received_at": "2099-09-15T01:04:00+00:00"})
    assert [item["source_id"] for item in db.list_comment_threads(status="completed")] == ["root"]


def test_recent_reply_to_older_comment_is_first_in_review(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    for event in (
        {"id": "comment:old", "kind": "comment", "source_id": "old", "status": "sent",
         "received_at": "2026-09-15T01:00:00+00:00"},
        {"id": "comment:new", "kind": "comment", "source_id": "new",
         "received_at": "2026-09-15T01:05:00+00:00"},
        {"id": "comment:old-out", "kind": "comment", "source_id": "old-out",
         "parent_comment_id": "old", "direction": "outbound", "status": "history",
         "received_at": "2026-09-15T01:01:00+00:00"},
        {"id": "comment:old-in", "kind": "comment", "source_id": "old-in",
         "parent_comment_id": "old", "direction": "inbound", "status": "history",
         "received_at": "2026-09-15T01:06:00+00:00"},
    ):
        db.upsert_event(event)
    assert [item["source_id"] for item in db.list_comment_threads(status="active", limit=1)] == ["old"]


def test_comment_heart_completes_review_and_later_reply_reopens_it(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.upsert_event({
        "id": "comment:root", "kind": "comment", "source_id": "root",
        "has_liked": True, "received_at": "2026-09-15T01:00:00+00:00",
    })
    assert db.list_comment_threads(status="active") == []
    assert [item["source_id"] for item in db.list_comment_threads(status="completed")] == ["root"]
    db.upsert_event({
        "id": "comment:child-1", "kind": "comment", "source_id": "child-1",
        "parent_comment_id": "root", "direction": "inbound", "status": "history",
        "received_at": "2026-09-15T01:01:00+00:00",
    })
    assert [item["source_id"] for item in db.list_comment_threads(status="active")] == ["root"]
    db.upsert_event({
        "id": "comment:child-1", "kind": "comment", "source_id": "child-1",
        "parent_comment_id": "root", "direction": "inbound", "status": "history",
        "has_liked": True, "received_at": "2026-09-15T01:01:00+00:00",
    })
    assert db.list_comment_threads(status="active") == []
    db.upsert_event({
        "id": "comment:child-2", "kind": "comment", "source_id": "child-2",
        "parent_comment_id": "root", "direction": "inbound", "status": "history",
        "received_at": "2026-09-15T01:02:00+00:00",
    })
    assert [item["source_id"] for item in db.list_comment_threads(status="active")] == ["root"]


def test_latest_comment_action_moves_thread_between_review_lists(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    root = {"id": "comment:root", "kind": "comment", "source_id": "root",
            "received_at": "2026-09-15T01:00:00+00:00"}
    db.upsert_event(root)
    assert [item["source_id"] for item in db.list_comment_threads(status="active")] == ["root"]

    db.mark_comment_reviewed("comment:root")
    assert [item["source_id"] for item in db.list_comment_threads(status="completed")] == ["root"]

    reply = {"id": "comment:reply", "kind": "comment", "source_id": "reply",
             "parent_comment_id": "root", "direction": "inbound", "status": "history",
             "received_at": "2099-09-15T01:01:00+00:00"}
    db.upsert_event(reply)
    assert [item["source_id"] for item in db.list_comment_threads(status="active")] == ["root"]
    db.upsert_event({**reply, "has_liked": True})
    assert [item["source_id"] for item in db.list_comment_threads(status="completed")] == ["root"]

    db.upsert_event({**reply, "id": "comment:new", "source_id": "new",
                     "has_liked": False, "received_at": "2099-09-15T01:02:00+00:00"})
    assert [item["source_id"] for item in db.list_comment_threads(status="active")] == ["root"]
    db.upsert_event({"id": "comment:out", "kind": "comment", "source_id": "out",
                     "parent_comment_id": "root", "direction": "outbound", "status": "history",
                     "received_at": "2099-09-15T01:03:00+00:00"})
    assert [item["source_id"] for item in db.list_comment_threads(status="completed")] == ["root"]
