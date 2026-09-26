from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import UTC, datetime, timedelta
from typing import Any, Iterator
from urllib.parse import urlencode

import httpx

from .config import paths, prepare_data_dir
from .db import (add_delivery, get_event, get_settings, list_artworks, save_artwork,
                 sent_today_count, update_event, update_settings, upsert_event)

GRAPH_BASE = "https://graph.instagram.com/" + os.getenv("INSTAGRAM_GRAPH_VERSION", "v25.0")
SCOPES = "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages"
HALT_CODES = {4, 17, 32, 368, 613}


class InstagramAssistantError(RuntimeError):
    pass


class InstagramHaltedError(InstagramAssistantError):
    pass


class GraphClient:
    def __init__(self, token: str, account_id: str, username: str) -> None:
        self.token, self.account_id, self.username = token, account_id, username

    def request(self, method: str, path: str, *, params: dict | None = None,
                data: dict | None = None, json_body: dict | None = None) -> dict:
        if not path.startswith("/") or "//" in path or ".." in path:
            raise InstagramAssistantError("잘못된 Graph API 경로입니다.")
        try:
            with httpx.Client(timeout=20) as http:
                response = http.request(method, GRAPH_BASE + path,
                    headers={"Authorization": f"Bearer {self.token}"},
                    params=params, data=data, json=json_body)
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise InstagramAssistantError("Meta Graph API 응답을 확인하지 못했습니다.") from exc
        if not isinstance(payload, dict):
            raise InstagramAssistantError("Meta Graph API 응답 형식이 올바르지 않습니다.")
        if response.is_error or "error" in payload:
            error = payload.get("error") or {}
            code = error.get("code")
            message = str(error.get("message") or "요청이 거절되었습니다.")[:300]
            message = message.replace(self.token, "[redacted]") if self.token else message
            if code in HALT_CODES:
                raise InstagramHaltedError(f"Meta API 제한 ({code}): {message}")
            raise InstagramAssistantError(f"Meta API 오류 ({code or response.status_code}): {message}")
        return payload

    def pages(self, path: str, *, params: dict | None = None, limit: int = 50) -> Iterator[dict]:
        query = dict(params or {})
        seen: set[str] = set()
        count = 0
        while count < limit:
            result = self.request("GET", path, params=query)
            for item in result.get("data") or []:
                if isinstance(item, dict):
                    yield item
                    count += 1
                    if count >= limit:
                        return
            paging = result.get("paging") or {}
            after = (paging.get("cursors") or {}).get("after")
            if not paging.get("next") or not after or after in seen:
                return
            seen.add(after)
            query["after"] = after


