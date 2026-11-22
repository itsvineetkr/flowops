from app.generators.base import Generator, register, require
from app.ir import Graph


def _render(node) -> str:
    p = node.params
    t = node.type
    if t == "from":
        alias = f" AS {p['as']}" if p.get("as") else ""
        return f"FROM {require(node, 'image')}{alias}"
    if t == "workdir":
        return f"WORKDIR {require(node, 'path')}"
    if t == "copy":
        frm = f"--from={p['from']} " if p.get("from") else ""
        return f"COPY {frm}{require(node, 'src')} {require(node, 'dest')}"
    if t == "run":
        return f"RUN {require(node, 'command')}"
    if t == "env":
        return f"ENV {require(node, 'key')}={require(node, 'value')}"
    if t == "expose":
        return f"EXPOSE {require(node, 'port')}"
    if t == "cmd":
        args = ", ".join(f'"{a}"' for a in require(node, "args"))
        return f"CMD [{args}]"
    raise ValueError(f"unsupported dockerfile instruction: {t}")


class DockerfileGenerator(Generator):
    key = "dockerfile"
    label = "Dockerfile"

    def generate(self, graph: Graph) -> dict[str, str]:
        lines = []
        for node in graph.topological_order():
            if node.type == "from" and lines:
                lines.append("")  # blank line between build stages
            lines.append(_render(node))
        return {"Dockerfile": "\n".join(lines) + "\n"}


register(DockerfileGenerator())
