from app import config, db
from app.database_backend import remote_url
from app.migrate_to_turso import migrate
from app.token_store import has_token, load_and_delete_oauth_state, load_token, save_oauth_state, save_token
from cryptography.fernet import Fernet


def test_libsql_adapter_preserves_record_queries(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setenv("TURSO_DATABASE_URL", str(tmp_path / "remote-compatible.db"))
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "local-test-token")
    monkeypatch.delenv("INSTAGRAM_ENV", raising=False)
    db.initialize()
    assert db.get_settings()["auto_send"] is False
    db.upsert_event({"id": "dm:one", "kind": "dm", "source_id": "one",
                     "thread_id": "thread-1", "body": "testing"})
    assert db.get_event("dm:one")["body"] == "testing"
    assert len(db.list_artworks()) == 6


def test_separate_turso_database_urls_must_differ(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_ENV", "development")
    monkeypatch.setenv("TURSO_DEV_DATABASE_URL", "libsql://same.example")
    monkeypatch.setenv("TURSO_PROD_DATABASE_URL", "libsql://same.example")
    monkeypatch.setenv("TURSO_DEV_AUTH_TOKEN", "test")
    try:
        with db.connect():
            pass
    except RuntimeError as exc:
        assert "must differ" in str(exc)
    else:
        raise AssertionError("shared development and production DB must be rejected")


def test_vercel_marketplace_prefixed_turso_variables(monkeypatch):
    monkeypatch.setenv("INSTAGRAM_ENV", "development")
    monkeypatch.setenv("TURSO_DEV_TURSO_DATABASE_URL", "libsql://development.example")
    monkeypatch.setenv("TURSO_DEV_TURSO_AUTH_TOKEN", "test-token")
    monkeypatch.delenv("TURSO_DEV_DATABASE_URL", raising=False)
    monkeypatch.delenv("TURSO_PROD_DATABASE_URL", raising=False)
    assert remote_url() == "libsql://development.example"


def test_explicit_environment_rejects_generic_database_url(monkeypatch):
    monkeypatch.setenv("INSTAGRAM_ENV", "production")
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://generic.example")
    try:
        with db.connect():
            pass
    except RuntimeError as exc:
        assert "environment-specific" in str(exc)
    else:
        raise AssertionError("generic URL must not be used by explicit environment")


def test_migrate_snapshot_into_empty_turso_database(tmp_path, monkeypatch):
    source = tmp_path / "source.sqlite3"
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setattr(config.paths, "database", source)
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.delenv("INSTAGRAM_ENV", raising=False)
    db.initialize()
    db.upsert_event({"id": "dm:migrate", "kind": "dm", "source_id": "migrate", "body": "preserve"})
    monkeypatch.setenv("TURSO_DATABASE_URL", str(tmp_path / "destination.db"))
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "local-test-token")
    counts = migrate(source)
    assert counts["events"] == 1
    assert db.get_event("dm:migrate")["body"] == "preserve"


def test_meta_token_is_encrypted_in_turso_and_oauth_state_survives_process(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setenv("TURSO_DATABASE_URL", str(tmp_path / "remote-compatible.db"))
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "local-test-token")
    monkeypatch.setenv("INSTAGRAM_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.delenv("INSTAGRAM_ENV", raising=False)
    db.initialize()
    save_token({"access_token": "sensitive-token", "account_id": "123", "expires_at": "future"})
    assert has_token()
    assert "sensitive-token" not in db.get_private_state("graph-token")
    assert load_token()["access_token"] == "sensitive-token"
    save_oauth_state({"state": "random-state"})
    assert load_and_delete_oauth_state() == {"state": "random-state"}
    assert db.get_private_state("oauth-state") is None
