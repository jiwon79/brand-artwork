"""SQLite-compatible connections for local development and Turso Cloud."""
from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any


class Row:
    def __init__(self, names: list[str], values: tuple[Any, ...]) -> None:
        self._names = names
        self._values = values

    def __getitem__(self, key: str | int) -> Any:
        return self._values[key] if isinstance(key, int) else self._values[self._names.index(key)]

    def keys(self) -> list[str]:
        return self._names

    def __iter__(self) -> Iterator[Any]:
        return iter(self._values)


class Cursor:
    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor
        self._names = [column[0] for column in cursor.description or ()]

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def _row(self, value: Any) -> Row | None:
        return Row(self._names, tuple(value)) if value is not None else None

    def fetchone(self) -> Row | None:
        return self._row(self._cursor.fetchone())

    def fetchall(self) -> list[Row]:
        return [self._row(value) for value in self._cursor.fetchall()]

    def __iter__(self) -> Iterator[Row]:
        while (value := self._cursor.fetchone()) is not None:
            yield self._row(value)


class RemoteConnection:
    def __init__(self, connection: Any) -> None:
        self._connection = connection

    def execute(self, sql: str, parameters: tuple[Any, ...] = ()) -> Cursor:
        return Cursor(self._connection.execute(sql, parameters))

    def executescript(self, script: str) -> None:
        # The remote HTTP drivers do not guarantee sqlite3.executescript support.
        for statement in script.split(";"):
            statement = statement.strip()
            if statement and not statement.upper().startswith("PRAGMA JOURNAL_MODE"):
                self.execute(statement)

    def commit(self) -> None:
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()


def remote_url() -> str:
    environment = os.getenv("INSTAGRAM_ENV", "").strip()
    prefix = {"development": "TURSO_DEV_", "production": "TURSO_PROD_"}.get(environment, "")
    if (os.getenv("TURSO_DEV_DATABASE_URL") and
            os.getenv("TURSO_DEV_DATABASE_URL") == os.getenv("TURSO_PROD_DATABASE_URL")):
        raise RuntimeError("Development and production Turso URLs must differ")
    if prefix and os.getenv("TURSO_DATABASE_URL"):
        raise RuntimeError("Use environment-specific Turso URLs when INSTAGRAM_ENV is set")
    return os.getenv(prefix + "DATABASE_URL" if prefix else "TURSO_DATABASE_URL", "").strip()


def open_connection(local_path: Path) -> sqlite3.Connection | RemoteConnection:
    url = remote_url()
    if not url:
        conn = sqlite3.connect(local_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    environment = os.getenv("INSTAGRAM_ENV", "").strip()
    prefix = {"development": "TURSO_DEV_", "production": "TURSO_PROD_"}.get(environment, "")
    token = os.getenv(prefix + "AUTH_TOKEN" if prefix else "TURSO_AUTH_TOKEN", "").strip()
    if not token:
        raise RuntimeError("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set")
    driver = os.getenv("TURSO_DRIVER", "libsql").strip()
    if driver == "libsql":
        import libsql

        conn = libsql.connect(database=url, auth_token=token)
    elif driver == "turso":
        import turso_serverless

        conn = turso_serverless.connect(url, auth_token=token)
    else:
        raise RuntimeError("TURSO_DRIVER must be libsql or turso")
    return RemoteConnection(conn)
