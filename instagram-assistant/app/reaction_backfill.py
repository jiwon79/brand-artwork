"""Replay stored, signed Instagram reaction webhooks after the schema upgrade."""

from __future__ import annotations

import argparse
import json

from .db import apply_dm_reaction, connect, get_settings, initialize


def backfill() -> dict[str, int]:
    initialize()
    settings = get_settings()
    account_id = str(settings.get("instagram_account_id") or "")
    messaging_id = str(settings.get("instagram_messaging_account_id") or "")
    if not account_id or not messaging_id:
        raise RuntimeError("Connected account and messaging account IDs are required")
    with connect() as conn:
        rows = conn.execute(
            "SELECT payload FROM webhook_events WHERE status='done' ORDER BY created_at,id"
        ).fetchall()
    counts = {"reaction_events": 0, "matched_messages": 0, "unmatched_messages": 0}
    for row in rows:
        payload = json.loads(row["payload"])
        for entry in payload.get("entry") or []:
            if str(entry.get("id") or "") not in {account_id, messaging_id}:
                continue
            for item in entry.get("messaging") or []:
                reaction = item.get("reaction") or {}
                if not reaction:
                    continue
                counts["reaction_events"] += 1
                matched = apply_dm_reaction(
                    account_id, str(reaction.get("mid") or ""),
                    str((item.get("sender") or {}).get("id") or ""),
                    {account_id, messaging_id}, str(reaction.get("action") or ""),
                    str(reaction.get("emoji") or "") or None,
                )
                counts["matched_messages" if matched else "unmatched_messages"] += 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Replay into the selected database")
    args = parser.parse_args()
    if not args.apply:
        parser.error("--apply is required")
    print(json.dumps(backfill()))


if __name__ == "__main__":
    main()
