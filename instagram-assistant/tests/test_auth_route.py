from fastapi.testclient import TestClient

from app import config, db, main
from app.admin_auth import hash_password


def test_oauth_start_requires_local_token_and_uses_post(monkeypatch):
    monkeypatch.setattr(main.instagram_service, "authorization_url", lambda: "https://www.instagram.com/oauth/authorize")
    with TestClient(main.app) as client:
        assert client.get("/api/auth/url").status_code == 405
        assert client.post("/api/auth/url").status_code == 403
        response = client.post("/api/auth/url", headers={"X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert response.json()["url"] == "https://www.instagram.com/oauth/authorize"


def test_hosted_oauth_callback_uses_one_time_state_without_admin_cookie(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", hash_password("test-admin-password-long"))
    monkeypatch.setenv("ADMIN_SESSION_SECRET", "test-session-secret")
    calls = []
    monkeypatch.setattr(main.instagram_service, "complete_oauth",
                        lambda code, state: calls.append((code, state)))
    with TestClient(main.app, base_url="https://admin.example") as client:
        assert client.get("/api/status").status_code == 401
        assert client.get("/api/auth/callback").status_code == 400
        response = client.get("/api/auth/callback?code=test-code&state=test-state",
                              follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/setting?oauth=connected"
    assert calls == [("test-code", "test-state")]


def test_webhook_subscription_requires_auth_and_confirms_fields(monkeypatch):
    calls = []

    class StubClient:
        def request(self, method, path, **kwargs):
            calls.append((method, path, kwargs))
            return {"data": [{"subscribed_fields": ["messages", "message_reactions", "comments"]}]}

    monkeypatch.setattr(main.instagram_service, "connect_saved_session", lambda: StubClient())
    with TestClient(main.app) as client:
        assert client.post("/api/webhooks/subscribe").status_code == 403
        response = client.post("/api/webhooks/subscribe", headers={
            "X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert response.json()["subscriptions"][0]["subscribed_fields"] == [
        "messages", "message_reactions", "comments"]
    assert calls == [
        ("POST", "/me/subscribed_apps", {"data": {
            "subscribed_fields": "messages,message_reactions,comments"}}),
        ("GET", "/me/subscribed_apps", {}),
    ]


def test_viewer_only_exposes_sync_action_without_mutation_token():
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
    assert 'id="sync"' in page.text
    assert script.status_code == 200
    assert "X-Instagram-Assistant-Token" not in script.text
    assert '/api/viewer/sync' in script.text
    assert '"/api/events/' not in script.text
    assert 'method: "PATCH"' not in script.text


def test_viewer_sync_requires_same_origin_and_cannot_call_protected_sync(monkeypatch):
    calls = []
    monkeypatch.setattr(main.instagram_service, "sync", lambda: calls.append(True) or {"comments": 1, "dms": 0})
    with TestClient(main.app) as client:
        assert client.get("/api/viewer/sync").status_code == 405
        assert client.post("/api/viewer/sync").status_code == 403
        assert client.post("/api/viewer/sync", headers={
            "Origin": "https://elsewhere.example", "X-Requested-With": "InstagramAssistant",
        }).status_code == 403
        assert client.post("/api/sync").status_code == 403
        response = client.post("/api/viewer/sync", headers={
            "Origin": "http://testserver", "X-Requested-With": "InstagramAssistant",
            "Sec-Fetch-Site": "same-origin",
        })
    assert response.status_code == 200
    assert response.json()["comments"] == 1
    assert calls == [True]


def test_viewer_dm_sync_skips_comment_fetch(monkeypatch):
    calls = []
    monkeypatch.setattr(main.instagram_service, "sync", lambda **kwargs: calls.append(kwargs) or {"dms": 1})
    headers = {"Origin": "http://testserver", "X-Requested-With": "InstagramAssistant",
               "Sec-Fetch-Site": "same-origin"}
    with TestClient(main.app) as client:
        response = client.post("/api/viewer/sync?scope=dm", headers=headers)
        targeted = client.post("/api/viewer/sync?scope=dm&user_id=123", headers=headers)
        invalid = client.post("/api/viewer/sync?scope=other", headers=headers)
    assert response.status_code == 200
    assert response.json()["dms"] == 1
    assert targeted.status_code == 200
    assert calls == [{"media_amount": 0, "dm_user_id": None},
                     {"media_amount": 0, "dm_user_id": "123"}]
    assert invalid.status_code == 422


def test_observation_setting_is_absent_and_cannot_be_restored(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    with TestClient(main.app) as client:
        with db.connect() as conn:
            conn.execute("INSERT INTO settings(key, value) VALUES ('read_only_observation', 'true')")
        db.initialize()
        assert "read_only_observation" not in client.get("/api/status").json()["settings"]
        response = client.patch("/api/settings", headers={
            "X-Instagram-Assistant-Token": main.TOKEN},
            json={"read_only_observation": True})
        assert response.status_code == 422
        assert "read_only_observation" not in db.get_settings()


def test_dm_heart_requires_local_token(monkeypatch):
    calls = []
    monkeypatch.setattr(main.instagram_service, "heart_dm", lambda event_id: calls.append(event_id) or {"has_liked": True})
    with TestClient(main.app) as client:
        assert client.post("/api/events/dm:message-1/heart").status_code == 403
        response = client.post("/api/events/dm:message-1/heart", headers={
            "X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert calls == ["dm:message-1"]


def test_draft_api_sets_send_action_for_connected_inbound_items(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    headers = {"X-Instagram-Assistant-Token": main.TOKEN}
    with TestClient(main.app) as client:
        db.update_settings({"instagram_account_id": "account-1"})
        for event in (
            {"id": "comment:root", "kind": "comment", "source_id": "root"},
            {"id": "dm:one", "kind": "dm", "source_id": "one", "author_id": "sender-1"},
        ):
            db.upsert_event({**event, "account_id": "account-1"})
        assert client.patch("/api/events/dm:one/draft", json={"draft": "안녕하세요"}).status_code == 403
        for event_id, action in (("comment:root", "reply_comment"), ("dm:one", "reply_dm")):
            response = client.patch(f"/api/events/{event_id}/draft", headers=headers,
                                    json={"draft": "안녕하세요"})
            assert response.status_code == 200
            assert response.json()["proposed_action"] == action
            assert response.json()["status"] == "drafted"
        assert client.patch("/api/events/dm:one/draft", headers=headers,
                            json={"draft": "  "}).status_code == 400
        db.upsert_event({"id": "dm:other", "kind": "dm", "source_id": "other",
                         "author_id": "sender-2", "account_id": "account-2"})
        assert client.patch("/api/events/dm:other/draft", headers=headers,
                            json={"draft": "안녕하세요"}).status_code == 400


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
