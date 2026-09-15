from __future__ import annotations

import argparse
import json

from .db import get_settings, initialize, list_artworks, list_events, update_event
from .instagram_client import instagram_service
from .rules import classify


def run_once(send: bool = False) -> dict[str, object]:
    initialize()
    sync_result = instagram_service.sync()
    settings = get_settings()
    artworks = list_artworks()
    classified = 0
    sent = 0
    for event in list_events(status="pending", limit=200):
        decision = classify(event, artworks, settings["profile_url"])
        updated = update_event(event["id"], decision.as_dict())
        classified += 1
        allow_kind = (
            event["kind"] == "comment" and settings.get("auto_comment")
        ) or (
            event["kind"] == "dm" and settings.get("auto_dm")
        )
        if (
            send
            and settings.get("auto_send")
            and not settings.get("read_only_observation")
            and allow_kind
            and updated
            and updated["status"] == "drafted"
            and float(updated.get("confidence") or 0) >= 0.96
        ):
            instagram_service.send_for_event(event["id"])
            sent += 1
    return {"sync": sync_result, "classified": classified, "sent": sent}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["once"])
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run_once(send=args.send), ensure_ascii=False))


if __name__ == "__main__":
    main()
