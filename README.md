# Flow Ops: Visual DevOps Studio

Design Dockerfiles, docker-compose stacks and CI/CD pipelines on a drag-and-drop canvas, preview the generated files live, and push them to a GitHub repository as a commit or pull request.

## Features

- **Accounts:** register with email and password, or continue with GitHub. After sign-up, the **Connections** page walks you through connecting GitHub and choosing repository access: *All repositories* or *Only select repositories*, changeable at any time. Passwords are hashed with scrypt and failed logins are rate-limited.
- **Visual editor:** three canvases (CI/CD pipeline, Dockerfile, Compose) with drag-and-drop nodes, a settings panel, a live preview of the generated file, autosave, undo/redo (⌘Z / ⇧⌘Z), JSON import/export and resizable panes.
- **CI/CD targets:** GitHub Actions. GitLab CI and Jenkins are shown as "coming soon".
- **Templates:** 16 stacks: Node/Express, NestJS, React+Vite, Next.js, Angular, Vue, MERN, FastAPI, Django, Flask, Spring Boot, Go, .NET, Rails, Laravel, Rust.
- **Recommendations (rule-based, no AI):** pick a repository you've granted Flow Ops access to. It reads the manifest files (package.json, requirements.txt, pom.xml, …) and the repo's language, suggests the best template, and fills in project-specific values: Django module, .NET assembly, Rust binary, Angular project and Node entry file.
- **Docker image picker:** Docker Hub search as you type. After you pick an image, version and variant chips (e.g. `3.12` + `slim` → `python:3.12-slim`) explain each variant and only offer tags that exist.
- **Push to GitHub:** one atomic commit to a branch, with an optional pull request. Docker Hub and GHCR registries are supported.

## Architecture

```
frontend/  React + Vite + TypeScript, React Flow, Zustand, Monaco, Tailwind
backend/   FastAPI, SQLAlchemy + Alembic (PostgreSQL), PyYAML, httpx
```

The canvas serializes to one graph format (`backend/app/ir.py`): `{nodes: [{id, type, params}], edges: [{source, target}]}`. The backend validates it (unknown nodes, cycles) and a platform **generator** renders it:

| Generator | File | Graph meaning |
|---|---|---|
| `dockerfile` | `Dockerfile` | nodes are instructions in topological order; each `FROM` starts a stage |
| `compose` | `docker-compose.yml` | nodes are services; edge A → B means B `depends_on` A |
| `github` | `.github/workflows/ci.yml` | linear chains become one job; forks/joins become jobs linked by `needs` |

Each GitHub Actions job runs on a fresh runner, so jobs downstream of checkout/setup/install steps repeat those steps automatically.

- **Adding a CI platform:** subclass `Generator` in `backend/app/generators/`, call `register()`, and import it in `app/main.py`. `stubs.py` shows the "coming soon" pattern.
- **Adding a stack template:** add a YAML file in `backend/app/templates/stacks/`.
  - Nodes chain to the previous node unless they set `_after: [ids]`.
  - `detect` lists marker files plus dependencies that must all be present.
  - `placeholders` declares `{{name}}` values that are filled from repo hints.
  - The test suite automatically checks that every template generates valid files and passes actionlint.

## Running locally

**With Docker (one command):** put your settings in `backend/.env`, then:

```sh
docker compose up --build          # frontend :5173, backend :8000, postgres :5433
```

Code changes hot-reload in both containers. `docker compose down` stops everything; add `-v` to also delete the database.

**Without Docker:** you need Python 3.12+, Node 20+, and Docker for Postgres only.

```sh
docker compose up -d db                       # PostgreSQL on localhost:5433

cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DEV_LOGIN=1 .venv/bin/uvicorn app.main:app --reload --port 8000   # runs migrations on startup

cd ../frontend
npm install && npm run dev                    # http://localhost:5173, proxies /api to :8000
```

- **Without GitHub:** `DEV_LOGIN=1` adds a "Dev login" button. Everything except the GitHub features works with it.
- **With GitHub:** put the GitHub App values (see below) in the environment before starting the backend.

## GitHub App setup

