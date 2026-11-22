"""Proxy for Docker Hub image search. Docker Hub sends no CORS headers, so the browser can't call it directly."""
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.models.models import User
from app.security import current_user

router = APIRouter(prefix="/api/dockerhub")
SEARCH_URL = "https://hub.docker.com/v2/search/repositories/"
TAGS_URL = "https://hub.docker.com/v2/repositories/{repo}/tags"
RECENT_PAGES = 4  # 400 most recently updated tags cover every maintained version of busy images
# Docker Hub repository names: optional namespace, lowercase alphanumerics with . _ - separators.
_PART = r"[a-z0-9]+(?:[._-][a-z0-9]+)*"
REPO_RE = re.compile(rf"^{_PART}(?:/{_PART})?$")
# "3.12.15-slim-trixie" -> version "3.12.15", variant "slim-trixie"; "3.16.0a1", "3.16-rc", "18beta1" are prereleases.
TAG_RE = re.compile(r"^(?P<version>\d+(?:\.\d+)*(?:(?:a|b|rc)\d+|alpha\d*|beta\d*)?)(?:-(?P<variant>.+))?$")
PRERELEASE_RE = re.compile(
    r"(?:\d(?:(?:a|b|rc)\d+|alpha\d*|beta\d*)(?:-|$))|(?:^|-)(?:rc|alpha|beta|dev|nightly|edge)(?:-|$)"
)
WINDOWS_RE = re.compile(r"windowsservercore|nanoserver|ltsc\d{4}")
CACHE_TTL = 600
_cache: dict[str, tuple[float, list[dict]]] = {}  # keyed by "search:<q>" / "tags:<repo>:<q>"
transport: httpx.BaseTransport | None = None  # swapped in tests


def _fetch(url: str, params: dict) -> dict:
    try:
        with httpx.Client(timeout=5, transport=transport) as http:
            r = http.get(url, params=params)
            if r.status_code == 404:
                raise HTTPException(404, "image not found on Docker Hub")
            r.raise_for_status()
            return r.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Docker Hub is unavailable")


def _cached(key: str, load) -> list[dict]:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]
    value = load()
    if len(_cache) > 1000:
        _cache.clear()
    _cache[key] = (time.monotonic(), value)
    return value


def _normalize(q: str) -> str:
    # "node:20-alpine" -> "node"; "docker.io/library/node" -> "node"
    q = q.strip().lower().split("@")[0].split(":")[0]
    for prefix in ("docker.io/", "index.docker.io/", "library/"):
        q = q.removeprefix(prefix)
    return q


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=100), _: User = Depends(current_user)):
    query = _normalize(q)
    if not query:
        return []

    def load():
        raw = _fetch(SEARCH_URL, {"query": query, "page_size": 10}).get("results", [])
        return [{"name": x["repo_name"], "description": x.get("short_description") or "",
                 "official": bool(x.get("is_official")), "stars": x.get("star_count", 0),
                 "pulls": x.get("pull_count", 0)} for x in raw]

    return _cached(f"search:{query}", load)


def _parse_tag(raw: dict) -> dict:
    name = raw["name"]
    m = TAG_RE.match(name)
    version, variant = (m["version"], m["variant"] or "") if m else ("", "" if name == "latest" else name)
    images = raw.get("images") or []
    amd64 = next((i for i in images if i.get("os") == "linux" and i.get("architecture") == "amd64"), None)
    return {
        "name": name,
        "version": version,
        "variant": variant,
        "prerelease": bool(PRERELEASE_RE.search(name)),
        "windows": bool(WINDOWS_RE.search(name)) or (bool(images) and all(i.get("os") == "windows" for i in images)),
        "size": (amd64 or {}).get("size") or raw.get("full_size") or 0,
        "updated": raw.get("last_updated") or "",
    }


@router.get("/tags")
def tags(image: str = Query(min_length=1, max_length=200), q: str = Query(default="", max_length=128),
         _: User = Depends(current_user)):
    """Tags for an image. Without `q`: the most recently updated tags (for version/variant pickers).
    With `q`: tags whose name contains it, which also reaches old versions."""
    name = _normalize(image)
    if not REPO_RE.match(name):
        return []  # other registries (ghcr.io/..., gcr.io/...) aren't searchable here
    repo = name if "/" in name else f"library/{name}"
    q = q.strip()
    url = TAGS_URL.format(repo=repo)

    def load():
        if q:
            pages = [_fetch(url, {"page_size": 100, "name": q, "ordering": "last_updated"})]
        else:
            pages = []
            for page in range(1, RECENT_PAGES + 1):
                data = _fetch(url, {"page_size": 100, "page": page, "ordering": "last_updated"})
                pages.append(data)
                if not data.get("next"):
                    break
        return [_parse_tag(t) for p in pages for t in p.get("results", [])]

    return _cached(f"tags:{repo}:{q.lower()}", load)
