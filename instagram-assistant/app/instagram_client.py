from __future__ import annotations

import json
import os
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from instagrapi import Client
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
            inserted_dms = 0
            try:
                medias = client.user_medias(client.user_id, amount=media_amount)
                artwork_by_code = {
                    item.get("post_code"): item for item in list_artworks() if item.get("post_code")
                }
                for media in medias:
                    code = getattr(media, "code", None)
                    artwork = artwork_by_code.get(code)
                    if artwork and not artwork.get("media_id"):
                        artwork["media_id"] = str(media.id)
                        save_artwork(artwork)
                    for comment in client.media_comments(media.id, amount=comments_per_media):
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
                            "author_id": user_id,
                            "author_username": getattr(user, "username", "") or "",
                            "body": getattr(comment, "text", "") or "",
                            "received_at": self._timestamp(created_at),
                        }))

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
                            if not user_id or user_id == str(client.user_id):
                                continue
                            shared_url = self._shared_url(message)
                            inserted_dms += int(upsert_event({
                                "id": f"dm:{message.id}",
                                "kind": "dm",
                                "source_id": str(message.id),
                                "thread_id": thread_id,
                                "shared_url": shared_url,
                                "author_id": user_id,
                                "author_username": usernames.get(user_id, ""),
                                "body": getattr(message, "text", "") or ("공유된 게시물" if shared_url else ""),
                                "received_at": self._timestamp(getattr(message, "timestamp", None)),
                            }))
            except STOP_EXCEPTIONS as exc:
                self._halt(str(exc))
                raise InstagramHaltedError(str(exc)) from exc
            update_settings({"last_sync_at": datetime.now(UTC).isoformat()})
            return {"comments": inserted_comments, "dms": inserted_dms}

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
                return share.get("target_url") or share.get("url")
            return getattr(share, "target_url", None) or getattr(share, "url", None)
        for name in ("media_share", "clip", "reel_share"):
            value = getattr(message, name, None)
            code = getattr(value, "code", None) if value else None
            if code:
                return f"https://www.instagram.com/reel/{code}/"
        return None

    @staticmethod
    def _halt(reason: str) -> None:
        update_settings({"halted_reason": reason[:500]})


instagram_service = InstagramService()
