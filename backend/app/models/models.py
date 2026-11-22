from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now():
    return datetime.now(timezone.utc)


class User(Base):
    """A Flow Ops account: email/password, GitHub, or both. GitHub can be connected later."""

    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(100))  # display name
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, nullable=True)
    github_id: Mapped[int | None] = mapped_column(unique=True, index=True, nullable=True)
    github_login: Mapped[str] = mapped_column(String(100), default="", server_default="")
    avatar_url: Mapped[str] = mapped_column(String(300), default="")
    github_token_enc: Mapped[str] = mapped_column(Text, default="")
    github_refresh_enc: Mapped[str] = mapped_column(Text, default="")
    github_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    stack: Mapped[str] = mapped_column(String(60), default="")
    repo: Mapped[str] = mapped_column(String(200), default="")  # owner/name
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    user: Mapped[User] = relationship(back_populates="projects")
    flows: Mapped[list["Flow"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Flow(Base):
    """One canvas per kind per project: dockerfile | compose | pipeline."""

    __tablename__ = "flows"
    __table_args__ = (UniqueConstraint("project_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    graph: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    project: Mapped[Project] = relationship(back_populates="flows")
