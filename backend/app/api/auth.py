"""Accounts: email/password or GitHub sign-in, and connecting GitHub to an existing account.

GitHub OAuth runs in two modes, carried in the state cookie:
- "login":   find or create the account for this GitHub identity and sign in.
- "connect": attach this GitHub identity to the signed-in account.
Browser-facing failures redirect back to the app with ?error=<code> instead of returning JSON.
"""
import re
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.github_auth import TokenError, exchange, store_tokens
from app.github_client import GitHub, GitHubError
from app.models.models import User
from app.passwords import MIN_LENGTH, LoginLimiter, hash_password, verify_password
from app.security import COOKIE, current_user, make_session_token, user_from_token
from app.urls import frontend, safe_return_path

router = APIRouter(prefix="/api/auth")
STATE_COOKIE = "flowops_oauth_state"
SESSION_AGE = 7 * 86400
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
login_limiter = LoginLimiter()


def _set_session(resp: Response, user: User) -> None:
    resp.set_cookie(COOKIE, make_session_token(user.id), max_age=SESSION_AGE, httponly=True, samesite="lax",
                    secure=config.COOKIE_SECURE)


def _me(user: User) -> dict:
    return {
        "id": user.id,
        "login": user.login,
        "email": user.email,
        "avatar_url": user.avatar_url,
        "has_password": bool(user.password_hash),
        "github_login": user.github_login or None,
        "has_github": bool(user.github_token_enc),
    }


# --- email accounts ---------------------------------------------------------------------------

class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("enter a valid email address")
        return v


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("enter your name")
        return v.strip()

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < MIN_LENGTH:
            raise ValueError(f"password must be at least {MIN_LENGTH} characters")
        return v


@router.post("/register", status_code=201)
def register(body: Registration, response: Response, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    user = User(login=body.name, email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    _set_session(response, user)
    return _me(user)


@router.post("/login")
def login_with_password(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    key = f"{request.client.host if request.client else '?'}:{body.email}"
    if login_limiter.blocked(key):
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    user = db.scalar(select(User).where(User.email == body.email))
    if not verify_password(body.password, user.password_hash if user else None):
        login_limiter.fail(key)
        raise HTTPException(401, "Incorrect email or password.")
    login_limiter.reset(key)
    _set_session(response, user)
    return _me(user)


class PasswordChange(BaseModel):
    current_password: str | None = Field(default=None, max_length=200)
    new_password: str = Field(min_length=MIN_LENGTH, max_length=200)


@router.post("/password", status_code=204)
def set_password(body: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Set a password (GitHub-only accounts) or change it (requires the current one)."""
    if user.password_hash and not verify_password(body.current_password or "", user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    if not user.email:
        raise HTTPException(400, "Add an email address before setting a password.")
    user.password_hash = hash_password(body.new_password)
    db.commit()


@router.post("/email")
def set_email(body: Credentials, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Add an email + password to a GitHub-only account so it can sign in without GitHub."""
    if user.email:
        raise HTTPException(400, "This account already has an email address.")
    if len(body.password) < MIN_LENGTH:
        raise HTTPException(422, f"password must be at least {MIN_LENGTH} characters")
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "Another account already uses this email.")
    user.email, user.password_hash = body.email, hash_password(body.password)
    db.commit()
    return _me(user)


# --- GitHub -----------------------------------------------------------------------------------

def _authorize(mode: str, next_path: str) -> RedirectResponse:
    if not config.GITHUB_CLIENT_ID:
        raise HTTPException(500, "GITHUB_CLIENT_ID is not configured")
    nonce = secrets.token_urlsafe(16)
    # GitHub Apps ignore OAuth scopes; access comes from the app's permissions and the repos the user grants.
    qs = urlencode({"client_id": config.GITHUB_CLIENT_ID, "state": nonce})
    resp = RedirectResponse(f"https://github.com/login/oauth/authorize?{qs}")
    resp.set_cookie(STATE_COOKIE, f"{nonce}|{mode}|{safe_return_path(next_path)}", max_age=600, httponly=True,
                    samesite="lax", secure=config.COOKIE_SECURE)
    return resp


@router.get("/login")
def login_with_github():
    return _authorize("login", "/")


@router.get("/github/connect")
def connect_github(next: str = "/welcome", token: str | None = Cookie(default=None, alias=COOKIE),
                   db: Session = Depends(get_db)):
    if not user_from_token(token, db):
        return RedirectResponse(frontend("/?error=signin_required"))
    return _authorize("connect", next)


@router.get("/callback")
def callback(state: str = "", code: str | None = None, error: str | None = None,
             saved: str | None = Cookie(default=None, alias=STATE_COOKIE),
             token: str | None = Cookie(default=None, alias=COOKIE), db: Session = Depends(get_db)):
    nonce, mode, next_path = (saved.split("|", 2) + ["", "", ""])[:3] if saved else ("", "", "")

    def fail(code_: str) -> RedirectResponse:
        target = next_path if mode == "connect" else "/"
        resp = RedirectResponse(frontend(f"{safe_return_path(target).split('?')[0]}?error={code_}"))
        resp.delete_cookie(STATE_COOKIE)
        return resp

    if not nonce or not state or not secrets.compare_digest(state, nonce):
        return fail("github_state")
    if error or not code:
        return fail("github_denied")
    try:
        tokens = exchange({"code": code})
        gh = GitHub(tokens["access_token"]).get("/user")
    except (TokenError, GitHubError):
        return fail("github_failed")

    linked = db.scalar(select(User).where(User.github_id == gh["id"]))
    if mode == "connect":
        user = user_from_token(token, db)
        if not user:
            return fail("signin_required")
        if linked and linked.id != user.id:
            return fail("github_in_use")
        destination = next_path
    else:
        user = linked
        new_account = user is None
        if new_account:
            user = User(login=gh.get("name") or gh["login"])
            db.add(user)
        destination = "/welcome" if new_account else "/"

    user.github_id, user.github_login = gh["id"], gh["login"]
    if not user.avatar_url:
        user.avatar_url = gh.get("avatar_url", "")
    store_tokens(user, tokens)
    db.commit()
    resp = RedirectResponse(frontend(destination))
    _set_session(resp, user)
    resp.delete_cookie(STATE_COOKIE)
    return resp


@router.post("/github/disconnect")
def disconnect_github(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.password_hash:
        raise HTTPException(400, "Set a password first, otherwise you couldn't sign in again.")
    user.github_id, user.github_login = None, ""
    user.github_token_enc = user.github_refresh_enc = ""
    user.github_token_expires_at = None
    db.commit()
    # Removing the token doesn't uninstall the GitHub App; that's done on GitHub.
    return {**_me(user), "manage_url": "https://github.com/settings/installations"}


# --- session ----------------------------------------------------------------------------------

@router.get("/options")
def options():
    install_url = f"https://github.com/apps/{config.GITHUB_APP_SLUG}/installations/new" if config.GITHUB_APP_SLUG else None
    return {"github": bool(config.GITHUB_CLIENT_ID), "dev_login": config.DEV_LOGIN, "github_install_url": install_url}


@router.post("/dev-login")
def dev_login(db: Session = Depends(get_db)):
    if not config.DEV_LOGIN:
        raise HTTPException(404, "not found")
    user = db.scalar(select(User).where(User.email == "dev@localhost")) or User(login="Dev", email="dev@localhost")
    db.add(user)
    db.commit()
    resp = RedirectResponse(frontend("/"), status_code=303)
    _set_session(resp, user)
    return resp


@router.get("/me")
def me(user: User = Depends(current_user)):
    return _me(user)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE)
