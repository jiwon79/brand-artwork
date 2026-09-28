"""Copy a consistent local SQLite snapshot to a new Turso database.

The destination may contain only automatically initialized settings and artworks.
Run with the destination Turso environment set; reconcile changes after cutover.
The source file is never modified.
"""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

from .config import paths
from .database_backend import open_connection
from .db import SCHEMA


TABLES = ("settings", "artworks", "events", "deliveries", "dm_sync_state", "webhook_events", "private_state")
CHANGE_TIMESTAMPS = {
    "artworks": "updated_at", "events": "updated_at", "deliveries": "created_at",
    "dm_sync_state": "checked_at", "webhook_events": "created_at", "private_state": "updated_at",
}
RECONCILE_TABLES = ("artworks", "events", "deliveries", "dm_sync_state", "webhook_events")


def migrate(source_path: Path = paths.database) -> dict[str, int]:
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    with tempfile.TemporaryDirectory() as directory:
        snapshot_path = Path(directory) / "snapshot.sqlite3"
        source = sqlite3.connect(source_path)
        snapshot = sqlite3.connect(snapshot_path)
        try:
            source.backup(snapshot)
        finally:
            source.close()
        destination = open_connection(snapshot_path)
        if isinstance(destination, sqlite3.Connection):
            destination.close()
            raise RuntimeError("Configure TURSO_DATABASE_URL before migration")
        try:
            destination.executescript(SCHEMA)
            counts: dict[str, int] = {}
            for table in TABLES:
                existing = destination.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if existing and table not in {"settings", "artworks"}:
                    raise RuntimeError(f"Destination table {table} is not empty")
                columns = [row[1] for row in snapshot.execute(f"PRAGMA table_info({table})")]
                if not columns:
                    counts[table] = 0
                    continue
                query = f"SELECT {','.join(columns)} FROM {table}"
                insert = f"INSERT OR REPLACE INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})"
                counts[table] = 0
                for values in snapshot.execute(query):
                    destination.execute(insert, tuple(values))
                    counts[table] += 1
                destination.commit()
                actual = destination.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if actual != counts[table] and table not in {"settings", "artworks"}:
                    raise RuntimeError(f"Migration count mismatch for {table}: {counts[table]} != {actual}")
            return counts
        finally:
            destination.close()
            snapshot.close()


def reconcile_recent(source_path: Path, since: str) -> dict[str, int]:
    """Copy local changes made during the initial snapshot before switching webhooks."""
    source = sqlite3.connect(source_path)
    destination = open_connection(source_path)
    if isinstance(destination, sqlite3.Connection):
        destination.close()
        source.close()
        raise RuntimeError("Configure a Turso destination before reconciliation")
    try:
        counts: dict[str, int] = {}
        # Hosted settings contain the active full-sync cursor, and private_state
        # contains the hosted encrypted Meta token. Neither belongs to the
        # local record delta after the initial snapshot.
        for table in RECONCILE_TABLES:
            columns = [row[1] for row in source.execute(f"PRAGMA table_info({table})")]
            column_list = ",".join(columns)
            timestamp = CHANGE_TIMESTAMPS.get(table)
            if timestamp == "created_at" and table == "webhook_events":
                rows = source.execute(f"SELECT {column_list} FROM {table} WHERE created_at >= ? OR processed_at >= ?", (since, since))
            elif timestamp:
                rows = source.execute(f"SELECT {column_list} FROM {table} WHERE {timestamp} >= ?", (since,))
            else:
                rows = source.execute(f"SELECT {column_list} FROM {table}")
            conflict = "IGNORE" if table == "webhook_events" else "REPLACE"
            insert = f"INSERT OR {conflict} INTO {table} ({column_list}) VALUES ({','.join('?' for _ in columns)})"
            counts[table] = 0
            for row in rows:
                destination.execute(insert, tuple(row))
                counts[table] += 1
            destination.commit()
        return counts
    finally:
        destination.close()
        source.close()


if __name__ == "__main__":
    import json

    print(json.dumps(migrate()))
