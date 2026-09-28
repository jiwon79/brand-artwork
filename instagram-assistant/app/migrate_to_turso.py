"""Copy a consistent local SQLite snapshot to an empty Turso database.

Run only after stopping local writers, with the destination Turso environment set.
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
                if existing:
                    raise RuntimeError(f"Destination table {table} is not empty")
                columns = [row[1] for row in snapshot.execute(f"PRAGMA table_info({table})")]
                if not columns:
                    counts[table] = 0
                    continue
                query = f"SELECT {','.join(columns)} FROM {table}"
                insert = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})"
                counts[table] = 0
                for values in snapshot.execute(query):
                    destination.execute(insert, tuple(values))
                    counts[table] += 1
                destination.commit()
                actual = destination.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if actual != counts[table]:
                    raise RuntimeError(f"Migration count mismatch for {table}: {counts[table]} != {actual}")
            return counts
        finally:
            destination.close()
            snapshot.close()


if __name__ == "__main__":
    import json

    print(json.dumps(migrate()))
