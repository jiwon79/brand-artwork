from __future__ import annotations

import os
import re
import secrets
import threading
from datetime import UTC, datetime, timedelta
from typing import Any, Iterator
from urllib.parse import urlencode

import httpx

from .config import paths, prepare_data_dir
from .meta_config import get_meta_config
from .token_store import (delete_oauth_state, delete_token, load_and_delete_oauth_state,
                          load_token, save_oauth_state, save_token)
from .db import (add_delivery, claim_dm_send_item, create_dm_send_items, dm_send_items,
                 finish_dm_send_item, get_dm_sync_state, get_event, get_settings, list_artworks,
                 list_conversation_messages, mark_comment_reviewed, reconcile_own_dm_messages,
                 reconcile_pending_dm_reactions, save_artwork, save_dm_sync_state,
                 set_dm_reactions, update_event, update_settings, upsert_event)

GRAPH_BASE = "https://graph.instagram.com/" + os.getenv("INSTAGRAM_GRAPH_VERSION", "v25.0")
SCOPES = "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages"
HALT_CODES = {4, 17, 32, 368, 613}


class InstagramAssistantError(RuntimeError):
    pass


class InstagramHaltedError(InstagramAssistantError):
    pass


class MetaApiError(InstagramAssistantError):
    def __init__(self, *, status: int, code: Any, subcode: Any,
                 error_type: Any, trace_id: Any, message: str, method: str, path: str) -> None:
        self.status = status
        self.code = code
        self.subcode = subcode
        self.trace_id = trace_id
        details = [f"HTTP {status}", f"code={code or 'unknown'}"]
        if subcode is not None:
            details.append(f"subcode={subcode}")
        if error_type:
            details.append(f"type={error_type}")
        if trace_id:
            details.append(f"trace={trace_id}")
        super().__init__(f"Meta API 거절 ({', '.join(details)}; {method} {path}): {message}")


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
            if not isinstance(error, dict):
                error = {"message": str(error)}
            code = error.get("code")
            message = str(error.get("message") or "요청이 거절되었습니다.")[:300]
            message = message.replace(self.token, "[redacted]") if self.token else message
            details = ", ".join(f"{label}={error[key]}" for key, label in (
                ("error_subcode", "subcode"), ("is_transient", "transient"),
                ("fbtrace_id", "trace")) if error.get(key) is not None)
            if details:
                message += f" [{details}]"
            if code in HALT_CODES:
                raise InstagramHaltedError(f"Meta API 제한 ({code}): {message}")
            raise MetaApiError(status=response.status_code, code=code,
                subcode=error.get("error_subcode"), error_type=error.get("type"),
                trace_id=error.get("fbtrace_id"), message=message,
                method=method, path=path)
        return payload

    def pages(self, path: str, *, params: dict | None = None, limit: int = 50) -> Iterator[dict]:
        query = dict(params or {})
        seen: set[str] = set()
        count = 0
        pages_checked = 0
        # Meta can return empty conversation pages with a next cursor. Manual
        # sync must stay bounded even when no accessible conversation appears.
        conversation_page_limit = min(limit, 10) if path == "/me/conversations" else None
        while count < limit:
            result = self.request("GET", path, params=query)
            pages_checked += 1
            for item in result.get("data") or []:
                if isinstance(item, dict):
                    yield item
                    count += 1
                    if count >= limit:
                        return
            paging = result.get("paging") or {}
            after = (paging.get("cursors") or {}).get("after")
            if (not paging.get("next") or not after or after in seen or
                    (conversation_page_limit is not None and pages_checked >= conversation_page_limit)):
                return
            seen.add(after)
            query["after"] = after

    def nested_pages(self, path: str, nested: dict[str, Any], *, fields: str,
                     limit: int = 1000000) -> Iterator[dict]:
        count = 0
        for item in nested.get("data") or []:
            if isinstance(item, dict):
                yield item
                count += 1
                if count >= limit:
                    return
        paging = nested.get("paging") or {}
        after = (paging.get("cursors") or {}).get("after")
        if paging.get("next") and after:
            yield from self.pages(path, params={"fields": fields, "limit": 50,
                                                  "after": after}, limit=limit - count)


