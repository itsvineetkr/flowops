"""Runs actionlint over every workflow Flow Ops can generate from templates plus edge-case graphs."""
import shutil
import subprocess

import pytest

from app.generators import base
from app.ir import Graph
from app.templates.loader import build_graph, load_stacks

pytestmark = pytest.mark.skipif(shutil.which("actionlint") is None, reason="actionlint not installed")

EDGE_CASES = {
    "all-events": [
        {"trigger": {"events": ["push", "pull_request", "schedule", "workflow_dispatch"], "branches": ["main"], "cron": "0 3 * * *"}},
        {"checkout": {}},
        {"setup_runtime": {"runtime": "go", "version": "1.23"}},
        {"test": {"command": "go test ./...", "env": {"CGO_ENABLED": "0"}}},
    ],
    "diamond-and-push": [
        {"trigger": {}},
        {"checkout": {}},
        {"setup_runtime": {"runtime": "node", "version": "20", "cache": "npm"}},
        {"install": {"command": "npm ci"}},
        {"lint": {"command": "npm run lint", "_after": ["install"]}},
        {"test": {"command": "npm test", "_after": ["install"]}},
        {"build": {"command": "npm run build", "_after": ["install"]}},
        {"docker_push": {"image": "me/app:latest", "_after": ["lint", "test", "build"]}},
        {"deploy": {"command": "./deploy.sh"}},
        {"notify": {"command": "echo done"}},
    ],
    "ghcr-push": [
        {"trigger": {"events": ["push"], "branches": ["main"]}},
        {"checkout": {}},
        {"docker_push": {"registry": "ghcr", "image": "ghcr.io/me/app:latest"}},
    ],
    "every-runtime": [{"trigger": {}}, {"checkout": {}}] + [
        {"setup_runtime": {"_id": rt, "_after": ["checkout"], "runtime": rt, "version": v}}
        for rt, v in [("node", "20"), ("python", "3.12"), ("java", "21"), ("go", "1.23"),
                      ("dotnet", "8.0.x"), ("ruby", "3.3"), ("php", "8.3"), ("rust", "stable")]
    ],
}


def _workflows() -> dict[str, Graph]:
    graphs = {f"template-{k}": s["flows"]["pipeline"] for k, s in load_stacks().items()}
    graphs |= {k: build_graph(v) for k, v in EDGE_CASES.items()}
    return graphs


def test_generated_workflows_pass_actionlint(tmp_path):
    wf_dir = tmp_path / ".github" / "workflows"
    wf_dir.mkdir(parents=True)
    for name, graph in _workflows().items():
        (wf_dir / f"{name}.yml").write_text(base.get("github").generate(graph)[".github/workflows/ci.yml"])
    # -shellcheck= disables the optional shellcheck integration so results don't depend on it being installed
    files = sorted(str(f) for f in wf_dir.glob("*.yml"))
    result = subprocess.run(["actionlint", "-no-color", "-shellcheck=", *files], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
