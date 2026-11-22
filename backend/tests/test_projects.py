from fastapi.testclient import TestClient

from app.main import app
from app.security import decrypt, encrypt

G = {"nodes": [{"id": "a", "type": "from", "params": {"image": "alpine"}}], "edges": []}


def test_requires_auth(db_session):
    assert TestClient(app).get("/api/projects").status_code == 401


def test_crud_and_flow_roundtrip(alice):
    pid = alice.post("/api/projects", json={"name": "demo", "stack": "fastapi"}).json()["id"]
    assert alice.put(f"/api/projects/{pid}/flows/dockerfile", json=G).status_code == 200
    got = alice.get(f"/api/projects/{pid}").json()
    assert got["flows"]["dockerfile"]["nodes"][0]["id"] == "a"
    alice.put(f"/api/projects/{pid}/flows/dockerfile", json={**G, "nodes": []})  # upsert, not duplicate
    assert alice.get(f"/api/projects/{pid}").json()["flows"]["dockerfile"]["nodes"] == []
    assert alice.delete(f"/api/projects/{pid}").status_code == 204
    assert alice.get("/api/projects").json() == []


def test_projects_are_private(alice, bob):
    pid = alice.post("/api/projects", json={"name": "secret"}).json()["id"]
    assert bob.get(f"/api/projects/{pid}").status_code == 404
    assert bob.delete(f"/api/projects/{pid}").status_code == 404
    assert bob.get("/api/projects").json() == []


def test_invalid_graph_rejected(alice):
    pid = alice.post("/api/projects", json={"name": "x"}).json()["id"]
    bad = {"nodes": [{"id": "a", "type": "run"}], "edges": [{"source": "a", "target": "zzz"}]}
    assert alice.put(f"/api/projects/{pid}/flows/pipeline", json=bad).status_code == 422


def test_token_encryption_roundtrip():
    assert decrypt(encrypt("gho_abc")) == "gho_abc" and encrypt("gho_abc") != "gho_abc"


def test_positions_persist(alice):
    pid = alice.post("/api/projects", json={"name": "p"}).json()["id"]
    g = {"nodes": [{"id": "a", "type": "run", "params": {}, "position": {"x": 10, "y": 20}}], "edges": []}
    alice.put(f"/api/projects/{pid}/flows/dockerfile", json=g)
    assert alice.get(f"/api/projects/{pid}").json()["flows"]["dockerfile"]["nodes"][0]["position"] == {"x": 10, "y": 20}


def test_dev_login_disabled_by_default(db_session):
    assert TestClient(app).post("/api/auth/dev-login").status_code == 404


def test_blank_name_rejected_and_repo_stored(alice):
    assert alice.post("/api/projects", json={"name": "   "}).status_code == 422
    assert alice.post("/api/projects", json={"name": "x", "repo": "not a repo"}).status_code == 422
    p = alice.post("/api/projects", json={"name": "  x  ", "repo": "me/app"}).json()
    assert p["name"] == "x" and p["repo"] == "me/app"
