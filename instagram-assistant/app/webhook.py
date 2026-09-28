"""Public, webhook-only ingress. No viewer or send routes are mounted here."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse

from .db import enqueue_webhook, finish_webhook, get_settings, initialize, next_webhook, set_dm_shared_url
from .instagram_client import instagram_service
from .meta_config import get_meta_config


logger = logging.getLogger(__name__)


def event_targets(payload: dict[str, Any], account_id: str,
                  messaging_account_id: str = "") -> tuple[set[str], set[str]]:
    users: set[str] = set()
    comments: set[str] = set()
    if payload.get("object") != "instagram":
        return users, comments
    for entry in payload.get("entry") or []:
        own_id = str(entry.get("id") or "")
        if own_id not in {account_id, messaging_account_id}:
            continue
        for item in entry.get("messaging") or []:
            sender = str((item.get("sender") or {}).get("id") or "")
            recipient = str((item.get("recipient") or {}).get("id") or "")
            user_id = recipient if sender == own_id else sender
            if user_id in {account_id, messaging_account_id} or not user_id.isdigit():
                continue
            users.add(user_id)
        for change in entry.get("changes") or []:
            if change.get("field") not in {"comments", "live_comments"}:
                continue
            value = change.get("value") or {}
            comment_id = str(value.get("parent_id") or value.get("comment_id") or value.get("id") or "")
            if comment_id.isdigit():
                comments.add(comment_id)
    return users, comments


def process_one() -> bool:
    queued = next_webhook()
    if queued is None:
        return False
    try:
        payload = json.loads(queued["payload"])
        settings = get_settings()
        account_id = str(settings.get("instagram_account_id") or "")
        messaging_id = str(settings.get("instagram_messaging_account_id") or "")
        users, comments = event_targets(payload, account_id, messaging_id)
        for user_id in users:
            instagram_service.sync(media_amount=0, threads_amount=1, dm_user_id=user_id)
        for entry in payload.get("entry") or []:
            if str(entry.get("id") or "") not in {account_id, messaging_id}:
                continue
            for item in entry.get("messaging") or []:
                message = item.get("message") or {}
                attachments = message.get("attachments") or []
                url = next((str((item.get("payload") or {}).get("url") or "")
                            for item in attachments
                            if item.get("type") in {"share", "ig_post", "ig_reel", "reel", "story"}
                            and re.match(r"^https://(?:www\.)?instagram\.com/",
                                str((item.get("payload") or {}).get("url") or ""))), "")
                message_id = str(message.get("mid") or "")
                if message_id and url:
                    set_dm_shared_url(message_id, url)
        for comment_id in comments:
            instagram_service.sync_comment_thread(comment_id)
    except Exception as exc:
        finish_webhook(queued["id"], str(exc))
    else:
        finish_webhook(queued["id"])
    return True


def _process_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        if not process_one():
            stop.wait(2)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize()
    stop = threading.Event()
    thread = threading.Thread(target=_process_loop, args=(stop,), daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=5)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/webhook", response_class=PlainTextResponse)
def verify(request: Request) -> str:
    token = get_meta_config().webhook_verify_token
    query = request.query_params
    if (not token or query.get("hub.mode") != "subscribe" or
            not hmac.compare_digest(query.get("hub.verify_token", "").encode(), token.encode())):
        raise HTTPException(403)
    return query.get("hub.challenge", "")


@app.post("/webhook")
async def receive(request: Request, background_tasks: BackgroundTasks) -> dict[str, bool]:
    secret = get_meta_config().webhook_app_secret
    if not secret:
        raise HTTPException(503)
    body = await request.body()
    if len(body) > 1024 * 1024:
        raise HTTPException(413)
    signature = request.headers.get("x-hub-signature-256", "")
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        logger.warning("Meta webhook rejected: signature mismatch or missing signature")
        raise HTTPException(403)
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400) from None
    if not isinstance(payload, dict) or payload.get("object") != "instagram":
        raise HTTPException(400)
    settings = get_settings()
    account_id = str(settings.get("instagram_account_id") or "")
    messaging_id = str(settings.get("instagram_messaging_account_id") or "")
    if not account_id or not any(str(entry.get("id") or "") in {account_id, messaging_id}
                                 for entry in payload.get("entry") or []):
        logger.warning("Meta webhook rejected: entry account does not match connected account")
        raise HTTPException(403)
    digest = hashlib.sha256(body).hexdigest()
    enqueue_webhook(digest, payload)
    if os.getenv("VERCEL"):
        background_tasks.add_task(process_one)
    return {"ok": True}
