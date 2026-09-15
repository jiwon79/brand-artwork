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
