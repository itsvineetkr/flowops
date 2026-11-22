import fnmatch
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.urls import frontend
from app.db import get_db
from app.generators import base
from app.github_auth import TokenError, access_token
from app.github_client import GitHub, GitHubError
from app.ir import Graph
from app.models.models import User
from app.recommender.detector import HINT_FILES, MANIFESTS, hints, recommender
from app.security import current_user

router = APIRouter(prefix="/api/github")

REPO_RE = re.compile(r"^[\w.-]+/[\w.-]+$")
BRANCH_RE = re.compile(r"^(?!/)(?!.*\.\.)(?!.*//)[\w./-]+(?<![/.])$")
TARGET = {"dockerfile": "dockerfile", "compose": "compose", "pipeline": "github"}
MARKERS = ("manage.py", "artisan", "angular.json", "*.csproj", "*.sln")
SKIP_DIRS = re.compile(r"(^|/)(node_modules|\.git|vendor|target|dist|build|\.venv|venv)/")
MAX_MANIFESTS = 30


def get_github(user: User = Depends(current_user), db: Session = Depends(get_db)) -> GitHub:
    if not user.github_token_enc:
        raise HTTPException(400, "Sign in with GitHub to use GitHub features")
    try:
        return GitHub(access_token(user, db))
    except TokenError as e:
        raise HTTPException(400, str(e))


def _gh_error(e: GitHubError) -> HTTPException:
    if e.status == 404:
        return HTTPException(404, "Repository or branch not found, or you don't have access")
    if e.status == 401:
        return HTTPException(400, "GitHub token is no longer valid; sign in again")
    return HTTPException(502, f"GitHub error ({e.status}): {e.message}")


class _RepoField(BaseModel):
    repo: str

    @field_validator("repo")
    @classmethod
    def _check_repo(cls, v: str) -> str:
        if not REPO_RE.match(v) or v.split("/")[0] in (".", "..") or v.split("/")[1] in (".", ".."):
            raise ValueError("repo must look like owner/name")
        return v


@router.get("/repos")
def list_repos(gh: GitHub = Depends(get_github)):
    """Only repositories the user granted the GitHub App access to (not everything they own)."""
    repos = []
    try:
        for inst in gh.get("/user/installations", params={"per_page": 100})["installations"]:
            page = gh.get(f"/user/installations/{inst['id']}/repositories", params={"per_page": 100})
            repos += page["repositories"]
    except GitHubError as e:
        raise _gh_error(e)
    return [{"full_name": r["full_name"], "default_branch": r["default_branch"], "private": r["private"],
             "description": r.get("description") or "", "language": r.get("language") or ""}
            for r in repos if r.get("permissions", {}).get("push", True)]


@router.get("/setup")
def after_install(state: str | None = None):
    """GitHub App "Setup URL": GitHub redirects here after the user grants or changes repo access."""
    return RedirectResponse(frontend(state or "/"))


class RepoRequest(_RepoField):
    pass


@router.post("/recommend")
def recommend_from_repo(body: RepoRequest, gh: GitHub = Depends(get_github)):
    try:
        info = gh.get(f"/repos/{body.repo}")
        default = info["default_branch"]
        tree = gh.get(f"/repos/{body.repo}/git/trees/{default}", params={"recursive": "1"})["tree"]
        files: dict[str, str] = {}
        for item in tree:
            path = item["path"]
            if item["type"] != "blob" or SKIP_DIRS.search(path) or len(files) >= MAX_MANIFESTS:
                continue
            name = path.rsplit("/", 1)[-1]
            if (name in MANIFESTS or name in HINT_FILES) and item.get("size", 0) <= 200_000:
                files[path] = gh.get_text(f"/repos/{body.repo}/contents/{path}?ref={default}")
            elif any(fnmatch.fnmatch(name, m) for m in MARKERS):
                files[path] = ""
    except GitHubError as e:
        raise _gh_error(e)
    language = info.get("language") or ""
    return {
        "repo": {"full_name": info["full_name"], "description": info.get("description") or "",
                 "language": language, "default_branch": default, "manifests": sorted(files)},
        "recommendations": recommender.recommend(files, language=language or None),
        "hints": hints(files),
    }


class PushRequest(_RepoField):
    branch: str = "flowops/config"
    base: str | None = None  # defaults to the repo's default branch
    message: str = Field(default="Add Docker and CI/CD configuration (Flow Ops)", min_length=1, max_length=500)
    open_pr: bool = True
    graphs: dict[str, Graph]

    @field_validator("branch", "base")
    @classmethod
    def _check_branch(cls, v: str | None) -> str | None:
        if v is not None and not BRANCH_RE.match(v):
            raise ValueError("invalid branch name")
        return v

    @field_validator("graphs")
    @classmethod
    def _check_kinds(cls, v: dict[str, Graph]) -> dict[str, Graph]:
        unknown = set(v) - set(TARGET)
        if unknown:
            raise ValueError(f"unknown flow kinds: {sorted(unknown)}")
        return v


@router.post("/push")
def push(body: PushRequest, gh: GitHub = Depends(get_github)):
    files: dict[str, str] = {}
    for kind, graph in body.graphs.items():
        if not graph.nodes:
            continue
        try:
            files |= base.get(TARGET[kind]).generate(graph)
        except ValueError as e:
            raise HTTPException(422, f"{kind}: {e}")
    if not files:
        raise HTTPException(422, "nothing to push: all canvases are empty")

    r = f"/repos/{body.repo}"
    try:
        base_branch = body.base or gh.get(r)["default_branch"]
        base_sha = gh.get(f"{r}/git/ref/heads/{base_branch}")["object"]["sha"]
        try:
            parent = gh.get(f"{r}/git/ref/heads/{body.branch}")["object"]["sha"]
            branch_exists = True
        except GitHubError as e:
            if e.status != 404:
                raise
            parent, branch_exists = base_sha, False

        parent_tree = gh.get(f"{r}/git/commits/{parent}")["tree"]["sha"]
        tree = gh.post(f"{r}/git/trees", {
            "base_tree": parent_tree,
            "tree": [{"path": p, "mode": "100644", "type": "blob", "content": c} for p, c in files.items()],
        })
        commit = gh.post(f"{r}/git/commits", {"message": body.message, "tree": tree["sha"], "parents": [parent]})
        if branch_exists:
            gh.patch(f"{r}/git/refs/heads/{body.branch}", {"sha": commit["sha"], "force": False})
        else:
            gh.post(f"{r}/git/refs", {"ref": f"refs/heads/{body.branch}", "sha": commit["sha"]})

        pr_url = None
        if body.open_pr and body.branch != base_branch:
            owner = body.repo.split("/")[0]
            existing = gh.get(f"{r}/pulls", params={"head": f"{owner}:{body.branch}", "base": base_branch, "state": "open"})
            if existing:
                pr_url = existing[0]["html_url"]
            else:
                pr_url = gh.post(f"{r}/pulls", {
                    "title": body.message.splitlines()[0],
                    "head": body.branch,
                    "base": base_branch,
                    "body": "Generated with Flow Ops:\n\n" + "\n".join(f"- `{p}`" for p in files),
                })["html_url"]
    except GitHubError as e:
        raise _gh_error(e)

    return {
        "branch": body.branch,
        "files": sorted(files),
        "commit_url": f"https://github.com/{body.repo}/commit/{commit['sha']}",
        "pr_url": pr_url,
    }
