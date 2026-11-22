"""Password hashing with scrypt (stdlib), plus a small failed-login limiter."""
import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

N, R, P, DKLEN = 2**14, 8, 1, 32
MIN_LENGTH = 8


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=DKLEN)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${N}${R}${P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        # Unknown account or no password set: still do the work so timing doesn't reveal which.
        hashlib.scrypt(password.encode(), salt=b"0" * 16, n=N, r=R, p=P, dklen=DKLEN)
        return False
    try:
        _, n, r, p, salt, digest = stored.split("$")
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(base64.b64decode(digest)))
    except ValueError:
        return False
    return hmac.compare_digest(actual, base64.b64decode(digest))


class LoginLimiter:
    """Allows `limit` failed logins per key in a sliding window. In-memory: per process."""

    def __init__(self, limit: int = 10, window: float = 15 * 60):
        self.limit, self.window = limit, window
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        q = self._failures[key]
        while q and time.monotonic() - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        return len(self._prune(key)) >= self.limit

    def fail(self, key: str) -> None:
        self._prune(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)