class InstagramService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._client: GraphClient | None = None

    @property
    def connected(self) -> bool:
        return self._client is not None

    @staticmethod
    def _check_halt(settings: dict[str, Any]) -> None:
        reason = settings.get("halted_reason")
        if not reason:
            return
        retry_after = settings.get("full_sync_retry_after")
        if retry_after:
            try:
                if datetime.now(UTC) >= datetime.fromisoformat(str(retry_after)):
                    update_settings({"halted_reason": None})
                    return
            except ValueError:
                pass
        raise InstagramHaltedError(str(reason))

    @staticmethod
    def _record_halt(exc: InstagramHaltedError) -> None:
        update_settings({"halted_reason": str(exc)[:500],
                         "full_sync_retry_after": (datetime.now(UTC) + timedelta(hours=1)).isoformat()})

    @staticmethod
    def _oauth_config() -> tuple[str, str, str]:
        config = get_meta_config()
        values = (config.app_id, config.app_secret, config.redirect_uri)
        if not all(values):
            raise InstagramAssistantError("Meta 앱의 INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI를 설정하세요.")
        return values

    def authorization_url(self) -> str:
        app_id, _, redirect_uri = self._oauth_config()
        state = secrets.token_urlsafe(32)
        save_oauth_state({"state": state, "created_at": datetime.now(UTC).isoformat()})
        return "https://www.instagram.com/oauth/authorize?" + urlencode({
            "client_id": app_id, "redirect_uri": redirect_uri,
            "response_type": "code", "scope": SCOPES,
            "enable_fb_login": "0", "state": state})

    def complete_oauth(self, code: str, state: str) -> dict[str, str]:
        with self._lock:
            app_id, secret, redirect_uri = self._oauth_config()
            try:
                saved = load_and_delete_oauth_state()
                created = datetime.fromisoformat(saved["created_at"])
            except (OSError, ValueError, KeyError) as exc:
                raise InstagramAssistantError("Instagram 연결 요청이 만료되었습니다.") from exc
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
                "instagram_messaging_account_id": "",
                "auto_send": False, "auto_comment": False, "auto_dm": False,
                "dm_backfill_complete": False, "dm_requests_backfill_complete": False,
                "halted_reason": None})
            return {"username": username, "user_id": account_id}

    @staticmethod
    def _save_token(token: str, account_id: str, username: str, expires_in: int) -> None:
        save_token({"access_token": token,
            "account_id": account_id, "username": username,
            "expires_at": (datetime.now(UTC) + timedelta(seconds=expires_in)).isoformat()})

    def connect_saved_session(self) -> GraphClient:
        with self._lock:
            if self._client:
                if not isinstance(self._client, GraphClient):
                    return self._client
                try:
                    saved_expiry = load_token()["expires_at"]
                    if datetime.fromisoformat(saved_expiry) > datetime.now(UTC) + timedelta(days=7):
                        return self._client
                except (OSError, ValueError, KeyError):
                    self._client = None
            try:
                saved = load_token()
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
            delete_token()
            delete_oauth_state()
            update_settings({"instagram_account_id": "", "instagram_username": "",
                "instagram_messaging_account_id": "",
                "auto_send": False, "auto_comment": False, "auto_dm": False,
                "halted_reason": None})

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

    @staticmethod
    def _dm_reactions(message: dict[str, Any], own_id: str,
                      username: str) -> tuple[str | None, str | None]:
        """Return the business and other participant's current reaction."""
        own: str | None = None
        peer: str | None = None
        reactions = (message.get("reactions") or {}).get("data") or []
        for reaction in reactions:
            emoji = str(reaction.get("emoji") or "")
            if not emoji:
                continue
            for user in reaction.get("users") or []:
                if (str(user.get("id") or "") == own_id or
                        str(user.get("username") or "").casefold() == username.casefold()):
                    own = emoji
                else:
                    peer = emoji
        return own, peer

    @classmethod
    def _shared_post_url(cls, message: dict[str, Any]) -> str:
        for share in (message.get("shares") or {}).get("data") or []:
            link = str(share.get("link") or "")
            if re.match(r"^https://(?:www\.)?instagram\.com/(?:p|reel|stories)/", link):
                return cls._canonical_url(link)
        return ""

    def sync(self, media_amount: int = 12, comments_per_media: int = 50,
             threads_amount: int = 100, dm_user_id: str | None = None,
             full: bool = False, media_items: list[dict] | None = None,
             conversation_items: list[dict] | None = None) -> dict[str, Any]:
        with self._lock:
            if dm_user_id is not None and not re.fullmatch(r"\d+", dm_user_id):
                raise InstagramAssistantError("대상 Instagram 사용자 ID는 숫자여야 합니다.")
            client = self.connect_saved_session()
            comments_count = replies_count = dm_count = 0
            dm_threads_checked = dm_threads_skipped = 0
            try:
                artworks = {item.get("post_code"): item for item in list_artworks() if item.get("post_code")}
                media_source = media_items if media_items is not None else client.pages("/me/media", params={
                    "fields": "id,caption,permalink,media_product_type,timestamp,comments_count",
                    "limit": min(media_amount, 100)}, limit=media_amount)
                for media in media_source:
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
                        "limit": min(comments_per_media, 50)},
                        limit=1000000 if full else min(comments_per_media * 4, 500)):
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
                        replies = (client.nested_pages(f"/{comment_id}/replies",
                            comment.get("replies") or {},
                            fields="id,text,username,from{id,username},timestamp") if full else
                            (comment.get("replies") or {}).get("data") or [])
                        for reply in replies:
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
                        if not full and imported_comments >= comments_per_media:
                            break
                    if int(media.get("comments_count") or 0) > 0 and not seen_comments:
                        raise InstagramAssistantError(
                            "게시물에 댓글이 있지만 공식 API가 빈 목록을 반환했습니다. "
                            "Meta 앱의 댓글 권한과 게시 상태를 확인하세요.")
                conversation_params = {
                    "platform": "instagram", "fields": "id,updated_time",
                    "limit": min(threads_amount, 100)}
                if dm_user_id is not None:
                    conversation_params["user_id"] = dm_user_id
                conversation_source = (conversation_items if conversation_items is not None else
                    client.pages("/me/conversations", params=conversation_params,
                                 limit=1 if dm_user_id is not None else threads_amount))
                for conversation in conversation_source:
                    thread_id = str(conversation["id"])
                    updated_time = str(conversation.get("updated_time") or "")
                    state = get_dm_sync_state(client.account_id, thread_id)
                    if not full and dm_user_id is None and updated_time and state and state["updated_time"] == updated_time:
                        try:
                            checked_at = datetime.fromisoformat(state["checked_at"])
                            if datetime.now(UTC) - checked_at < timedelta(hours=24):
                                dm_threads_skipped += 1
                                continue
                        except ValueError:
                            pass
                    detail = client.request("GET", f"/{thread_id}", params={
                        "fields": "participants{id,username},messages{id,created_time,from,to,message,reactions,shares{link}}"})
                    participants = (detail.get("participants") or {}).get("data") or []
                    own_messaging_ids = {
                        str(person["id"])
                        for person in participants
                        if person.get("id") and str(person.get("username") or "").casefold() == client.username.casefold()
                    }
                    if len(own_messaging_ids) != 1:
                        raise InstagramAssistantError(
                            "DM 대화에서 연결 계정의 발신자 ID를 확인하지 못했습니다. 방향을 추측하지 않고 동기화를 중단합니다.")
                    own_messaging_id = next(iter(own_messaging_ids))
                    if get_settings().get("instagram_messaging_account_id") != own_messaging_id:
                        update_settings({"instagram_messaging_account_id": own_messaging_id})
                    participant_names = {
                        str(person["id"]): str(person.get("username") or "")
                        for person in participants if person.get("id")
                    }
                    messages = (client.nested_pages(f"/{thread_id}/messages",
                        detail.get("messages") or {},
                        fields="id,created_time,from,to,message,reactions,shares{link}") if full else
                        (detail.get("messages") or {}).get("data") or [])
                    for message in messages:
                        sender = message.get("from") or {}
                        sender_id = str(sender.get("id") or "")
                        if not sender_id:
                            continue
                        outbound = sender_id == own_messaging_id
                        shared_url = self._shared_post_url(message)
                        own_reaction, peer_reaction = self._dm_reactions(
                            message, own_messaging_id, client.username)
                        dm_count += int(upsert_event({
                            "id": f"dm:{message['id']}", "account_id": client.account_id,
                            "kind": "dm", "source_id": str(message["id"]), "thread_id": thread_id,
                            "author_id": sender_id,
                            "author_username": sender.get("username") or participant_names.get(sender_id, ""),
                            "direction": "outbound" if outbound else "inbound",
                            "has_liked": int(own_reaction in {"❤", "❤️", "♥"}),
                            "own_reaction": own_reaction, "peer_reaction": peer_reaction,
                            "shared_url": shared_url or None,
                            "body": message.get("message") or ("" if shared_url else "메시지 내용 없음"),
                            "received_at": self._timestamp(message.get("created_time")),
                            "status": "history" if outbound else "pending"}))
                        # Graph omits `reactions` when a message has no reactions.
                        # A successful message fetch is a complete current snapshot.
                        set_dm_reactions(f"dm:{message['id']}", own_reaction, peer_reaction)
                        reconcile_pending_dm_reactions(client.account_id, str(message["id"]),
                                                       {client.account_id, own_messaging_id})
                    reconcile_own_dm_messages(client.account_id, own_messaging_id, client.username)
                    dm_threads_checked += 1
                    if updated_time:
                        save_dm_sync_state(client.account_id, thread_id, updated_time)
            except InstagramHaltedError as exc:
                self._record_halt(exc)
                raise
            update_settings({"last_sync_at": datetime.now(UTC).isoformat()})
            return {"comments": comments_count, "comment_replies": replies_count,
                "dms": dm_count, "dm_threads_checked": dm_threads_checked,
                "dm_threads_skipped": dm_threads_skipped, "dm_full_sync": full,
                "dm_requests_full_sync": False}

    def sync_comment_thread(self, comment_id: str) -> dict[str, int]:
        if not re.fullmatch(r"\d+", comment_id):
            raise InstagramAssistantError("댓글 ID는 숫자여야 합니다.")
        with self._lock:
            client = self.connect_saved_session()
            detail = client.request("GET", f"/{comment_id}", params={
                "fields": "id,text,username,from{id,username},timestamp,like_count,parent_id,"
                          "media{id,permalink,caption}"})
            parent_id = str(detail.get("parent_id") or comment_id)
            parent = (client.request("GET", f"/{parent_id}", params={
                "fields": "id,text,username,from{id,username},timestamp,like_count,"
                          "media{id,permalink,caption}"}) if parent_id != comment_id else detail)
            media = parent.get("media") or detail.get("media") or {}
            post_url = self._canonical_url(str(media.get("permalink") or ""))
            match = re.search(r"instagram\.com/(?:reel|p)/([^/?#]+)", post_url)
            common = {"account_id": client.account_id, "kind": "comment",
                      "media_id": str(media.get("id") or ""), "post_code": match.group(1) if match else "",
                      "post_url": post_url, "post_caption": re.sub(r"\s+", " ",
                      media.get("caption") or "").strip()[:160]}
            count = 0
            username = self._comment_username(parent)
            if username and username.casefold() != client.username.casefold():
                count += int(upsert_event({**common, "id": f"comment:{parent_id}",
                    "source_id": parent_id, "author_username": username,
                    "body": parent.get("text") or "", "like_count": parent.get("like_count"),
                    "received_at": self._timestamp(parent.get("timestamp"))}))
            for reply in client.pages(f"/{parent_id}/replies", params={
                    "fields": "id,text,username,from{id,username},timestamp", "limit": 50}, limit=1000000):
                reply_username = self._comment_username(reply)
                outbound = reply_username.casefold() == client.username.casefold()
                count += int(upsert_event({**common, "id": f"comment:{reply['id']}",
                    "source_id": str(reply["id"]), "parent_comment_id": parent_id,
                    "author_username": reply_username,
                    "direction": "outbound" if outbound else "inbound",
                    "body": reply.get("text") or "",
                    "received_at": self._timestamp(reply.get("timestamp")), "status": "history"}))
                if outbound:
                    update_event(f"comment:{parent_id}", {"status": "sent", "error": None})
            return {"comments": count}

    def send_for_event(self, event_id: str) -> dict[str, Any]:
        with self._lock:
            event = get_event(event_id)
            if not event:
                raise InstagramAssistantError("처리할 항목을 찾지 못했습니다.")
            if event["status"] == "sent":
                raise InstagramAssistantError("이미 전송한 항목입니다.")
            settings = get_settings()
            self._check_halt(settings)
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
                self._record_halt(exc)
                add_delivery(event_id, action, event["draft"], "halted", error=str(exc))
                raise
            except MetaApiError as exc:
                rejected = 400 <= exc.status < 500 and exc.status not in {408, 429}
                add_delivery(event_id, action, event["draft"],
                    "rejected" if rejected else "uncertain", error=str(exc))
                update_event(event_id, {"status": "manual", "error":
                    ("Meta 거절: " if rejected else "전송 결과 불확실: ") + str(exc)})
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
            sent_event = update_event(event_id, {"status": "sent", "error": None}) or event
            if action == "reply_comment":
                mark_comment_reviewed(event_id)
            return sent_event

    def send_dm_sequence(self, event_id: str, username: str,
                         messages: list[str]) -> dict[str, Any]:
        """Send an immutable approved DM sequence, stopping on any uncertain result."""
        with self._lock:
            event = get_event(event_id)
            if not event or event.get("kind") != "dm" or event.get("direction") != "inbound":
                raise InstagramAssistantError("받은 DM 메시지를 선택해야 합니다.")
            if not event.get("author_id") or not event.get("thread_id"):
                raise InstagramAssistantError("상대방 ID와 대화 ID가 필요합니다.")
            if str(event.get("author_username") or "").casefold() != username.lstrip("@").casefold():
                raise InstagramAssistantError("승인한 계정과 DM 계정이 다릅니다.")
            if not 1 <= len(messages) <= 10 or any(not item.strip() or len(item) > 1000 for item in messages):
                raise InstagramAssistantError("DM은 1~10개이며 각 문장은 1~1000자여야 합니다.")

            saved = dm_send_items(event_id)
            if not saved:
                if event["status"] not in {"pending", "drafted"}:
                    raise InstagramAssistantError("이미 처리된 DM은 새로 발송할 수 없습니다.")
                conversation = list_conversation_messages(event["thread_id"])
                latest_inbound = next((item for item in reversed(conversation)
                                       if item["direction"] == "inbound"), None)
                if not latest_inbound or latest_inbound["id"] != event_id:
                    raise InstagramAssistantError("승인 후 새 DM이 도착했습니다. 대화를 다시 검토하세요.")
                if any(item["direction"] == "outbound" and
                       item["received_at"] > event["received_at"] for item in conversation):
                    raise InstagramAssistantError("이 요청 뒤 보낸 DM이 있어 중복 가능성을 확인해야 합니다.")
            elif [item["body"] for item in saved] != messages:
                raise InstagramAssistantError("기존 발송 목록과 문구가 다릅니다.")

            if saved and all(item["status"] == "sent" for item in saved):
                update_event(event_id, {"status": "sent", "error": None})
                return {"event_id": event_id, "username": username,
                        "messages": [{"index": item["item_index"] + 1, "status": "sent",
                                      "remote_id": item["remote_id"]} for item in saved]}

            settings = get_settings()
            self._check_halt(settings)
            client = self.connect_saved_session()
            if event.get("account_id") != client.account_id:
                raise InstagramAssistantError("현재 연결 계정에서 수집한 DM이 아닙니다.")
            try:
                items = create_dm_send_items(event_id, messages)
            except ValueError as exc:
                raise InstagramAssistantError(str(exc)) from exc
            for item in items:
                index = item["item_index"]
                if item["status"] == "sent":
                    continue
                if item["status"] != "pending":
                    raise InstagramAssistantError(
                        f"{index + 1}번째 DM의 결과가 {item['status']}입니다. Instagram에서 확인 후 수동으로 조정하세요.")
                if not claim_dm_send_item(event_id, index):
                    raise InstagramAssistantError("다른 발송이 진행 중입니다. 대화를 다시 확인하세요.")
                body = item["body"]
                try:
                    result = client.request("POST", f"/{client.account_id}/messages", json_body={
                        "recipient": {"id": event["author_id"]}, "message": {"text": body},
                    })
                except InstagramHaltedError as exc:
                    self._record_halt(exc)
                    add_delivery(event_id, "reply_dm", body, "halted", error=str(exc))
                    finish_dm_send_item(event_id, index, "halted", error=str(exc))
                    update_event(event_id, {"status": "manual", "error": str(exc)})
                    raise
                except MetaApiError as exc:
                    status = "rejected" if 400 <= exc.status < 500 and exc.status not in {408, 429} else "uncertain"
                    add_delivery(event_id, "reply_dm", body, status, error=str(exc))
                    finish_dm_send_item(event_id, index, status, error=str(exc))
                    update_event(event_id, {"status": "manual", "error": str(exc)})
                    raise
                except InstagramAssistantError as exc:
                    add_delivery(event_id, "reply_dm", body, "uncertain", error=str(exc))
                    finish_dm_send_item(event_id, index, "uncertain", error=str(exc))
                    update_event(event_id, {"status": "manual", "error": str(exc)})
                    raise
                remote_id = str(result.get("id") or result.get("message_id") or "")
                if not remote_id:
                    add_delivery(event_id, "reply_dm", body, "uncertain", error="발송 ID 없음")
                    finish_dm_send_item(event_id, index, "uncertain", error="발송 ID 없음")
                    update_event(event_id, {"status": "manual", "error": "발송 ID 없음"})
                    raise InstagramAssistantError("발송 ID가 없어 Instagram에서 확인해야 합니다.")
                add_delivery(event_id, "reply_dm", body, "sent", remote_id)
                finish_dm_send_item(event_id, index, "sent", remote_id)
            update_event(event_id, {"status": "sent", "error": None})
            return {"event_id": event_id, "username": username,
                    "messages": [{"index": item["item_index"] + 1, "status": item["status"],
                                  "remote_id": item["remote_id"]}
                                 for item in dm_send_items(event_id)]}

    def heart_dm(self, event_id: str) -> dict[str, Any]:
        with self._lock:
            event = get_event(event_id)
            if not event or event.get("kind") != "dm" or event.get("direction") != "inbound":
                raise InstagramAssistantError("받은 DM 메시지만 하트를 누를 수 있습니다.")
            if not event.get("source_id") or not event.get("author_id"):
                raise InstagramAssistantError("DM 메시지 ID와 상대방 ID가 필요합니다.")
            if event.get("has_liked"):
                raise InstagramAssistantError("이미 하트를 누른 DM입니다.")
            settings = get_settings()
            self._check_halt(settings)
            client = self.connect_saved_session()
            if event.get("account_id") != client.account_id:
                raise InstagramAssistantError("현재 연결 계정에서 수집한 DM이 아닙니다. 다시 동기화하세요.")
            try:
                result = client.request("POST", f"/{client.account_id}/messages", json_body={
                    "recipient": {"id": event["author_id"]},
                    "sender_action": "react",
                    "payload": {"message_id": event["source_id"], "reaction": "love"},
                })
            except InstagramHaltedError as exc:
                self._record_halt(exc)
                raise
            if str(result.get("recipient_id") or "") != str(event["author_id"]):
                raise InstagramAssistantError("DM 하트 결과를 확인하지 못했습니다. 다시 누르기 전에 Instagram에서 확인하세요.")
            return update_event(event_id, {"has_liked": True, "own_reaction": "❤",
                                           "error": None}) or event

instagram_service = InstagramService()
