"""GitHub App user-to-server tokens: storing them and refreshing them when they expire."""
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app import config
from app.models.models import User
from app.security import decrypt, encrypt

TOKEN_URL = "https://github.com/login/oauth/access_token"
REFRESH_MARGIN = timedelta(minutes=5)


class TokenError(Exception):
    pass


def exchange(params: dict) -> dict:
    """POST to GitHub's token endpoint (code exchange or refresh). Overridden in tests."""
    with httpx.Client(timeout=10) as http:
        data = http.post(TOKEN_URL, headers={"Accept": "application/json"},
                         data={"client_id": config.GITHUB_CLIENT_ID,
                               "client_secret": config.GITHUB_CLIENT_SECRET, **params}).json()
    if "access_token" not in data:
        raise TokenError(data.get("error_description", "GitHub token exchange failed"))
    return data


def store_tokens(user: User, data: dict) -> None:
    user.github_token_enc = encrypt(data["access_token"])
    # Expiring tokens come with a refresh token; apps with expiration disabled return neither.
    user.github_refresh_enc = encrypt(data["refresh_token"]) if data.get("refresh_token") else ""
    expires_in = data.get("expires_in")
    user.github_token_expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
                                    if expires_in else None)


def access_token(user: User, db: Session) -> str:
    expires = user.github_token_expires_at
    if expires is not None:
        if expires.tzinfo is None:  # SQLite drops tzinfo
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= expires - REFRESH_MARGIN:
            if not user.github_refresh_enc:
                raise TokenError("GitHub session expired; sign in again")
            store_tokens(user, exchange({"grant_type": "refresh_token",
                                         "refresh_token": decrypt(user.github_refresh_enc)}))
            db.commit()
    return decrypt(user.github_token_enc)
