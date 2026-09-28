"""Vercel entrypoint: private viewer, public webhook, and durable queue drain."""
from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, Request
from fastapi.responses import PlainTextResponse

from .main import app
from .full_sync import run_pass
from .webhook import process_one, receive, verify


app.add_api_route("/webhook", verify, methods=["GET"], response_class=PlainTextResponse)
app.add_api_route("/webhook", receive, methods=["POST"])


@app.get("/api/cron/process-webhooks")
def process_webhooks(authorization: str | None = Header(default=None)) -> dict[str, object]:
    secret = os.getenv("CRON_SECRET", "")
    if not secret or not hmac.compare_digest(authorization or "", "Bearer " + secret):
        raise HTTPException(403)
    count = 0
    while count < 20 and process_one():
        count += 1
    return {"processed": count}


@app.get("/api/cron/full-sync")
def full_sync(authorization: str | None = Header(default=None)) -> dict[str, object]:
    secret = os.getenv("CRON_SECRET", "")
    if not secret or not hmac.compare_digest(authorization or "", "Bearer " + secret):
        raise HTTPException(403)
    count = 0
    while count < 20 and process_one():
        count += 1
    return {"webhooks_processed": count, "reconciliation": run_pass(max_seconds=240)}
