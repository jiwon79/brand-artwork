"""Isolated Meta credentials for development and production apps."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class MetaConfig:
    app_id: str
    app_secret: str
    redirect_uri: str
    webhook_verify_token: str
    webhook_app_secret: str


def get_meta_config() -> MetaConfig:
    environment = os.getenv("INSTAGRAM_ENV", "").strip()
    if not environment:
        # Existing loopback installation; new deployments must set INSTAGRAM_ENV.
        return MetaConfig(
            os.getenv("INSTAGRAM_APP_ID", ""),
            os.getenv("INSTAGRAM_APP_SECRET", ""),
            os.getenv("INSTAGRAM_REDIRECT_URI", ""),
            os.getenv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", ""),
            os.getenv("INSTAGRAM_WEBHOOK_APP_SECRET", os.getenv("INSTAGRAM_APP_SECRET", "")),
        )
    if environment not in {"development", "production"}:
        raise RuntimeError("INSTAGRAM_ENV must be development or production")
    prefix = "META_DEV_" if environment == "development" else "META_PROD_"
    other = "META_PROD_APP_ID" if environment == "development" else "META_DEV_APP_ID"
    app_id = os.getenv(prefix + "APP_ID", "")
    if app_id and app_id == os.getenv(other, ""):
        raise RuntimeError("Development and production Meta app IDs must differ")
    return MetaConfig(
        app_id,
        os.getenv(prefix + "APP_SECRET", ""),
        os.getenv(prefix + "REDIRECT_URI", ""),
        os.getenv(prefix + "WEBHOOK_VERIFY_TOKEN", ""),
        os.getenv(prefix + "WEBHOOK_APP_SECRET", os.getenv(prefix + "APP_SECRET", "")),
    )
