"""Writes every template's generated files to OUT_DIR/<stack>/ (used by CI to lint them with hadolint)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.generators import base, compose, dockerfile, github_actions  # noqa: E402,F401
from app.templates.loader import load_stacks  # noqa: E402

TARGET = {"dockerfile": "dockerfile", "compose": "compose", "pipeline": "github"}


def main(out_dir: str) -> None:
    for key, stack in load_stacks().items():
        for kind, graph in stack["flows"].items():
            for path, content in base.get(TARGET[kind]).generate(graph).items():
                dest = Path(out_dir) / key / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content)
                print(dest)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "generated")
