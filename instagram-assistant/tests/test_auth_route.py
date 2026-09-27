from fastapi.testclient import TestClient

from app import config, db, main


def test_oauth_start_requires_local_token_and_uses_post(monkeypatch):
    monkeypatch.setattr(main.instagram_service, "authorization_url", lambda: "https://www.instagram.com/oauth/authorize")
    with TestClient(main.app) as client:
        assert client.get("/api/auth/url").status_code == 405
        assert client.post("/api/auth/url").status_code == 403
        response = client.post("/api/auth/url", headers={"X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert response.json()["url"] == "https://www.instagram.com/oauth/authorize"


def test_viewer_does_not_expose_mutation_token_or_controls():
    with TestClient(main.app) as client:
        page = client.get("/dm")
        script = client.get("/static/app.js")
    assert page.status_code == 200
    assert main.TOKEN not in page.text
    assert "instagram-assistant-token" not in page.text
    assert "조회 전용" not in page.text
    assert "DM 내역" not in page.text
    assert "댓글 내역" not in page.text
    assert "보내기" not in page.text
    assert script.status_code == 200
    assert "X-Instagram-Assistant-Token" not in script.text
    assert 'method: "POST"' not in script.text
    assert 'method: "PATCH"' not in script.text


def test_dm_heart_requires_local_token(monkeypatch):
    calls = []
    monkeypatch.setattr(main.instagram_service, "heart_dm", lambda event_id: calls.append(event_id) or {"has_liked": True})
    with TestClient(main.app) as client:
        assert client.post("/api/events/dm:message-1/heart").status_code == 403
        response = client.post("/api/events/dm:message-1/heart", headers={
            "X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert calls == ["dm:message-1"]


def test_observed_heart_requires_token_and_completes_review(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    with TestClient(main.app) as client:
        db.upsert_event({
            "id": "comment:root", "kind": "comment", "source_id": "root",
            "received_at": "2026-09-15T01:00:00+00:00",
        })
        path = "/api/events/comment:root/heart-observed"
        assert client.post(path).status_code == 403
        response = client.post(path, headers={"X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert response.json()["has_liked"] == 1
    assert db.get_event("comment:root")["reviewed_at"] is not None
    assert db.list_comment_threads(status="active") == []


def test_observed_dm_heart_completes_conversation(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    with TestClient(main.app) as client:
        db.upsert_event({
            "id": "dm:one", "kind": "dm", "source_id": "one", "thread_id": "thread-1",
            "received_at": "2026-09-15T01:00:00+00:00",
        })
        response = client.post("/api/events/dm:one/heart-observed", headers={
            "X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert response.json()["has_liked"] == 1
    assert db.list_conversations(status="active") == []
    assert [item["thread_id"] for item in db.list_conversations(status="completed")] == ["thread-1"]
