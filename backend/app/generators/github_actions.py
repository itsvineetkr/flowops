import yaml

from app.generators.base import Generator, register, require as _req
from app.ir import Graph, Node

RUNTIME_ACTIONS = {
    "node": ("actions/setup-node@v4", "node-version"),
    "python": ("actions/setup-python@v5", "python-version"),
    "java": ("actions/setup-java@v4", "java-version"),
    "go": ("actions/setup-go@v5", "go-version"),
    "dotnet": ("actions/setup-dotnet@v4", "dotnet-version"),
    "ruby": ("ruby/setup-ruby@v1", "ruby-version"),
    "php": ("shivammathur/setup-php@v2", "php-version"),
    "rust": ("actions-rust-lang/setup-rust-toolchain@v1", "toolchain"),
}
RUN_TYPES = {"install", "lint", "test", "build", "deploy", "notify"}
# Every job runs on a fresh runner, so jobs downstream of these steps re-run them.
PREAMBLE_TYPES = ("checkout", "setup_runtime", "install")


class _NoAliasDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True



def _steps(node: Node) -> list[dict]:
    t, p = node.type, node.params
    if t == "checkout":
        return [{"uses": "actions/checkout@v4"}]
    if t == "setup_runtime":
        runtime = _req(node, "runtime")
        if runtime not in RUNTIME_ACTIONS:
            raise ValueError(f"unsupported runtime '{runtime}'")
        action, version_key = RUNTIME_ACTIONS[runtime]
        step: dict = {"uses": action, "with": {version_key: str(_req(node, "version"))}}
        if runtime == "java":
            step["with"]["distribution"] = p.get("distribution", "temurin")
        if p.get("cache"):
            step["with"]["cache"] = p["cache"]
        return [step]
    if t in RUN_TYPES:
        step = {"name": p.get("name", t.capitalize()), "run": _req(node, "command")}
        if p.get("env"):
            step["env"] = p["env"]
        return [step]
    if t == "docker_build":
        image = _req(node, "image")
        return [{"name": "Docker build", "run": f"docker build -t {image} {p.get('context', '.')}"}]
    if t == "docker_push":
        image = _req(node, "image")
        if p.get("registry") == "ghcr":
            # GITHUB_TOKEN can push to GHCR when the job has `packages: write` (see _permissions).
            login = {"uses": "docker/login-action@v3",
                     "with": {"registry": "ghcr.io", "username": "${{ github.actor }}",
                              "password": "${{ secrets.GITHUB_TOKEN }}"}}
        else:
            login = {"uses": "docker/login-action@v3",
                     "with": {"username": "${{ secrets.DOCKERHUB_USERNAME }}",
                              "password": "${{ secrets.DOCKERHUB_TOKEN }}"}}
        return [
            login,
            {"uses": "docker/build-push-action@v6",
             "with": {"context": p.get("context", "."), "push": True, "tags": image}},
        ]
    raise ValueError(f"unsupported pipeline node: {t}")


def _permissions(node: Node) -> dict[str, str]:
    if node.type == "docker_push" and node.params.get("registry") == "ghcr":
        return {"contents": "read", "packages": "write"}
    return {}


def _trigger(nodes: list[Node]) -> dict:
    trig = [n for n in nodes if n.type == "trigger"]
    if len(trig) != 1:
        raise ValueError("pipeline needs exactly one trigger node")
    p = trig[0].params
    on: dict = {}
    for ev in p.get("events", ["push"]):
        if ev == "schedule":
            on["schedule"] = [{"cron": _req(trig[0], "cron")}]
        else:
            on[ev] = {"branches": p["branches"]} if p.get("branches") and ev in ("push", "pull_request") else {}
    return on


class GitHubActionsGenerator(Generator):
    """Splits the graph into jobs: linear chains become one job's steps, and
    forks/joins start new jobs wired together with `needs`. New jobs inherit the
    checkout/setup/install steps of the jobs they depend on."""

    key = "github"
    label = "GitHub Actions"

    def generate(self, graph: Graph) -> dict[str, str]:
        order = graph.topological_order()
        trigger_ids = {n.id for n in order if n.type == "trigger"}
        on = _trigger(order)
        successors: dict[str, list[str]] = {}
        for e in graph.edges:
            if e.source not in trigger_ids:
                successors.setdefault(e.source, []).append(e.target)

        job_of: dict[str, str] = {}
        jobs: dict[str, dict] = {}
        preamble: dict[str, list[dict]] = {}  # job id -> steps a dependent job must repeat
        for node in order:
            if node.id in trigger_ids:
                continue
            preds = [s for s in graph.predecessors(node.id) if s not in trigger_ids]
            if len(preds) == 1 and len(successors.get(preds[0], [])) == 1:
                jid = job_of[preds[0]]
            else:
                base = node.type if node.type not in PREAMBLE_TYPES else "ci"
                jid, i = base, 1
                while jid in jobs:
                    i += 1
                    jid = f"{base}-{i}"
                needs = sorted({job_of[s] for s in preds})
                inherited: list[dict] = []
                for dep in needs:
                    inherited += [st for st in preamble[dep] if st not in inherited]
                jobs[jid] = {"runs-on": "ubuntu-latest", **({"needs": needs} if needs else {}), "steps": list(inherited)}
                preamble[jid] = list(inherited)
            job_of[node.id] = jid
            if perms := _permissions(node):
                job = jobs[jid]
                merged = {**job.get("permissions", {}), **perms}
                # keep key order readable: runs-on, needs, permissions, steps
                jobs[jid] = {k: v for k, v in job.items() if k != "steps"} | {"permissions": merged, "steps": job["steps"]}
            new_steps = _steps(node)
            jobs[jid]["steps"].extend(new_steps)
            if node.type in PREAMBLE_TYPES:
                preamble[jid] += [st for st in new_steps if st not in preamble[jid]]

        doc = {"name": "CI", "on": on, "jobs": jobs}
        return {".github/workflows/ci.yml": yaml.dump(doc, Dumper=_NoAliasDumper, sort_keys=False)}


register(GitHubActionsGenerator())
