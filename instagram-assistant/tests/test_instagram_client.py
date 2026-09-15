from types import SimpleNamespace

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
