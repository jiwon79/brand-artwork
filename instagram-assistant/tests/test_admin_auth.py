from fastapi.testclient import TestClient

from app import config, main
from app.admin_auth import hash_password


def test_admin_login_protects_records_and_checks_origin(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "records.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", hash_password("correct horse staple 2026", b"test-salt-value-123456789"))
    monkeypatch.setenv("ADMIN_SESSION_SECRET", "test-session-secret-123456789")
    monkeypatch.setenv("INSTAGRAM_ENV", "development")
    monkeypatch.setattr(main.instagram_service, "sync", lambda: {"dms": 0})
    with TestClient(main.app, base_url="https://admin.example") as client:
        assert client.get("/api/events").status_code == 401
        assert client.get("/dm", follow_redirects=False).headers["location"] == "/login"
        assert client.post("/api/admin/login", data={"password": "wrong"}).status_code == 401
        response = client.post("/api/admin/login", data={"password": "correct horse staple 2026"},
                               follow_redirects=False)
        assert response.status_code == 303
        assert "secure" in response.headers["set-cookie"].lower()
        assert "httponly" in response.headers["set-cookie"].lower()
        assert client.get("/api/events").status_code == 200
        assert client.post("/api/sync", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.post("/api/sync", headers={"Origin": "https://admin.example"}).json() == {"dms": 0}
        assert client.post("/api/admin/logout", headers={"Origin": "https://admin.example"},
                           follow_redirects=False).status_code == 303
        assert client.get("/api/events").status_code == 401


def test_public_host_fails_closed_without_admin_config(monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("ADMIN_SESSION_SECRET", raising=False)
    with TestClient(main.app, base_url="https://admin.example") as client:
        assert client.get("/api/events").status_code == 503
