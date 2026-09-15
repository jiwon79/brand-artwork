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
