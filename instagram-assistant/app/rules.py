from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


REACTION_ONLY = re.compile(r"^[\s\W_]*$", re.UNICODE)
INTEREST = re.compile(r"(저요|해\s*보고\s*싶|체험|궁금|링크|보내\s*주세요|써\s*보고\s*싶)", re.I)
BUILD = re.compile(r"(만들|제작|방법|강의|자료|코드|소스|프롬프트|튜토리얼|따라\s*해)", re.I)
PURCHASE = re.compile(r"(구매|결제|가격|얼마|사고\s*싶|어디서\s*사|판매)", re.I)
THANKS = re.compile(r"^(감사(합니다|해요|해|용)?|고맙(습니다|워요|워)?|확인(했습니다|했어요)?|넵+|네+)[!~.\sㅎㅋ❤️❤]*$", re.I)
PRAISE = re.compile(r"(멋져|예뻐|잘\s*만|대박|신기|최고|쩐다|좋네요|귀여)", re.I)


@dataclass(frozen=True)
class Decision:
    intent: str
    action: str
    confidence: float
    draft: str
    artwork_slug: str | None = None
    status: str = "drafted"

    def as_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "proposed_action": self.action,
            "confidence": self.confidence,
            "draft": self.draft,
            "artwork_slug": self.artwork_slug,
            "status": self.status,
        }


def _compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _artwork_for_event(event: dict[str, Any], artworks: list[dict[str, Any]]) -> dict[str, Any] | None:
    media_id = str(event.get("media_id") or "")
    post_code = str(event.get("post_code") or "")
    shared_url = str(event.get("shared_url") or "")
    for artwork in artworks:
        if media_id and media_id == str(artwork.get("media_id") or ""):
            return artwork
        if post_code and post_code == str(artwork.get("post_code") or ""):
            return artwork
        if artwork.get("post_code") and f"/{artwork['post_code']}/" in shared_url:
            return artwork
    return None


def classify(event: dict[str, Any], artworks: list[dict[str, Any]], profile_url: str) -> Decision:
    body = _compact(event.get("body", ""))
    artwork = _artwork_for_event(event, artworks)
    artwork_slug = artwork["slug"] if artwork else None

    if not body or REACTION_ONLY.fullmatch(body) or THANKS.fullmatch(body):
        return Decision("reaction_or_close", "ignore", 0.99, "", artwork_slug, "ignored")

    if event["kind"] == "comment":
        if PRAISE.search(body):
            return Decision("praise", "ignore", 0.94, "", artwork_slug, "ignored")
        if BUILD.search(body):
            return Decision(
                "build_interest",
                "reply_comment",
                0.96,
                "디엠 주시면 체험 링크와 제작 자료 안내드릴게요!",
                artwork_slug,
            )
        if INTEREST.search(body):
            return Decision(
                "demo_interest",
                "reply_comment",
                0.97,
                "디엠 주시면 체험 링크 드릴게요!",
                artwork_slug,
            )
        return Decision("needs_review", "manual_review", 0.45, "", artwork_slug, "manual")

    if PURCHASE.search(body):
        title = artwork["title"] if artwork else "제작 자료"
        destination = (artwork or {}).get("purchase_url") or profile_url
        draft = (
            f"{title}는 프로필 링크에서 구매하실 수 있어요!!\n"
            f"{destination}\n"
            "추가로 궁금한 점 있으시면 편하게 디엠 주세요ㅎㅎ"
        )
        return Decision("purchase_intent", "reply_dm", 0.98, draft, artwork_slug)

    if artwork and (INTEREST.search(body) or event.get("shared_url")):
        demo_url = artwork.get("demo_url", "")
        availability = artwork.get("product_status") == "available"
        extra = (
            "직접 따라 만드는 자료도 준비되어 있어서, 필요하시면 구매 방법도 안내드릴게요ㅎㅎ"
            if availability
            else "직접 따라 만드는 자료는 현재 준비 중이에요. 완성되면 안내드릴게요ㅎㅎ"
        )
        return Decision(
            "demo_link_request",
            "reply_dm",
            0.97,
            f"요청하신 {artwork['title']} 체험 링크예요!\n{demo_url}\n{extra}",
            artwork_slug,
        )

    if BUILD.search(body):
        return Decision(
            "ambiguous_build_interest",
            "reply_dm",
            0.82,
            "체험 링크를 원하시는 걸까요, 직접 만드는 방법을 원하시는 걸까요?",
            artwork_slug,
        )

    if INTEREST.search(body):
        return Decision(
            "ambiguous_link_request",
            "reply_dm",
            0.78,
            "어떤 작품의 체험 링크가 필요하신지 알려주실 수 있을까요?",
            artwork_slug,
        )

    return Decision("needs_review", "manual_review", 0.4, "", artwork_slug, "manual")
