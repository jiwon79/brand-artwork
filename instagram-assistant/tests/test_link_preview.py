from app.link_preview import is_public_url, parse_preview_html


def test_parse_preview_prefers_open_graph_image(monkeypatch):
    monkeypatch.setattr("app.link_preview.is_public_url", lambda value: True)
    result = parse_preview_html(
        "https://studio.jiiwon.com/color-text",
        '<meta property="og:title" content="Color Text">'
        '<meta property="og:image" content="assets/og-image.jpg">',
    )

    assert result == {
        "url": "https://studio.jiiwon.com/color-text",
        "title": "Color Text",
        "image_url": "https://studio.jiiwon.com/assets/og-image.jpg",
    }


def test_parse_preview_falls_back_to_document_title(monkeypatch):
    monkeypatch.setattr("app.link_preview.is_public_url", lambda value: True)
    result = parse_preview_html("https://example.com/work", "<title>  Example   Work </title>")

    assert result["title"] == "Example Work"
    assert result["image_url"] == ""


def test_private_and_non_http_urls_are_rejected():
    assert not is_public_url("http://127.0.0.1/private")
    assert not is_public_url("file:///etc/passwd")
