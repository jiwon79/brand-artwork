"""Small authenticated command-line client for the deployed assistant API."""

from __future__ import annotations

import argparse
import getpass
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener


DEFAULT_URLS = {
    "dev": "https://instagram-assistant-dev.vercel.app",
    "prod": "https://instagram-assistant-prod.vercel.app",
    "local": "http://127.0.0.1:4318",
}
TOKEN_FILE = Path.home() / "Library/Application Support/InstagramAssistant/local-token"


class CliError(Exception):
    pass


class Client:
    def __init__(self, base_url: str, token: str | None = None):
        parsed = urlparse(base_url)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in
                                                    {"localhost", "127.0.0.1", "::1"}):
            raise CliError("URL must use HTTPS, except for localhost")
        if (not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"}
                or parsed.query or parsed.fragment):
            raise CliError("URL must be an origin without credentials or path")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method: str, path: str, *, params: dict[str, Any] | None = None,
                body: dict[str, Any] | None = None, form: dict[str, str] | None = None) -> Any:
        url = self.base_url + path
        if params:
            url += "?" + urlencode({key: value for key, value in params.items() if value is not None})
        headers = {"Accept": "application/json", "Origin": self.base_url}
        if path == "/api/viewer/sync":
            headers["X-Requested-With"] = "InstagramAssistant"
        if self.token:
            headers["X-Instagram-Assistant-Token"] = self.token
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif form is not None:
            data = urlencode(form).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = None
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=600 if path == "/api/viewer/sync" else 45) as response:
                if path == "/api/admin/login":
                    return None  # A 303 redirect may have opened the HTML dashboard.
                return json.load(response)
        except HTTPError as exc:
            try:
                detail = json.load(exc).get("detail", exc.reason)
            except (ValueError, AttributeError):
                detail = exc.reason
            raise CliError(f"HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise CliError(f"Request failed: {exc.reason if isinstance(exc, URLError) else exc}") from exc

    def login(self, password: str) -> None:
        # Authentication lives only in this process's in-memory cookie jar.
        self.request("POST", "/api/admin/login", form={"password": password})


def secret_from_keychain(service: str, account: str) -> str | None:
    try:
        result = subprocess.run(["security", "find-generic-password", "-s", service,
                                 "-a", account, "-w"], check=False, capture_output=True, text=True)
    except FileNotFoundError:
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Instagram assistant hosted API client")
    p.add_argument("--env", choices=DEFAULT_URLS, required=True, help="Select the backend explicitly")
    p.add_argument("--base-url", help="Override the selected backend origin (HTTPS or localhost)")
    p.add_argument("--password-stdin", action="store_true", help="Read admin password from stdin")
    p.add_argument("--keychain-service", help="Override the admin password Keychain service")
    p.add_argument("--keychain-account", default="jiwon")
    p.add_argument("--pretty", action="store_true", help="Indent JSON output")
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    conversations = commands.add_parser("conversations")
    conversations.add_argument("--status", choices=["active", "completed", "all"])
    conversation = commands.add_parser("conversation")
    conversation.add_argument("thread_id")
    events = commands.add_parser("events")
    events.add_argument("--kind", choices=["dm", "comment"])
    events.add_argument("--status", choices=["active", "completed", "all", "pending", "drafted", "sent"])
    events.add_argument("--limit", type=int, default=100)
    event = commands.add_parser("event")
    event.add_argument("event_id")
    sync = commands.add_parser("sync")
    sync.add_argument("--scope", choices=["all", "dm"], default="dm")
    sync.add_argument("--user-id", help="Instagram-scoped user ID for a single DM conversation")
    sync.add_argument("--dm-limit", type=int, default=100)
    draft = commands.add_parser("draft")
    draft.add_argument("event_id")
    text_input = draft.add_mutually_exclusive_group(required=True)
    text_input.add_argument("--text", help="Exact reply text")
    text_input.add_argument("--text-stdin", action="store_true", help="Read exact reply text from stdin")
    send = commands.add_parser("send")
    send.add_argument("event_id")
    send.add_argument("--expect-draft", required=True, help="Must exactly match the saved draft")
    send.add_argument("--yes", action="store_true", required=True, help="Actually send the reply")
    for name in ("heart", "heart-observed", "ignore"):
        action = commands.add_parser(name)
        action.add_argument("event_id")
        action.add_argument("--yes", action="store_true", required=True, help="Actually apply this action")
    return p


def run(args: argparse.Namespace) -> Any:
    if args.password_stdin and getattr(args, "text_stdin", False):
        raise CliError("--password-stdin and --text-stdin cannot share stdin")
    if args.base_url and args.env != "local" and not args.password_stdin and not os.getenv("INSTAGRAM_ASSISTANT_ADMIN_PASSWORD"):
        raise CliError("A custom hosted URL requires --password-stdin or INSTAGRAM_ASSISTANT_ADMIN_PASSWORD")
    if args.base_url and args.env == "local" and urlparse(args.base_url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise CliError("The local token may only be sent to localhost")
    token = None
    if args.env == "local":
        try:
            token = TOKEN_FILE.read_text().strip()
        except FileNotFoundError as exc:
            raise CliError(f"Local token missing: {TOKEN_FILE}") from exc
    client = Client(args.base_url or DEFAULT_URLS[args.env], token)
    if args.env != "local":
        if args.password_stdin:
            password = sys.stdin.readline().rstrip("\r\n")
        else:
            password = os.getenv("INSTAGRAM_ASSISTANT_ADMIN_PASSWORD") or secret_from_keychain(
                args.keychain_service or f"Instagram Assistant {'Dev' if args.env == 'dev' else 'Prod'} Admin",
                args.keychain_account)
            if not password and sys.stdin.isatty():
                password = getpass.getpass("Administrator password: ")
        if not password:
            raise CliError("Admin password unavailable; use Keychain, the password environment variable, or --password-stdin")
        client.login(password)
    if args.command == "status":
        return client.request("GET", "/api/status")
    if args.command == "conversations":
        return client.request("GET", "/api/conversations", params={"status": None if args.status == "all" else args.status})
    if args.command == "conversation":
        return client.request("GET", "/api/conversations/" + quote(args.thread_id, safe=""))
    if args.command == "events":
        if not 1 <= args.limit <= 500:
            raise CliError("--limit must be between 1 and 500")
        return client.request("GET", "/api/events", params={"kind": args.kind,
                                                                "status": None if args.status == "all" else args.status,
                                                                "limit": args.limit})
    if args.command == "sync":
        if args.user_id and args.scope != "dm":
            raise CliError("--user-id requires --scope dm")
        if not 1 <= args.dm_limit <= 100:
            raise CliError("--dm-limit must be between 1 and 100")
        return client.request("POST", "/api/viewer/sync", params={"scope": args.scope,
            "user_id": args.user_id, "dm_limit": args.dm_limit}, body={})
    path = "/api/events/" + quote(args.event_id, safe="")
    if args.command == "event":
        return client.request("GET", path)
    if args.command == "draft":
        reply = sys.stdin.read() if args.text_stdin else args.text
        if not reply.strip():
            raise CliError("Reply text is empty")
        return client.request("PATCH", path + "/draft", body={"draft": reply})
    if not args.yes:
        raise CliError("This action requires --yes")
    if args.command == "send":
        current = client.request("GET", path)
        if current.get("status") != "drafted" or current.get("draft") != args.expect_draft:
            raise CliError("Saved draft/status does not match --expect-draft; nothing was sent")
    return client.request("POST", path + "/" + args.command)


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        result = run(args)
    except CliError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
