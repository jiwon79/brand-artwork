from fastapi.testclient import TestClient

from app import config, hosted
from app.meta_config import get_meta_config


def test_meta_development_and_production_credentials_are_isolated(monkeypatch):
    monkeypatch.setenv("META_DEV_APP_ID", "dev-id")
    monkeypatch.setenv("META_PROD_APP_ID", "prod-id")
    monkeypatch.setenv("META_DEV_WEBHOOK_APP_SECRET", "dev-signing")
    monkeypatch.setenv("META_PROD_WEBHOOK_APP_SECRET", "prod-signing")
    monkeypatch.setenv("INSTAGRAM_ENV", "development")
    assert get_meta_config().app_id == "dev-id"
    assert get_meta_config().webhook_app_secret == "dev-signing"
    monkeypatch.setenv("INSTAGRAM_ENV", "production")
    assert get_meta_config().app_id == "prod-id"
    assert get_meta_config().webhook_app_secret == "prod-signing"


def test_hosted_webhook_drain_requires_cron_secret(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setenv("CRON_SECRET", "cron-test-secret")
    calls = []
    monkeypatch.setattr(hosted, "process_one", lambda: calls.append(True) or len(calls) < 3)
    with TestClient(hosted.app, base_url="https://admin.example") as client:
        assert client.get("/api/cron/process-webhooks").status_code == 403
        assert client.get("/api/cron/process-webhooks", headers={"Authorization": "Bearer wrong"}).status_code == 403
        assert client.get("/api/cron/process-webhooks", headers={
            "Authorization": "Bearer cron-test-secret"}).json() == {
                "processed": 2}


def test_daily_cron_starts_full_sync_only_with_secret(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setenv("CRON_SECRET", "cron-test-secret")
    monkeypatch.setattr(hosted, "process_one", lambda: False)
    monkeypatch.setattr(hosted, "run_pass", lambda **kwargs: {"complete": True, **kwargs})
    with TestClient(hosted.app, base_url="https://admin.example") as client:
        assert client.get("/api/cron/full-sync").status_code == 403
        assert client.get("/api/cron/full-sync", headers={
            "Authorization": "Bearer cron-test-secret"}).json() == {
                "webhooks_processed": 0,
                "reconciliation": {"complete": True, "max_seconds": 240}}


def test_hosted_webhook_challenge_is_plain_text(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.delenv("INSTAGRAM_ENV", raising=False)
    monkeypatch.setenv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "verify-test")
    with TestClient(hosted.app) as client:
        response = client.get("/webhook", params={
            "hub.mode": "subscribe", "hub.verify_token": "verify-test",
            "hub.challenge": "exact-challenge"})
    assert response.status_code == 200
    assert response.text == "exact-challenge"
    assert response.headers["content-type"].startswith("text/plain")
