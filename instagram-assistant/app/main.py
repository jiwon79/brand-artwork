from __future__ import annotations

import os
import re
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .config import ROOT, local_token
from .admin_auth import COOKIE_NAME, configured, require_configuration, sign_session, valid_session, verify_password
from .db import (
    count_events_by_status,
    get_event,
    get_settings,
    initialize,
    list_artworks,
    list_comment_threads,
    list_conversation_messages,
    list_conversations,
    list_events,
    list_post_labels,
    mark_comment_reviewed,
    save_artwork,
    save_post_label,
    sent_today_count,
    update_event,
    update_settings,
)
from .instagram_client import InstagramAssistantError, instagram_service
from .link_preview import fetch_link_preview
from .token_store import has_token


app = FastAPI(title="jiiwon.studio Instagram Assistant", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
TOKEN = local_token() if not os.getenv("VERCEL") and not configured() else ""


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_url: str | None = None
    auto_send: bool | None = None
    auto_comment: bool | None = None
    auto_dm: bool | None = None
    daily_send_limit: int | None = Field(default=None, ge=1, le=50)


class ArtworkBody(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9-]+$")
    title: str
    post_code: str | None = None
    media_id: str | None = None
    product_name: str = ""
    product_status: str = "available"


class DraftBody(BaseModel):
    draft: str


class PostLabelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=40)


@app.on_event("startup")
def startup() -> None:
    initialize()


def protect(x_instagram_assistant_token: str | None) -> None:
    if configured():
        return  # Admin session and same-origin checks are enforced in middleware.
    if x_instagram_assistant_token != TOKEN:
        raise HTTPException(403, "Invalid local token")


@app.middleware("http")
async def admin_gate(request: Request, call_next):
    if (request.url.path.startswith("/static/") or request.url.path in
            {"/webhook", "/api/cron/process-webhooks", "/api/cron/full-sync"}):
        return await call_next(request)
    try:
        login_enabled = require_configuration(request)
    except HTTPException as exc:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    if not login_enabled or request.url.path in {"/login", "/api/admin/login"}:
        return await call_next(request)
    # Instagram redirects the browser here without the viewer's admin cookie.
    # complete_oauth validates a short-lived, one-use state stored server-side.
    if request.method == "GET" and request.url.path == "/api/auth/callback":
        return await call_next(request)
    if not valid_session(request.cookies.get(COOKIE_NAME)):
        if request.method == "GET" and not request.url.path.startswith("/api/"):
            return RedirectResponse("/login", status_code=303)
        return JSONResponse({"detail": "Administrator login required"}, status_code=401)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin", "")
        host = request.headers.get("host", "")
        if origin not in {f"https://{host}", f"http://{host}"}:
            return JSONResponse({"detail": "Same-origin request required"}, status_code=403)
    return await call_next(request)


@app.get("/login", response_class=HTMLResponse)
def admin_login_page() -> str:
    return (ROOT / "static" / "login.html").read_text()


@app.post("/api/admin/login")
async def admin_login(request: Request):
    if not configured():
        raise HTTPException(503, "Administrator login is not configured")
    from urllib.parse import parse_qs

    form = parse_qs((await request.body()).decode("utf-8", errors="replace"))
    if not verify_password((form.get("password") or [""])[0]):
        raise HTTPException(401, "Invalid administrator password")
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE_NAME, sign_session(), max_age=43200,
                        httponly=True,
                        secure=(request.url.hostname not in {"localhost", "127.0.0.1", "::1"}),
                        samesite="lax", path="/")
    return response


@app.post("/api/admin/logout")
def admin_logout() -> RedirectResponse:
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


def as_http_error(exc: Exception) -> HTTPException:
    return HTTPException(400, str(exc))


@app.get("/setting", response_class=HTMLResponse)
@app.get("/work", response_class=HTMLResponse)
@app.get("/comment", response_class=HTMLResponse)
@app.get("/dm", response_class=HTMLResponse)
@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (ROOT / "static" / "index.html").read_text()


@app.get("/api/status")
def status() -> dict[str, Any]:
    settings = get_settings()
    counts = count_events_by_status()
    return {
        "admin_login": configured(),
        "authenticated": has_token(),
        "connected": instagram_service.connected,
        "settings": settings,
        "counts": {
            "pending": counts.get("pending", 0),
            "drafted": counts.get("drafted", 0),
            "manual": counts.get("manual", 0),
            "sent_today": sent_today_count(),
        },
    }


@app.post("/api/auth/url")
def auth_url(x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, str]:
    protect(x_instagram_assistant_token)
    try:
        return {"url": instagram_service.authorization_url()}
    except Exception as exc:
        raise as_http_error(exc) from exc


@app.get("/api/auth/callback")
def auth_callback(code: str = "", state: str = "", error: str = "") -> RedirectResponse:
    if error or not code or not state:
        raise HTTPException(400, "Instagram 연결이 취소되었습니다.")
    try:
        instagram_service.complete_oauth(code, state)
    except InstagramAssistantError as exc:
        raise as_http_error(exc) from exc
    return RedirectResponse("/setting?oauth=connected", status_code=303)


@app.post("/api/webhooks/subscribe")
def subscribe_webhooks(x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, object]:
    protect(x_instagram_assistant_token)
    try:
        client = instagram_service.connect_saved_session()
        client.request("POST", "/me/subscribed_apps", data={
            "subscribed_fields": "messages,message_reactions,comments"})
        subscriptions = client.request("GET", "/me/subscribed_apps").get("data") or []
    except InstagramAssistantError as exc:
        raise as_http_error(exc) from exc
    return {"subscriptions": subscriptions}


