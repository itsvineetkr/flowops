from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.ir import Graph
from app.models.models import Flow, Project, User
from app.security import current_user

router = APIRouter(prefix="/api/projects")
Kind = Literal["dockerfile", "compose", "pipeline"]


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    stack: str = ""
    repo: str = Field(default="", pattern=r"^([\w.-]+/[\w.-]+)?$")

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("project name is required")
        return v.strip()


def _owned(db: Session, user: User, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p or p.user_id != user.id:  # 404 for other users' projects, not 403
        raise HTTPException(404, "project not found")
    return p


def _out(p: Project) -> dict[str, Any]:
    return {"id": p.id, "name": p.name, "stack": p.stack, "repo": p.repo, "created_at": p.created_at,
            "flows": {f.kind: f.graph for f in p.flows}}


@router.get("")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Project).where(Project.user_id == user.id).order_by(Project.id.desc()))
    return [_out(p) for p in rows]


@router.post("", status_code=201)
def create_project(body: ProjectIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = Project(user_id=user.id, name=body.name, stack=body.stack, repo=body.repo)
    db.add(p)
    db.commit()
    return _out(p)


@router.get("/{project_id}")
def get_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(_owned(db, user, project_id))


@router.patch("/{project_id}")
def rename_project(project_id: int, body: ProjectIn, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    p = _owned(db, user, project_id)
    p.name, p.stack, p.repo = body.name, body.stack, body.repo
    db.commit()
    return _out(p)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, user, project_id))
    db.commit()


@router.put("/{project_id}/flows/{kind}")
def save_flow(project_id: int, kind: Kind, graph: Graph, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    p = _owned(db, user, project_id)
    flow = next((f for f in p.flows if f.kind == kind), None)
    if flow is None:
        flow = Flow(project_id=p.id, kind=kind)
        db.add(flow)
    flow.graph = graph.model_dump()
    db.commit()
    return {"kind": kind, "graph": flow.graph}
