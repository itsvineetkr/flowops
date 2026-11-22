from abc import ABC, abstractmethod

from app.ir import Graph, Node


def require(node: Node, key: str):
    value = node.params.get(key)
    if value in ("", None, []):
        raise ValueError(f"node '{node.id}' ({node.type}) is missing required param '{key}'")
    return value


class Generator(ABC):
    """Renders a validated Graph into one or more files: {path: content}."""

    key: str
    label: str
    available: bool = True

    @abstractmethod
    def generate(self, graph: Graph) -> dict[str, str]: ...


_REGISTRY: dict[str, Generator] = {}


def register(gen: Generator) -> Generator:
    _REGISTRY[gen.key] = gen
    return gen


def get(key: str) -> Generator:
    if key not in _REGISTRY:
        raise KeyError(f"unknown generator: {key}")
    gen = _REGISTRY[key]
    if not gen.available:
        raise NotImplementedError(f"{gen.label} support is coming soon")
    return gen


def catalog() -> list[dict]:
    return [{"key": g.key, "label": g.label, "available": g.available} for g in _REGISTRY.values()]
