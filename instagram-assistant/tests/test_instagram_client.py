import json
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pytest

from app import config, db, instagram_client
from app.instagram_client import GraphClient, InstagramAssistantError, InstagramService


def test_graph_client_uses_official_host_and_bearer_token(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"id": "reply-2"})

    original_client = httpx.Client
    monkeypatch.setattr(instagram_client.httpx, "Client", lambda **kwargs: original_client(
        transport=httpx.MockTransport(respond), **kwargs))
    result = GraphClient("private-token", "ig-1", "studio.jiiwon").request(
        "POST", "/comment-1/replies", data={"message": "DM 주세요"})
    assert result == {"id": "reply-2"}
    assert requests[0].url.host == "graph.instagram.com"
    assert requests[0].headers["authorization"] == "Bearer private-token"
    assert "message=DM" in requests[0].content.decode()


def test_graph_pages_stop_when_meta_has_no_next_page(monkeypatch):
    client = GraphClient("token", "ig-1", "studio.jiiwon")
    calls = []

    def request(method, path, *, params):
        calls.append(dict(params))
        return {"data": [{"id": "comment-1"}], "paging": {"cursors": {"after": "last"}}}

    monkeypatch.setattr(client, "request", request)
    assert list(client.pages("/media-1/comments", limit=10)) == [{"id": "comment-1"}]
    assert len(calls) == 1


def test_oauth_url_uses_official_scopes_and_stores_short_lived_state(monkeypatch, tmp_path):
    monkeypatch.setenv("INSTAGRAM_APP_ID", "app-id")
    monkeypatch.setenv("INSTAGRAM_APP_SECRET", "secret")
    monkeypatch.setenv("INSTAGRAM_REDIRECT_URI", "https://example.com/api/auth/callback")
    monkeypatch.setattr(instagram_client.paths, "oauth_state", tmp_path / "state.json")
    monkeypatch.setattr(instagram_client, "prepare_data_dir", lambda: None)
    url = InstagramService().authorization_url()
    state = json.loads((tmp_path / "state.json").read_text())
    assert url.startswith("https://www.instagram.com/oauth/authorize?")
    assert "instagram_business_manage_comments" in url
    assert "instagram_business_manage_messages" in url
    assert f"state={state['state']}" in url
    assert (tmp_path / "state.json").stat().st_mode & 0o777 == 0o600


def test_oauth_rejects_wrong_state_before_token_exchange(monkeypatch, tmp_path):
    monkeypatch.setenv("INSTAGRAM_APP_ID", "app-id")
    monkeypatch.setenv("INSTAGRAM_APP_SECRET", "secret")
    monkeypatch.setenv("INSTAGRAM_REDIRECT_URI", "https://example.com/api/auth/callback")
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps({"state": "expected", "created_at": datetime.now(UTC).isoformat()}))
    monkeypatch.setattr(instagram_client.paths, "oauth_state", state_file)
    with pytest.raises(InstagramAssistantError, match="만료"):
        InstagramService().complete_oauth("code", "wrong")
    assert not state_file.exists()


def event(**changes):
    return {"id": "comment:1", "account_id": "ig-1", "kind": "comment",
            "source_id": "1", "direction": "inbound", "parent_comment_id": None,
            "status": "drafted", "draft": "게시물 DM 주시면 링크 드릴게요!",
            "proposed_action": "reply_comment", **changes}


def setup_send(monkeypatch, item):
    calls = []
    monkeypatch.setattr(instagram_client, "get_event", lambda _: item)
    monkeypatch.setattr(instagram_client, "get_settings", lambda: {
        "read_only_observation": False, "halted_reason": None, "daily_send_limit": 20})
    monkeypatch.setattr(instagram_client, "sent_today_count", lambda: 0)
    monkeypatch.setattr(instagram_client, "add_delivery", lambda *args, **kwargs: calls.append(("delivery", args, kwargs)))
    monkeypatch.setattr(instagram_client, "update_event", lambda _, values: calls.append(("update", values)) or {**item, **values})
    service = InstagramService()
    return service, calls


