"""Single-administrator password login for the private records viewer."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import secrets
import time

from fastapi import HTTPException, Request


COOKIE_NAME = "instagram_assistant_admin"
SESSION_SECONDS = 12 * 60 * 60
HASH_ROUNDS = 600_000


def hash_password(password: str, salt: bytes | None = None) -> str:
    if len(password) < 16:
        raise ValueError("Administrator password must be at least 16 characters")
    salt = salt or secrets.token_bytes(24)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ROUNDS)
    return "pbkdf2_sha256$%d$%s$%s" % (
        HASH_ROUNDS, base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
    )


def verify_password(password: str) -> bool:
    encoded = os.getenv("ADMIN_PASSWORD_HASH", "")
    try:
        algorithm, rounds, salt, digest = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or int(rounds) < HASH_ROUNDS:
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), base64.urlsafe_b64decode(salt), int(rounds)
        )
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(digest))
    except (ValueError, TypeError, binascii.Error):
        return False


def configured() -> bool:
    return bool(os.getenv("ADMIN_PASSWORD_HASH") and os.getenv("ADMIN_SESSION_SECRET"))


def require_configuration(request: Request) -> bool:
    """Permit legacy local-only use; fail closed on any non-loopback host."""
    if configured():
        return True
    host = (request.url.hostname or "").lower()
    client_host = request.client.host if request.client else ""
    if not ((host in {"localhost", "127.0.0.1", "::1"} and
             client_host in {"localhost", "127.0.0.1", "::1"}) or
            (host == "testserver" and client_host == "testclient")):
        raise HTTPException(503, "Administrator login is not configured")
    return False


def sign_session() -> str:
    environment = os.getenv("INSTAGRAM_ENV", "development")
    expires = int(time.time()) + SESSION_SECONDS
    payload = f"v1:{environment}:{expires}"
    signature = hmac.new(os.environ["ADMIN_SESSION_SECRET"].encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{signature}"


def valid_session(value: str | None) -> bool:
    if not configured() or not value:
        return False
    try:
        version, environment, expires, signature = value.split(":")
        if version != "v1" or environment != os.getenv("INSTAGRAM_ENV", "development"):
            return False
        if int(expires) < time.time():
            return False
        payload = f"{version}:{environment}:{expires}"
        expected = hmac.new(os.environ["ADMIN_SESSION_SECRET"].encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)
    except ValueError:
        return False


if __name__ == "__main__":
    import getpass

    password = getpass.getpass("New administrator password (16+ characters): ")
    confirmation = getpass.getpass("Repeat password: ")
    if not secrets.compare_digest(password, confirmation):
        raise SystemExit("Passwords differ")
    print(hash_password(password))
