import base64
import hashlib
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models.models import User

COOKIE = "flowops_session"


def _fernet() -> Fernet:
    key = config.TOKEN_ENC_KEY.encode() or base64.urlsafe_b64encode(hashlib.sha256(config.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(text: str) -> str:
    return _fernet().decrypt(text.encode()).decode()


def make_session_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({"sub": str(user_id), "exp": exp}, config.SECRET_KEY, algorithm="HS256")


def user_from_token(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    try:
        user_id = int(jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
    return db.get(User, user_id)


def current_user(token: str | None = Cookie(default=None, alias=COOKIE), db: Session = Depends(get_db)) -> User:
    if not token:
        raise HTTPException(401, "not authenticated")
    user = user_from_token(token, db)
    if not user:
        raise HTTPException(401, "invalid session")
    return user
