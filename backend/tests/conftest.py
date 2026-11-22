import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models.models import User
from app.security import COOKIE, make_session_token


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)
    s = Session()
    app.dependency_overrides[get_db] = lambda: s
    yield s
    app.dependency_overrides.clear()
    s.close()


def login_client(db, github_id: int, login: str) -> TestClient:
    u = User(github_id=github_id, login=login)
    db.add(u)
    db.commit()
    c = TestClient(app)
    c.cookies.set(COOKIE, make_session_token(u.id))
    return c


@pytest.fixture()
def alice(db_session):
    return login_client(db_session, 1, "alice")


@pytest.fixture()
def bob(db_session):
    return login_client(db_session, 2, "bob")
