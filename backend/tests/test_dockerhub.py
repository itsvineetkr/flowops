import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import dockerhub
from app.main import app


@pytest.fixture()
def hub(monkeypatch):
    calls = []

    def handler(req: httpx.Request):
        calls.append(req.url.params["query"])
        if req.url.params["query"] == "boom":
            return httpx.Response(503)
        return httpx.Response(200, json={"results": [
            {"repo_name": "node", "short_description": "Node.js", "star_count": 1, "pull_count": 2, "is_official": True},
            {"repo_name": "cimg/node", "short_description": None, "is_official": False},
        ]})

    monkeypatch.setattr(dockerhub, "transport", httpx.MockTransport(handler))
    monkeypatch.setattr(dockerhub, "_cache", {})
    return calls


def test_search_maps_results_and_strips_tag(alice, hub):
    r = alice.get("/api/dockerhub/search", params={"q": "docker.io/library/Node:20-alpine"}).json()
    assert hub == ["node"]
    assert r[0] == {"name": "node", "description": "Node.js", "official": True, "stars": 1, "pulls": 2}
    assert r[1]["description"] == ""


def test_search_is_cached(alice, hub):
    alice.get("/api/dockerhub/search", params={"q": "node"})
    alice.get("/api/dockerhub/search", params={"q": "node:18"})
    assert hub == ["node"]


def test_search_upstream_error_is_502(alice, hub):
    assert alice.get("/api/dockerhub/search", params={"q": "boom"}).status_code == 502


def test_search_requires_login(db_session, hub):
    assert TestClient(app).get("/api/dockerhub/search", params={"q": "node"}).status_code == 401


def tag(name, os="linux", arch="amd64", size=50_000_000):
    return {"name": name, "full_size": 1, "last_updated": "2026-10-24T00:00:00Z",
            "images": [{"os": os, "architecture": arch, "size": size}]}


@pytest.fixture()
def tag_hub(monkeypatch):
    calls = []
    pages = {1: ["3.12-slim", "3.12.15-slim-trixie", "latest", "18beta1-alpine"], 2: ["slim", "3.16.0a1-slim", "3.16-rc-alpine"]}

    def handler(req: httpx.Request):
        calls.append((req.url.path, dict(req.url.params)))
        if "nope" in req.url.path:
            return httpx.Response(404)
        if req.url.params.get("name"):
            return httpx.Response(200, json={"results": [tag("3.8-slim"), tag("3.8-windowsservercore", os="windows")], "next": None})
        page = int(req.url.params.get("page", 1))
        return httpx.Response(200, json={"results": [tag(n) for n in pages[page]], "next": "more" if page == 1 else None})

    monkeypatch.setattr(dockerhub, "transport", httpx.MockTransport(handler))
    monkeypatch.setattr(dockerhub, "_cache", {})
    return calls


def test_tags_parses_version_and_variant(alice, tag_hub):
    out = {t["name"]: t for t in alice.get("/api/dockerhub/tags", params={"image": "python"}).json()}
    assert [p for p, _ in tag_hub] == ["/v2/repositories/library/python/tags"] * 2  # paged until no `next`
    assert (out["3.12.15-slim-trixie"]["version"], out["3.12.15-slim-trixie"]["variant"]) == ("3.12.15", "slim-trixie")
    assert (out["slim"]["version"], out["slim"]["variant"]) == ("", "slim")
    assert (out["latest"]["version"], out["latest"]["variant"]) == ("", "")
    assert out["3.16.0a1-slim"]["prerelease"] and out["3.16-rc-alpine"]["prerelease"]
    assert out["18beta1-alpine"]["prerelease"] and out["18beta1-alpine"]["version"] == "18beta1"
    assert not out["3.12-slim"]["prerelease"] and out["3.12-slim"]["size"] == 50_000_000


def test_tags_query_uses_name_filter_and_flags_windows(alice, tag_hub):
    out = alice.get("/api/dockerhub/tags", params={"image": "Python:3.12", "q": "3.8"}).json()
    assert tag_hub[0][1]["name"] == "3.8"
    assert [t["windows"] for t in out] == [False, True]


def test_tags_namespaced_image_and_other_registries(alice, tag_hub):
    alice.get("/api/dockerhub/tags", params={"image": "bitnami/redis"})
    assert tag_hub[0][0] == "/v2/repositories/bitnami/redis/tags"
    assert alice.get("/api/dockerhub/tags", params={"image": "gcr.io/distroless/static"}).json() == []
    assert alice.get("/api/dockerhub/tags", params={"image": "../../x"}).json() == []


def test_tags_unknown_image_is_404(alice, tag_hub):
    assert alice.get("/api/dockerhub/tags", params={"image": "nope"}).status_code == 404
