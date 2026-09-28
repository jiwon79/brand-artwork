"""Daily full reconciliation; never sends replies or reactions."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from .db import get_settings, initialize, update_settings
from .instagram_client import instagram_service


def run_if_due() -> dict[str, object]:
    initialize()
    previous = get_settings().get("last_full_sync_at")
    if previous:
        try:
            if datetime.now(UTC) - datetime.fromisoformat(previous) < timedelta(hours=24):
                return {"skipped": "last successful full sync was less than 24 hours ago"}
        except ValueError:
            pass
    result = instagram_service.sync(media_amount=1000000, comments_per_media=1000000,
                                    threads_amount=1000000, full=True)
    update_settings({"last_full_sync_at": datetime.now(UTC).isoformat()})
    return result


if __name__ == "__main__":
    print(json.dumps(run_if_due(), ensure_ascii=False))
