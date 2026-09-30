from fastapi.testclient import TestClient

from app import config, main


def test_post_label_is_private_persistent_and_replaces_artwork_title(tmp_path, monkeypatch):
    from app.admin_auth import hash_password

    monkeypatch.setattr(config.paths, "database", tmp_path / "records.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", hash_password("correct horse staple 2026", b"test-salt-value-123456789"))
    monkeypatch.setenv("ADMIN_SESSION_SECRET", "test-session-secret-123456789")
    monkeypatch.setenv("INSTAGRAM_ENV", "development")
    with TestClient(main.app, base_url="https://admin.example") as client:
        assert client.get("/api/post-labels").status_code == 401
        client.post("/api/admin/login", data={"password": "correct horse staple 2026"})
        assert client.get("/api/post-labels").json()["Db1_p35TbhR"] == "녹는 글자"
        assert client.put("/api/post-labels/Db1_p35TbhR", json={"label": "  물 떨어지는 글자  "},
                          headers={"Origin": "https://admin.example"}).json() == {
            "post_code": "Db1_p35TbhR", "label": "물 떨어지는 글자"}
        assert client.get("/api/post-labels").json()["Db1_p35TbhR"] == "물 떨어지는 글자"
        assert client.put("/api/post-labels/invalid!", json={"label": "test"},
                          headers={"Origin": "https://admin.example"}).status_code == 400
        assert client.put("/api/post-labels/Db1_p35TbhR", json={"label": "other"}).status_code == 403
