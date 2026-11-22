import json

import httpx
import pytest

from app.api.github import get_github
from app.github_client import GitHub
from app.main import app
from fastapi.testclient import TestClient


class FakeGitHub:
    """Minimal in-memory model of the Git Data + Pulls APIs for one repo."""

    def __init__(self):
        self.refs = {"main": "c0"}
        self.commits = {"c0": {"tree": "t0", "parents": []}}
        self.trees = {"t0": {"README.md": "hi"}}
        self.pulls = []
        self.calls = []
        self.n = 0
        self.language = "Python"

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def handler(self, req: httpx.Request) -> httpx.Response:
        path, m = req.url.path, req.method
        self.calls.append((m, path))
        body = json.loads(req.content) if req.content else {}
        r = "/repos/me/app"
        if path == "/user/installations":
            return httpx.Response(200, json={"installations": [{"id": 7}, {"id": 8}]})
        if path == "/user/installations/7/repositories":
            return httpx.Response(200, json={"repositories": [
                {"full_name": "me/app", "default_branch": "main", "private": False, "language": "Python",
                 "description": "demo", "permissions": {"push": True}}]})
        if path == "/user/installations/8/repositories":
            return httpx.Response(200, json={"repositories": [
                {"full_name": "org/readonly", "default_branch": "main", "private": True, "permissions": {"push": False}}]})
        if path == r:
            return httpx.Response(200, json={"full_name": "me/app", "default_branch": "main",
                                             "description": "demo", "language": self.language})
        if path.startswith(f"{r}/git/ref/heads/"):
            name = path.removeprefix(f"{r}/git/ref/heads/")
            if name not in self.refs:
                return httpx.Response(404, json={"message": "Not Found"})
            return httpx.Response(200, json={"object": {"sha": self.refs[name]}})
        if path.startswith(f"{r}/git/commits/") and m == "GET":
            return httpx.Response(200, json={"tree": {"sha": self.commits[path.rsplit('/', 1)[1]]["tree"]}})
        if path == f"{r}/git/trees" and m == "POST":
            files = dict(self.trees[body["base_tree"]])
            files |= {e["path"]: e["content"] for e in body["tree"]}
            sha = self._id("t")
            self.trees[sha] = files
            return httpx.Response(201, json={"sha": sha})
        if path.startswith(f"{r}/git/trees/") and m == "GET":
            tree = self.trees[self.commits[self.refs["main"]]["tree"]]
            return httpx.Response(200, json={"tree": [{"path": p, "type": "blob", "size": len(c)} for p, c in tree.items()]})
        if path.startswith(f"{r}/contents/"):
            return httpx.Response(200, text=self.trees[self.commits[self.refs["main"]]["tree"]][path.removeprefix(f"{r}/contents/")])
        if path == f"{r}/git/commits" and m == "POST":
            sha = self._id("c")
            self.commits[sha] = {"tree": body["tree"], "parents": body["parents"]}
            return httpx.Response(201, json={"sha": sha})
        if path == f"{r}/git/refs" and m == "POST":
            self.refs[body["ref"].removeprefix("refs/heads/")] = body["sha"]
            return httpx.Response(201, json={})
        if path.startswith(f"{r}/git/refs/heads/") and m == "PATCH":
            name = path.removeprefix(f"{r}/git/refs/heads/")
            if self.refs[name] not in self.commits[body["sha"]]["parents"]:
                return httpx.Response(422, json={"message": "Update is not a fast forward"})
            self.refs[name] = body["sha"]
            return httpx.Response(200, json={})
        if path == f"{r}/pulls" and m == "GET":
            head = req.url.params["head"].split(":")[1]
            return httpx.Response(200, json=[p for p in self.pulls if p["head"] == head])
        if path == f"{r}/pulls" and m == "POST":
            pr = {"head": body["head"], "html_url": f"https://github.com/me/app/pull/{len(self.pulls) + 1}"}
            self.pulls.append(pr)
            return httpx.Response(201, json=pr)
        return httpx.Response(500, json={"message": f"unhandled {m} {path}"})

    def files_on(self, branch):
        return self.trees[self.commits[self.refs[branch]]["tree"]]


@pytest.fixture()
def fake(alice):
    gh = FakeGitHub()
    app.dependency_overrides[get_github] = lambda: GitHub("t", transport=httpx.MockTransport(gh.handler))
    yield gh


PIPE = {"nodes": [{"id": "t", "type": "trigger"}, {"id": "c", "type": "checkout"}], "edges": [{"source": "t", "target": "c"}]}
DOCKER = {"nodes": [{"id": "f", "type": "from", "params": {"image": "alpine"}}], "edges": []}


