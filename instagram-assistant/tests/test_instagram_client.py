import json
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pytest

from app import config, db, instagram_client
from app.instagram_client import GraphClient, InstagramAssistantError, InstagramService, MetaApiError


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


def test_graph_error_keeps_meta_trace_without_exposing_token(monkeypatch):
    original_client = httpx.Client
    monkeypatch.setattr(instagram_client.httpx, "Client", lambda **kwargs: original_client(
        transport=httpx.MockTransport(lambda _: httpx.Response(500, json={"error": {
            "code": 2, "message": "private-token failed", "is_transient": True,
            "fbtrace_id": "trace-123"}})), **kwargs))
    with pytest.raises(InstagramAssistantError, match="transient=True, trace=trace-123") as exc:
        GraphClient("private-token", "ig-1", "studio.jiiwon").request("POST", "/me/messages")
    assert "private-token" not in str(exc.value)


def test_graph_client_preserves_meta_status_and_subcode(monkeypatch):
    original_client = httpx.Client
    monkeypatch.setattr(instagram_client.httpx, "Client", lambda **kwargs: original_client(
        transport=httpx.MockTransport(lambda _: httpx.Response(400, json={"error": {
            "message": "Outside allowed window", "code": 10, "error_subcode": 2018278,
            "type": "OAuthException", "fbtrace_id": "trace-1"}})), **kwargs))
    with pytest.raises(MetaApiError) as caught:
        GraphClient("private-token", "ig-1", "studio.jiiwon").request(
            "POST", "/ig-1/messages", json_body={"message": {"text": "hello"}})
    assert caught.value.status == 400
    assert caught.value.subcode == 2018278
    assert "POST /ig-1/messages" in str(caught.value)
    assert "trace=trace-1" in str(caught.value)
    assert "private-token" not in str(caught.value)


def test_expired_meta_halt_does_not_block_new_actions(monkeypatch):
    updates = []
    monkeypatch.setattr(instagram_client, "update_settings", lambda values: updates.append(values))
    InstagramService._check_halt({"halted_reason": "rate limit",
                                  "full_sync_retry_after": "2020-01-01T00:00:00+00:00"})
    assert updates == [{"halted_reason": None}]
    with pytest.raises(instagram_client.InstagramHaltedError, match="rate limit"):
        InstagramService._check_halt({"halted_reason": "rate limit",
                                      "full_sync_retry_after": "2099-01-01T00:00:00+00:00"})


def test_dm_batch_sync_targets_only_selected_threads_and_reports_stale_ids(monkeypatch):
    service = InstagramService()
    monkeypatch.setattr(service, "connect_saved_session", lambda: SimpleNamespace(account_id="ig-1"))
    events = {
        "dm:one": {"id": "dm:one", "kind": "dm", "direction": "inbound",
                   "account_id": "ig-1", "thread_id": "thread-1", "author_username": "first",
                   "received_at": "2026-09-30T01:00:00+00:00", "status": "pending"},
        "dm:two": {"id": "dm:two", "kind": "dm", "direction": "inbound",
                   "account_id": "ig-1", "thread_id": "thread-2", "author_username": "second",
                   "received_at": "2026-09-30T01:00:00+00:00", "status": "pending"},
    }
    monkeypatch.setattr(instagram_client, "get_event", events.get)
    monkeypatch.setattr(instagram_client, "list_conversation_messages", lambda thread: (
        [{"id": "dm:one", "direction": "inbound", "received_at": "2026-09-30T01:00:00+00:00"}]
        if thread == "thread-1" else
        [{"id": "dm:two", "direction": "inbound", "received_at": "2026-09-30T01:00:00+00:00"},
         {"id": "dm:new", "direction": "inbound", "received_at": "2026-09-30T02:00:00+00:00"}]))
    calls = []
    monkeypatch.setattr(service, "sync", lambda **kwargs: calls.append(kwargs) or
                        {"dm_threads_checked": 2})
    result = service.sync_dm_batch([("dm:one", "first"), ("dm:two", "second")])
    assert calls == [{"media_amount": 0, "conversation_items": [
        {"id": "thread-1"}, {"id": "thread-2"}]}]
    assert [item["ready_to_send"] for item in result["targets"]] == [True, False]
    with pytest.raises(InstagramAssistantError, match="일치하지 않습니다"):
        service.sync_dm_batch([("dm:one", "wrong")])
    assert len(calls) == 1


