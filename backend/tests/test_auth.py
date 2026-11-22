import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.main import app
from app.models.models import User
from app.security import COOKIE, decrypt

FRONT = "http://localhost:5173"


@pytest.fixture()
def client(db_session):
    auth.login_limiter._failures.clear()
    return TestClient(app, follow_redirects=False)


def register(c, email="Ada@Example.com", password="correct horse", name="Ada"):
    return c.post("/api/auth/register", json={"name": name, "email": email, "password": password})


# --- email accounts


def test_register_signs_in_and_normalizes_email(client):
    r = register(client)
    assert r.status_code == 201 and COOKIE in r.cookies
    me = client.get("/api/auth/me").json()
    assert me["email"] == "ada@example.com" and me["login"] == "Ada"
    assert me["has_password"] and not me["has_github"] and me["github_login"] is None


@pytest.mark.parametrize("body,status", [
    ({"name": "A", "email": "not-an-email", "password": "longenough"}, 422),
    ({"name": "A", "email": "a@b.co", "password": "short"}, 422),
    ({"name": "  ", "email": "a@b.co", "password": "longenough"}, 422),
])
def test_register_validation(client, body, status):
    assert client.post("/api/auth/register", json=body).status_code == status


def test_duplicate_email_rejected(client):
    register(client)
    r = register(TestClient(app), email="ada@example.com")
    assert r.status_code == 409


def test_login_logout(client, db_session):
    register(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope-nope"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "ADA@example.com", "password": "correct horse"})
    assert r.status_code == 200 and client.get("/api/auth/me").json()["login"] == "Ada"
    stored = db_session.query(User).one().password_hash
    assert stored.startswith("scrypt$") and "correct horse" not in stored


def test_unknown_email_and_wrong_password_look_the_same(client):
    register(client)
    a = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "wrong-pass"})
    b = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_login_rate_limited(client):
    register(client)
    for _ in range(10):
        client.post("/api/auth/login", json={"email": "ada@example.com", "password": "wrong-pass"})
    r = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "correct horse"})
    assert r.status_code == 429


# --- GitHub OAuth


class FakeGitHubAPI:
    users = {"gho_ada": {"id": 101, "login": "ada-gh", "name": "Ada L", "avatar_url": "http://a/ada.png"},
             "gho_bob": {"id": 202, "login": "bob-gh", "name": None, "avatar_url": ""}}

    def __init__(self, token):
        self.token = token

    def get(self, path):
        assert path == "/user"
        return self.users[self.token]


@pytest.fixture()
def github(monkeypatch):
    monkeypatch.setattr(auth, "GitHub", FakeGitHubAPI)
    monkeypatch.setattr(auth.config, "GITHUB_CLIENT_ID", "Iv1.test")
    monkeypatch.setattr(auth, "exchange", lambda p: {"access_token": {"code-ada": "gho_ada", "code-bob": "gho_bob"}[p["code"]]})


def oauth(c, start: str, code: str, **extra):
    r = c.get(start)
    if r.headers["location"].startswith(FRONT):  # refused before reaching GitHub
        return r
    state = r.headers["location"].split("state=")[1]
    return c.get("/api/auth/callback", params={"state": state, "code": code} | extra)


def test_github_signup_creates_account_and_goes_to_onboarding(client, github, db_session):
    r = oauth(client, "/api/auth/login", "code-ada")
    assert r.headers["location"] == f"{FRONT}/welcome"
    me = client.get("/api/auth/me").json()
    assert me["login"] == "Ada L" and me["github_login"] == "ada-gh" and me["has_github"] and not me["has_password"]
    assert decrypt(db_session.query(User).one().github_token_enc) == "gho_ada"


def test_github_login_existing_account_goes_home(client, github, db_session):
    oauth(client, "/api/auth/login", "code-ada")
    client.post("/api/auth/logout")
    r = oauth(client, "/api/auth/login", "code-ada")
    assert r.headers["location"] == f"{FRONT}/"
    assert db_session.query(User).count() == 1


def test_connect_github_to_email_account(client, github, db_session):
    register(client)
    r = oauth(client, "/api/auth/github/connect?next=/welcome", "code-ada")
    assert r.headers["location"] == f"{FRONT}/welcome"
    me = client.get("/api/auth/me").json()
    assert me["email"] == "ada@example.com" and me["github_login"] == "ada-gh" and me["login"] == "Ada"
    assert db_session.query(User).count() == 1


def test_connect_refuses_github_account_owned_by_someone_else(client, github):
    oauth(TestClient(app, follow_redirects=False), "/api/auth/login", "code-ada")  # another person signed up with it
    register(client)
    r = oauth(client, "/api/auth/github/connect?next=/welcome", "code-ada")
    assert r.headers["location"] == f"{FRONT}/welcome?error=github_in_use"
    assert client.get("/api/auth/me").json()["has_github"] is False


def test_connect_requires_session(client, github):
    r = client.get("/api/auth/github/connect")
    assert r.headers["location"] == f"{FRONT}/?error=signin_required"


@pytest.mark.parametrize("extra,code,error", [
    ({"state": "forged"}, "code-ada", "github_state"),
    ({"error": "access_denied"}, None, "github_denied"),
])
def test_callback_failures_redirect_with_error(client, github, extra, code, error):
    r = client.get("/api/auth/login")
    state = r.headers["location"].split("state=")[1]
    params = {"state": state} | ({"code": code} if code else {}) | extra
    r = client.get("/api/auth/callback", params=params)
    assert r.headers["location"] == f"{FRONT}/?error={error}"
    assert client.get("/api/auth/me").status_code == 401


def test_open_redirect_blocked_in_next(client, github):
    register(client)
    r = oauth(client, "/api/auth/github/connect?next=//evil.com", "code-ada")
    assert r.headers["location"] == f"{FRONT}/"


def test_disconnect_needs_password_then_works(client, github):
    oauth(client, "/api/auth/login", "code-bob")
    assert client.post("/api/auth/github/disconnect").status_code == 400
    assert client.post("/api/auth/email", json={"email": "bob@example.com", "password": "bobs-password"}).status_code == 200
    r = client.post("/api/auth/github/disconnect")
    assert r.status_code == 200 and r.json()["has_github"] is False and r.json()["github_login"] is None
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "bob@example.com", "password": "bobs-password"}).status_code == 200


def test_change_password(client):
    register(client)
    assert client.post("/api/auth/password", json={"current_password": "wrong", "new_password": "new-password-1"}).status_code == 400
    assert client.post("/api/auth/password", json={"current_password": "correct horse", "new_password": "new-password-1"}).status_code == 204
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "ada@example.com", "password": "new-password-1"}).status_code == 200