@app.post("/api/logout")
def logout(x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, bool]:
    protect(x_instagram_assistant_token)
    instagram_service.logout()
    return {"ok": True}


@app.post("/api/sync")
def sync(x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    try:
        return instagram_service.sync()
    except Exception as exc:
        raise as_http_error(exc) from exc


@app.post("/api/viewer/sync")
def viewer_sync(request: Request, scope: Literal["all", "dm"] = "all",
                user_id: str | None = None,
                dm_limit: int = Query(default=100, ge=1, le=100),
                x_requested_with: str | None = Header(default=None)) -> dict[str, Any]:
    origin = request.headers.get("origin", "")
    host = request.headers.get("host", "")
    if (x_requested_with != "InstagramAssistant" or
            origin not in {f"http://{host}", f"https://{host}"} or
            request.headers.get("sec-fetch-site", "same-origin") != "same-origin"):
        raise HTTPException(403, "Same-origin viewer request required")
    if user_id is not None and scope != "dm":
        raise HTTPException(400, "user_id requires DM scope")
    if dm_limit != 100 and scope != "dm":
        raise HTTPException(400, "dm_limit requires DM scope")
    try:
        return (instagram_service.sync(media_amount=0, threads_amount=dm_limit, dm_user_id=user_id)
                if scope == "dm" else instagram_service.sync())
    except Exception as exc:
        raise as_http_error(exc) from exc


@app.get("/api/events")
def events(
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if kind == "comment":
        return list_comment_threads(status=status, limit=limit)
    return list_events(status=status, kind=kind, limit=limit)


@app.get("/api/events/{event_id}")
def event_detail(event_id: str) -> dict[str, Any]:
    event = get_event(event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@app.get("/api/conversations")
def conversations(status: str | None = None) -> list[dict[str, Any]]:
    return list_conversations(status=status)


@app.get("/api/link-preview")
def link_preview(url: str) -> dict[str, str]:
    return fetch_link_preview(url)


@app.get("/api/conversations/{thread_id}")
def conversation(thread_id: str) -> list[dict[str, Any]]:
    return list_conversation_messages(thread_id)


@app.patch("/api/events/{event_id}/draft")
def edit_draft(event_id: str, body: DraftBody, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    event = get_event(event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if event["direction"] != "inbound" or event["status"] not in {"pending", "drafted"}:
        raise HTTPException(400, "Only pending inbound items can be drafted")
    if event["kind"] == "comment" and not event["parent_comment_id"]:
        action = "reply_comment"
    elif event["kind"] == "dm" and event["author_id"]:
        action = "reply_dm"
    else:
        raise HTTPException(400, "This item cannot be replied to through the API")
    if event["account_id"] != get_settings().get("instagram_account_id"):
        raise HTTPException(400, "Event does not belong to the connected account")
    if not body.draft.strip():
        raise HTTPException(400, "Reply draft is empty")
    return update_event(event_id, {
        "draft": body.draft, "status": "drafted", "proposed_action": action,
    }) or event


@app.post("/api/events/{event_id}/send")
def send_event(event_id: str, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    try:
        return instagram_service.send_for_event(event_id)
    except Exception as exc:
        raise as_http_error(exc) from exc


@app.post("/api/events/{event_id}/heart")
def heart_dm(event_id: str, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    try:
        return instagram_service.heart_dm(event_id)
    except Exception as exc:
        raise as_http_error(exc) from exc


@app.post("/api/events/{event_id}/heart-observed")
def heart_observed(event_id: str, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    event = get_event(event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if event["kind"] not in {"comment", "dm"} or event["direction"] != "inbound":
        raise HTTPException(400, "Only inbound comments and DMs can be marked as hearted")
    account_id = get_settings().get("instagram_account_id")
    if account_id and event["account_id"] != account_id:
        raise HTTPException(400, "Event does not belong to the connected account")
    if event["kind"] == "comment":
        author = str(event.get("author_username") or "").strip().removeprefix("@").casefold()
        own_username = str(get_settings().get("instagram_username") or "").casefold()
        if not author or (own_username and author == own_username):
            raise HTTPException(400, "Comment author must be a known other account")
    if not event["has_liked"]:
        update_event(event_id, {"has_liked": True,
                                **({"own_reaction": "❤"} if event["kind"] == "dm" else {})})
    if event["kind"] == "comment":
        mark_comment_reviewed(event_id)
    return get_event(event_id) or event


@app.post("/api/events/{event_id}/ignore")
def ignore_event(event_id: str, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    event = update_event(event_id, {"status": "ignored", "proposed_action": "ignore"})
    if not event:
        raise HTTPException(404, "Event not found")
    if event["kind"] == "comment":
        mark_comment_reviewed(event_id)
    return event


@app.get("/api/artworks")
def artworks() -> list[dict[str, Any]]:
    return list_artworks()


@app.get("/api/post-labels")
def post_labels() -> dict[str, str]:
    return list_post_labels()


@app.put("/api/post-labels/{post_code}")
def put_post_label(post_code: str, body: PostLabelBody,
                   x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, str]:
    protect(x_instagram_assistant_token)
    if not re.fullmatch(r"[A-Za-z0-9_-]{5,30}", post_code):
        raise HTTPException(400, "Invalid Instagram post code")
    label = body.label.strip()
    if not label:
        raise HTTPException(400, "Post label cannot be blank")
    return save_post_label(post_code, label)


@app.post("/api/artworks")
def create_artwork(body: ArtworkBody, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    return save_artwork(body.model_dump())


@app.patch("/api/settings")
def settings(body: SettingsBody, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    return update_settings(body.model_dump(exclude_none=True))
