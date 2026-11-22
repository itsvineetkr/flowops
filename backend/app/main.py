from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.generators import base, compose, dockerfile, github_actions, stubs  # noqa: F401
from app import config
from app.api import auth, dockerhub, github, projects, templates
from app.ir import Graph
from app.migrate import upgrade

@asynccontextmanager
async def lifespan(_app: FastAPI):
    upgrade()  # alembic upgrade head
    yield


app = FastAPI(title="Flow Ops", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(templates.router)
app.include_router(github.router)
app.include_router(dockerhub.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_URL.rstrip("/")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    target: str
    graph: Graph


@app.get("/api/platforms")
def platforms():
    return base.catalog()


@app.post("/api/generate")
def generate(req: GenerateRequest):
    try:
        return {"files": base.get(req.target).generate(req.graph)}
    except KeyError as e:
        raise HTTPException(404, str(e))
    except NotImplementedError as e:
        raise HTTPException(501, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
