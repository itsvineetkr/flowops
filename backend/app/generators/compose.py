import yaml

from app.generators.base import Generator, register
from app.ir import Graph


class ComposeGenerator(Generator):
    """Each node is a service (or volume/network); edge A -> B means B depends_on A."""

    key = "compose"
    label = "docker-compose"

    def generate(self, graph: Graph) -> dict[str, str]:
        services: dict[str, dict] = {}
        volumes: dict[str, None] = {}
        names = {n.id: n.params.get("name", n.id) for n in graph.nodes}
        for node in graph.topological_order():
            if node.type != "service":
                raise ValueError(f"unsupported compose node: {node.type}")
            p = node.params
            svc: dict = {}
            if p.get("build"):
                svc["build"] = p["build"]
            if p.get("image"):
                svc["image"] = p["image"]
            if "build" not in svc and "image" not in svc:
                raise ValueError(f"service '{names[node.id]}' needs an image or build context")
            if p.get("ports"):
                svc["ports"] = [str(x) for x in p["ports"]]
            if p.get("environment"):
                svc["environment"] = p["environment"]
            if p.get("volumes"):
                svc["volumes"] = p["volumes"]
                for v in p["volumes"]:
                    src = str(v).split(":")[0]
                    if not src.startswith((".", "/", "~")):
                        volumes[src] = None
            deps = [names[s] for s in graph.predecessors(node.id)]
            if deps:
                svc["depends_on"] = deps
            if p.get("restart"):
                svc["restart"] = p["restart"]
            services[names[node.id]] = svc
        doc: dict = {"services": services}
        if volumes:
            doc["volumes"] = volumes
        return {"docker-compose.yml": yaml.safe_dump(doc, sort_keys=False)}


register(ComposeGenerator())
