from __future__ import annotations

import hashlib
import hmac

from fastapi.testclient import TestClient

from app import webhook


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


def test_messaging_account_id_alias_routes_inbound_and_outbound():
    payload = {"object": "instagram", "entry": [{"id": "1784", "messaging": [
        {"sender": {"id": "456"}, "recipient": {"id": "1784"}},
        {"sender": {"id": "1784"}, "recipient": {"id": "789"}},
    ]}]}
    assert webhook.event_targets(payload, "2911", "1784") == ({"456", "789"}, set())
    assert webhook.event_targets(payload, "2911") == (set(), set())