def test_graph_pages_stop_when_meta_has_no_next_page(monkeypatch):
    client = GraphClient("token", "ig-1", "studio.jiiwon")
    calls = []

    def request(method, path, *, params):
        calls.append(dict(params))
        return {"data": [{"id": "comment-1"}], "paging": {"cursors": {"after": "last"}}}

    monkeypatch.setattr(client, "request", request)
    assert list(client.pages("/media-1/comments", limit=10)) == [{"id": "comment-1"}]
    assert len(calls) == 1


def test_manual_conversation_pages_stop_after_budget_when_meta_returns_empty_pages(monkeypatch):
    client = GraphClient("token", "ig-1", "studio.jiiwon")
    calls = []

    def request(method, path, *, params):
        calls.append(dict(params))
        return {"data": [], "paging": {"next": "https://example.com/next",
                                      "cursors": {"after": f"cursor-{len(calls)}"}}}

    monkeypatch.setattr(client, "request", request)
    assert list(client.pages("/me/conversations", params={"limit": 1}, limit=1)) == []
    assert len(calls) == 1
    calls.clear()
    assert list(client.pages("/me/conversations", params={"limit": 100}, limit=100)) == []
    assert len(calls) == 10


def test_nested_pages_continue_after_initial_dm_page(monkeypatch):
    client = GraphClient("token", "ig-1", "studio.jiiwon")
    calls = []

    def request(method, path, *, params):
        calls.append((path, dict(params)))
        return {"data": [{"id": "older"}], "paging": {}}

    monkeypatch.setattr(client, "request", request)
    initial = {"data": [{"id": "newest"}],
               "paging": {"next": "https://example.com/next", "cursors": {"after": "cursor"}}}
    assert [item["id"] for item in client.nested_pages(
        "/thread/messages", initial, fields="id,created_time")] == ["newest", "older"]
    assert calls == [("/thread/messages", {"fields": "id,created_time", "limit": 50,
                                           "after": "cursor"})]


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
        "halted_reason": None, "daily_send_limit": 0})
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


def test_meta_http_400_is_recorded_as_rejected_not_uncertain(monkeypatch):
    item = event(id="dm:message-1", kind="dm", source_id="message-1",
                 author_id="visitor-1", proposed_action="reply_dm", draft="안녕하세요")
    service, calls = setup_send(monkeypatch, item)

    def reject(method, path, **kwargs):
        raise MetaApiError(status=400, code=10, subcode=2018278,
            error_type="OAuthException", trace_id="trace-1", message="Outside allowed window",
            method=method, path=path)

    service._client = SimpleNamespace(account_id="ig-1", request=reject)
    with pytest.raises(MetaApiError):
        service.send_for_event(item["id"])
    assert any(call[0] == "delivery" and call[1][3] == "rejected" for call in calls)
    assert any(call[0] == "update" and "subcode=2018278" in call[1]["error"] for call in calls)
    assert any(call[0] == "delivery" and "POST /ig-1/messages" in call[2]["error"] for call in calls)


def test_old_account_event_cannot_be_sent(monkeypatch):
    item = event(account_id="different-account")
    service, _ = setup_send(monkeypatch, item)
    service._client = SimpleNamespace(account_id="ig-1")
    with pytest.raises(InstagramAssistantError, match="현재 연결 계정"):
        service.send_for_event(item["id"])


