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
