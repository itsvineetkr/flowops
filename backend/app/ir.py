"""Intermediate representation: the canvas graph the frontend sends to /generate."""
from typing import Any

from pydantic import BaseModel, Field, model_validator


class Node(BaseModel):
    id: str
    type: str
    params: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] | None = None  # canvas layout only; ignored by generators


class Edge(BaseModel):
    source: str
    target: str


class Graph(BaseModel):
    nodes: list[Node]
    edges: list[Edge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_integrity(self) -> "Graph":
        ids = [n.id for n in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate node ids")
        known = set(ids)
        for e in self.edges:
            if e.source not in known or e.target not in known:
                raise ValueError(f"edge references unknown node: {e.source} -> {e.target}")
        self.topological_order()
        return self

    def topological_order(self) -> list[Node]:
        """Kahn's algorithm; raises ValueError on a cycle."""
        by_id = {n.id: n for n in self.nodes}
        indeg = {i: 0 for i in by_id}
        out: dict[str, list[str]] = {i: [] for i in by_id}
        for e in self.edges:
            indeg[e.target] += 1
            out[e.source].append(e.target)
        ready = [i for i in by_id if indeg[i] == 0]
        order: list[Node] = []
        while ready:
            cur = ready.pop(0)
            order.append(by_id[cur])
            for nxt in out[cur]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    ready.append(nxt)
        if len(order) != len(by_id):
            raise ValueError("graph contains a cycle")
        return order

    def predecessors(self, node_id: str) -> list[str]:
        return [e.source for e in self.edges if e.target == node_id]