def test_comment_reply_uses_parent_endpoint_and_verifies_nested_id(monkeypatch):
    item = event()
    service, calls = setup_send(monkeypatch, item)

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"
        def __init__(self): self.posts = []
        def pages(self, path, *, params, limit):
            assert path == "/1/replies"
            return iter([] if not self.posts else [{"id": "reply-2", "username": "studio.jiiwon"}])
        def request(self, method, path, **kwargs):
            self.posts.append((method, path, kwargs))
            return {"id": "reply-2"}
    graph = FakeGraph()
    service._client = graph
    result = service.send_for_event(item["id"])
    assert graph.posts == [("POST", "/1/replies", {"data": {"message": item["draft"]}})]
    assert result["status"] == "sent"
    assert any(call[0] == "delivery" and call[1][3] == "sent" for call in calls)


def test_existing_reply_blocks_duplicate_post(monkeypatch):
    item = event()
    service, calls = setup_send(monkeypatch, item)
    graph = SimpleNamespace(account_id="ig-1", username="studio.jiiwon",
        pages=lambda *args, **kwargs: iter([{"id": "older", "username": "studio.jiiwon"}]),
        request=lambda *args, **kwargs: pytest.fail("duplicate POST"))
    service._client = graph
    with pytest.raises(InstagramAssistantError, match="이미 답글"):
        service.send_for_event(item["id"])
    assert ("update", {"status": "sent", "error": None}) in calls


def test_old_account_event_cannot_be_sent(monkeypatch):
    item = event(account_id="different-account")
    service, _ = setup_send(monkeypatch, item)
    service._client = SimpleNamespace(account_id="ig-1")
    with pytest.raises(InstagramAssistantError, match="현재 연결 계정"):
        service.send_for_event(item["id"])