class InstagramService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._client: GraphClient | None = None

    @property
    def connected(self) -> bool:
        return self._client is not None

    @staticmethod
    def _oauth_config() -> tuple[str, str, str]:
        values = (os.getenv("INSTAGRAM_APP_ID", ""),
                  os.getenv("INSTAGRAM_APP_SECRET", ""),
                  os.getenv("INSTAGRAM_REDIRECT_URI", ""))
        if not all(values):
            raise InstagramAssistantError("Meta 앱의 INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI를 설정하세요.")
        return values

    def authorization_url(self) -> str:
        app_id, _, redirect_uri = self._oauth_config()
        prepare_data_dir()
        state = secrets.token_urlsafe(32)
        paths.oauth_state.write_text(json.dumps({"state": state,
            "created_at": datetime.now(UTC).isoformat()}))
        paths.oauth_state.chmod(0o600)
        return "https://www.instagram.com/oauth/authorize?" + urlencode({
            "client_id": app_id, "redirect_uri": redirect_uri,
            "response_type": "code", "scope": SCOPES,
            "enable_fb_login": "0", "state": state})

    def complete_oauth(self, code: str, state: str) -> dict[str, str]:
        with self._lock:
            app_id, secret, redirect_uri = self._oauth_config()
            try:
                saved = json.loads(paths.oauth_state.read_text())
                created = datetime.fromisoformat(saved["created_at"])
            except (OSError, ValueError, KeyError) as exc:
                raise InstagramAssistantError("Instagram 연결 요청이 만료되었습니다.") from exc
            paths.oauth_state.unlink(missing_ok=True)
            if (not secrets.compare_digest(str(saved["state"]), state)
                    or datetime.now(UTC) - created > timedelta(minutes=10)):
                raise InstagramAssistantError("Instagram 연결 요청이 만료되었습니다.")
            try:
                with httpx.Client(timeout=20) as http:
                    response = http.post("https://api.instagram.com/oauth/access_token", data={
                        "client_id": app_id, "client_secret": secret,
                        "grant_type": "authorization_code", "redirect_uri": redirect_uri,
                        "code": code})
                    response.raise_for_status()
                    short_token = response.json()["access_token"]
                    response = http.get("https://graph.instagram.com/access_token", params={
                        "grant_type": "ig_exchange_token", "client_secret": secret,
                        "access_token": short_token})
                    response.raise_for_status()
                    long_token = response.json()
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                raise InstagramAssistantError("Meta 인증 토큰 교환에 실패했습니다.") from exc
            token = str(long_token["access_token"])
            profile = GraphClient(token, "", "").request("GET", "/me", params={"fields": "id,username"})
            account_id, username = str(profile["id"]), str(profile["username"])
            self._save_token(token, account_id, username, int(long_token.get("expires_in", 0)))
            self._client = GraphClient(token, account_id, username)
            update_settings({"instagram_account_id": account_id, "instagram_username": username,
                "read_only_observation": True, "auto_send": False,
                "auto_comment": False, "auto_dm": False,
                "dm_backfill_complete": False, "dm_requests_backfill_complete": False,
                "halted_reason": None})
            return {"username": username, "user_id": account_id}

    @staticmethod
    def _save_token(token: str, account_id: str, username: str, expires_in: int) -> None:
        prepare_data_dir()
        paths.session.write_text(json.dumps({"access_token": token,
            "account_id": account_id, "username": username,
            "expires_at": (datetime.now(UTC) + timedelta(seconds=expires_in)).isoformat()}))
        paths.session.chmod(0o600)

    def connect_saved_session(self) -> GraphClient:
        with self._lock:
            if self._client:
                if not isinstance(self._client, GraphClient):
                    return self._client
                try:
                    saved_expiry = json.loads(paths.session.read_text())["expires_at"]
                    if datetime.fromisoformat(saved_expiry) > datetime.now(UTC) + timedelta(days=7):
                        return self._client
                except (OSError, ValueError, KeyError):
                    self._client = None
            try:
                saved = json.loads(paths.session.read_text())
                if datetime.fromisoformat(saved["expires_at"]) <= datetime.now(UTC) + timedelta(days=7):
                    with httpx.Client(timeout=20) as http:
                        response = http.get("https://graph.instagram.com/refresh_access_token", params={
                            "grant_type": "ig_refresh_token", "access_token": saved["access_token"]})
                        response.raise_for_status()
                        refreshed = response.json()
                    saved["access_token"] = refreshed["access_token"]
                    self._save_token(saved["access_token"], saved["account_id"],
                                     saved["username"], int(refreshed["expires_in"]))
            except (OSError, ValueError, KeyError, httpx.HTTPError) as exc:
                raise InstagramAssistantError("공식 Meta 연결이 없거나 만료되었습니다. 설정에서 다시 연결하세요.") from exc
            self._client = GraphClient(saved["access_token"], saved["account_id"], saved["username"])
            return self._client

    def logout(self) -> None:
        with self._lock:
            self._client = None
            paths.session.unlink(missing_ok=True)
            paths.oauth_state.unlink(missing_ok=True)
            update_settings({"instagram_account_id": "", "instagram_username": "",
                "read_only_observation": True, "auto_send": False,
                "auto_comment": False, "auto_dm": False, "halted_reason": None})

    @staticmethod
    def _timestamp(value: Any) -> str:
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC).isoformat()
            except ValueError:
                pass
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _canonical_url(value: str) -> str:
        match = re.search(r"instagram\.com/(reel|p)/([^/?#]+)", value)
        return f"https://www.instagram.com/{match.group(1)}/{match.group(2)}/" if match else value

    @staticmethod
    def _comment_username(comment: dict[str, Any]) -> str:
        return str(comment.get("username") or (comment.get("from") or {}).get("username") or "")

    def sync(self, media_amount: int = 12, comments_per_media: int = 50,
             threads_amount: int = 30) -> dict[str, Any]:
        with self._lock:
            client = self.connect_saved_session()
            comments_count = replies_count = dm_count = 0
            try:
                artworks = {item.get("post_code"): item for item in list_artworks() if item.get("post_code")}
                for media in client.pages("/me/media", params={
                    "fields": "id,caption,permalink,media_product_type,timestamp,comments_count",
                    "limit": min(media_amount, 100)}, limit=media_amount):
                    if media.get("media_product_type") == "STORY":
                        continue
                    media_id = str(media["id"])
                    post_url = self._canonical_url(str(media.get("permalink") or ""))
                    match = re.search(r"instagram\.com/(?:reel|p)/([^/?#]+)", post_url)
                    code = match.group(1) if match else ""
                    caption = re.sub(r"\s+", " ", media.get("caption") or "").strip()[:160]
                    artwork = artworks.get(code)
                    if artwork and artwork.get("media_id") != media_id:
                        save_artwork({**artwork, "media_id": media_id})
                    seen_comments = imported_comments = 0
                    for comment in client.pages(f"/{media_id}/comments", params={
                        "fields": "id,text,username,from{id,username},timestamp,like_count,"
                                  "replies{id,text,username,from{id,username},timestamp}",
                        "limit": min(comments_per_media, 50)}, limit=min(comments_per_media * 4, 500)):
                        seen_comments += 1
                        username = self._comment_username(comment)
                        if not username or username.casefold() == client.username.casefold():
                            continue
                        imported_comments += 1
                        comment_id = str(comment["id"])
                        common = {"account_id": client.account_id, "kind": "comment",
                                  "media_id": media_id, "post_code": code,
                                  "post_url": post_url, "post_caption": caption}
                        comments_count += int(upsert_event({**common,
                            "id": f"comment:{comment_id}", "source_id": comment_id,
                            "author_username": username, "body": comment.get("text") or "",
                            "like_count": comment.get("like_count"),
                            "received_at": self._timestamp(comment.get("timestamp"))}))
                        for reply in (comment.get("replies") or {}).get("data") or []:
                            reply_username = self._comment_username(reply)
                            if not reply_username:
                                detail = client.request("GET", f"/{reply['id']}", params={
                                    "fields": "id,username,from{id,username}"})
                                reply_username = self._comment_username(detail)
                            outbound = reply_username.casefold() == client.username.casefold()
                            replies_count += int(upsert_event({**common,
                                "id": f"comment:{reply['id']}", "source_id": str(reply["id"]),
                                "parent_comment_id": comment_id,
                                "author_username": reply_username,
                                "direction": "outbound" if outbound else "inbound",
                                "body": reply.get("text") or "",
                                "received_at": self._timestamp(reply.get("timestamp")),
                                "status": "history"}))
                            if outbound:
                                update_event(f"comment:{comment_id}", {"status": "sent", "error": None})
                        if imported_comments >= comments_per_media:
                            break
                    if int(media.get("comments_count") or 0) > 0 and not seen_comments:
                        raise InstagramAssistantError(
                            "게시물에 댓글이 있지만 공식 API가 빈 목록을 반환했습니다. "
                            "Meta 앱의 댓글 권한과 게시 상태를 확인하세요.")
                for conversation in client.pages("/me/conversations", params={
                    "platform": "instagram", "limit": min(threads_amount, 100)}, limit=threads_amount):
                    thread_id = str(conversation["id"])
                    detail = client.request("GET", f"/{thread_id}", params={
                        "fields": "messages{id,created_time,from,to,message}"})
                    for message in (detail.get("messages") or {}).get("data") or []:
                        sender = message.get("from") or {}
                        sender_id = str(sender.get("id") or "")
                        if not sender_id:
                            continue
                        outbound = sender_id == client.account_id
                        dm_count += int(upsert_event({
                            "id": f"dm:{message['id']}", "account_id": client.account_id,
                            "kind": "dm", "source_id": str(message["id"]), "thread_id": thread_id,
                            "author_id": sender_id,
                            "author_username": sender.get("username") or (client.username if outbound else ""),
                            "direction": "outbound" if outbound else "inbound",
                            "body": message.get("message") or "메시지 내용 없음",
                            "received_at": self._timestamp(message.get("created_time")),
                            "status": "history" if outbound else "pending"}))
            except InstagramHaltedError as exc:
                update_settings({"halted_reason": str(exc)[:500]})
                raise
            update_settings({"last_sync_at": datetime.now(UTC).isoformat()})
            return {"comments": comments_count, "comment_replies": replies_count,
                "dms": dm_count, "dm_full_sync": False,
                "dm_requests_full_sync": False}

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
            if event.get("account_id") != client.account_id:
                raise InstagramAssistantError("현재 연결 계정에서 수집한 항목이 아닙니다. 다시 동기화하세요.")
            action = event.get("proposed_action")
            if (action == "reply_comment" and event.get("kind") == "comment"
                    and event.get("direction") == "inbound" and not event.get("parent_comment_id")):
                path, payload = f"/{event['source_id']}/replies", {"message": event["draft"]}
            elif (action == "reply_dm" and event.get("kind") == "dm"
                  and event.get("direction") == "inbound" and event.get("author_id")):
                path = f"/{client.account_id}/messages"
                payload = {"recipient": {"id": event["author_id"]},
                           "message": {"text": event["draft"]}}
            else:
                raise InstagramAssistantError("공식 API로 전송할 수 없는 작업입니다.")
            if action == "reply_comment":
                existing = list(client.pages(f"/{event['source_id']}/replies", params={
                    "fields": "id,text,username,timestamp", "limit": 50}, limit=200))
                if any(str(reply.get("username") or "").casefold() == client.username.casefold()
                       for reply in existing):
                    update_event(event_id, {"status": "sent", "error": None})
                    raise InstagramAssistantError("원댓글에 이미 답글이 있습니다. 중복 발송하지 않았습니다.")
            try:
                if action == "reply_comment":
                    result = client.request("POST", path, data=payload)
                else:
                    result = client.request("POST", path, json_body=payload)
            except InstagramHaltedError as exc:
                update_settings({"halted_reason": str(exc)[:500]})
                add_delivery(event_id, action, event["draft"], "halted", error=str(exc))
                raise
            except InstagramAssistantError as exc:
                add_delivery(event_id, action, event["draft"], "uncertain", error=str(exc))
                update_event(event_id, {"status": "manual", "error": "전송 결과 불확실: " + str(exc)})
                raise
            remote_id = str(result.get("id") or result.get("message_id") or "")
            if action == "reply_comment":
                try:
                    replies = client.pages(f"/{event['source_id']}/replies", params={
                        "fields": "id,text,username,timestamp", "limit": 50}, limit=200)
                    verified = bool(remote_id) and any(str(item.get("id")) == remote_id for item in replies)
                except InstagramAssistantError:
                    verified = False
                if not verified:
                    add_delivery(event_id, action, event["draft"], "uncertain", remote_id or None)
                    update_event(event_id, {"status": "manual", "error": "원댓글 연결 확인 실패"})
                    raise InstagramAssistantError("발송 여부가 불확실합니다. 중복 전송 전에 원댓글을 확인하세요.")
            elif not remote_id:
                add_delivery(event_id, action, event["draft"], "uncertain")
                update_event(event_id, {"status": "manual", "error": "발송 ID 없음"})
                raise InstagramAssistantError("발송 ID가 없어 결과가 불확실합니다. 중복 전송 전에 DM을 확인하세요.")
            add_delivery(event_id, action, event["draft"], "sent", remote_id)
            return update_event(event_id, {"status": "sent", "error": None}) or event

instagram_service = InstagramService()
