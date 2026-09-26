from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import ROOT, local_token, paths
from .db import (
    count_events_by_status,
    get_settings,
    initialize,
    list_artworks,
    list_comment_threads,
    list_conversation_messages,
    list_conversations,
    list_events,
    save_artwork,
    sent_today_count,
    update_event,
    update_settings,
)
from .instagram_client import InstagramAssistantError, instagram_service
from .link_preview import fetch_link_preview


app = FastAPI(title="jiiwon.studio Instagram Assistant", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
TOKEN = local_token()


class SettingsBody(BaseModel):
    profile_url: str | None = None
    read_only_observation: bool | None = None
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


@app.on_event("startup")
def startup() -> None:
    initialize()


def protect(x_instagram_assistant_token: str | None) -> None:
    if x_instagram_assistant_token != TOKEN:
        raise HTTPException(403, "Invalid local token")


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
        "authenticated": paths.session.exists(),
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


@app.get("/api/events")
def events(
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if kind == "comment":
        return list_comment_threads(status=status, limit=limit)
    return list_events(status=status, kind=kind, limit=limit)


@app.get("/api/conversations")
def conversations() -> list[dict[str, Any]]:
    return list_conversations()


@app.get("/api/link-preview")
def link_preview(url: str) -> dict[str, str]:
    return fetch_link_preview(url)


@app.get("/api/conversations/{thread_id}")
def conversation(thread_id: str) -> list[dict[str, Any]]:
    return list_conversation_messages(thread_id)


@app.patch("/api/events/{event_id}/draft")
def edit_draft(event_id: str, body: DraftBody, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    event = update_event(event_id, {"draft": body.draft, "status": "drafted"})
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@app.post("/api/events/{event_id}/send")
def send_event(event_id: str, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    try:
        return instagram_service.send_for_event(event_id)
    except Exception as exc:
        raise as_http_error(exc) from exc


@app.post("/api/events/{event_id}/ignore")
def ignore_event(event_id: str, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    event = update_event(event_id, {"status": "ignored", "proposed_action": "ignore"})
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@app.get("/api/artworks")
def artworks() -> list[dict[str, Any]]:
    return list_artworks()


@app.post("/api/artworks")
def create_artwork(body: ArtworkBody, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    return save_artwork(body.model_dump())


@app.patch("/api/settings")
def settings(body: SettingsBody, x_instagram_assistant_token: str | None = Header(default=None)) -> dict[str, Any]:
    protect(x_instagram_assistant_token)
    return update_settings(body.model_dump(exclude_none=True))
