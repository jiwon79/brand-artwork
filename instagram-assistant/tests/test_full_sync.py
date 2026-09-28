from datetime import UTC, datetime

from app import full_sync


def test_full_sync_skips_within_24_hours(monkeypatch):
    monkeypatch.setattr(full_sync, "initialize", lambda: None)
    monkeypatch.setattr(full_sync, "get_settings", lambda: {
        "last_full_sync_at": datetime.now(UTC).isoformat()})
    monkeypatch.setattr(full_sync.instagram_service, "sync", lambda **kwargs: 1 / 0)
    assert "skipped" in full_sync.run_if_due()


def test_full_sync_scans_all_pages_and_records_success(monkeypatch):
    calls = []
    monkeypatch.setattr(full_sync, "initialize", lambda: None)
    monkeypatch.setattr(full_sync, "get_settings", lambda: {"last_full_sync_at": None})
    monkeypatch.setattr(full_sync.instagram_service, "sync", lambda **kwargs:
                        calls.append(kwargs) or {"dms": 1})
    monkeypatch.setattr(full_sync, "update_settings", lambda values: calls.append(values))
    assert full_sync.run_if_due() == {"dms": 1}
    assert calls[0]["full"] is True and calls[0]["threads_amount"] > 100
    assert "last_full_sync_at" in calls[1]
