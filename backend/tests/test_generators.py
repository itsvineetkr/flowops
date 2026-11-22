import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def graph(nodes, edges):
    return {"nodes": [{"id": i, "type": t, "params": p} for i, t, p in nodes],
            "edges": [{"source": s, "target": t} for s, t in edges]}


def test_compose_depends_on_and_volumes():
    g = graph([("db", "service", {"name": "db", "image": "postgres:16", "volumes": ["pgdata:/var/lib/postgresql/data"]}),
               ("api", "service", {"name": "api", "build": ".", "ports": ["8000:8000"]})],
              [("db", "api")])
    r = client.post("/api/generate", json={"target": "compose", "graph": g})
    doc = yaml.safe_load(r.json()["files"]["docker-compose.yml"])
    assert doc["services"]["api"]["depends_on"] == ["db"]
    assert "pgdata" in doc["volumes"]


def test_github_linear_chain_is_one_job():
    g = graph([("t", "trigger", {"events": ["push", "pull_request"], "branches": ["main"]}),
               ("c", "checkout", {}),
               ("s", "setup_runtime", {"runtime": "node", "version": 20, "cache": "npm"}),
               ("i", "install", {"command": "npm ci"}),
               ("x", "test", {"command": "npm test"})],
              [("t", "c"), ("c", "s"), ("s", "i"), ("i", "x")])
    r = client.post("/api/generate", json={"target": "github", "graph": g})
    doc = yaml.safe_load(r.json()["files"][".github/workflows/ci.yml"])
    assert doc["on"]["push"] == {"branches": ["main"]}
    assert len(doc["jobs"]) == 1
    assert [s.get("run") for s in next(iter(doc["jobs"].values()))["steps"]][-2:] == ["npm ci", "npm test"]


def test_github_fork_join_uses_needs():
    g = graph([("t", "trigger", {}), ("c", "checkout", {}),
               ("l", "lint", {"command": "ruff check ."}), ("x", "test", {"command": "pytest"}),
               ("b", "docker_build", {"image": "app:latest"})],
              [("t", "c"), ("c", "l"), ("c", "x"), ("l", "b"), ("x", "b")])
    r = client.post("/api/generate", json={"target": "github", "graph": g})
    jobs = yaml.safe_load(r.json()["files"][".github/workflows/ci.yml"])["jobs"]
    assert len(jobs) == 4
    assert sorted(jobs["docker_build"]["needs"]) == ["lint", "test"]
    assert jobs["lint"]["steps"][0] == {"uses": "actions/checkout@v4"}


def test_missing_param_is_422_and_stub_is_501():
    g = graph([("t", "trigger", {}), ("i", "install", {})], [("t", "i")])
    assert client.post("/api/generate", json={"target": "github", "graph": g}).status_code == 422
    assert client.post("/api/generate", json={"target": "gitlab", "graph": g}).status_code == 501
    assert any(p["key"] == "gitlab" and not p["available"] for p in client.get("/api/platforms").json())


def test_downstream_jobs_inherit_checkout_setup_install_and_no_yaml_aliases():
    g = graph([("t", "trigger", {"events": ["push", "pull_request"], "branches": ["main"]}),
               ("c", "checkout", {}),
               ("s", "setup_runtime", {"runtime": "python", "version": "3.12"}),
               ("i", "install", {"command": "pip install -r requirements.txt"}),
               ("l", "lint", {"command": "ruff check ."}), ("x", "test", {"command": "pytest"}),
               ("p", "docker_push", {"image": "me/app"})],
              [("t", "c"), ("c", "s"), ("s", "i"), ("i", "l"), ("i", "x"), ("l", "p"), ("x", "p")])
    text = client.post("/api/generate", json={"target": "github", "graph": g}).json()["files"][".github/workflows/ci.yml"]
    assert "&id" not in text and "*id" not in text
    jobs = yaml.safe_load(text)["jobs"]
    assert list(jobs) == ["ci", "lint", "test", "docker_push"]
    for jid in ("lint", "test", "docker_push"):
        steps = jobs[jid]["steps"]
        assert steps[0] == {"uses": "actions/checkout@v4"}
        assert steps[1]["uses"] == "actions/setup-python@v5"
        assert steps[2]["run"] == "pip install -r requirements.txt"
        assert list(jobs[jid])[:2] == ["runs-on", "needs"]
    # preamble steps appear once even when inherited from two parents
    assert sum(1 for s in jobs["docker_push"]["steps"] if s.get("uses") == "actions/checkout@v4") == 1


def test_ghcr_push_uses_github_token_and_job_permissions():
    g = graph([("t", "trigger", {}), ("c", "checkout", {}),
               ("p", "docker_push", {"registry": "ghcr", "image": "ghcr.io/me/app:latest"})],
              [("t", "c"), ("c", "p")])
    job = next(iter(yaml.safe_load(client.post("/api/generate", json={"target": "github", "graph": g})
                                   .json()["files"][".github/workflows/ci.yml"])["jobs"].values()))
    assert job["permissions"] == {"contents": "read", "packages": "write"}
    assert list(job) == ["runs-on", "permissions", "steps"]
    login = job["steps"][1]["with"]
    assert login["registry"] == "ghcr.io" and login["password"] == "${{ secrets.GITHUB_TOKEN }}"
