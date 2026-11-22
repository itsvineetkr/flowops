from app import config


def safe_return_path(path: str | None, default: str = "/") -> str:
    """Only same-site relative paths, so redirects can't bounce users to another site."""
    if path and path.startswith("/") and not path.startswith("//") and "\\" not in path:
        return path
    return default


def frontend(path: str = "/") -> str:
    return config.FRONTEND_URL.rstrip("/") + safe_return_path(path)
