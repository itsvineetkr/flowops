import os

ENV = os.getenv("ENV", "development")
PRODUCTION = ENV == "production"

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://flowops:flowops@localhost:5433/flowops")
_DEV_SECRET = "dev-only-secret-do-not-use-in-production"
SECRET_KEY = os.getenv("SECRET_KEY", _DEV_SECRET)
# GitHub App (not an OAuth App): lets users grant access to only selected repositories.
GITHUB_APP_SLUG = os.getenv("GITHUB_APP_SLUG", "")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
# Enables POST /api/auth/dev-login (local development only).
DEV_LOGIN = os.getenv("DEV_LOGIN") == "1"
# Fernet key for encrypting stored GitHub tokens; derived from SECRET_KEY if unset.
TOKEN_ENC_KEY = os.getenv("TOKEN_ENC_KEY", "")
# Session cookies are HTTPS-only in production; override with COOKIE_SECURE=0/1.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "1" if PRODUCTION else "0") == "1"

if PRODUCTION:
    if SECRET_KEY == _DEV_SECRET or len(SECRET_KEY) < 32:
        raise RuntimeError("Set SECRET_KEY to a random string of at least 32 characters in production")
    if DEV_LOGIN:
        raise RuntimeError("DEV_LOGIN must not be enabled in production")