def test_graph_sync_records_parent_reply_and_dm_for_connected_account(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.update_settings({"instagram_account_id": "ig-1", "instagram_username": "studio.jiiwon"})

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"

        def pages(self, path, *, params, limit):
            data = {
                "/me/media": [{"id": "media-1", "permalink": "https://www.instagram.com/reel/ABC/", "caption": "작품"}],
                "/media-1/comments": [{"id": "comment-1", "username": "visitor", "text": "링크 주세요",
                    "timestamp": "2026-09-26T01:00:00+0000", "replies": {"data": [
                        {"id": "reply-1", "username": "studio.jiiwon", "text": "DM 주세요",
                         "timestamp": "2026-09-26T01:01:00+0000"}]}}],
                "/me/conversations": [{"id": "thread-1"}],
            }
            return iter(data[path])

        def request(self, method, path, *, params):
            assert method == "GET" and path == "/thread-1"
            return {"participants": {"data": [
                {"id": "messaging-own-id", "username": "studio.jiiwon"},
                {"id": "visitor-id", "username": "visitor"},
            ]}, "messages": {"data": [{"id": "message-1", "from": {"id": "visitor-id", "username": "visitor"},
                "message": "안녕하세요", "created_time": "2026-09-26T01:02:00+0000"},
                {"id": "message-2", "from": {"id": "messaging-own-id", "username": "studio.jiiwon"},
                 "message": "안녕하세요!", "created_time": "2026-09-26T01:03:00+0000"}]}}

    service = InstagramService()
    service._client = FakeGraph()
    result = service.sync(media_amount=1, comments_per_media=10, threads_amount=1)
    assert result["comments"] == 1 and result["comment_replies"] == 1 and result["dms"] == 2
    assert db.get_event("comment:comment-1")["status"] == "sent"
    assert db.get_event("comment:reply-1")["parent_comment_id"] == "comment-1"
    assert db.get_event("dm:message-1")["author_id"] == "visitor-id"
    assert db.get_event("dm:message-1")["account_id"] == "ig-1"
    assert db.get_event("dm:message-1")["direction"] == "inbound"
    assert db.get_event("dm:message-2")["direction"] == "outbound"
    assert db.get_event("dm:message-2")["status"] == "history"


def test_dm_resync_corrects_existing_outbound_draft(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.upsert_event({"id": "dm:message-2", "account_id": "ig-1", "kind": "dm",
        "source_id": "message-2", "thread_id": "thread-1", "author_id": "messaging-own-id",
        "author_username": "studio.jiiwon", "direction": "inbound", "body": "제가 보낸 답장",
        "status": "drafted"})
    db.update_event("dm:message-2", {"draft": "잘못 만든 초안", "proposed_action": "reply_dm"})
    db.upsert_event({"id": "dm:older", "account_id": "ig-1", "kind": "dm",
        "source_id": "older", "thread_id": "older-thread", "author_id": "messaging-own-id",
        "author_username": "studio.jiiwon", "direction": "inbound", "body": "예전에 보낸 답장",
        "status": "pending"})

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"
        def pages(self, path, *, params, limit):
            if path == "/me/media":
                return iter([])
            assert path == "/me/conversations"
            return iter([{"id": "thread-1"}])
        def request(self, method, path, *, params):
            return {"participants": {"data": [
                {"id": "messaging-own-id", "username": "studio.jiiwon"},
                {"id": "visitor-id", "username": "visitor"}]},
                "messages": {"data": [{"id": "message-2", "from": {"id": "messaging-own-id"},
                    "message": "제가 보낸 답장", "created_time": "2026-09-26T01:03:00+0000"}]}}

    service = InstagramService()
    service._client = FakeGraph()
    service.sync(media_amount=0, threads_amount=1)
    repaired = db.get_event("dm:message-2")
    assert repaired["direction"] == "outbound"
    assert repaired["status"] == "history"
    assert repaired["draft"] is None
    assert repaired["proposed_action"] is None
    assert repaired["author_username"] == "studio.jiiwon"
    assert db.get_event("dm:older")["direction"] == "outbound"
    assert db.get_event("dm:older")["status"] == "history"


def test_sync_reports_permission_gap_when_media_has_comments_but_api_returns_none(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"

        def pages(self, path, *, params, limit):
            if path == "/me/media":
                return iter([{"id": "media-1", "permalink": "https://www.instagram.com/reel/ABC/",
                    "media_product_type": "REELS", "comments_count": 2}])
            assert path == "/media-1/comments"
            return iter([])

    service = InstagramService()
    service._client = FakeGraph()
    with pytest.raises(InstagramAssistantError, match="Meta 앱의 댓글 권한"):
        service.sync(media_amount=1)


def test_sync_uses_from_username_and_scans_past_own_comments(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"

        def pages(self, path, *, params, limit):
            if path == "/me/media":
                return iter([{"id": "media-1", "permalink": "https://www.instagram.com/reel/ABC/",
                    "comments_count": 4}])
            if path == "/media-1/comments":
                assert "from{id,username}" in params["fields"]
                comments = [
                    {"id": f"own-{i}", "from": {"username": "studio.jiiwon"}, "text": "DM 주세요"}
                    for i in range(3)
                ] + [{"id": "visitor-1", "from": {"username": "visitor"},
                    "text": "링크 주세요", "timestamp": "2026-09-26T01:00:00+0000"}]
                return iter(comments[:limit])
            return iter([])

    service = InstagramService()
    service._client = FakeGraph()
    result = service.sync(media_amount=1, comments_per_media=1, threads_amount=0)
    assert result["comments"] == 1
    assert db.get_event("comment:visitor-1")["author_username"] == "visitor"
    assert db.get_event("comment:own-0") is None


def test_sync_resolves_reply_author_when_list_omits_it(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"

        def pages(self, path, *, params, limit):
            if path == "/me/media":
                return iter([{"id": "media-1", "permalink": "https://www.instagram.com/reel/ABC/"}])
            if path == "/media-1/comments":
                return iter([{"id": "comment-1", "from": {"username": "visitor"},
                    "text": "링크 주세요", "replies": {"data": [{"id": "reply-1", "text": "DM 주세요"}]}}])
            return iter([])

        def request(self, method, path, *, params):
            assert method == "GET" and path == "/reply-1"
            return {"id": "reply-1", "from": {"username": "studio.jiiwon"}}

    service = InstagramService()
    service._client = FakeGraph()
    result = service.sync(media_amount=1, comments_per_media=1, threads_amount=0)
    assert result["comment_replies"] == 1
    assert db.get_event("comment:comment-1")["status"] == "sent"
    assert db.get_event("comment:reply-1")["author_username"] == "studio.jiiwon"
