from __future__ import annotations

import json
import os
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from instagrapi import Client
from instagrapi.extractors import extract_comment
from instagrapi.exceptions import (
    ChallengeRequired,
    FeedbackRequired,
    LoginRequired,
    PleaseWaitFewMinutes,
    RateLimitError,
    TwoFactorRequired,
)

from .config import paths, prepare_data_dir
from .db import (
    add_delivery,
    get_event,
    get_settings,
    list_artworks,
    save_artwork,
    sent_today_count,
    update_event,
    update_settings,
    upsert_event,
)


STOP_EXCEPTIONS = (
    ChallengeRequired,
    FeedbackRequired,
    PleaseWaitFewMinutes,
    RateLimitError,
)


class InstagramAssistantError(RuntimeError):
    pass


class InstagramHaltedError(InstagramAssistantError):
    pass


class InstagramService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._client: Client | None = None

    @property
    def connected(self) -> bool:
        return self._client is not None

    def login(self, username: str, password: str, verification_code: str = "") -> dict[str, Any]:
        with self._lock:
            client = Client()
            try:
                client.login(username, password, verification_code=verification_code or None)
                client.get_timeline_feed()
            except TwoFactorRequired as exc:
                raise InstagramAssistantError("2단계 인증 코드가 필요합니다.") from exc
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            client.dump_settings(paths.session)
            paths.session.chmod(0o600)
            self._client = client
            update_settings({"instagram_username": username, "halted_reason": None})
            return {"username": username, "user_id": str(client.user_id)}

    def connect_saved_session(self) -> Client:
        with self._lock:
            if self._client:
                return self._client
            if not paths.session.exists():
                raise LoginRequired("저장된 Instagram 세션이 없습니다.")
            settings = json.loads(paths.session.read_text())
            client = Client()
            client.set_settings(settings)
            session_id = self._extract_session_id(settings)
            if not session_id:
                raise LoginRequired("저장된 세션에서 sessionid를 찾을 수 없습니다.")
            try:
                client.login_by_sessionid(session_id)
                client.get_timeline_feed()
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            self._client = client
            return client

    def logout(self) -> None:
        with self._lock:
            self._client = None
            paths.session.unlink(missing_ok=True)
            update_settings({"instagram_username": "", "halted_reason": None})

    def sync(self, media_amount: int = 12, comments_per_media: int = 50, threads_amount: int = 30) -> dict[str, int]:
        with self._lock:
            client = self.connect_saved_session()
            inserted_comments = 0
            inserted_replies = 0
            inserted_dms = 0
            try:
                medias = client.user_medias(client.user_id, amount=media_amount)
                artwork_by_code = {
                    item.get("post_code"): item for item in list_artworks() if item.get("post_code")
                }
                for media in medias:
                    code = getattr(media, "code", None)
                    post_caption = re.sub(
                        r"\s+", " ", getattr(media, "caption_text", "") or ""
                    ).strip()[:160]
                    post_url = self._media_url(media)
                    artwork = artwork_by_code.get(code)
                    if artwork and not artwork.get("media_id"):
                        artwork["media_id"] = str(media.id)
                        save_artwork(artwork)
                    comments_with_replies = self._media_comments_with_replies(
                        client, str(media.id), comments_per_media
                    )
                    for comment, replies in comments_with_replies:
                        user = getattr(comment, "user", None)
                        user_id = str(getattr(user, "pk", "") or "")
                        if user_id == str(client.user_id):
                            continue
                        created_at = getattr(comment, "created_at_utc", None)
                        inserted_comments += int(upsert_event({
                            "id": f"comment:{comment.pk}",
                            "kind": "comment",
                            "source_id": str(comment.pk),
                            "media_id": str(media.id),
                            "post_code": code,
                            "post_url": post_url,
                            "post_caption": post_caption,
                            "author_id": user_id,
                            "author_username": getattr(user, "username", "") or "",
                            "has_liked": getattr(comment, "has_liked", None),
                            "like_count": getattr(comment, "like_count", None),
                            "body": getattr(comment, "text", "") or "",
                            "received_at": self._timestamp(created_at),
                        }))
                        has_own_reply = False
                        for reply in replies:
                            reply_user = getattr(reply, "user", None)
                            reply_user_id = str(getattr(reply_user, "pk", "") or "")
                            outbound = reply_user_id == str(client.user_id)
                            has_own_reply = has_own_reply or outbound
                            inserted_replies += int(upsert_event({
                                "id": f"comment:{reply.pk}",
                                "kind": "comment",
                                "source_id": str(reply.pk),
                                "parent_comment_id": str(comment.pk),
                                "media_id": str(media.id),
                                "post_code": code,
                                "post_url": post_url,
                                "post_caption": post_caption,
                                "author_id": reply_user_id,
                                "author_username": getattr(reply_user, "username", "") or "",
                                "direction": "outbound" if outbound else "inbound",
                                "has_liked": getattr(reply, "has_liked", None),
                                "like_count": getattr(reply, "like_count", None),
                                "body": getattr(reply, "text", "") or "",
                                "received_at": self._timestamp(
                                    getattr(reply, "created_at_utc", None)
                                ),
                                "status": "history",
                            }))
                        if has_own_reply:
                            update_event(
                                f"comment:{comment.pk}",
                                {"status": "sent", "error": None},
                            )

                thread_groups = [client.direct_threads(amount=threads_amount, thread_message_limit=20)]
                for box in ("primary", "general"):
                    try:
                        thread_groups.append(client.direct_threads(
                            amount=threads_amount,
                            box=box,
                            thread_message_limit=20,
                        ))
                    except STOP_EXCEPTIONS:
                        raise
                    except Exception:
                        pass
                seen_threads: set[str] = set()
                for threads in thread_groups:
                    for thread in threads:
                        thread_id = str(thread.id)
                        if thread_id in seen_threads:
                            continue
                        seen_threads.add(thread_id)
                        usernames = {
                            str(user.pk): user.username for user in getattr(thread, "users", [])
                        }
                        for message in getattr(thread, "messages", []):
                            user_id = str(getattr(message, "user_id", "") or "")
                            if not user_id:
                                continue
                            outbound = bool(getattr(message, "is_sent_by_viewer", False)) or user_id == str(client.user_id)
                            shared_url = self._shared_url(message)
                            has_liked, like_count = self._direct_heart_state(
                                message, str(client.user_id)
                            )
                            inserted_dms += int(upsert_event({
                                "id": f"dm:{message.id}",
                                "kind": "dm",
                                "source_id": str(message.id),
                                "thread_id": thread_id,
                                "shared_url": shared_url,
                                "author_id": user_id,
                                "author_username": (
                                    get_settings().get("instagram_username", "")
                                    if outbound else usernames.get(user_id, "")
                                ),
                                "direction": "outbound" if outbound else "inbound",
                                "has_liked": has_liked,
                                "like_count": like_count,
                                "body": getattr(message, "text", "") or ("공유된 게시물" if shared_url else ""),
                                "received_at": self._timestamp(getattr(message, "timestamp", None)),
                                "status": "history" if outbound else "pending",
                            }))
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            update_settings({"last_sync_at": datetime.now(UTC).isoformat()})
            return {
                "comments": inserted_comments,
                "comment_replies": inserted_replies,
                "dms": inserted_dms,
            }

    @staticmethod
    def _media_comments_with_replies(
        client: Client,
        media_id: str,
        amount: int,
    ) -> list[tuple[Any, list[Any]]]:
        results: list[tuple[Any, list[Any]]] = []
        seen: set[str] = set()
        min_id = ""
        max_id = ""
        while len(results) < amount:
            comments, next_min_id, next_max_id = client.media_comments_v1_chunk(
                media_id, min_id=min_id, max_id=max_id
            )
            page = getattr(client, "last_json", {}) or {}
            raw_by_id = {
                str(item.get("pk")): item
                for item in page.get("comments", [])
            }
            for comment in comments:
                comment_id = str(comment.pk)
                if comment_id in seen:
                    continue
                seen.add(comment_id)
                raw = raw_by_id.get(comment_id, {})
                replies = [
                    extract_comment(item)
                    for item in (raw.get("preview_child_comments") or [])
                ]
                reply_count = int(raw.get("child_comment_count") or len(replies))
                if reply_count > len(replies):
                    replies = client.media_comment_replies(media_id, comment_id, amount=0)
                results.append((comment, replies))
                if len(results) >= amount:
                    break

            if page.get("has_more_comments") and next_max_id and next_max_id != max_id:
                max_id, min_id = next_max_id, ""
            elif (
                page.get("has_more_headload_comments")
                and next_min_id
                and next_min_id != min_id
            ):
                min_id, max_id = next_min_id, ""
            else:
                break
        return results[:amount]

    @staticmethod
    def _media_url(media: Any) -> str:
        code = str(getattr(media, "code", "") or "")
        if not code:
            return ""
        route = "reel" if getattr(media, "product_type", "") == "clips" else "p"
        return f"https://www.instagram.com/{route}/{code}/"

    def send_for_event(self, event_id: str) -> dict[str, Any]:
        with self._lock:
            event = get_event(event_id)
            if not event:
                raise InstagramAssistantError("처리할 항목을 찾지 못했습니다.")
            if event["status"] == "sent":
                raise InstagramAssistantError("이미 전송한 항목입니다.")
            settings = get_settings()
            if settings.get("read_only_observation"):
                raise InstagramAssistantError("현재 관찰 모드입니다. 설정에서 먼저 해제하세요.")
            if settings.get("halted_reason"):
                raise InstagramHaltedError(str(settings["halted_reason"]))
            if sent_today_count() >= int(settings.get("daily_send_limit", 20)):
                raise InstagramAssistantError("오늘의 발송 한도에 도달했습니다.")
            if not event.get("draft"):
                raise InstagramAssistantError("전송할 답변 초안이 없습니다.")

            client = self.connect_saved_session()
            try:
                if event["proposed_action"] == "reply_comment":
                    result = client.media_comment(
                        event["media_id"],
                        event["draft"],
                        replied_to_comment_id=int(event["source_id"]),
                    )
                    remote_id = str(result.pk)
                elif event["proposed_action"] == "reply_dm":
                    result = client.direct_answer(int(event["thread_id"]), event["draft"])
                    remote_id = str(result.id)
                else:
                    raise InstagramAssistantError("자동 전송이 허용되지 않은 작업입니다.")
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                add_delivery(event_id, event["proposed_action"], event["draft"], "halted", error=str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            except Exception as exc:
                add_delivery(event_id, event["proposed_action"], event["draft"], "failed", error=str(exc))
                update_event(event_id, {"status": "failed", "error": str(exc)})
                raise
            add_delivery(event_id, event["proposed_action"], event["draft"], "sent", remote_id)
            return update_event(event_id, {"status": "sent", "error": None}) or event

    def set_comment_like(self, event_id: str, liked: bool) -> dict[str, Any]:
        with self._lock:
            event = get_event(event_id)
            if not event or event["kind"] != "comment":
                raise InstagramAssistantError("댓글 항목을 찾지 못했습니다.")
            settings = get_settings()
            if settings.get("read_only_observation"):
                raise InstagramAssistantError("현재 관찰 모드입니다. 설정에서 먼저 해제하세요.")
            if settings.get("halted_reason"):
                raise InstagramHaltedError(str(settings["halted_reason"]))
            client = self.connect_saved_session()
            action = "like_comment" if liked else "unlike_comment"
            try:
                success = (
                    client.comment_like(int(event["source_id"]))
                    if liked else client.comment_unlike(int(event["source_id"]))
                )
                if not success:
                    raise InstagramAssistantError("Instagram이 하트 변경을 확인하지 않았습니다.")
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                add_delivery(event_id, action, "", "halted", error=str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            except Exception as exc:
                add_delivery(event_id, action, "", "failed", error=str(exc))
                raise
            current_count = int(event.get("like_count") or 0)
            next_count = max(0, current_count + (1 if liked else -1))
            add_delivery(event_id, action, "", "sent")
            return update_event(event_id, {
                "has_liked": liked,
                "like_count": next_count,
                "error": None,
            }) or event

    def set_direct_message_like(self, event_id: str, liked: bool) -> dict[str, Any]:
        with self._lock:
            event = get_event(event_id)
            if not event or event["kind"] != "dm" or not event.get("thread_id"):
                raise InstagramAssistantError("DM 메시지를 찾지 못했습니다.")
            settings = get_settings()
            if settings.get("read_only_observation"):
                raise InstagramAssistantError("현재 관찰 모드입니다. 설정에서 먼저 해제하세요.")
            if settings.get("halted_reason"):
                raise InstagramHaltedError(str(settings["halted_reason"]))
            client = self.connect_saved_session()
            action = "like_direct_message" if liked else "unlike_direct_message"
            try:
                success = (
                    client.direct_message_like(
                        int(event["thread_id"]), int(event["source_id"])
                    )
                    if liked
                    else client.direct_message_unlike(
                        int(event["thread_id"]), int(event["source_id"])
                    )
                )
                if not success:
                    raise InstagramAssistantError("Instagram이 DM 하트 변경을 확인하지 않았습니다.")
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                add_delivery(event_id, action, "", "halted", error=str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            except Exception as exc:
                add_delivery(event_id, action, "", "failed", error=str(exc))
                raise
            current_count = int(event.get("like_count") or 0)
            next_count = max(0, current_count + (1 if liked else -1))
            add_delivery(event_id, action, "", "sent")
            return update_event(event_id, {
                "has_liked": liked,
                "like_count": next_count,
                "error": None,
            }) or event

    @staticmethod
    def _direct_heart_state(message: Any, viewer_id: str) -> tuple[bool, int]:
        reactions = getattr(message, "reactions", None)
        if not reactions:
            return False, 0

        def value(item: Any, key: str) -> Any:
            return item.get(key) if isinstance(item, dict) else getattr(item, key, None)

        heart_emojis = {"❤", "❤️", "♥", "♥️"}
        emojis = [
            item for item in (value(reactions, "emojis") or [])
            if str(value(item, "emoji") or "") in heart_emojis
        ]
        legacy_likes = value(reactions, "likes") or []
        heart_reactions = emojis or legacy_likes
        has_liked = any(
            str(value(item, "sender_id") or value(item, "user_id") or "") == viewer_id
            for item in heart_reactions
        )
        count = len(heart_reactions)
        if not emojis:
            count = max(count, int(value(reactions, "likes_count") or 0))
        return has_liked, count

    @staticmethod
    def _extract_session_id(settings: dict[str, Any]) -> str | None:
        authorization = settings.get("authorization_data") or {}
        if authorization.get("sessionid"):
            return str(authorization["sessionid"])
        cookies = settings.get("cookies") or []
        if isinstance(cookies, dict):
            return cookies.get("sessionid")
        for cookie in cookies:
            if isinstance(cookie, dict) and cookie.get("name") == "sessionid":
                return cookie.get("value")
        return None

    @staticmethod
    def _timestamp(value: Any) -> str:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=UTC)
            return value.astimezone(UTC).isoformat()
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _shared_url(message: Any) -> str | None:
        share = getattr(message, "xma_share", None)
        if share:
            if isinstance(share, dict):
                url = share.get("target_url") or share.get("url") or share.get("video_url")
            else:
                url = (
                    getattr(share, "target_url", None)
                    or getattr(share, "url", None)
                    or getattr(share, "video_url", None)
                )
            if url:
                return InstagramService._canonical_instagram_url(str(url))
        for item in getattr(message, "generic_xma", None) or []:
            url = getattr(item, "video_url", None)
            if url:
                return InstagramService._canonical_instagram_url(str(url))
        for name in ("media_share", "clip", "reel_share"):
            value = getattr(message, name, None)
            code = (
                getattr(value, "code", None)
                if value and not isinstance(value, dict)
                else (value or {}).get("code")
            )
            if code:
                return f"https://www.instagram.com/reel/{code}/"
        raw = getattr(message, "raw_xma", None) or {}
        for items in raw.values():
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get("target_url"):
                    return InstagramService._canonical_instagram_url(item["target_url"])
        return None

    @staticmethod
    def _canonical_instagram_url(url: str) -> str:
        match = re.search(r"instagram\.com/(reel|p)/([^/?#]+)", url)
        if match:
            return f"https://www.instagram.com/{match.group(1)}/{match.group(2)}/"
        return url

    @staticmethod
    def _halt(reason: str) -> None:
        update_settings({"halted_reason": reason[:500]})


instagram_service = InstagramService()
