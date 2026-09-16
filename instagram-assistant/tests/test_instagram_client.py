from types import SimpleNamespace

from app import instagram_client
from app.instagram_client import InstagramService


def test_shared_url_reads_current_xma_video_url():
    message = SimpleNamespace(
        xma_share=SimpleNamespace(
            video_url="https://www.instagram.com/reel/Dc8RsObTqfn/?id=123"
        ),
        generic_xma=[],
    )
    assert InstagramService._shared_url(message) == (
        "https://www.instagram.com/reel/Dc8RsObTqfn/"
    )


def test_shared_url_falls_back_to_raw_xma():
    message = SimpleNamespace(
        xma_share=None,
        generic_xma=[],
        media_share=None,
        clip=None,
        reel_share=None,
        raw_xma={
            "xma_clip": [{"target_url": "https://www.instagram.com/reel/ABC/?tracking=1"}]
        },
    )
    assert InstagramService._shared_url(message) == "https://www.instagram.com/reel/ABC/"


def test_comment_like_updates_local_state(monkeypatch):
    event = {
        "id": "comment:1", "kind": "comment", "source_id": "1",
        "like_count": 2,
    }
    client = SimpleNamespace(comment_like=lambda comment_id: comment_id == 1)
    service = InstagramService()
    service._client = client
    monkeypatch.setattr(instagram_client, "get_event", lambda event_id: event)
    monkeypatch.setattr(
        instagram_client,
        "get_settings",
        lambda: {"read_only_observation": False, "halted_reason": None},
    )
    monkeypatch.setattr(instagram_client, "add_delivery", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        instagram_client,
        "update_event",
        lambda event_id, values: {**event, **values},
    )
    updated = service.set_comment_like("comment:1", True)
    assert updated["has_liked"] is True
    assert updated["like_count"] == 3


def test_direct_message_like_updates_local_state(monkeypatch):
    event = {
        "id": "dm:1", "kind": "dm", "source_id": "1", "thread_id": "2",
        "like_count": 0,
    }
    client = SimpleNamespace(
        direct_message_like=lambda thread_id, message_id: (thread_id, message_id) == (2, 1)
    )
    service = InstagramService()
    service._client = client
    monkeypatch.setattr(instagram_client, "get_event", lambda event_id: event)
    monkeypatch.setattr(
        instagram_client,
        "get_settings",
        lambda: {"read_only_observation": False, "halted_reason": None},
    )
    monkeypatch.setattr(instagram_client, "add_delivery", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        instagram_client,
        "update_event",
        lambda event_id, values: {**event, **values},
    )
    updated = service.set_direct_message_like("dm:1", True)
    assert updated["has_liked"] is True
    assert updated["like_count"] == 1


def test_direct_heart_state_reads_viewer_and_other_reactions():
    message = SimpleNamespace(reactions=SimpleNamespace(
        emojis=[
            SimpleNamespace(sender_id=10, emoji="❤"),
            SimpleNamespace(sender_id=20, emoji="❤️"),
            SimpleNamespace(sender_id=30, emoji="😂"),
        ],
        likes=[],
        likes_count=0,
    ))
    assert InstagramService._direct_heart_state(message, "10") == (True, 2)


def test_media_comments_collect_preview_replies(monkeypatch):
    parent = SimpleNamespace(pk="1")
    reply = SimpleNamespace(pk="2")

    class FakeClient:
        last_json = {}

        def media_comments_v1_chunk(self, media_id, min_id="", max_id=""):
            self.last_json = {
                "comments": [{
                    "pk": "1",
                    "child_comment_count": 1,
                    "preview_child_comments": [{"pk": "2"}],
                }],
                "has_more_comments": False,
                "has_more_headload_comments": False,
            }
            return [parent], "", ""

    monkeypatch.setattr(instagram_client, "extract_comment", lambda item: reply)
    results = InstagramService._media_comments_with_replies(FakeClient(), "media-1", 50)
    assert results == [(parent, [reply])]


def test_media_url_uses_reel_route_for_clips():
    media = SimpleNamespace(code="ABC", product_type="clips")
    assert InstagramService._media_url(media) == "https://www.instagram.com/reel/ABC/"


def test_action_logs_are_not_stored_as_direct_messages():
    assert InstagramService._should_store_direct_message(
        SimpleNamespace(item_type="action_log")
    ) is False
    assert InstagramService._should_store_direct_message(
        SimpleNamespace(item_type="text")
    ) is True


def test_direct_message_body_labels_non_text_items():
    assert InstagramService._direct_message_body(
        SimpleNamespace(text="", item_type="video_call_event"), None
    ) == "영상 통화 기록"
    assert InstagramService._direct_message_body(
        SimpleNamespace(text="", item_type="media"), None
    ) == "사진 또는 동영상"
    assert InstagramService._direct_message_body(
        SimpleNamespace(text="", item_type="clip"), "https://example.com/reel/ABC/"
    ) == "공유된 게시물"


def test_full_dm_sync_fetches_every_thread_and_message():
    thread = SimpleNamespace(id="101", messages=["preview"])
    request_thread = SimpleNamespace(id="202", messages=["request-preview"])

    class FakeClient:
        def __init__(self):
            self.thread_calls = []
            self.message_calls = []
            self.pending_calls = []

        def direct_threads(self, **kwargs):
            self.thread_calls.append(kwargs)
            return [thread]

        def direct_messages(self, thread_id, amount):
            self.message_calls.append((thread_id, amount))
            return ["one", "two"]

        def direct_pending_inbox(self, amount):
            self.pending_calls.append(amount)
            return [request_thread]

    client = FakeClient()
    results = list(InstagramService._direct_thread_messages(
        client, True, 30, full_request_history=True
    ))
    assert results == [
        (thread, ["one", "two"]),
        (request_thread, ["one", "two"]),
    ]
    assert client.thread_calls == [
        {"amount": 0, "thread_message_limit": 1},
        {"amount": 0, "thread_message_limit": 1, "box": "primary"},
        {"amount": 0, "thread_message_limit": 1, "box": "general"},
    ]
    assert client.pending_calls == [0]
    assert client.message_calls == [(101, 0), (202, 0)]


def test_incremental_dm_sync_only_uses_recent_thread_messages():
    thread = SimpleNamespace(id="101", messages=["recent"])
    request_thread = SimpleNamespace(id="202", messages=["recent-request"])

    class FakeClient:
        def __init__(self):
            self.thread_calls = []
            self.pending_calls = []

        def direct_threads(self, **kwargs):
            self.thread_calls.append(kwargs)
            return [thread]

        def direct_pending_inbox(self, amount):
            self.pending_calls.append(amount)
            return [request_thread]

    client = FakeClient()
    results = list(InstagramService._direct_thread_messages(client, False, 30))
    assert results == [
        (thread, ["recent"]),
        (request_thread, ["recent-request"]),
    ]
    assert all(call["amount"] == 30 for call in client.thread_calls)
    assert all(call["thread_message_limit"] == 20 for call in client.thread_calls)
    assert client.pending_calls == [30]