Flow Ops uses a **GitHub App** rather than an OAuth App, so users grant access to *specific repositories* instead of everything they own.

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
2. **Homepage URL:** your app URL (`http://localhost:5173` for local development).
3. **Callback URL:** `<app URL>/api/auth/callback`. Tick **Expire user authorization tokens** (Flow Ops refreshes them automatically). Leave "Request user authorization (OAuth) during installation" unticked.
4. **Setup URL:** `<app URL>/api/github/setup`, and tick **Redirect on update**.
5. **Webhook:** untick *Active*.
6. **Repository permissions:**
   - Contents: Read and write
   - Pull requests: Read and write
   - Workflows: Read and write (needed to commit `.github/workflows/*`)
   - Metadata: Read
7. **Where can this app be installed:** "Any account" if other people will use it, otherwise "Only on this account".
8. Create the app, then **Generate a new client secret**.
9. Set these environment variables:
   - `GITHUB_APP_SLUG`: the app's URL name, as in `github.com/apps/<slug>`
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`

Connecting GitHub, or signing in with it, shares only the user's identity. Repository access is a separate step on the **Connections** page: GitHub's install screen offers *All repositories* or *Only select repositories*, and Flow Ops lists, analyzes and pushes to those repos only. A GitHub account can be linked to only one Flow Ops account. Users can disconnect GitHub once their account has a password, so they can't lock themselves out. Tokens are stored encrypted (Fernet, keyed from `TOKEN_ENC_KEY`, or derived from `SECRET_KEY` if that isn't set).

## Production deployment

The production stack is `docker-compose.prod.yml`: PostgreSQL, the FastAPI backend (running as a non-root user, with migrations on startup) and nginx (serving the frontend and proxying `/api`).

```sh
cp .env.prod.example .env.prod     # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

- Put HTTPS in front of port `HTTP_PORT` (Caddy, a cloud load balancer, or Cloudflare). Session cookies are `Secure` in production, so plain HTTP won't keep users signed in.
- Point the GitHub App's Homepage, Callback and Setup URLs at `PUBLIC_URL`.
- With `ENV=production`, the backend refuses to start if `SECRET_KEY` is the default or shorter than 32 characters, or if `DEV_LOGIN` is set.

## Tests

```sh
cd backend  && PYTHONPATH=. .venv/bin/pytest -q     # API, generators, templates, migrations, GitHub flow, actionlint
cd frontend && npm run lint && npx tsc -b && npm test   # unit tests: store/undo, tag picker, import validation
cd frontend && npm run test:e2e                        # Playwright in your local Chrome (own servers + SQLite)
```

- The actionlint test runs when `actionlint` is installed, and is skipped otherwise.
- **CI** (`.github/workflows/ci.yml`) runs all of the above. It also lints every generated Dockerfile with hadolint and builds the production images.

## Database migrations

Schema changes go through Alembic:

```sh
cd backend
.venv/bin/alembic revision --autogenerate -m "describe change"
.venv/bin/alembic upgrade head
```

`tests/test_migrations.py` fails if the models change without a migration.

## Roadmap

- GitLab CI and Jenkins generators (stubs in place)
- AI recommendations (plug an LLM into the `Recommender` interface in `app/recommender/detector.py`)
- Ready-made deploy steps (SSH, cloud providers, Kubernetes)

### FastAPI + React template

Choose **FastAPI + React** for a repository with `backend/requirements.txt`,
`backend/main.py` (exporting `app`), and a React + Vite app in `frontend/` with a
committed `package-lock.json`. The generated root Dockerfile builds React and copies
`frontend/dist` into `/app/static` in the Python runtime image. Compose runs the app
at `http://localhost:8000` alongside PostgreSQL. Configure the backend to use
`DATABASE_URL`; Compose startup ordering does not guarantee database readiness, so
use connection retries in the application.

Serve the frontend by adding this **after your API routes** in `backend/main.py`:

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles

static_dir = Path(__file__).parent / "static"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
```

Use relative `/api/...` URLs in React and put API routes under `/api`. This serves
the index page and static assets; use hash-based frontend routing or add an explicit
SPA fallback for client-side deep links. The template generates configuration,
not application source. Its CI runs backend pytest tests, Ruff, available frontend
lint/test scripts, the Vite build, and a Docker build. Keep frontend test scripts
non-interactive for CI. Replace the sample database credentials before deployment.
