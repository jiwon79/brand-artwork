from datetime import UTC, datetime

from app import full_sync
from app.instagram_client import InstagramHaltedError


def test_full_sync_skips_within_24_hours(monkeypatch):
    monkeypatch.setattr(full_sync, "initialize", lambda: None)
    monkeypatch.setattr(full_sync, "get_settings", lambda: {
        "last_full_sync_at": datetime.now(UTC).isoformat()})
    monkeypatch.setattr(full_sync.instagram_service, "sync", lambda **kwargs: 1 / 0)
    assert "skipped" in full_sync.run_if_due()


def test_full_sync_saves_cursor_then_marks_success_only_after_dm_phase(monkeypatch):
    calls = []
    settings = {"last_full_sync_at": None, "full_sync_progress": None,
                "full_sync_retry_after": None}
    pages = [
        {"data": [{"id": "media-1"}], "paging": {"next": "next", "cursors": {"after": "media-cursor"}}},
        {"data": [{"id": "media-2"}]},
        {"data": [{"id": "thread-1"}]},
    ]
    class Client:
        def request(self, method, path, *, params):
            calls.append((path, params.copy()))
            return pages.pop(0)
    monkeypatch.setattr(full_sync, "initialize", lambda: None)
    monkeypatch.setattr(full_sync, "get_settings", lambda: settings.copy())
    monkeypatch.setattr(full_sync.instagram_service, "connect_saved_session", lambda: Client())
    monkeypatch.setattr(full_sync.instagram_service, "sync", lambda **kwargs:
                        calls.append(kwargs) or {"dms": 1})
    monkeypatch.setattr(full_sync, "update_settings", settings.update)
    assert full_sync.run_if_due()["phase"] == "media"
    assert settings["full_sync_progress"] == {"phase": "media", "cursor": "media-cursor"}
    assert settings["last_full_sync_at"] is None
    assert full_sync.run_if_due()["phase"] == "media"
    assert settings["full_sync_progress"] == {"phase": "dm", "cursor": None}
    assert full_sync.run_if_due()["complete"] is True
    assert settings["last_full_sync_at"] is not None
    assert settings["full_sync_progress"] is None
    assert calls[0][1]["limit"] == 1
    assert calls[2][1]["after"] == "media-cursor"


def test_full_sync_defers_after_meta_rate_limit(monkeypatch):
    settings = {"last_full_sync_at": None, "full_sync_progress": None,
                "full_sync_retry_after": None}
    class Client:
        def request(self, *args, **kwargs):
            raise InstagramHaltedError("Meta API 제한 (4)")
    monkeypatch.setattr(full_sync, "initialize", lambda: None)
    monkeypatch.setattr(full_sync, "get_settings", lambda: settings.copy())
    monkeypatch.setattr(full_sync, "update_settings", settings.update)
    monkeypatch.setattr(full_sync.instagram_service, "connect_saved_session", lambda: Client())
    assert "deferred" in full_sync.run_if_due()
    assert settings["full_sync_progress"] == {"phase": "media", "cursor": None}
    assert "deferred" in full_sync.run_if_due()


def test_run_pass_continues_all_pages(monkeypatch):
    steps = iter([{"phase": "media", "next": True},
                  {"phase": "dm", "next": True}, {"complete": True}])
    monkeypatch.setattr(full_sync, "run_if_due", lambda: next(steps))
    monkeypatch.setattr(full_sync.time, "sleep", lambda _: None)
    assert full_sync.run_pass() == {"complete": True, "steps": 3}
