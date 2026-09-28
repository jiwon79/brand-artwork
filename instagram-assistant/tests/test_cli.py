from urllib.parse import urlparse

from fastapi.testclient import TestClient

from app import cli, config, main
from app.db import upsert_event


def test_event_detail_requires_login_and_returns_exact_event(tmp_path, monkeypatch):
    from app.admin_auth import hash_password

    monkeypatch.setattr(config.paths, "database", tmp_path / "records.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", hash_password("correct horse staple 2026", b"test-salt-value-123456789"))
    monkeypatch.setenv("ADMIN_SESSION_SECRET", "test-session-secret-123456789")
    monkeypatch.setenv("INSTAGRAM_ENV", "development")
    with TestClient(main.app, base_url="https://admin.example") as client:
        upsert_event({"id": "dm:test-id", "account_id": "test-account", "kind": "dm",
                      "source_id": "test-id", "direction": "inbound", "body": "hello",
                      "received_at": "2026-09-28T00:00:00Z", "status": "pending"})
        assert client.get("/api/events/dm:test-id").status_code == 401
        client.post("/api/admin/login", data={"password": "correct horse staple 2026"})
        assert client.get("/api/events/dm:test-id").json()["body"] == "hello"
        assert client.get("/api/events/dm:missing").status_code == 404


def test_send_requires_exact_saved_draft_and_explicit_yes(monkeypatch):
    requests = []

    class FakeClient:
        def __init__(self, base_url, token):
            pass

        def login(self, password):
            assert password == "test password"

        def request(self, method, path, **kwargs):
            requests.append((method, path))
            if method == "GET":
                return {"status": "drafted", "draft": "approved words"}
            return {"status": "sent"}

    monkeypatch.setattr(cli, "Client", FakeClient)
    monkeypatch.setenv("INSTAGRAM_ASSISTANT_ADMIN_PASSWORD", "test password")
    assert cli.main(["--env", "dev", "send", "dm:test-id", "--expect-draft", "wrong", "--yes"]) == 1
    assert requests == [("GET", "/api/events/dm%3Atest-id")]
    requests.clear()
    assert cli.main(["--env", "dev", "send", "dm:test-id", "--expect-draft", "approved words", "--yes"]) == 0
    assert requests == [("GET", "/api/events/dm%3Atest-id"), ("POST", "/api/events/dm%3Atest-id/send")]


def test_custom_url_cannot_receive_automatic_keychain_password(monkeypatch):
    monkeypatch.delenv("INSTAGRAM_ASSISTANT_ADMIN_PASSWORD", raising=False)
    assert cli.main(["--env", "dev", "--base-url", "https://example.com", "status"]) == 1


def test_prod_uses_legacy_keychain_service_when_named_entry_is_missing(monkeypatch):
    services = []

    class FakeClient:
        def __init__(self, base_url, token):
            pass

        def login(self, password):
            assert password == "stored password"

        def request(self, method, path, **kwargs):
            return {"ok": True}

    monkeypatch.delenv("INSTAGRAM_ASSISTANT_ADMIN_PASSWORD", raising=False)
    monkeypatch.setattr(cli, "Client", FakeClient)
    monkeypatch.setattr(cli, "secret_from_keychain", lambda service, account:
                        services.append(service) or ("stored password" if service == "Instagram Assistant Admin" else None))
    assert cli.main(["--env", "prod", "status"]) == 0
    assert services == ["Instagram Assistant Prod Admin", "Instagram Assistant Admin"]


def test_viewer_sync_sets_required_header(monkeypatch):
    observed = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, *_):
            return b'{"dms": 1}'

    client = cli.Client("https://instagram-assistant-dev.vercel.app")

    def open_request(request, timeout):
        observed["origin"] = request.get_header("Origin")
        observed["requested_with"] = request.get_header("X-requested-with")
        observed["timeout"] = timeout
        observed["scope"] = urlparse(request.full_url).query
        return Response()

    monkeypatch.setattr(client.opener, "open", open_request)
    assert client.request("POST", "/api/viewer/sync", params={"scope": "dm"}, body={}) == {"dms": 1}
    assert observed == {"origin": "https://instagram-assistant-dev.vercel.app",
                        "requested_with": "InstagramAssistant", "timeout": 600, "scope": "scope=dm"}