def test_dm_sequence_sends_exact_messages_once(tmp_path, monkeypatch):
    monkeypatch.setattr(config.paths, "database", tmp_path / "records.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.update_settings({"instagram_account_id": "ig-1"})
    db.upsert_event({"id": "dm:in-1", "account_id": "ig-1", "kind": "dm",
                     "source_id": "in-1", "thread_id": "thread-1", "author_id": "visitor-1",
                     "author_username": "recipient", "direction": "inbound", "body": "안녕하세요",
                     "received_at": "2026-09-28T00:00:00Z", "status": "pending"})
    for index in range(20):
        db.add_delivery("dm:in-1", "reply_dm", f"earlier-{index}", "sent", f"old-{index}")
    sent = []

    def post(method, path, **kwargs):
        sent.append(kwargs["json_body"]["message"]["text"])
        return {"id": f"out-{len(sent)}"}

    service = InstagramService()
    service._client = SimpleNamespace(account_id="ig-1", request=post)
    messages = ["첫 DM", "둘째 DM"]
    result = service.send_dm_sequence("dm:in-1", "recipient", messages)
    assert sent == messages
    assert [item["remote_id"] for item in result["messages"]] == ["out-1", "out-2"]
    assert db.get_event("dm:in-1")["status"] == "sent"
    assert service.send_dm_sequence("dm:in-1", "recipient", messages) == result
    assert sent == messages
    with pytest.raises(InstagramAssistantError, match="문구가 다릅니다"):
        service.send_dm_sequence("dm:in-1", "recipient", ["changed"])


def test_dm_heart_uses_official_reaction_and_records_success(monkeypatch):
    item = event(id="dm:message-1", kind="dm", source_id="message-1", author_id="visitor-1",
                 proposed_action=None, draft="")
    service, calls = setup_send(monkeypatch, item)
    requests = []
    def request(method, path, **kwargs):
        requests.append((method, path, kwargs))
        return {"recipient_id": "visitor-1"}
    service._client = SimpleNamespace(account_id="ig-1", request=request)
    result = service.heart_dm(item["id"])
    assert requests == [("POST", "/ig-1/messages", {"json_body": {
        "recipient": {"id": "visitor-1"}, "sender_action": "react",
        "payload": {"message_id": "message-1", "reaction": "love"}}})]
    assert result["has_liked"] is True
    assert ("update", {"has_liked": True, "own_reaction": "❤", "error": None}) in calls


def test_dm_heart_rejects_outbound_and_duplicate(monkeypatch):
    item = event(id="dm:message-1", kind="dm", source_id="message-1", author_id="visitor-1",
                 direction="outbound", proposed_action=None, draft="")
    service, _ = setup_send(monkeypatch, item)
    with pytest.raises(InstagramAssistantError, match="받은 DM"):
        service.heart_dm(item["id"])
    item["direction"] = "inbound"
    item["has_liked"] = True
    with pytest.raises(InstagramAssistantError, match="이미 하트"):
        service.heart_dm(item["id"])


def test_dm_heart_does_not_mark_unverified_response(monkeypatch):
    item = event(id="dm:message-1", kind="dm", source_id="message-1", author_id="visitor-1",
                 proposed_action=None, draft="")
    service, calls = setup_send(monkeypatch, item)
    service._client = SimpleNamespace(account_id="ig-1", request=lambda *args, **kwargs: {})
    with pytest.raises(InstagramAssistantError, match="결과를 확인"):
        service.heart_dm(item["id"])
    assert not any(call[0] == "update" for call in calls)


def test_graph_message_reactions_identify_both_participants():
    message = {"reactions": {"data": [
        {"emoji": "❤", "users": [{"id": "visitor-1", "username": "visitor"}]},
        {"emoji": "👍", "users": [{"id": "own-1", "username": "studio.jiiwon"}]},
    ]}}
    assert InstagramService._dm_reactions(message, "own-1", "studio.jiiwon") == ("👍", "❤")
    assert InstagramService._dm_reactions({}, "own-1", "studio.jiiwon") == (None, None)


def test_dm_sync_clears_reaction_when_graph_omits_empty_collection(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()
    db.upsert_event({"id": "dm:message-1", "account_id": "ig-1", "kind": "dm",
                     "source_id": "message-1", "thread_id": "thread-1",
                     "author_id": "visitor-id", "body": "test"})
    db.set_dm_reactions("dm:message-1", "❤", None)

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"

        def pages(self, path, *, params, limit):
            return iter([{"id": "thread-1"}]) if path == "/me/conversations" else iter([])

        def request(self, method, path, *, params):
            return {"participants": {"data": [
                {"id": "own-id", "username": "studio.jiiwon"},
                {"id": "visitor-id", "username": "visitor"}]},
                "messages": {"data": [{"id": "message-1", "from": {"id": "visitor-id"},
                    "message": "test", "created_time": "2026-09-28T01:00:00+0000"}]}}

    service = InstagramService()
    service._client = FakeGraph()
    service.sync(media_amount=0, threads_amount=1)
    assert db.get_event("dm:message-1")["own_reaction"] is None
    assert db.get_event("dm:message-1")["has_liked"] == 0


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


def test_dm_sync_fetches_changed_threads_and_can_target_one_user(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"
        updated = "2026-09-27T01:00:00+0000"
        detail_calls = 0
        list_params = None

        def pages(self, path, *, params, limit):
            if path == "/me/media":
                return iter([])
            assert path == "/me/conversations"
            self.list_params = params
            return iter([{"id": "thread-1", "updated_time": self.updated}])

        def request(self, method, path, *, params):
            assert method == "GET" and path == "/thread-1"
            self.detail_calls += 1
            return {"participants": {"data": [
                {"id": "own-id", "username": "studio.jiiwon"},
                {"id": "visitor-id", "username": "visitor"}]},
                "messages": {"data": [{"id": "message-1", "from": {"id": "visitor-id"},
                    "message": "안녕하세요", "created_time": "2026-09-27T01:00:00+0000"}]}}

    service = InstagramService()
    fake = FakeGraph()
    service._client = fake
    assert service.sync(media_amount=0)["dm_threads_checked"] == 1
    assert service.sync(media_amount=0)["dm_threads_skipped"] == 1
    assert fake.detail_calls == 1
    fake.updated = "2026-09-27T01:01:00+0000"
    assert service.sync(media_amount=0)["dm_threads_checked"] == 1
    assert fake.detail_calls == 2
    assert service.sync(media_amount=0, dm_user_id="123")["dm_threads_checked"] == 1
    assert fake.list_params["user_id"] == "123"
    assert fake.detail_calls == 3


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


def test_targeted_comment_fetches_parent_and_all_replies(monkeypatch, tmp_path):
    monkeypatch.setattr(config.paths, "database", tmp_path / "assistant.sqlite3")
    monkeypatch.setattr(config.paths, "data", tmp_path)
    db.initialize()

    class FakeGraph:
        account_id, username = "ig-1", "studio.jiiwon"

        def request(self, method, path, *, params):
            if path == "/22":
                return {"id": "22", "parent_id": "11", "username": "visitor2"}
            assert path == "/11"
            return {"id": "11", "username": "visitor", "text": "원댓글",
                "media": {"id": "99", "permalink": "https://www.instagram.com/reel/ABC/"}}

        def pages(self, path, *, params, limit):
            assert path == "/11/replies" and limit > 50
            return iter([{"id": "22", "username": "visitor2", "text": "다시 질문"},
                {"id": "23", "username": "studio.jiiwon", "text": "답장"}])

    service = InstagramService()
    service._client = FakeGraph()
    assert service.sync_comment_thread("22") == {"comments": 3}
    assert db.get_event("comment:22")["parent_comment_id"] == "11"
    assert db.get_event("comment:11")["status"] == "sent"
