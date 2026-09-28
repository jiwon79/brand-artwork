from __future__ import annotations

import hashlib
import hmac

from fastapi.testclient import TestClient

from app import config, db, webhook


def test_ingress_verification_signature_and_dedup(monkeypatch):
    monkeypatch.setenv("INSTAGRAM_APP_SECRET", "test-secret")
    monkeypatch.setenv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "test-verify")
    monkeypatch.setattr(webhook, "get_settings", lambda: {"instagram_account_id": "123"})
    monkeypatch.setattr(webhook, "initialize", lambda: None)
    monkeypatch.setattr(webhook, "next_webhook", lambda: None)
    saved = []
    monkeypatch.setattr(webhook, "enqueue_webhook", lambda event_id, payload: saved.append(event_id))
    with TestClient(webhook.app) as client:
        response = client.get("/webhook", params={"hub.mode": "subscribe",
            "hub.verify_token": "test-verify", "hub.challenge": "hello"})
        assert response.text == "hello"
        assert client.get("/webhook", params={"hub.mode": "subscribe",
            "hub.verify_token": "wrong", "hub.challenge": "hello"}).status_code == 403
        assert client.get("/webhook", params={"hub.mode": "subscribe",
            "hub.verify_token": "다른 토큰", "hub.challenge": "hello"}).status_code == 403
        body = b'{"object":"instagram","entry":[{"id":"123"}]}'
        assert client.post("/webhook", content=body).status_code == 403
        signature = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()
        assert client.post("/webhook", content=body,
            headers={"x-hub-signature-256": signature}).status_code == 200
        assert saved == [hashlib.sha256(body).hexdigest()]


def test_event_targets_only_connected_account():
    payload = {"object": "instagram", "entry": [
        {"id": "123", "messaging": [{"sender": {"id": "456"},
            "recipient": {"id": "123"}}, {"sender": {"id": "123"},
            "recipient": {"id": "789"}}],
            "changes": [{"field": "comments", "value": {"comment_id": "12", "parent_id": "11"}}]},
        {"id": "999", "messaging": [{"sender": {"id": "999"},
            "recipient": {"id": "888"}}]}]}
    assert webhook.event_targets(payload, "123") == ({"456", "789"}, {"11"})
    payload["entry"][0]["changes"][0]["value"].pop("parent_id")
    assert webhook.event_targets(payload, "123") == ({"456", "789"}, {"12"})


def test_hosted_webhook_processes_queued_event_after_ack(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("INSTAGRAM_APP_SECRET", "test-secret")
    monkeypatch.setattr(webhook, "get_settings", lambda: {"instagram_account_id": "123"})
    monkeypatch.setattr(webhook, "initialize", lambda: None)
    monkeypatch.setattr(webhook, "next_webhook", lambda: None)
    calls = []
    monkeypatch.setattr(webhook, "enqueue_webhook", lambda *_: calls.append("queued"))
    monkeypatch.setattr(webhook, "process_one", lambda: calls.append("processed"))
    body = b'{"object":"instagram","entry":[{"id":"123"}]}'
    signature = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()
    with TestClient(webhook.app) as client:
        assert client.post("/webhook", content=body,
            headers={"x-hub-signature-256": signature}).status_code == 200
    assert "queued" in calls and "processed" in calls[calls.index("queued") + 1:]


def test_messaging_account_id_alias_routes_inbound_and_outbound():
    payload = {"object": "instagram", "entry": [{"id": "1784", "messaging": [
        {"sender": {"id": "456"}, "recipient": {"id": "1784"}},
        {"sender": {"id": "1784"}, "recipient": {"id": "789"}},
    ]}]}
    assert webhook.event_targets(payload, "2911", "1784") == ({"456", "789"}, set())
    assert webhook.event_targets(payload, "2911") == (set(), set())


def test_known_message_reaction_webhook_updates_heart_without_graph(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "records.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.update_settings({"instagram_account_id": "account-1",
                        "instagram_messaging_account_id": "own-1"})
    db.upsert_event({"id": "dm:message-1", "account_id": "account-1", "kind": "dm",
                     "source_id": "message-1", "thread_id": "thread-1", "author_id": "own-1",
                     "direction": "outbound", "body": "hello"})
    payload = {"object": "instagram", "entry": [{"id": "own-1", "messaging": [{
        "sender": {"id": "visitor-1"}, "recipient": {"id": "own-1"},
        "reaction": {"mid": "message-1", "action": "react", "reaction": "other", "emoji": "❤"}}]}]}
    db.enqueue_webhook("reaction-1", payload)
    monkeypatch.setattr(webhook.instagram_service, "sync", lambda **_: (_ for _ in ()).throw(
        AssertionError("known reactions must not spend a Graph request")))
    assert webhook.process_one()
    assert db.get_event("dm:message-1")["peer_reaction"] == "❤"
    payload["entry"][0]["messaging"][0]["reaction"] = {
        "mid": "message-1", "action": "unreact", "reaction": "other", "emoji": "❤"}
    db.enqueue_webhook("reaction-2", payload)
    assert webhook.process_one()
    assert db.get_event("dm:message-1")["peer_reaction"] is None
