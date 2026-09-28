"""Persistent encrypted Meta token and OAuth state storage for Turso deployments."""
from __future__ import annotations

import json
import os

from cryptography.fernet import Fernet, InvalidToken

from .config import paths, prepare_data_dir
from .database_backend import remote_url
from .db import delete_private_state, get_private_state, set_private_state


def _cipher() -> Fernet:
    key = os.getenv("INSTAGRAM_TOKEN_ENCRYPTION_KEY", "")
    if not key:
        raise RuntimeError("INSTAGRAM_TOKEN_ENCRYPTION_KEY is required with Turso")
    return Fernet(key.encode())


def save_token(payload: dict) -> None:
    data = json.dumps(payload)
    if remote_url():
        set_private_state("graph-token", _cipher().encrypt(data.encode()).decode())
    else:
        prepare_data_dir()
        paths.session.write_text(data)
        paths.session.chmod(0o600)


def load_token() -> dict:
    if remote_url():
        ciphertext = get_private_state("graph-token")
        if not ciphertext:
            raise FileNotFoundError("No saved Meta token")
        try:
            return json.loads(_cipher().decrypt(ciphertext.encode()))
        except InvalidToken as exc:
            raise ValueError("Meta token could not be decrypted") from exc
    return json.loads(paths.session.read_text())


def has_token() -> bool:
    return get_private_state("graph-token") is not None if remote_url() else paths.session.exists()


def delete_token() -> None:
    if remote_url():
        delete_private_state("graph-token")
    else:
        paths.session.unlink(missing_ok=True)


def save_oauth_state(payload: dict) -> None:
    data = json.dumps(payload)
    if remote_url():
        set_private_state("oauth-state", data)
    else:
        prepare_data_dir()
        paths.oauth_state.write_text(data)
        paths.oauth_state.chmod(0o600)


def load_and_delete_oauth_state() -> dict:
    if remote_url():
        data = get_private_state("oauth-state")
        delete_private_state("oauth-state")
        if data is None:
            raise FileNotFoundError("No OAuth state")
        return json.loads(data)
    data = json.loads(paths.oauth_state.read_text())
    paths.oauth_state.unlink(missing_ok=True)
    return data


def delete_oauth_state() -> None:
    if remote_url():
        delete_private_state("oauth-state")
    else:
        paths.oauth_state.unlink(missing_ok=True)
