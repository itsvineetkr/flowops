import pytest
from pydantic import ValidationError

from app.generators import base, dockerfile, stubs  # noqa: F401  (register generators)
from app.ir import Graph


def chain(*nodes):
    return {
        "nodes": [{"id": str(i), "type": t, "params": p} for i, (t, p) in enumerate(nodes)],
        "edges": [{"source": str(i), "target": str(i + 1)} for i in range(len(nodes) - 1)],
    }


def test_multistage_dockerfile():
    g = Graph(**chain(
        ("from", {"image": "node:20", "as": "build"}),
        ("workdir", {"path": "/app"}),
        ("run", {"command": "npm ci"}),
        ("from", {"image": "nginx:alpine"}),
        ("copy", {"from": "build", "src": "/app/dist", "dest": "/usr/share/nginx/html"}),
        ("expose", {"port": 80}),
    ))
    out = base.get("dockerfile").generate(g)["Dockerfile"]
    assert out.startswith("FROM node:20 AS build\nWORKDIR /app\nRUN npm ci\n\nFROM nginx:alpine")
    assert "COPY --from=build /app/dist /usr/share/nginx/html" in out


def test_cycle_rejected():
    with pytest.raises(ValidationError):
        Graph(nodes=[{"id": "a", "type": "run"}, {"id": "b", "type": "run"}],
              edges=[{"source": "a", "target": "b"}, {"source": "b", "target": "a"}])


def test_coming_soon():
    with pytest.raises(NotImplementedError):
        base.get("gitlab")


def test_missing_param_is_value_error():
    g = Graph(nodes=[{"id": "f", "type": "from", "params": {"image": ""}}])
    with pytest.raises(ValueError, match="missing required param 'image'"):
        base.get("dockerfile").generate(g)
