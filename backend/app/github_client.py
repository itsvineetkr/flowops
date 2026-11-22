import httpx


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class GitHub:
    """Thin GitHub REST client. `transport` lets tests swap in a fake API."""

    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(
            base_url="https://api.github.com",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28"},
            timeout=15,
            transport=transport,
        )

    def request(self, method: str, path: str, **kw) -> httpx.Response:
        r = self.http.request(method, path, **kw)
        if r.status_code >= 400:
            try:
                msg = r.json().get("message", r.text)
            except ValueError:
                msg = r.text
            raise GitHubError(r.status_code, msg)
        return r

    def get(self, path: str, **kw):
        return self.request("GET", path, **kw).json()

    def post(self, path: str, body: dict):
        return self.request("POST", path, json=body).json()

    def patch(self, path: str, body: dict):
        return self.request("PATCH", path, json=body).json()

    def get_text(self, path: str) -> str:
        return self.request("GET", path, headers={"Accept": "application/vnd.github.raw"}).text
