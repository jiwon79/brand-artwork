"""Resumable daily reconciliation; each call processes one media or DM page."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from .db import get_settings, initialize, update_settings
from .instagram_client import InstagramHaltedError, instagram_service


MEDIA_FIELDS = "id,caption,permalink,media_product_type,timestamp,comments_count"
CONVERSATION_FIELDS = "id,updated_time"


def _next_cursor(page: dict[str, Any]) -> str | None:
    paging = page.get("paging") or {}
    after = (paging.get("cursors") or {}).get("after")
    return str(after) if paging.get("next") and after else None


def run_if_due() -> dict[str, object]:
    initialize()
    settings = get_settings()
    current = datetime.now(UTC)
    retry = settings.get("full_sync_retry_after")
    if retry:
        try:
            if current < datetime.fromisoformat(retry):
                return {"deferred": retry}
        except ValueError:
            pass
    progress = settings.get("full_sync_progress")
    if not progress:
        previous = settings.get("last_full_sync_at")
        if previous:
            try:
                if current - datetime.fromisoformat(previous) < timedelta(hours=24):
                    return {"skipped": "last successful full sync was less than 24 hours ago"}
            except ValueError:
                pass
        progress = {"phase": "media", "cursor": None}
        update_settings({"full_sync_progress": progress})

    phase = progress["phase"]
    params: dict[str, Any] = {"limit": 1}
    if progress.get("cursor"):
        params["after"] = progress["cursor"]
    if phase == "media":
        path = "/me/media"
        params["fields"] = MEDIA_FIELDS
    elif phase == "dm":
        path = "/me/conversations"
        params.update({"platform": "instagram", "fields": CONVERSATION_FIELDS})
    else:
        raise RuntimeError("Invalid full sync phase")

    try:
        page = instagram_service.connect_saved_session().request("GET", path, params=params)
        items = [item for item in page.get("data") or [] if isinstance(item, dict)]
        result = instagram_service.sync(
            media_amount=0, threads_amount=0, comments_per_media=1000000, full=True,
            media_items=items if phase == "media" else [],
            conversation_items=items if phase == "dm" else [],
        ) if items else {}
    except InstagramHaltedError as exc:
        retry_at = (current + timedelta(hours=1)).isoformat()
        update_settings({"full_sync_retry_after": retry_at, "halted_reason": str(exc)[:500]})
        return {"deferred": retry_at, "reason": "Meta API rate limit"}

    after = _next_cursor(page)
    if after:
        update_settings({"full_sync_progress": {"phase": phase, "cursor": after},
                         "full_sync_retry_after": None})
        return {"phase": phase, "processed": len(items), "next": True, **result}
    if phase == "media":
        update_settings({"full_sync_progress": {"phase": "dm", "cursor": None},
                         "full_sync_retry_after": None})
        return {"phase": "media", "processed": len(items), "next": True, **result}
    update_settings({"last_full_sync_at": datetime.now(UTC).isoformat(),
                     "full_sync_progress": None, "full_sync_retry_after": None,
                     "halted_reason": None})
    return {"phase": "dm", "processed": len(items), "complete": True, **result}


if __name__ == "__main__":
    print(json.dumps(run_if_due(), ensure_ascii=False))
