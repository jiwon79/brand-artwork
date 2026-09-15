from __future__ import annotations

import ipaddress
import socket
from functools import lru_cache
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


MAX_HTML_BYTES = 512_000


class PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self.title = ""
        self._inside_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value for key, value in attrs if value}
        if tag.lower() == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            content = values.get("content", "").strip()
            if key and content and key not in self.meta:
                self.meta[key] = content
        if tag.lower() == "title":
            self._inside_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._inside_title = False

    def handle_data(self, data: str) -> None:
        if self._inside_title:
            self.title += data


def is_public_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
        return bool(addresses) and all(ipaddress.ip_address(address).is_global for address in addresses)
    except (OSError, ValueError):
        return False


def parse_preview_html(url: str, html: str) -> dict[str, str]:
    parser = PreviewParser()
    parser.feed(html)
    image = parser.meta.get("og:image") or parser.meta.get("twitter:image") or ""
    image_url = urljoin(url, image) if image else ""
    if image_url and not is_public_url(image_url):
        image_url = ""
    title = parser.meta.get("og:title") or parser.meta.get("twitter:title") or parser.title
    return {"url": url, "title": " ".join(title.split()), "image_url": image_url}


class SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # type: ignore[no-untyped-def]
        if not is_public_url(new_url):
            raise ValueError("Unsafe redirect URL")
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


@lru_cache(maxsize=128)
def fetch_link_preview(url: str) -> dict[str, str]:
    if not is_public_url(url):
        return {"url": url, "title": "", "image_url": ""}
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; InstagramAssistant/1.0)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with build_opener(SafeRedirectHandler()).open(request, timeout=5) as response:
            content_type = response.headers.get_content_type()
            if content_type not in {"text/html", "application/xhtml+xml"}:
                return {"url": url, "title": "", "image_url": ""}
            final_url = response.geturl()
            if not is_public_url(final_url):
                return {"url": url, "title": "", "image_url": ""}
            charset = response.headers.get_content_charset() or "utf-8"
            html = response.read(MAX_HTML_BYTES + 1)[:MAX_HTML_BYTES].decode(charset, errors="replace")
            return parse_preview_html(final_url, html)
    except (LookupError, OSError, ValueError):
        return {"url": url, "title": "", "image_url": ""}
