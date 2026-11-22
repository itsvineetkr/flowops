"""Loads declarative stack definitions (stacks/*.yaml) into canvas Graphs.

Each flow is a list of one-key mappings `- <node type>: {params}`. Nodes connect to
the previous node unless they list `_after: [ids]`; ids default to the node type
(deduplicated as type-2, type-3...) or can be set with `_id`.

Strings may contain `{{name}}` for values declared under `placeholders:`; they're filled
from repo hints (see recommender.hints) or the declared default.
"""
import copy
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import yaml

from app.ir import Graph

# Hint values end up inside Dockerfile/YAML lines: allow only identifier/path characters, so a
# repo can't inject newlines or shell syntax through e.g. its Cargo package name.
SAFE_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$")
_PLACEHOLDER = re.compile(r"(?<!\$)\{\{(\w+)\}\}")  # not ${{ github.* }} expressions

STACKS_DIR = Path(__file__).parent / "stacks"
KINDS = ("dockerfile", "compose", "pipeline")
X_GAP, Y_GAP = 240, 110


def _layout(graph: Graph) -> None:
    """Layered top-down layout: row = longest path from a root, rows centered."""
    depth: dict[str, int] = {}
    for node in graph.topological_order():
        preds = graph.predecessors(node.id)
        depth[node.id] = max((depth[p] + 1 for p in preds), default=0)
    rows: dict[int, list[str]] = defaultdict(list)
    for node in graph.nodes:
        rows[depth[node.id]].append(node.id)
    for node in graph.nodes:
        row = rows[depth[node.id]]
        node.position = {"x": (row.index(node.id) - (len(row) - 1) / 2) * X_GAP, "y": depth[node.id] * Y_GAP}


def build_graph(items: list[dict]) -> Graph:
    nodes, edges, prev = [], [], None
    seen: dict[str, int] = {}
    for item in items:
        (ntype, raw), = item.items()
        params = dict(raw or {})
        nid = params.pop("_id", None)
        if nid is None:
            seen[ntype] = seen.get(ntype, 0) + 1
            nid = ntype if seen[ntype] == 1 else f"{ntype}-{seen[ntype]}"
        after = params.pop("_after", [prev] if prev else [])
        nodes.append({"id": nid, "type": ntype, "params": params})
        edges += [{"source": a, "target": nid} for a in after]
        prev = nid
    graph = Graph(nodes=nodes, edges=edges)
    _layout(graph)
    return graph


def _substitute(value, values: dict[str, str]):
    if isinstance(value, str):
        return _PLACEHOLDER.sub(lambda m: values.get(m[1], m[0]), value)
    if isinstance(value, list):
        return [_substitute(v, values) for v in value]
    if isinstance(value, dict):
        return {k: _substitute(v, values) for k, v in value.items()}
    return value


def render_flows(stack: dict, hints: dict[str, str] | None = None) -> dict[str, Graph]:
    """Builds the stack's canvases, filling placeholders from safe hints or their defaults."""
    values = {name: spec["default"] for name, spec in stack.get("placeholders", {}).items()}
    for name, value in (hints or {}).items():
        if name in values and SAFE_VALUE.match(value):
            values[name] = value
    return {k: build_graph(_substitute(copy.deepcopy(items), values)) for k, items in stack["raw_flows"].items()}


@lru_cache
def load_stacks() -> dict[str, dict]:
    stacks = {}
    for path in sorted(STACKS_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text())
        data["raw_flows"] = {k: data.pop(k) for k in KINDS if k in data}
        data["flows"] = render_flows(data)  # with defaults
        stacks[data["key"]] = data
    return stacks


def summary(stack: dict) -> dict:
    return {k: stack[k] for k in ("key", "name", "language", "category", "description")}