def test_push_creates_branch_commit_and_pr(alice, fake):
    r = alice.post("/api/github/push", json={"repo": "me/app", "graphs": {"pipeline": PIPE, "dockerfile": DOCKER,
                                                                             "compose": {"nodes": [], "edges": []}}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["files"] == [".github/workflows/ci.yml", "Dockerfile"]
    assert out["pr_url"] == "https://github.com/me/app/pull/1"
    files = fake.files_on("flowops/config")
    assert files["README.md"] == "hi"  # existing repo content kept
    assert files["Dockerfile"] == "FROM alpine\n"
    assert fake.refs["main"] == "c0"  # base branch untouched


def test_second_push_fast_forwards_branch_and_reuses_pr(alice, fake):
    body = {"repo": "me/app", "graphs": {"dockerfile": DOCKER}}
    alice.post("/api/github/push", json=body)
    first = fake.refs["flowops/config"]
    body["graphs"]["dockerfile"] = {"nodes": [{"id": "f", "type": "from", "params": {"image": "debian"}}], "edges": []}
    out = alice.post("/api/github/push", json=body).json()
    assert fake.commits[fake.refs["flowops/config"]]["parents"] == [first]
    assert fake.files_on("flowops/config")["Dockerfile"] == "FROM debian\n"
    assert out["pr_url"].endswith("/pull/1") and len(fake.pulls) == 1


def test_push_to_default_branch_skips_pr(alice, fake):
    out = alice.post("/api/github/push", json={"repo": "me/app", "branch": "main", "graphs": {"dockerfile": DOCKER}}).json()
    assert out["pr_url"] is None and fake.files_on("main")["Dockerfile"] == "FROM alpine\n"


@pytest.mark.parametrize("override", [{"repo": "../etc"}, {"repo": "me/.."}, {"repo": "me"}, {"branch": "a..b"}, {"branch": "/x"}, {"graphs": {"evil": DOCKER}}])
def test_push_rejects_bad_input(alice, fake, override):
    body = {"repo": "me/app", "graphs": {"dockerfile": DOCKER}} | override
    assert alice.post("/api/github/push", json=body).status_code == 422
    assert not any(m == "POST" for m, _ in fake.calls)


def test_push_invalid_graph_is_422_before_touching_github(alice, fake):
    bad = {"nodes": [{"id": "f", "type": "from", "params": {}}], "edges": []}
    r = alice.post("/api/github/push", json={"repo": "me/app", "graphs": {"dockerfile": bad}})
    assert r.status_code == 422 and "image" in r.json()["detail"]
    assert fake.calls == []


def test_recommend_rejects_bad_repo(alice, fake):
    assert alice.post("/api/github/recommend", json={"repo": "../../user"}).status_code == 422
    assert fake.calls == []


def test_recommend_from_repo(alice, fake):
    fake.trees["t0"] |= {"requirements.txt": "fastapi\n", "node_modules/x/package.json": '{"dependencies":{"next":"1"}}'}
    out = alice.post("/api/github/recommend", json={"repo": "me/app"}).json()
    assert [r["key"] for r in out["recommendations"]] == ["fastapi"]
    assert out["repo"]["language"] == "Python" and out["repo"]["manifests"] == ["requirements.txt"]


def test_recommend_falls_back_to_repo_language(alice, fake):
    fake.language = "Go"
    out = alice.post("/api/github/recommend", json={"repo": "me/app"}).json()
    assert [r["key"] for r in out["recommendations"]] == ["go"]
    assert out["recommendations"][0]["reasons"] == ["repository language is Go"]


def test_repos_lists_only_granted_repos_with_push(alice, fake):
    repos = alice.get("/api/github/repos").json()
    assert [r["full_name"] for r in repos] == ["me/app"]
    assert ("GET", "/user/repos") not in fake.calls  # never enumerates everything the user owns


@pytest.mark.parametrize("state,expected", [
    ("/p/3", "http://localhost:5173/p/3"), (None, "http://localhost:5173/"),
    ("//evil.com", "http://localhost:5173/"), ("https://evil.com", "http://localhost:5173/"),
    ("/\\evil.com", "http://localhost:5173/"),
])
def test_setup_redirect_is_same_site_only(db_session, state, expected):
    c = TestClient(app, follow_redirects=False)
    r = c.get("/api/github/setup", params={"installation_id": 1, "setup_action": "install"} | ({"state": state} if state else {}))
    assert r.headers["location"] == expected


def test_github_features_need_github_login(alice):
    # alice has no stored token; the real dependency is in effect
    assert alice.get("/api/github/repos").status_code == 400


def test_me_reports_github_link(alice):
    assert alice.get("/api/auth/me").json()["has_github"] is False


def test_expired_token_is_refreshed(db_session, alice, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app import github_auth
    from app.models.models import User
    from app.security import decrypt, encrypt

    user = db_session.query(User).filter_by(login="alice").one()
    user.github_token_enc, user.github_refresh_enc = encrypt("old"), encrypt("r1")
    user.github_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()
    seen = {}

    def fake_exchange(params):
        seen.update(params)
        return {"access_token": "new", "refresh_token": "r2", "expires_in": 28800}

    monkeypatch.setattr(github_auth, "exchange", fake_exchange)
    assert github_auth.access_token(user, db_session) == "new"
    assert seen == {"grant_type": "refresh_token", "refresh_token": "r1"}
    assert decrypt(user.github_refresh_enc) == "r2"
    assert github_auth.access_token(user, db_session) == "new"  # fresh token: no second refresh


def test_recommend_returns_hints(alice, fake):
    fake.trees["t0"] |= {"Cargo.toml": "[package]\nname = 'ledger'\n"}
    out = alice.post("/api/github/recommend", json={"repo": "me/app"}).json()
    assert out["hints"] == {"rust_binary": "ledger"}
