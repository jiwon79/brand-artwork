from app.rules import classify


ARTWORKS = [{
    "slug": "line-pull",
    "title": "Line Pull",
    "post_code": "Dc8RsObTqfn",
    "media_id": "123_456",
    "demo_url": "https://studio.jiiwon.com/line-pull",
    "purchase_url": "https://litt.ly/jiiwon",
    "product_status": "available",
}]


def event(kind: str, body: str, **extra):
    return {"kind": kind, "body": body, **extra}


def test_interest_comment_moves_to_dm():
    result = classify(event("comment", "저요!", post_code="Dc8RsObTqfn"), ARTWORKS, "https://litt.ly/jiiwon")
    assert result.action == "reply_comment"
    assert "디엠" in result.draft
    assert result.confidence >= 0.96


def test_praise_is_ignored():
    result = classify(event("comment", "진짜 잘 만들었어요 ❤️"), ARTWORKS, "https://litt.ly/jiiwon")
    assert result.status == "ignored"


def test_known_artwork_dm_returns_demo_and_soft_purchase_prompt():
    result = classify(event("dm", "링크 주세요", shared_url="https://instagram.com/reel/Dc8RsObTqfn/"), ARTWORKS, "https://litt.ly/jiiwon")
    assert result.action == "reply_dm"
    assert ARTWORKS[0]["demo_url"] in result.draft
    assert "구매 방법" in result.draft


def test_purchase_intent_returns_profile_link():
    result = classify(event("dm", "구매하고 싶어요", post_code="Dc8RsObTqfn"), ARTWORKS, "https://litt.ly/jiiwon")
    assert result.action == "reply_dm"
    assert "https://litt.ly/jiiwon" in result.draft


def test_ambiguous_dm_asks_for_artwork():
    result = classify(event("dm", "링크 보내주세요"), ARTWORKS, "https://litt.ly/jiiwon")
    assert result.intent == "ambiguous_link_request"
    assert result.confidence < 0.96
