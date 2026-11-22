"""Rule-based stack detection from a repo's manifest files.

Used on a repository the user granted access to (see api/github.py). A stack matches when at least one of its marker files is present and every one of
its `deps` is found. More specific stacks (more deps) score higher, so a MERN repo
ranks MERN above plain Express.
"""
import fnmatch
import json
import re
import tomllib
from typing import Protocol

from app.templates.loader import load_stacks, summary

MANIFESTS = ("package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle",
             "build.gradle.kts", "go.mod", "Gemfile", "composer.json", "Cargo.toml")


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _deps_from(name: str, content: str) -> tuple[set[str], str]:
    """Returns (exact dependency names, raw text for substring matching)."""
    try:
        if name in ("package.json", "composer.json"):
            data = json.loads(content)
            keys = ("dependencies", "devDependencies") if name == "package.json" else ("require", "require-dev")
            return {d.lower() for k in keys for d in data.get(k, {})}, ""
        if name == "requirements.txt":
            return {re.split(r"[\s<>=~!\[;@]", ln.strip(), maxsplit=1)[0].lower()
                    for ln in content.splitlines() if ln.strip() and not ln.lstrip().startswith(("#", "-"))}, ""
        if name == "pyproject.toml":
            data = tomllib.loads(content)
            names = [re.split(r"[\s<>=~!\[;@]", d, maxsplit=1)[0] for d in data.get("project", {}).get("dependencies", [])]
            names += list(data.get("tool", {}).get("poetry", {}).get("dependencies", {}))
            return {n.lower() for n in names}, ""
    except (ValueError, tomllib.TOMLDecodeError, AttributeError):
        pass  # unparseable manifest: fall back to substring matching
    return set(), content.lower()


# GitHub reports JS and TS separately; JS/TS templates fit either.
_LANGUAGE_FAMILY = {"TypeScript": "JavaScript"}


# Marker files whose content is worth fetching for hints (they're small).
HINT_FILES = ("manage.py", "angular.json")


def _toml(content: str) -> dict:
    try:
        return tomllib.loads(content)
    except tomllib.TOMLDecodeError:
        return {}


def hints(files: dict[str, str]) -> dict[str, str]:
    """Values for template placeholders, guessed from the repo's files (shallowest file wins)."""
    out: dict[str, str] = {}
    for path in sorted(files, key=lambda p: (p.count("/"), p)):
        name, content = _basename(path), files[path]
        if name == "manage.py" and "django_module" not in out:
            m = re.search(r"DJANGO_SETTINGS_MODULE['\"]\s*,\s*['\"]([\w.]+)\.settings", content)
            if m:
                out["django_module"] = m[1]
        elif name.endswith(".csproj") and "dotnet_assembly" not in out:
            out["dotnet_assembly"] = name.removesuffix(".csproj")
        elif name == "Cargo.toml" and "rust_binary" not in out:
            data = _toml(content)
            bins = data.get("bin") or []
            binary = (bins[0].get("name") if bins and isinstance(bins[0], dict) else None) or data.get("package", {}).get("name")
            if isinstance(binary, str):
                out["rust_binary"] = binary
        elif name == "angular.json" and "angular_project" not in out:
            try:
                projects = json.loads(content).get("projects", {})
            except (ValueError, AttributeError):
                projects = {}
            if projects:
                out["angular_project"] = next(iter(projects))
        elif name == "package.json" and "node_main" not in out:
            try:
                main = json.loads(content).get("main")
            except (ValueError, AttributeError):
                main = None
            if isinstance(main, str) and main.strip():
                out["node_main"] = main.strip().removeprefix("./")
    return out


class Recommender(Protocol):
    def recommend(self, files: dict[str, str], language: str | None = None) -> list[dict]: ...


class RuleRecommender:
    def recommend(self, files: dict[str, str], language: str | None = None) -> list[dict]:
        basenames = {_basename(p) for p in files}
        exact: set[str] = set()
        raw: list[str] = []
        for path, content in files.items():
            if _basename(path) in MANIFESTS and content:
                names, text = _deps_from(_basename(path), content)
                exact |= names
                if text:
                    raw.append(text)

        results = []
        for stack in load_stacks().values():
            rule = stack.get("detect", {})
            markers = [m for m in rule.get("files", []) if any(fnmatch.fnmatch(b, m) for b in basenames)]
            if not markers:
                continue
            deps = rule.get("deps", [])
            found = [d for d in deps if d.lower() in exact or any(d.lower() in t for t in raw)]
            if len(found) != len(deps):
                continue
            reasons = [f"found {m}" for m in markers] + [f"depends on {d}" for d in found]
            results.append({**summary(stack), "score": 1 + 3 * len(deps), "reasons": reasons})
        if not results and language:
            # No manifest rule matched: fall back to the repo's primary language as a weaker guess.
            family = _LANGUAGE_FAMILY.get(language, language)
            for stack in load_stacks().values():
                if _LANGUAGE_FAMILY.get(stack["language"], stack["language"]) == family:
                    results.append({**summary(stack), "score": 0, "reasons": [f"repository language is {language}"]})
        return sorted(results, key=lambda r: -r["score"])


recommender: Recommender = RuleRecommender()
