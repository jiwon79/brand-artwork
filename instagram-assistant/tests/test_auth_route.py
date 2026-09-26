from fastapi.testclient import TestClient

from app import main


def test_oauth_start_requires_local_token_and_uses_post(monkeypatch):
    monkeypatch.setattr(main.instagram_service, "authorization_url", lambda: "https://www.instagram.com/oauth/authorize")
    with TestClient(main.app) as client:
        assert client.get("/api/auth/url").status_code == 405
        assert client.post("/api/auth/url").status_code == 403
        response = client.post("/api/auth/url", headers={"X-Instagram-Assistant-Token": main.TOKEN})
    assert response.status_code == 200
    assert response.json()["url"] == "https://www.instagram.com/oauth/authorize"
